"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { CLUE_KEYS, shareText } from "@/lib/game/daily";
import type { Bilingual, DailyView, MovieOption } from "@/lib/game/service";
import { guessAction } from "./actions";

type Props = { initialView: DailyView; options: MovieOption[]; siteUrl: string };

// Lowercase and drop spaces/punctuation so "ala vaikunta" matches "Ala Vaikunthapurramuloo".
// Telugu letters and vowel signs (\p{M}) are kept.
function normalize(s: string) {
  return s.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}

export function DailyGame({ initialView, options, siteUrl }: Props) {
  const t = useTranslations("daily");
  const locale = useLocale() as "te" | "en";
  const [view, setView] = useState(initialView);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const pick = (b: Bilingual) => b[locale];
  const other = (b: Bilingual) => b[locale === "te" ? "en" : "te"];
  const playing = view.status === "playing";
  const guessesLeft = view.maxGuesses - view.guesses.length;

  const matches = useMemo(() => {
    const q = normalize(query);
    if (!q) return [];
    const guessed = new Set(view.guesses.map((g) => g.id));
    return options
      .filter((o) => !guessed.has(o.id))
      .filter((o) => normalize(o.title.en).includes(q) || normalize(o.title.te).includes(q))
      .slice(0, 6);
  }, [query, options, view.guesses]);

  function guess(movieId: number) {
    setError(null);
    startTransition(async () => {
      const res = await guessAction(view.puzzleId, movieId);
      if (res.ok) {
        setView(res.view);
        setQuery("");
        return;
      }
      if (res.error === "unauthorized" || res.error === "expired") {
        if (res.error === "expired") setError(t("errors.expired"));
        window.location.reload();
        return;
      }
      setError(t(`errors.${res.error}`));
    });
  }

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
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <span className="font-semibold text-gold">{t("number", { number: view.number })}</span>
      </div>

      {/* Clues */}
      <section className="space-y-2">
        <h2 className="text-sm text-muted">{t("clues")}</h2>
        <ol className="space-y-2">
          {CLUE_KEYS.map((key, i) => {
            const clue = view.clues.find((c) => c.key === key);
            return (
              <li
                key={key}
                className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
                  clue ? "border-gold/40 bg-panel" : "border-dashed border-line text-muted"
                }`}
              >
                <span className="text-sm text-muted">
                  {i + 1}. {t(`clue.${key}`)}
                </span>
                <span className={`text-right font-semibold ${key === "emoji" ? "text-2xl" : ""}`}>
                  {clue ? pick(clue.value) : <span className="text-xs">🔒 {t("lockedClue")}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Guess box */}
      {playing && (
        <section className="space-y-2">
          <div className="relative">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches[0]) guess(matches[0].id);
              }}
              disabled={pending}
              placeholder={t("guessPlaceholder")}
              aria-label={t("guessPlaceholder")}
              className="w-full rounded-xl border border-line bg-panel px-4 py-3 outline-none focus:border-gold disabled:opacity-60"
            />
            {query && (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-line bg-panel-2 shadow-xl">
                {matches.length === 0 ? (
                  <li className="px-4 py-3 text-sm text-muted">{t("noMatch")}</li>
                ) : (
                  matches.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => guess(m.id)}
                        disabled={pending}
                        className="flex w-full items-baseline justify-between gap-3 px-4 py-2.5 text-left hover:bg-line"
                      >
                        <span>
                          {pick(m.title)}
                          <span className="ml-2 text-xs text-muted">{other(m.title)}</span>
                        </span>
                        <span className="text-xs text-muted">{m.year}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
          <p className="text-sm text-muted">{t("guessesLeft", { left: guessesLeft })}</p>
          {error && <p className="text-sm text-miss">{error}</p>}
        </section>
      )}

      {/* Result */}
      {!playing && view.answer && (
        <section
          className={`space-y-3 rounded-2xl border p-5 text-center ${
            view.status === "won" ? "border-hit/50 bg-hit/10" : "border-miss/50 bg-miss/10"
          }`}
        >
          <p className="text-lg font-bold">
            {view.status === "won" ? t("won", { guesses: view.guesses.length }) : t("lost")}
          </p>
          <p>{t("answerWas", { title: pick(view.answer.title), year: view.answer.year })}</p>
          <button
            type="button"
            onClick={share}
            className="rounded-full bg-gold px-5 py-2.5 font-semibold text-ink hover:bg-gold-strong"
          >
            {t("share")}
          </button>
          {copied && <p className="text-sm text-hit">{t("copied")}</p>}
          <p className="text-xs text-muted">{t("comeBack")}</p>
        </section>
      )}

      {/* Past guesses */}
      {view.guesses.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm text-muted">{t("yourGuesses")}</h2>
          <ul className="space-y-1.5">
            {view.guesses.map((g) => (
              <li key={g.id} className="flex items-center gap-3 rounded-lg bg-panel px-3 py-2">
                <span aria-hidden>{g.correct ? "🟩" : "🟥"}</span>
                <span className={g.correct ? "font-semibold text-hit" : "line-through opacity-70"}>
                  {pick(g.title)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
