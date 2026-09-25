"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/app/[locale]/(app)/games/actions";
import { searchMoviesAction } from "@/app/[locale]/(app)/games/actions";
import { CLUE_KEYS } from "@/lib/game/daily";
import type { Bilingual, MovieOption, RoundView } from "@/lib/game/service";

type Props<V extends RoundView> = {
  view: V;
  onView: (view: V) => void;
  guessAction: (roundId: number, movieId: number) => Promise<ActionResult<V>>;
  title: string;
  badge?: ReactNode;
  // Shown under the result once the round is over (share button, next round, …).
  resultActions?: ReactNode;
};

export function GuessGame<V extends RoundView>({
  view,
  onView,
  guessAction,
  title,
  badge,
  resultActions,
}: Props<V>) {
  const t = useTranslations("daily");
  const locale = useLocale() as "te" | "en";
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<MovieOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const searchId = useRef(0);

  const pick = (b: Bilingual) => b[locale];
  const other = (b: Bilingual) => b[locale === "te" ? "en" : "te"];
  const playing = view.status === "playing";
  const guessesLeft = view.maxGuesses - view.guesses.length;

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Server-side search with a short debounce; answers to outdated queries are dropped.
  function onQueryChange(value: string) {
    setQuery(value);
    clearTimeout(timer.current);
    const id = ++searchId.current;
    const q = value.trim();
    if (!q) {
      setMatches([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      const results = await searchMoviesAction(q);
      if (id !== searchId.current) return;
      const guessed = new Set(view.guesses.map((g) => g.id));
      setMatches(results.filter((r) => !guessed.has(r.id)));
      setSearching(false);
    }, 200);
  }

  function guess(movieId: number) {
    setError(null);
    startTransition(async () => {
      const res = await guessAction(view.roundId, movieId);
      if (res.ok) {
        onView(res.view);
        onQueryChange("");
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

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        {badge}
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
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches[0] && !searching) guess(matches[0].id);
              }}
              disabled={pending}
              placeholder={t("guessPlaceholder")}
              aria-label={t("guessPlaceholder")}
              className="w-full rounded-xl border border-line bg-panel px-4 py-3 outline-none focus:border-gold disabled:opacity-60"
            />
            {query.trim() && !searching && (
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
          {resultActions}
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
