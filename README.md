# TFI Banisa

Daily Tollywood movie games in Telugu and English. **Guess the Movie**: five clues, six guesses. Play the daily film (one per day, streaks, leaderboard) or **Unlimited** (back-to-back random films, separate stats).

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · next-intl (`/te`, `/en`) · Postgres + Drizzle ORM · Better Auth (Google login) · Vitest · GitHub Actions · Vercel.

## Run it locally

Needs Node 22+, pnpm 10 (`corepack enable pnpm`) and Docker.

```bash
pnpm install
cp .env.example .env.local        # then set BETTER_AUTH_SECRET: openssl rand -base64 32
pnpm db:up                        # Postgres on localhost:5433
pnpm db:migrate
pnpm db:seed                      # ~50 movies
pnpm dev                          # http://localhost:3000
```

Login is Google-only. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env.local` (see "Google login" below), or the login page will say it isn't set up.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm test` | Unit tests (game rules) |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript |
| `pnpm db:generate` | Create a migration after editing `src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` | Load/refresh the hand-made starter movie list (safe to re-run) |
| `pnpm db:import` | Import Telugu films from Wikidata (`--dry-run` to preview, `--refresh` to re-download) |
| `pnpm db:studio` | Browse the database in the browser |

## Project layout

```
src/
  app/[locale]/             pages; every URL starts with /te or /en
    (app)/dashboard         logged-in only
    (app)/games/daily       the game + its server action
    login, leaderboard
  app/api/auth/[...all]     Better Auth endpoints
  db/schema.ts              all tables
  db/seed-data.ts           starter movies and people
  i18n/                     language routing
  lib/auth.ts               login setup, getSession(), requireUser()
  lib/game/daily.ts         pure game rules (unit-tested)
  lib/game/service.ts       game database logic
  proxy.ts                  adds /te or /en to URLs
messages/en.json, te.json   all UI text
drizzle/                    SQL migrations (commit these)
```

## Google login

Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application):
- Authorized JavaScript origin: `http://localhost:3000`
- Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`

While the consent screen is in **Testing**, only listed test users can log in.

## Movie data

- `pnpm db:seed` loads ~50 hand-checked films with emoji clues. These are the daily answers today.
- `pnpm db:import` adds ~5,300 Telugu films from **Wikidata** (CC0, free for commercial use). Every imported film is **searchable** but **inactive**: it can't be an answer until someone reviews it, adds an emoji clue and sets `is_active = true`.
- An answer needs: active, not hidden, director, music director, emoji and at least one lead.
- Import rules: it matches existing films by Wikidata id, then by English/Telugu title (year ±1). It **only fills empty fields** and never overwrites your edits. Leads come from Wikidata's cast order (the Wikipedia "Starring" order). Duplicate Wikidata items are merged, and near-copies of reviewed films are hidden from search (the import prints them).
- `original_languages` shows e.g. `{ta,te}` for Tamil films with a Telugu version. Use it to skip non-Telugu films in review.
- Wikidata answers are cached in `.cache/wikidata/`. A full fresh run takes ~4 minutes.
- Search is fuzzy (pg_trgm), so "alavaikunta" finds *Ala Vaikunthapurramuloo* and "puspa" finds *Pushpa*.

## Unlimited mode

- Random reviewed films, one round after another. It never serves today's daily answer (so it can't spoil it) and avoids the player's last 100 films.
- It has its own stats (`unlimited_stats`, streak = wins in a row) and doesn't affect the daily streak or leaderboard.

## How the daily game works

- The day's puzzle uses the India-time date (`Asia/Kolkata`). The first request of the day picks a movie that hasn't been an answer before. The pick is deterministic per date, and a unique index stops two picks racing.
- The browser only ever receives the clues it has unlocked. The answer is sent only after the game ends.
- Guesses go through a server action. The server checks and scores every guess while holding a row lock, so double taps and made-up scores don't work.
- Opening the game starts the clock. The leaderboard sorts by fewest guesses, then fastest time.
- Before launch, set `LAUNCH_DATE` in `src/lib/game/daily.ts` to launch day so the first puzzle is #1.

## Deploying (first time)

1. **Database:** create a Neon project (region: Singapore, `ap-southeast-1`, the closest to India). Copy the **pooled** connection string.
2. **Vercel:** import the GitHub repo. It's a business, so use the **Pro** plan. Set these environment variables for Production and Preview:
   `DATABASE_URL`, `BETTER_AUTH_SECRET` (a new one, not your local one), `BETTER_AUTH_URL=https://tfibanisa.app`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
   Set the Vercel function region to `bom1` (Mumbai).
3. **Migrations:** run `DATABASE_URL=<neon url> pnpm db:migrate && pnpm db:seed` once, and again whenever `drizzle/` changes. (Later: move this into a deploy workflow.)
4. **Google login:** on the existing OAuth client in Google Cloud Console, add origin `https://tfibanisa.app` and redirect URI `https://tfibanisa.app/api/auth/callback/google`. Reset the client secret and use the new one in Vercel. Then click **Publish app** on the consent screen so anyone can log in, not only test users.
5. **Domain:** in Vercel → Domains, add `tfibanisa.app`, then add the records it shows in Cloudflare DNS (set them to "DNS only", not proxied).

## Before launch

- [ ] Re-check every movie in `seed-data.ts` (credits, Telugu spellings) and grow the list
- [ ] Privacy policy, terms, and a "delete my account" option (India DPDP Act)
- [ ] Rate limiting on login and guesses (Upstash)
- [ ] Sentry for errors, PostHog for analytics
- [ ] Share preview image (Open Graph) in both languages
- [ ] Admin page for editing movies and scheduling puzzles
