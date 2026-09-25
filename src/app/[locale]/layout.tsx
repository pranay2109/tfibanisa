import type { Metadata } from "next";
import { Noto_Sans_Telugu } from "next/font/google";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Header } from "@/components/header";
import { routing } from "@/i18n/routing";
import "../globals.css";

// Covers Telugu and Latin script, so both languages share one font.
const noto = Noto_Sans_Telugu({
  subsets: ["telugu", "latin"],
  variable: "--font-noto",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common" });
  return {
    title: { default: t("appName"), template: `%s · ${t("appName")}` },
    description: t("tagline"),
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("common");

  return (
    <html lang={locale} className={`${noto.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          <Header />
          <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
          <footer className="border-t border-line px-4 py-6 text-center text-xs text-muted">
            {t("disclaimer")}
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
