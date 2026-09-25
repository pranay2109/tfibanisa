import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, ne, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  dailyAttempts,
  dailyPuzzles,
  movieLeads,
  movies,
  people,
  unlimitedRounds,
  unlimitedStats,
  user,
  userStats,
} from "@/db/schema";
import {
  CLUE_KEYS,
  EMPTY_STATS,
  EMPTY_UNLIMITED_STATS,
  GameError,
  MAX_GUESSES,
  applyGuess,
  cluesRevealed,
  indiaDate,
  pickMovieId,
  puzzleNumber,
  updateStats,
  updateUnlimitedStats,
  type AttemptStatus,
  type ClueKey,
  type Stats,
  type UnlimitedStats,
} from "./daily";

export type Bilingual = { en: string; te: string };

// What the game screen needs for one round, in either mode.
export type RoundView = {
  roundId: number;
  status: AttemptStatus;
  maxGuesses: number;
  guesses: { id: number; title: Bilingual; correct: boolean }[];
  // Only the clues the player has unlocked so far.
  clues: { key: ClueKey; value: Bilingual }[];
  // Filled in only once the round is over.
  answer: { title: Bilingual; year: number } | null;
};

export type DailyView = RoundView & { number: number; date: string };

export type MovieOption = { id: number; title: Bilingual; year: number };

type Puzzle = typeof dailyPuzzles.$inferSelect;

// A movie can be an answer only when it's reviewed (active) and every clue exists.
const playable = and(
  eq(movies.isActive, true),
  eq(movies.hidden, false),
  isNotNull(movies.directorId),
  isNotNull(movies.musicDirectorId),
  isNotNull(movies.emoji),
  sql`exists (select 1 from ${movieLeads} where ${movieLeads.movieId} = ${movies.id})`,
);

// ---------------------------------------------------------------------------
// Shared round logic
// ---------------------------------------------------------------------------

async function loadClues(movieId: number): Promise<Record<ClueKey, Bilingual>> {
  const [movie] = await db.select().from(movies).where(eq(movies.id, movieId));
  const crewIds = [movie.directorId, movie.musicDirectorId].filter((id): id is number => id !== null);
  const crew = crewIds.length
    ? await db.select().from(people).where(inArray(people.id, crewIds))
    : [];
  const leads = await db
    .select({ nameEn: people.nameEn, nameTe: people.nameTe })
    .from(movieLeads)
    .innerJoin(people, eq(movieLeads.personId, people.id))
    .where(eq(movieLeads.movieId, movieId))
    .orderBy(asc(movieLeads.billingOrder));

  const person = (id: number | null): Bilingual => {
    const p = crew.find((c) => c.id === id);
    return p ? { en: p.nameEn, te: p.nameTe } : { en: "?", te: "?" };
  };

  return {
    year: { en: String(movie.year), te: String(movie.year) },
    musicDirector: person(movie.musicDirectorId),
    director: person(movie.directorId),
    emoji: { en: movie.emoji ?? "?", te: movie.emoji ?? "?" },
    leads: {
      en: leads.map((l) => l.nameEn).join(", "),
      te: leads.map((l) => l.nameTe).join(", "),
    },
  };
}

async function buildRoundView(
  roundId: number,
  answerId: number,
  guesses: number[],
  status: AttemptStatus,
): Promise<RoundView> {
  const guessed = guesses.length
    ? await db
        .select({ id: movies.id, en: movies.titleEn, te: movies.titleTe })
        .from(movies)
        .where(inArray(movies.id, guesses))
    : [];

  const clues = await loadClues(answerId);
  const wrong = guesses.filter((id) => id !== answerId).length;
  const shown = cluesRevealed(wrong, status);

  let answer: RoundView["answer"] = null;
  if (status !== "playing") {
    const [m] = await db.select().from(movies).where(eq(movies.id, answerId));
    answer = { title: { en: m.titleEn, te: m.titleTe }, year: m.year };
  }

  return {
    roundId,
    status,
    maxGuesses: MAX_GUESSES,
    guesses: guesses.map((id) => {
      const m = guessed.find((g) => g.id === id)!;
      return { id, title: { en: m.en, te: m.te }, correct: id === answerId };
    }),
    clues: CLUE_KEYS.slice(0, shown).map((key) => ({ key, value: clues[key] })),
    answer,
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function assertMovieExists(tx: Tx, movieId: number) {
  const [movie] = await tx.select({ id: movies.id }).from(movies).where(eq(movies.id, movieId));
  if (!movie) throw new GameError("unknown_movie");
}

// Guess search: every movie is searchable. Exact substring matches come first, then close
// spellings (English spellings of Telugu titles vary: "vaikunta"/"vaikuntha", "puspa"/"pushpa"),
// then fame. Fuzzy matching uses pg_trgm and is skipped for very short queries.
const FUZZY_THRESHOLD = 0.45;

export async function searchMovies(query: string, limit = 8): Promise<MovieOption[]> {
  const q = query.trim().slice(0, 60);
  if (!q) return [];
  const key = sql`lower(regexp_replace(${q}, '[[:space:][:punct:]]', '', 'g'))`;
  const exact = sql`${movies.searchKey} like '%' || ${key} || '%'`;
  const fuzzy = sql`word_similarity(${key}, ${movies.searchKey})`;
  const fuzzyOk = [...q.replace(/[\s\p{P}]/gu, "")].length >= 3;

  const rows = await db
    .select({ id: movies.id, en: movies.titleEn, te: movies.titleTe, year: movies.year })
    .from(movies)
    .where(
      and(
        eq(movies.hidden, false),
        fuzzyOk ? sql`(${exact} or ${fuzzy} >= ${FUZZY_THRESHOLD})` : exact,
      ),
    )
    .orderBy(
      desc(exact),
      ...(fuzzyOk ? [desc(fuzzy)] : []),
      desc(movies.popularity),
      desc(movies.year),
    )
    .limit(limit);
  return rows.map((r) => ({ id: r.id, title: { en: r.en, te: r.te }, year: r.year }));
}

// ---------------------------------------------------------------------------
// Daily game
// ---------------------------------------------------------------------------

export async function getOrCreatePuzzle(date: string = indiaDate()): Promise<Puzzle> {
  const [existing] = await db
    .select()
    .from(dailyPuzzles)
    .where(eq(dailyPuzzles.puzzleDate, date))
    .limit(1);
  if (existing) return existing;

  // Prefer movies that have never been an answer; start over once all have been used.
  const used = db.select({ id: dailyPuzzles.movieId }).from(dailyPuzzles);
  let candidates = await db
    .select({ id: movies.id })
    .from(movies)
    .where(and(playable, notInArray(movies.id, used)));
  if (candidates.length === 0) {
    candidates = await db.select({ id: movies.id }).from(movies).where(playable);
  }

  const movieId = pickMovieId(
    date,
    candidates.map((c) => c.id),
  );
  // Two requests can race at midnight; the unique date keeps one winner.
  await db.insert(dailyPuzzles).values({ puzzleDate: date, movieId }).onConflictDoNothing();
  const [puzzle] = await db
    .select()
    .from(dailyPuzzles)
    .where(eq(dailyPuzzles.puzzleDate, date))
    .limit(1);
  return puzzle;
}

export async function getDailyView(userId: string): Promise<DailyView> {
  const puzzle = await getOrCreatePuzzle();

  // Opening the puzzle starts the clock used for leaderboard tie-breaks.
  await db
    .insert(dailyAttempts)
    .values({ userId, puzzleId: puzzle.id })
    .onConflictDoNothing();
  const [attempt] = await db
    .select()
    .from(dailyAttempts)
    .where(and(eq(dailyAttempts.userId, userId), eq(dailyAttempts.puzzleId, puzzle.id)));

  const view = await buildRoundView(puzzle.id, puzzle.movieId, attempt.guesses, attempt.status);
  return { ...view, number: puzzleNumber(puzzle.puzzleDate), date: puzzle.puzzleDate };
}

export async function submitGuess(
  userId: string,
  puzzleId: number,
  movieId: number,
): Promise<DailyView> {
  const puzzle = await getOrCreatePuzzle();
  if (puzzle.id !== puzzleId) throw new GameError("expired");

  await db.transaction(async (tx) => {
    await tx
      .insert(dailyAttempts)
      .values({ userId, puzzleId: puzzle.id })
      .onConflictDoNothing();
    // Lock the row so two quick taps can't both count.
    const [attempt] = await tx
      .select()
      .from(dailyAttempts)
      .where(and(eq(dailyAttempts.userId, userId), eq(dailyAttempts.puzzleId, puzzle.id)))
      .for("update");
    await assertMovieExists(tx, movieId);

    const result = applyGuess(attempt.guesses, movieId, puzzle.movieId);
    const finished = result.status !== "playing";
    await tx
      .update(dailyAttempts)
      .set({
        guesses: result.guesses,
        status: result.status,
        finishedAt: finished ? new Date() : null,
      })
      .where(eq(dailyAttempts.id, attempt.id));

    if (finished) {
      const [row] = await tx
        .select()
        .from(userStats)
        .where(eq(userStats.userId, userId))
        .for("update");
      const next = updateStats(row ?? EMPTY_STATS, {
        date: puzzle.puzzleDate,
        status: result.status as "won" | "lost",
        guessCount: result.guesses.length,
      });
      await tx
        .insert(userStats)
        .values({ userId, ...next })
        .onConflictDoUpdate({ target: userStats.userId, set: next });
    }
  });

  return getDailyView(userId);
}

export async function getStats(userId: string): Promise<Stats> {
  const [row] = await db.select().from(userStats).where(eq(userStats.userId, userId));
  return row ?? EMPTY_STATS;
}

export type LeaderboardRow = { rank: number; name: string; guesses: number; seconds: number };

// The leaderboard is public, so show "Pranay M." rather than a full name.
function publicName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  if (!first) return "Banisa";
  const last = rest.at(-1);
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}

// Today's winners: fewest guesses first, then fastest.
export async function getTodayLeaderboard(limit = 20): Promise<LeaderboardRow[]> {
  const puzzle = await getOrCreatePuzzle();
  const guessCount = sql<number>`jsonb_array_length(${dailyAttempts.guesses})`;
  const seconds = sql<number>`extract(epoch from ${dailyAttempts.finishedAt} - ${dailyAttempts.startedAt})`;

  const rows = await db
    .select({ name: user.name, guesses: guessCount, seconds })
    .from(dailyAttempts)
    .innerJoin(user, eq(dailyAttempts.userId, user.id))
    .where(and(eq(dailyAttempts.puzzleId, puzzle.id), eq(dailyAttempts.status, "won")))
    .orderBy(asc(guessCount), asc(seconds))
    .limit(limit);

  return rows.map((r, i) => ({
    rank: i + 1,
    name: publicName(r.name),
    guesses: Number(r.guesses),
    seconds: Math.round(Number(r.seconds)),
  }));
}

export type TodaySummary = {
  number: number;
  status: AttemptStatus | "not_started";
  guessCount: number;
};

// Read-only peek for the dashboard. Unlike getDailyView it does not start the clock.
export async function getTodaySummary(userId: string): Promise<TodaySummary> {
  const puzzle = await getOrCreatePuzzle();
  const [attempt] = await db
    .select({ status: dailyAttempts.status, guesses: dailyAttempts.guesses })
    .from(dailyAttempts)
    .where(and(eq(dailyAttempts.userId, userId), eq(dailyAttempts.puzzleId, puzzle.id)));
  const number = puzzleNumber(puzzle.puzzleDate);
  if (!attempt || (attempt.status === "playing" && attempt.guesses.length === 0)) {
    return { number, status: "not_started", guessCount: 0 };
  }
  return { number, status: attempt.status, guessCount: attempt.guesses.length };
}

// ---------------------------------------------------------------------------
// Unlimited mode
// ---------------------------------------------------------------------------

// Skip the last N answers this player saw so rounds don't repeat quickly.
const RECENT_ROUNDS = 100;

async function pickUnlimitedMovie(tx: Tx, userId: string): Promise<number> {
  // Never serve today's daily answer: that would spoil the daily game.
  const today = await getOrCreatePuzzle();
  const recent = tx
    .select({ id: unlimitedRounds.movieId })
    .from(unlimitedRounds)
    .where(eq(unlimitedRounds.userId, userId))
    .orderBy(desc(unlimitedRounds.id))
    .limit(RECENT_ROUNDS);

  const pick = (extra?: ReturnType<typeof and>) =>
    tx
      .select({ id: movies.id })
      .from(movies)
      .where(and(playable, ne(movies.id, today.movieId), extra))
      .orderBy(sql`random()`)
      .limit(1);

  const [fresh] = await pick(notInArray(movies.id, recent));
  if (fresh) return fresh.id;
  // Played through the whole pool recently; allow repeats.
  const [any] = await pick();
  if (!any) throw new Error("No playable movies for unlimited mode");
  return any.id;
}

async function latestRound(tx: Tx | typeof db, userId: string, lock = false) {
  const q = tx
    .select()
    .from(unlimitedRounds)
    .where(eq(unlimitedRounds.userId, userId))
    .orderBy(desc(unlimitedRounds.id))
    .limit(1);
  const [row] = lock ? await q.for("update") : await q;
  return row ?? null;
}

async function viewOf(round: typeof unlimitedRounds.$inferSelect): Promise<RoundView> {
  return buildRoundView(round.id, round.movieId, round.guesses, round.status);
}

// The player's current round: the one in progress, or the last finished one (so its result
// stays on screen until they ask for the next film). Creates the first round on first visit.
export async function getUnlimitedView(userId: string): Promise<RoundView> {
  const round = await latestRound(db, userId);
  if (round) return viewOf(round);
  return startUnlimitedRound(userId);
}

export async function startUnlimitedRound(userId: string): Promise<RoundView> {
  const round = await db.transaction(async (tx) => {
    // Serialise per user so a double tap on "Next film" can't open two rounds.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`unlimited:${userId}`}))`);
    const current = await latestRound(tx, userId);
    if (current?.status === "playing") return current;
    const movieId = await pickUnlimitedMovie(tx, userId);
    const [created] = await tx.insert(unlimitedRounds).values({ userId, movieId }).returning();
    return created;
  });
  return viewOf(round);
}

export async function submitUnlimitedGuess(
  userId: string,
  roundId: number,
  movieId: number,
): Promise<RoundView> {
  const round = await db.transaction(async (tx) => {
    const current = await latestRound(tx, userId, true);
    if (!current || current.id !== roundId) throw new GameError("expired");
    await assertMovieExists(tx, movieId);

    const result = applyGuess(current.guesses, movieId, current.movieId);
    const finished = result.status !== "playing";
    const [updated] = await tx
      .update(unlimitedRounds)
      .set({
        guesses: result.guesses,
        status: result.status,
        finishedAt: finished ? new Date() : null,
      })
      .where(eq(unlimitedRounds.id, current.id))
      .returning();

    if (finished) {
      const [row] = await tx
        .select()
        .from(unlimitedStats)
        .where(eq(unlimitedStats.userId, userId))
        .for("update");
      const next = updateUnlimitedStats(row ?? EMPTY_UNLIMITED_STATS, result.status === "won");
      await tx
        .insert(unlimitedStats)
        .values({ userId, ...next })
        .onConflictDoUpdate({ target: unlimitedStats.userId, set: next });
    }
    return updated;
  });
  return viewOf(round);
}

export async function getUnlimitedStats(userId: string): Promise<UnlimitedStats> {
  const [row] = await db.select().from(unlimitedStats).where(eq(unlimitedStats.userId, userId));
  return row ?? EMPTY_UNLIMITED_STATS;
}
