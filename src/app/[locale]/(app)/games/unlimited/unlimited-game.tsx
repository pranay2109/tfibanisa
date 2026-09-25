"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { GuessGame } from "@/components/guess-game";
import { useRouter } from "@/i18n/navigation";
import type { UnlimitedStats } from "@/lib/game/daily";
import type { RoundView } from "@/lib/game/service";
import { nextRoundAction, unlimitedGuessAction } from "../actions";

type Props = { initialView: RoundView; stats: UnlimitedStats };

export function UnlimitedGame({ initialView, stats }: Props) {
  const t = useTranslations("unlimited");
  const tErr = useTranslations("daily.errors");
  const router = useRouter();
  const [view, setView] = useState(initialView);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onView(next: RoundView) {
    setView(next);
    // A finished round changes the stats shown in the header.
    if (next.status !== "playing") router.refresh();
  }

  function nextFilm() {
    setError(null);
    startTransition(async () => {
      const res = await nextRoundAction();
      if (res.ok) setView(res.view);
      else setError(tErr(res.error === "unauthorized" ? "generic" : res.error));
    });
  }

  return (
    <GuessGame
      view={view}
      onView={onView}
      guessAction={unlimitedGuessAction}
      title={t("title")}
      badge={
        <span className="text-right text-sm text-muted">
          <span className="font-semibold text-gold">🔥 {stats.currentStreak}</span> {t("inARow")}
          <span className="mx-2 text-line">|</span>
          {t("solved", { wins: stats.wins, played: stats.played })}
        </span>
      }
      resultActions={
        <>
          <button
            type="button"
            onClick={nextFilm}
            disabled={pending}
            className="rounded-full bg-gold px-6 py-2.5 font-semibold text-ink hover:bg-gold-strong disabled:opacity-60"
          >
            {t("nextFilm")}
          </button>
          {error && <p className="text-sm text-miss">{error}</p>}
          <p className="text-xs text-muted">{t("note")}</p>
        </>
      }
    />
  );
}
