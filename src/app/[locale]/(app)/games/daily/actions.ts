"use server";

import { getSession } from "@/lib/auth";
import { GameError } from "@/lib/game/daily";
import { submitGuess, type DailyView } from "@/lib/game/service";

export type GuessResult =
  | { ok: true; view: DailyView }
  | { ok: false; error: GameError["code"] | "generic" | "unauthorized" };

export async function guessAction(puzzleId: number, movieId: number): Promise<GuessResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "unauthorized" };
  if (!Number.isInteger(puzzleId) || !Number.isInteger(movieId)) {
    return { ok: false, error: "unknown_movie" };
  }

  try {
    return { ok: true, view: await submitGuess(session.user.id, puzzleId, movieId) };
  } catch (err) {
    if (err instanceof GameError) return { ok: false, error: err.code };
    console.error("guessAction failed", err);
    return { ok: false, error: "generic" };
  }
}
