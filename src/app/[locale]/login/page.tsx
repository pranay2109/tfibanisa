import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getSession, googleEnabled } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage({ params }: PageProps<"/[locale]/login">) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (await getSession()) redirect({ href: "/dashboard", locale });
  const t = await getTranslations("login");

  return (
    <div className="mx-auto max-w-sm space-y-6 py-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted">{t("subtitle")}</p>
      </div>
      <LoginForm googleEnabled={googleEnabled} callbackURL={`/${locale}/dashboard`} />
    </div>
  );
}
