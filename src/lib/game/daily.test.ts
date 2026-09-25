import { describe, expect, it } from "vitest";
import {
  EMPTY_STATS,
  EMPTY_UNLIMITED_STATS,
  GameError,
  MAX_GUESSES,
  addDays,
  applyGuess,
  cluesRevealed,
  indiaDate,
  pickMovieId,
  puzzleNumber,
  shareText,
  updateStats,
  updateUnlimitedStats,
} from "./daily";

describe("applyGuess", () => {
  it("wins on the right movie", () => {
    expect(applyGuess([4, 5], 9, 9)).toEqual({ guesses: [4, 5, 9], status: "won" });
  });

  it("keeps playing on a wrong guess", () => {
    expect(applyGuess([], 4, 9)).toEqual({ guesses: [4], status: "playing" });
  });

  it("loses after the last wrong guess", () => {
    expect(applyGuess([1, 2, 3, 4, 5], 6, 9).status).toBe("lost");
  });

  it("rejects the same movie twice", () => {
    expect(() => applyGuess([4], 4, 9)).toThrow(GameError);
  });

  it("rejects guesses after the game is over", () => {
    expect(() => applyGuess([9], 4, 9)).toThrow("finished");
    expect(() => applyGuess([1, 2, 3, 4, 5, 6], 7, 9)).toThrow("finished");
  });
});

describe("cluesRevealed", () => {
  it("starts with one clue and adds one per wrong guess", () => {
    expect(cluesRevealed(0, "playing")).toBe(1);
    expect(cluesRevealed(2, "playing")).toBe(3);
    expect(cluesRevealed(5, "playing")).toBe(5);
  });

  it("shows everything when the game is over", () => {
    expect(cluesRevealed(0, "won")).toBe(5);
  });
});

describe("dates", () => {
  it("uses India time, not UTC", () => {
    // 20:00 UTC is 01:30 the next day in India.
    expect(indiaDate(new Date("2026-09-25T20:00:00Z"))).toBe("2026-09-26");
    expect(indiaDate(new Date("2026-09-25T18:00:00Z"))).toBe("2026-09-25");
  });

  it("adds days across month ends", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("numbers puzzles from launch day", () => {
    expect(puzzleNumber("2026-09-25")).toBe(1);
    expect(puzzleNumber("2026-10-05")).toBe(11);
  });
});

describe("pickMovieId", () => {
  it("is stable for a date regardless of input order", () => {
    expect(pickMovieId("2026-10-01", [3, 1, 2])).toBe(pickMovieId("2026-10-01", [1, 2, 3]));
  });

  it("spreads picks across movies", () => {
    const ids = Array.from({ length: 20 }, (_, i) => i + 1);
    const picks = new Set(
      Array.from({ length: 60 }, (_, i) => pickMovieId(addDays("2026-10-01", i), ids)),
    );
    expect(picks.size).toBeGreaterThan(10);
  });

  it("fails loudly with no movies", () => {
    expect(() => pickMovieId("2026-10-01", [])).toThrow();
  });
});

describe("updateStats", () => {
  it("counts a first win", () => {
    const s = updateStats(EMPTY_STATS, { date: "2026-10-01", status: "won", guessCount: 3 });
    expect(s).toMatchObject({ played: 1, wins: 1, currentStreak: 1, maxStreak: 1 });
    expect(s.guessDistribution).toEqual([0, 0, 1, 0, 0, 0]);
  });

  it("extends the streak on consecutive days", () => {
    const day1 = updateStats(EMPTY_STATS, { date: "2026-10-01", status: "won", guessCount: 1 });
    const day2 = updateStats(day1, { date: "2026-10-02", status: "won", guessCount: 2 });
    expect(day2.currentStreak).toBe(2);
    expect(day2.maxStreak).toBe(2);
  });

  it("restarts the streak after a missed day", () => {
    const day1 = updateStats(EMPTY_STATS, { date: "2026-10-01", status: "won", guessCount: 1 });
    const day3 = updateStats(day1, { date: "2026-10-03", status: "won", guessCount: 1 });
    expect(day3.currentStreak).toBe(1);
    expect(day3.maxStreak).toBe(1);
  });

  it("breaks the streak on a loss but keeps the max", () => {
    const day1 = updateStats(EMPTY_STATS, { date: "2026-10-01", status: "won", guessCount: 1 });
    const day2 = updateStats(day1, { date: "2026-10-02", status: "lost", guessCount: MAX_GUESSES });
    expect(day2).toMatchObject({ played: 2, wins: 1, currentStreak: 0, maxStreak: 1 });
  });
});

describe("updateUnlimitedStats", () => {
  it("counts wins in a row and resets on a loss", () => {
    let s = updateUnlimitedStats(EMPTY_UNLIMITED_STATS, true);
    s = updateUnlimitedStats(s, true);
    expect(s).toMatchObject({ played: 2, wins: 2, currentStreak: 2, maxStreak: 2 });
    s = updateUnlimitedStats(s, false);
    expect(s).toMatchObject({ played: 3, wins: 2, currentStreak: 0, maxStreak: 2 });
  });
});

describe("shareText", () => {
  it("shows wrong guesses then the hit", () => {
    expect(
      shareText({ number: 7, status: "won", guessCount: 3, siteUrl: "https://tfibanisa.app" }),
    ).toBe("TFI Banisa #7 3/6\n🟥🟥🟩\nhttps://tfibanisa.app");
  });

  it("shows X on a loss", () => {
    expect(
      shareText({ number: 7, status: "lost", guessCount: 6, siteUrl: "https://tfibanisa.app" }),
    ).toContain("X/6\n🟥🟥🟥🟥🟥🟥");
  });
});
