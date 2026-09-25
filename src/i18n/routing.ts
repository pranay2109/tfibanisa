import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["te", "en"],
  // First visit: picked from the browser's Accept-Language, then remembered in a cookie.
  defaultLocale: "te",
});

export type Locale = (typeof routing.locales)[number];
