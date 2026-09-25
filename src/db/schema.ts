import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Auth tables. Shape is dictated by Better Auth; table names are its defaults.
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Movie catalogue. Every display name is stored in English and Telugu.
// ---------------------------------------------------------------------------

export const people = pgTable("people", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  nameEn: text("name_en").notNull(),
  nameTe: text("name_te").notNull(),
  // e.g. "Q3595143". Null for people added by hand.
  wikidataId: text("wikidata_id").unique(),
  // Number of Wikipedia language editions with an article. A free fame score.
  popularity: integer("popularity").notNull().default(0),
});

// Lowercase, no spaces or punctuation. Telugu vowel signs are kept.
const searchKeySql = (col: string) =>
  sql.raw(`lower(regexp_replace(${col}, '[[:space:][:punct:]]', '', 'g'))`);

export const movies = pgTable(
  "movies",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    titleEn: text("title_en").notNull(),
    titleTe: text("title_te").notNull(),
    year: integer("year").notNull(),
    // Credits and emoji can be missing on imported movies until someone fills them in.
    directorId: integer("director_id").references(() => people.id),
    musicDirectorId: integer("music_director_id").references(() => people.id),
    // Our own emoji "plot" clue, e.g. "🪰💔🔪".
    emoji: text("emoji"),
    wikidataId: text("wikidata_id").unique(),
    popularity: integer("popularity").notNull().default(0),
    // Original languages from Wikidata, primary first, e.g. {te} or {ta,te} for a Tamil film
    // with a Telugu version. Helps spot non-Telugu films during review.
    originalLanguages: text("original_languages").array(),
    searchKey: text("search_key").generatedAlwaysAs(
      sql`${searchKeySql("title_en")} || ' ' || ${searchKeySql("title_te")}`,
    ),
    // Only active movies with every clue filled in can be a daily answer.
    isActive: boolean("is_active").notNull().default(true),
    // Hidden movies are left out of search too: e.g. a low-quality Wikidata copy of a film we
    // already have. Set by the import (see scripts/import-wikidata.ts) or by hand.
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("movies_popularity_idx").on(t.popularity),
    // Speeds up both the substring and the fuzzy (pg_trgm) guess search.
    index("movies_search_key_trgm_idx").using("gin", t.searchKey.op("gin_trgm_ops")),
  ],
);

// Lead actors, in billing order.
export const movieLeads = pgTable(
  "movie_leads",
  {
    movieId: integer("movie_id")
      .notNull()
      .references(() => movies.id, { onDelete: "cascade" }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id),
    billingOrder: integer("billing_order").notNull(),
  },
  (t) => [primaryKey({ columns: [t.movieId, t.personId] })],
);

// ---------------------------------------------------------------------------
// Daily "Guess the Movie" game.
// ---------------------------------------------------------------------------

export const dailyPuzzles = pgTable("daily_puzzles", {
  id: serial("id").primaryKey(),
  // Calendar date in India time (Asia/Kolkata).
  puzzleDate: date("puzzle_date").notNull().unique(),
  movieId: integer("movie_id")
    .notNull()
    .references(() => movies.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dailyAttempts = pgTable(
  "daily_attempts",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    puzzleId: integer("puzzle_id")
      .notNull()
      .references(() => dailyPuzzles.id, { onDelete: "cascade" }),
    // Movie ids guessed so far, in order.
    guesses: jsonb("guesses").$type<number[]>().notNull().default(sql`'[]'::jsonb`),
    status: text("status", { enum: ["playing", "won", "lost"] })
      .notNull()
      .default("playing"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    unique("daily_attempts_user_puzzle_uq").on(t.userId, t.puzzleId),
    index("daily_attempts_puzzle_status_idx").on(t.puzzleId, t.status),
  ],
);

// ---------------------------------------------------------------------------
// Unlimited mode: back-to-back rounds with random movies. Kept apart from the
// daily game so it can't inflate daily streaks or the leaderboard.
// ---------------------------------------------------------------------------

export const unlimitedRounds = pgTable(
  "unlimited_rounds",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    movieId: integer("movie_id")
      .notNull()
      .references(() => movies.id),
    guesses: jsonb("guesses").$type<number[]>().notNull().default(sql`'[]'::jsonb`),
    status: text("status", { enum: ["playing", "won", "lost"] })
      .notNull()
      .default("playing"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("unlimited_rounds_user_idx").on(t.userId, t.id)],
);

export const unlimitedStats = pgTable("unlimited_stats", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  played: integer("played").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  // Wins in a row, across rounds.
  currentStreak: integer("current_streak").notNull().default(0),
  maxStreak: integer("max_streak").notNull().default(0),
});

export const userStats = pgTable("user_stats", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  played: integer("played").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  currentStreak: integer("current_streak").notNull().default(0),
  maxStreak: integer("max_streak").notNull().default(0),
  lastPlayedDate: date("last_played_date"),
  // Index i = number of wins that took i+1 guesses.
  guessDistribution: jsonb("guess_distribution")
    .$type<number[]>()
    .notNull()
    .default(sql`'[0,0,0,0,0,0]'::jsonb`),
});
