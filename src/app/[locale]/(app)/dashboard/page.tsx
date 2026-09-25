import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";
import { MAX_GUESSES } from "@/lib/game/daily";
import { getStats, getTodaySummary, getUnlimitedStats } from "@/lib/game/service";

export default async function DashboardPage({ params }: PageProps<"/[locale]/dashboard">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const [t, today, stats, unlimited] = await Promise.all([
    getTranslations("dashboard"),
    getTodaySummary(user.id),
    getStats(user.id),
    getUnlimitedStats(user.id),
  ]);

  const name = user.name || user.email.split("@")[0];
  const winRate = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
  const maxBar = Math.max(1, ...stats.guessDistribution);

  const status = {
    not_started: { text: t("notPlayed"), cta: t("playNow") },
    playing: {
      text: t("inProgress", { left: MAX_GUESSES - today.guessCount }),
      cta: t("continue"),
    },
    won: { text: t("won", { guesses: today.guessCount }), cta: t("viewResult") },
    lost: { text: t("lost"), cta: t("viewResult") },
  }[today.status];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("welcome", { name })}</h1>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gold/40 bg-panel p-5">
        <div className="space-y-1">
          <h2 className="font-semibold text-gold">{t("todayTitle", { number: today.number })}</h2>
          <p className="text-sm text-muted">{status.text}</p>
        </div>
        <Link
          href="/games/daily"
          className="rounded-full bg-gold px-5 py-2.5 font-semibold text-ink hover:bg-gold-strong"
        >
          {status.cta}
        </Link>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-panel p-5">
        <div className="space-y-1">
          <h2 className="font-semibold">{t("unlimitedTitle")}</h2>
          <p className="text-sm text-muted">{t("unlimitedText", { max: unlimited.maxStreak })}</p>
        </div>
        <Link
          href="/games/unlimited"
          className="rounded-full border border-gold px-5 py-2.5 font-semibold text-gold hover:bg-gold/10"
        >
          {t("unlimitedCta")}
        </Link>
      </section>

      <section className="space-y-4 rounded-2xl border border-line bg-panel p-5">
        <h2 className="font-semibold">{t("statsTitle")}</h2>
        <dl className="grid grid-cols-4 gap-2 text-center">
          {[
            [t("played"), stats.played],
            [t("winRate"), winRate],
            [t("streak"), stats.currentStreak],
            [t("maxStreak"), stats.maxStreak],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dd className="text-2xl font-bold">{value}</dd>
              <dt className="text-xs text-muted">{label}</dt>
            </div>
          ))}
        </dl>

        <div className="space-y-1.5">
          <h3 className="text-sm text-muted">{t("distribution")}</h3>
          {stats.guessDistribution.map((count, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="w-3 text-muted">{i + 1}</span>
              <div
                className="rounded bg-gold/80 px-2 text-right text-xs font-semibold text-ink"
                style={{ width: `${Math.max(8, (count / maxBar) * 100)}%` }}
              >
                {count}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
