import "server-only";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  dailyAttempts,
  dailyPuzzles,
  movieLeads,
  movies,
  people,
  user,
  userStats,
} from "@/db/schema";
import {
  CLUE_KEYS,
  EMPTY_STATS,
  GameError,
  MAX_GUESSES,
  applyGuess,
  cluesRevealed,
  indiaDate,
  pickMovieId,
  puzzleNumber,
  updateStats,
  type AttemptStatus,
  type ClueKey,
  type Stats,
} from "./daily";

export type Bilingual = { en: string; te: string };

export type DailyView = {
  puzzleId: number;
  number: number;
  date: string;
  status: AttemptStatus;
  maxGuesses: number;
  guesses: { id: number; title: Bilingual; correct: boolean }[];
  // Only the clues the player has unlocked so far.
  clues: { key: ClueKey; value: Bilingual }[];
  // Filled in only once the game is over.
  answer: { title: Bilingual; year: number } | null;
};

export type MovieOption = { id: number; title: Bilingual; year: number };

type Puzzle = typeof dailyPuzzles.$inferSelect;

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
    .where(and(eq(movies.isActive, true), notInArray(movies.id, used)));
  if (candidates.length === 0) {
    candidates = await db.select({ id: movies.id }).from(movies).where(eq(movies.isActive, true));
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

async function loadClues(movieId: number): Promise<Record<ClueKey, Bilingual>> {
  const [movie] = await db.select().from(movies).where(eq(movies.id, movieId));
  const crew = await db
    .select()
    .from(people)
    .where(inArray(people.id, [movie.directorId, movie.musicDirectorId]));
  const leads = await db
    .select({ nameEn: people.nameEn, nameTe: people.nameTe })
    .from(movieLeads)
    .innerJoin(people, eq(movieLeads.personId, people.id))
    .where(eq(movieLeads.movieId, movieId))
    .orderBy(asc(movieLeads.billingOrder));

  const person = (id: number): Bilingual => {
    const p = crew.find((c) => c.id === id)!;
    return { en: p.nameEn, te: p.nameTe };
  };

  return {
    year: { en: String(movie.year), te: String(movie.year) },
    musicDirector: person(movie.musicDirectorId),
    director: person(movie.directorId),
    emoji: { en: movie.emoji, te: movie.emoji },
    leads: {
      en: leads.map((l) => l.nameEn).join(", "),
      te: leads.map((l) => l.nameTe).join(", "),
    },
  };
}

export async function getMovieOptions(): Promise<MovieOption[]> {
  const rows = await db
    .select({ id: movies.id, en: movies.titleEn, te: movies.titleTe, year: movies.year })
    .from(movies)
    .orderBy(asc(movies.titleEn));
  return rows.map((r) => ({ id: r.id, title: { en: r.en, te: r.te }, year: r.year }));
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

  const guessed = attempt.guesses.length
    ? await db
        .select({ id: movies.id, en: movies.titleEn, te: movies.titleTe })
        .from(movies)
        .where(inArray(movies.id, attempt.guesses))
    : [];

  const clues = await loadClues(puzzle.movieId);
  const wrong = attempt.guesses.filter((id) => id !== puzzle.movieId).length;
  const shown = cluesRevealed(wrong, attempt.status);

  let answer: DailyView["answer"] = null;
  if (attempt.status !== "playing") {
    const [m] = await db.select().from(movies).where(eq(movies.id, puzzle.movieId));
    answer = { title: { en: m.titleEn, te: m.titleTe }, year: m.year };
  }

  return {
    puzzleId: puzzle.id,
    number: puzzleNumber(puzzle.puzzleDate),
    date: puzzle.puzzleDate,
    status: attempt.status,
    maxGuesses: MAX_GUESSES,
    guesses: attempt.guesses.map((id) => {
      const m = guessed.find((g) => g.id === id)!;
      return { id, title: { en: m.en, te: m.te }, correct: id === puzzle.movieId };
    }),
    clues: CLUE_KEYS.slice(0, shown).map((key) => ({ key, value: clues[key] })),
    answer,
  };
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

    const [movie] = await tx.select({ id: movies.id }).from(movies).where(eq(movies.id, movieId));
    if (!movie) throw new GameError("unknown_movie");

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
