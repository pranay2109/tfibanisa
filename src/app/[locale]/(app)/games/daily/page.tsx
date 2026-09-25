import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { getDailyView, getMovieOptions } from "@/lib/game/service";
import { DailyGame } from "./daily-game";

export async function generateMetadata({ params }: PageProps<"/[locale]/games/daily">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "daily" });
  return { title: t("title") };
}

export default async function DailyPage({ params }: PageProps<"/[locale]/games/daily">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const [view, options] = await Promise.all([getDailyView(user.id), getMovieOptions()]);

  return (
    <DailyGame
      initialView={view}
      options={options}
      siteUrl={process.env.BETTER_AUTH_URL ?? "https://tfibanisa.app"}
    />
  );
}
