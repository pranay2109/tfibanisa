-- pg_trgm powers fuzzy movie search. Neon and Postgres 13+ allow this without superuser.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "unlimited_rounds" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"movie_id" integer NOT NULL,
	"guesses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'playing' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "unlimited_stats" (
	"user_id" text PRIMARY KEY NOT NULL,
	"played" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"max_streak" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "movies" ALTER COLUMN "director_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "movies" ALTER COLUMN "music_director_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "movies" ALTER COLUMN "emoji" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "wikidata_id" text;--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "popularity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "original_languages" text[];--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "search_key" text GENERATED ALWAYS AS (lower(regexp_replace(title_en, '[[:space:][:punct:]]', '', 'g')) || ' ' || lower(regexp_replace(title_te, '[[:space:][:punct:]]', '', 'g'))) STORED;--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "wikidata_id" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "popularity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "unlimited_rounds" ADD CONSTRAINT "unlimited_rounds_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlimited_rounds" ADD CONSTRAINT "unlimited_rounds_movie_id_movies_id_fk" FOREIGN KEY ("movie_id") REFERENCES "public"."movies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlimited_stats" ADD CONSTRAINT "unlimited_stats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unlimited_rounds_user_idx" ON "unlimited_rounds" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "movies_popularity_idx" ON "movies" USING btree ("popularity");--> statement-breakpoint
CREATE INDEX "movies_search_key_trgm_idx" ON "movies" USING gin ("search_key" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "movies" ADD CONSTRAINT "movies_wikidata_id_unique" UNIQUE("wikidata_id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_wikidata_id_unique" UNIQUE("wikidata_id");