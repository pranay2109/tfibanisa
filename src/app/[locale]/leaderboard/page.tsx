import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getTodayLeaderboard } from "@/lib/game/service";

export async function generateMetadata({ params }: PageProps<"/[locale]/leaderboard">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "leaderboard" });
  return { title: t("title") };
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function LeaderboardPage({ params }: PageProps<"/[locale]/leaderboard">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, rows] = await Promise.all([getTranslations("leaderboard"), getTodayLeaderboard()]);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted">{t("subtitle")}</p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-line bg-panel p-6 text-center text-muted">
          {t("empty")}
        </p>
      ) : (
        <table className="w-full overflow-hidden rounded-2xl border border-line bg-panel text-sm">
          <thead className="text-left text-muted">
            <tr className="border-b border-line">
              <th className="px-4 py-2 font-normal">{t("rank")}</th>
              <th className="px-4 py-2 font-normal">{t("player")}</th>
              <th className="px-4 py-2 text-right font-normal">{t("guesses")}</th>
              <th className="px-4 py-2 text-right font-normal">{t("time")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rank} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 font-bold text-gold">{r.rank}</td>
                <td className="px-4 py-2.5">{r.name}</td>
                <td className="px-4 py-2.5 text-right">{r.guesses}/6</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatTime(r.seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
