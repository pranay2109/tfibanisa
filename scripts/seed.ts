// Loads the starter catalogue. Safe to re-run: rows are matched by slug and updated.
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const { movieLeads, movies, people } = await import("../src/db/schema");
  const { MOVIES, PEOPLE } = await import("../src/db/seed-data");

  for (const m of MOVIES) {
    for (const slug of [m.director, m.music, ...m.leads]) {
      if (!PEOPLE[slug]) throw new Error(`Movie ${m.slug} refers to unknown person "${slug}"`);
    }
  }

  await db.transaction(async (tx) => {
    const personRows = await tx
      .insert(people)
      .values(Object.entries(PEOPLE).map(([slug, p]) => ({ slug, nameEn: p.en, nameTe: p.te })))
      .onConflictDoUpdate({
        target: people.slug,
        set: { nameEn: sql`excluded.name_en`, nameTe: sql`excluded.name_te` },
      })
      .returning({ id: people.id, slug: people.slug });
    const personId = new Map(personRows.map((p) => [p.slug, p.id]));

    for (const m of MOVIES) {
      const values = {
        slug: m.slug,
        titleEn: m.en,
        titleTe: m.te,
        year: m.year,
        directorId: personId.get(m.director)!,
        musicDirectorId: personId.get(m.music)!,
        emoji: m.emoji,
      };
      const [row] = await tx
        .insert(movies)
        .values(values)
        .onConflictDoUpdate({ target: movies.slug, set: values })
        .returning({ id: movies.id });

      await tx.delete(movieLeads).where(sql`${movieLeads.movieId} = ${row.id}`);
      await tx.insert(movieLeads).values(
        m.leads.map((slug, i) => ({
          movieId: row.id,
          personId: personId.get(slug)!,
          billingOrder: i + 1,
        })),
      );
    }
  });

  console.log(`Seeded ${Object.keys(PEOPLE).length} people and ${MOVIES.length} movies.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
