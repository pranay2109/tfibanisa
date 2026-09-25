import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { headers } from "next/headers";
import { Resend } from "resend";
import { db } from "@/db";
import { account, session, user, verification } from "@/db/schema";
import { redirect } from "@/i18n/navigation";

export const googleEnabled = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function sendMagicLink({ email, url }: { email: string; url: string }) {
  if (!resend) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY is required in production");
    }
    console.log(`\n[magic-link] ${email}\n${url}\n`);
    return;
  }
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM ?? "TFI Banisa <login@tfibanisa.app>",
    to: email,
    subject: "Your TFI Banisa login link / మీ లాగిన్ లింక్",
    text: `Click to log in to TFI Banisa:\n${url}\n\nThis link expires in 5 minutes. If you did not ask for it, ignore this email.`,
  });
  if (error) throw new Error(`Resend failed: ${error.message}`);
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  socialProviders: googleEnabled
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        },
      }
    : {},
  plugins: [
    magicLink({ sendMagicLink }),
    // Must be last: lets server actions set auth cookies.
    nextCookies(),
  ],
});

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

// For protected pages and actions. Sends logged-out visitors to the login page.
export async function requireUser(locale: string) {
  const session = await getSession();
  if (!session) return redirect({ href: "/login", locale });
  return session.user;
}
