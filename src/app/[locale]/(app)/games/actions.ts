"use server";

import { getSession } from "@/lib/auth";
import { GameError } from "@/lib/game/daily";
import {
  searchMovies,
  startUnlimitedRound,
  submitGuess,
  submitUnlimitedGuess,
  type MovieOption,
  type RoundView,
} from "@/lib/game/service";

export type ActionError = GameError["code"] | "generic" | "unauthorized";
export type ActionResult<T> = { ok: true; view: T } | { ok: false; error: ActionError };

async function run<T>(fn: (userId: string) => Promise<T>): Promise<ActionResult<T>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "unauthorized" };
  try {
    return { ok: true, view: await fn(session.user.id) };
  } catch (err) {
    if (err instanceof GameError) return { ok: false, error: err.code };
    console.error("game action failed", err);
    return { ok: false, error: "generic" };
  }
}

const validIds = (...ids: number[]) => ids.every((id) => Number.isInteger(id) && id > 0);

export async function dailyGuessAction(puzzleId: number, movieId: number) {
  if (!validIds(puzzleId, movieId)) return { ok: false, error: "unknown_movie" } as const;
  return run((userId) => submitGuess(userId, puzzleId, movieId));
}

export async function unlimitedGuessAction(roundId: number, movieId: number) {
  if (!validIds(roundId, movieId)) return { ok: false, error: "unknown_movie" } as const;
  return run((userId) => submitUnlimitedGuess(userId, roundId, movieId));
}

export async function nextRoundAction(): Promise<ActionResult<RoundView>> {
  return run((userId) => startUnlimitedRound(userId));
}

export async function searchMoviesAction(query: string): Promise<MovieOption[]> {
  if (!(await getSession())) return [];
  return searchMovies(String(query));
}
