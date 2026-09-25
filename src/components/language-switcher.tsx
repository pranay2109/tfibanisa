"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";

export function LanguageSwitcher({ label }: { label: string }) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.replace(pathname, { locale: locale === "te" ? "en" : "te" })}
      className="rounded-full border border-line px-3 py-1 text-sm text-muted hover:border-gold hover:text-gold"
    >
      {label}
    </button>
  );
}
