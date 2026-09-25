"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { GuessGame } from "@/components/guess-game";
import { Link } from "@/i18n/navigation";
import { shareText } from "@/lib/game/daily";
import type { DailyView } from "@/lib/game/service";
import { dailyGuessAction } from "../actions";

export function DailyGame({ initialView, siteUrl }: { initialView: DailyView; siteUrl: string }) {
  const t = useTranslations("daily");
  const [view, setView] = useState(initialView);
  const [copied, setCopied] = useState(false);

  async function share() {
    if (view.status === "playing") return;
    const text = shareText({
      number: view.number,
      status: view.status,
      guessCount: view.guesses.length,
      siteUrl,
    });
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // User closed the share sheet; fall back to copying.
      }
    }
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  return (
    <GuessGame
      view={view}
      onView={setView}
      guessAction={dailyGuessAction}
      title={t("title")}
      badge={<span className="font-semibold text-gold">{t("number", { number: view.number })}</span>}
      resultActions={
        <>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={share}
              className="rounded-full bg-gold px-5 py-2.5 font-semibold text-ink hover:bg-gold-strong"
            >
              {t("share")}
            </button>
            <Link
              href="/games/unlimited"
              className="rounded-full border border-gold px-5 py-2.5 font-semibold text-gold hover:bg-gold/10"
            >
              {t("keepPlaying")}
            </Link>
          </div>
          {copied && <p className="text-sm text-hit">{t("copied")}</p>}
          <p className="text-xs text-muted">{t("comeBack")}</p>
        </>
      }
    />
  );
}
