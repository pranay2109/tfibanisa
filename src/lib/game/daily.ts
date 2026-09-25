// Pure rules for the daily "Guess the Movie" game. No DB or framework code here.

export const MAX_GUESSES = 6;

// Clues go from hardest to easiest. One is shown at the start, and each wrong guess reveals the next.
export const CLUE_KEYS = ["year", "musicDirector", "director", "emoji", "leads"] as const;
export type ClueKey = (typeof CLUE_KEYS)[number];

export type AttemptStatus = "playing" | "won" | "lost";

// Puzzle #1 is played on this India-time date. Move it to the real launch day before going live.
export const LAUNCH_DATE = "2026-09-25";

export class GameError extends Error {
  // "expired": the player's screen is still on yesterday's puzzle.
  constructor(public code: "finished" | "duplicate" | "unknown_movie" | "expired") {
    super(code);
  }
}

export function cluesRevealed(wrongGuesses: number, status: AttemptStatus): number {
  if (status !== "playing") return CLUE_KEYS.length;
  return Math.min(1 + wrongGuesses, CLUE_KEYS.length);
}

export function applyGuess(
  guesses: number[],
  guessId: number,
  answerId: number,
): { guesses: number[]; status: AttemptStatus } {
  if (guesses.includes(answerId) || guesses.length >= MAX_GUESSES) {
    throw new GameError("finished");
  }
  if (guesses.includes(guessId)) throw new GameError("duplicate");

  const next = [...guesses, guessId];
  const status: AttemptStatus =
    guessId === answerId ? "won" : next.length >= MAX_GUESSES ? "lost" : "playing";
  return { guesses: next, status };
}

// ---------------------------------------------------------------------------
// Dates. Everything is an ISO "YYYY-MM-DD" string in India time.
// ---------------------------------------------------------------------------

export function indiaDate(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function puzzleNumber(isoDate: string): number {
  return daysBetween(LAUNCH_DATE, isoDate) + 1;
}

// Deterministic pick so every server instance agrees on the same movie for a date.
export function pickMovieId(isoDate: string, candidateIds: number[]): number {
  if (candidateIds.length === 0) throw new Error("No movies available for the daily puzzle");
  const sorted = [...candidateIds].sort((a, b) => a - b);
  // FNV-1a hash of the date string.
  let hash = 0x811c9dc5;
  for (const ch of isoDate) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return sorted[hash % sorted.length];
}

// ---------------------------------------------------------------------------
// Stats and sharing.
// ---------------------------------------------------------------------------

export type Stats = {
  played: number;
  wins: number;
  currentStreak: number;
  maxStreak: number;
  lastPlayedDate: string | null;
  guessDistribution: number[];
};

export const EMPTY_STATS: Stats = {
  played: 0,
  wins: 0,
  currentStreak: 0,
  maxStreak: 0,
  lastPlayedDate: null,
  guessDistribution: Array(MAX_GUESSES).fill(0),
};

export function updateStats(
  stats: Stats,
  result: { date: string; status: "won" | "lost"; guessCount: number },
): Stats {
  const won = result.status === "won";
  const continues = stats.lastPlayedDate === addDays(result.date, -1);
  const currentStreak = won ? (continues ? stats.currentStreak + 1 : 1) : 0;
  const guessDistribution = [...stats.guessDistribution];
  if (won) guessDistribution[result.guessCount - 1] += 1;

  return {
    played: stats.played + 1,
    wins: stats.wins + (won ? 1 : 0),
    currentStreak,
    maxStreak: Math.max(stats.maxStreak, currentStreak),
    lastPlayedDate: result.date,
    guessDistribution,
  };
}

export type UnlimitedStats = {
  played: number;
  wins: number;
  currentStreak: number;
  maxStreak: number;
};

export const EMPTY_UNLIMITED_STATS: UnlimitedStats = {
  played: 0,
  wins: 0,
  currentStreak: 0,
  maxStreak: 0,
};

// Unlimited streaks count wins in a row, with no calendar involved.
export function updateUnlimitedStats(stats: UnlimitedStats, won: boolean): UnlimitedStats {
  const currentStreak = won ? stats.currentStreak + 1 : 0;
  return {
    played: stats.played + 1,
    wins: stats.wins + (won ? 1 : 0),
    currentStreak,
    maxStreak: Math.max(stats.maxStreak, currentStreak),
  };
}

export function shareText(opts: {
  number: number;
  status: "won" | "lost";
  guessCount: number;
  siteUrl: string;
}): string {
  const score = opts.status === "won" ? `${opts.guessCount}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
  const squares =
    opts.status === "won"
      ? "🟥".repeat(opts.guessCount - 1) + "🟩"
      : "🟥".repeat(MAX_GUESSES);
  return `TFI Banisa #${opts.number} ${score}\n${squares}\n${opts.siteUrl}`;
}
