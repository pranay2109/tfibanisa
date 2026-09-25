"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

type Props = { googleEnabled: boolean; callbackURL: string };

export function LoginForm({ googleEnabled, callbackURL }: Props) {
  const t = useTranslations("login");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await authClient.signIn.magicLink({ email, callbackURL });
    setState(error ? "error" : "sent");
  }

  if (state === "sent") {
    return (
      <p className="rounded-2xl border border-hit/40 bg-hit/10 p-4 text-center text-sm">
        {t("sent", { email })}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {googleEnabled && (
        <>
          <button
            type="button"
            onClick={() => authClient.signIn.social({ provider: "google", callbackURL })}
            className="w-full rounded-full bg-text px-4 py-3 font-semibold text-ink hover:opacity-90"
          >
            {t("google")}
          </button>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" />
            {t("or")}
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <form onSubmit={sendLink} className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-sm text-muted">{t("emailLabel")}</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("emailPlaceholder")}
            className="w-full rounded-xl border border-line bg-panel px-4 py-3 outline-none focus:border-gold"
          />
        </label>
        <button
          type="submit"
          disabled={state === "sending"}
          className="w-full rounded-full bg-gold px-4 py-3 font-semibold text-ink hover:bg-gold-strong disabled:opacity-60"
        >
          {state === "sending" ? t("sending") : t("sendLink")}
        </button>
        {state === "error" && <p className="text-center text-sm text-miss">{t("error")}</p>}
      </form>
    </div>
  );
}
