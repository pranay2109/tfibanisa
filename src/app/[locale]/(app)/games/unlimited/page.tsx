import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { getUnlimitedStats, getUnlimitedView } from "@/lib/game/service";
import { UnlimitedGame } from "./unlimited-game";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/games/unlimited">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "unlimited" });
  return { title: t("title") };
}

export default async function UnlimitedPage({ params }: PageProps<"/[locale]/games/unlimited">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const [view, stats] = await Promise.all([getUnlimitedView(user.id), getUnlimitedStats(user.id)]);

  return <UnlimitedGame initialView={view} stats={stats} />;
}
