import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");

  return (
    <div className="space-y-10 py-6">
      <section className="space-y-5 text-center">
        <p className="text-5xl" aria-hidden>
          🎬🍿🔥
        </p>
        <h1 className="text-3xl font-bold sm:text-4xl">{t("title")}</h1>
        <p className="mx-auto max-w-xl text-muted">{t("subtitle")}</p>
        <Link
          href="/games/daily"
          className="inline-block rounded-full bg-gold px-6 py-3 font-semibold text-ink hover:bg-gold-strong"
        >
          {t("cta")}
        </Link>
      </section>

      <ol className="grid gap-3 sm:grid-cols-3">
        {(["step1", "step2", "step3"] as const).map((key, i) => (
          <li key={key} className="rounded-2xl border border-line bg-panel p-4">
            <span className="mb-2 block text-2xl font-bold text-gold">{i + 1}</span>
            <span className="text-sm text-muted">{t(key)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
