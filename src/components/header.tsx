import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSession } from "@/lib/auth";
import { LanguageSwitcher } from "./language-switcher";
import { LogoutButton } from "./logout-button";

export async function Header() {
  const [t, session] = await Promise.all([getTranslations("common"), getSession()]);

  return (
    <header className="border-b border-line bg-panel/80 backdrop-blur">
      <nav className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/" className="mr-auto text-lg font-bold text-gold">
          {t("appName")}
        </Link>
        <Link href="/leaderboard" className="text-sm text-muted hover:text-text">
          {t("leaderboard")}
        </Link>
        {session ? (
          <>
            <Link href="/dashboard" className="text-sm text-muted hover:text-text">
              {t("dashboard")}
            </Link>
            <LogoutButton label={t("logout")} />
          </>
        ) : (
          <Link
            href="/login"
            className="rounded-full bg-gold px-4 py-1.5 text-sm font-semibold text-ink hover:bg-gold-strong"
          >
            {t("login")}
          </Link>
        )}
        <LanguageSwitcher label={t("switchLanguage")} />
      </nav>
    </header>
  );
}
