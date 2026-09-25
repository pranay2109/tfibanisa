"use client";

import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";

type Props = { googleEnabled: boolean; callbackURL: string };

export function LoginForm({ googleEnabled, callbackURL }: Props) {
  const t = useTranslations("login");

  if (!googleEnabled) {
    return <p className="text-center text-sm text-miss">{t("notConfigured")}</p>;
  }

  return (
    <button
      type="button"
      onClick={() => authClient.signIn.social({ provider: "google", callbackURL })}
      className="flex w-full items-center justify-center gap-3 rounded-full bg-text px-4 py-3 font-semibold text-ink hover:opacity-90"
    >
      <svg aria-hidden viewBox="0 0 24 24" className="size-5">
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7Z" />
        <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.7-4.9h-4v3.1A12 12 0 0 0 12 24Z" />
        <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
        <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z" />
      </svg>
      {t("google")}
    </button>
  );
}
