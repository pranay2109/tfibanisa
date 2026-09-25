// Imports Telugu films from Wikidata (CC0, free for commercial use).
//
//   pnpm db:import             import into the database in DATABASE_URL
//   pnpm db:import --dry-run   fetch and report, write nothing
//   pnpm db:import --refresh   ignore the local cache and re-download
//
// Rules:
// - Movies match on wikidata_id, then on (title, year) so hand-made rows get linked, not duplicated.
// - Only empty fields are filled. Titles, credits, leads and emoji you set are never overwritten.
//   Popularity is refreshed every run.
// - New movies arrive inactive. Nothing becomes a daily answer until someone reviews it.
// - Near-copies of reviewed films are hidden from search (printed at the end).
import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { CastMember, ImportFilm } from "../src/lib/import/wikidata";

config({ path: ".env.local" });

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const REFRESH = args.has("--refresh");
const CACHE_DIR = ".cache/wikidata";
const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "TFIBanisaImporter/0.1 (https://tfibanisa.app; pranaymogalapuri@gmail.com)";

// Films whose original language is Telugu (Q8097).
const FILM = "?f wdt:P31/wdt:P279* wd:Q11424 ; wdt:P364 wd:Q8097 .";

const FILMS_QUERY = `SELECT ?f (SAMPLE(?en) AS ?en) (SAMPLE(?te) AS ?te) (MIN(YEAR(?d)) AS ?year) (SAMPLE(?links) AS ?links) WHERE {
  ${FILM}
  ?f wikibase:sitelinks ?links .
  OPTIONAL { ?f wdt:P577 ?d }
  OPTIONAL { ?f rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?f rdfs:label ?te FILTER(LANG(?te) = "te") }
} GROUP BY ?f`;

// People are fetched for known ids in batches: one big query times out on the public
// endpoint, and small batches can be cached and retried on their own.
const values = (ids: string[]) => ids.map((id) => `wd:${id}`).join(" ");

const peopleQuery = (personIds: string[]) => `SELECT ?p (SAMPLE(?en) AS ?en) (SAMPLE(?te) AS ?te) (SAMPLE(?links) AS ?links) WHERE {
  VALUES ?p { ${values(personIds)} }
  ?p wikibase:sitelinks ?links .
  OPTIONAL { ?p rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?p rdfs:label ?te FILTER(LANG(?te) = "te") }
} GROUP BY ?p`;

const BATCH = 300;

type Binding = Record<string, { value: string } | undefined>;

async function sparql(cacheName: string, query: string, quiet = false): Promise<Binding[]> {
  const file = `${CACHE_DIR}/${cacheName}.json`;
  if (!REFRESH) {
    try {
      const cached = JSON.parse(await readFile(file, "utf8")) as Binding[];
      if (!quiet) console.log(`  ${cacheName}: ${cached.length} rows (cached)`);
      return cached;
    } catch {
      // No cache yet.
    }
  }

  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    let problem: string;
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/sparql-results+json",
          "User-Agent": USER_AGENT,
        },
        body: new URLSearchParams({ query }),
      });
      const body = await res.text();
      if (res.ok) {
        // A query that hits the 60s limit comes back as HTTP 200 with the JSON cut off.
        const rows = (JSON.parse(body) as { results: { bindings: Binding[] } }).results.bindings;
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(file, JSON.stringify(rows));
        if (!quiet) {
          console.log(`  ${cacheName}: ${rows.length} rows in ${((Date.now() - started) / 1000).toFixed(1)}s`);
        }
        return rows;
      }
      if (res.status !== 429 && res.status < 500) {
        throw new Error(`Wikidata ${cacheName} failed: HTTP ${res.status} ${body.slice(0, 300)}`);
      }
      problem = `HTTP ${res.status}`;
      const retryAfter = Number(res.headers.get("retry-after"));
      if (retryAfter) await new Promise((r) => setTimeout(r, retryAfter * 1000));
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Wikidata")) throw err;
      problem = err instanceof SyntaxError ? "truncated response" : String(err);
    }
    if (attempt >= 4) throw new Error(`Wikidata ${cacheName} failed after ${attempt} tries: ${problem}`);
    console.log(`  ${cacheName}: ${problem}, retrying in ${attempt * 10}s`);
    await new Promise((r) => setTimeout(r, attempt * 10_000));
  }
}

async function batched(label: string, ids: string[], makeQuery: (ids: string[]) => string) {
  const rows: Binding[] = [];
  const batches = Math.ceil(ids.length / BATCH);
  for (let i = 0; i < batches; i++) {
    const part = ids.slice(i * BATCH, (i + 1) * BATCH);
    rows.push(...(await sparql(`${label}-${i}-${part.length}`, makeQuery(part), true)));
    process.stdout.write(`\r  ${label}: batch ${i + 1}/${batches}, ${rows.length} rows`);
  }
  process.stdout.write("\n");
  return rows;
}

// Credits come from the entity API, not SPARQL: it returns statements in the order editors
// entered them, which follows the Wikipedia infobox (hero first, main director first).
type FilmClaims = { director: string[]; music: string[]; cast: CastMember[]; languages: string[] };
const API = "https://www.wikidata.org/w/api.php";
const API_BATCH = 50; // wbgetentities maximum

type Statement = {
  mainsnak: { datavalue?: { value?: { id?: string } } };
  qualifiers?: { P1545?: { datavalue?: { value?: string } }[] };
};

function extractClaims(claims: Record<string, Statement[]>): FilmClaims {
  const ids = (prop: string) =>
    (claims[prop] ?? []).map((s) => s.mainsnak.datavalue?.value?.id).filter((x): x is string => !!x);
  const cast = (claims.P161 ?? []).flatMap((s, position) => {
    const id = s.mainsnak.datavalue?.value?.id;
    if (!id) return [];
    const ord = Number(s.qualifiers?.P1545?.[0]?.datavalue?.value);
    return [{ qid: id, ordinal: Number.isFinite(ord) && ord > 0 ? ord : null, position }];
  });
  return { director: ids("P57"), music: ids("P86"), cast, languages: ids("P364") };
}

async function fetchClaims(filmIds: string[]): Promise<Map<string, FilmClaims>> {
  const out = new Map<string, FilmClaims>();
  const batches = Math.ceil(filmIds.length / API_BATCH);
  for (let i = 0; i < batches; i++) {
    const part = filmIds.slice(i * API_BATCH, (i + 1) * API_BATCH);
    const file = `${CACHE_DIR}/claims-${part[0]}-${part.length}.json`;
    let batch: Record<string, FilmClaims> | null = null;
    if (!REFRESH) {
      try {
        batch = JSON.parse(await readFile(file, "utf8"));
      } catch {
        // Not cached yet.
      }
    }
    for (let attempt = 1; !batch; attempt++) {
      const url = `${API}?action=wbgetentities&props=claims&format=json&maxlag=5&ids=${part.join("|")}`;
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } }).catch(() => null);
      const body = res?.ok ? ((await res.json()) as { entities?: Record<string, { claims?: Record<string, Statement[]> }>; error?: { code: string } }) : null;
      if (body?.entities) {
        batch = Object.fromEntries(
          Object.entries(body.entities).map(([id, e]) => [id, extractClaims(e.claims ?? {})]),
        );
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(file, JSON.stringify(batch));
        break;
      }
      // "maxlag" means Wikidata's servers are busy and asks bots to back off.
      const problem = body?.error?.code ?? (res ? `HTTP ${res.status}` : "network error");
      if (attempt >= 5) throw new Error(`Wikidata claims batch ${i} failed: ${problem}`);
      await new Promise((r) => setTimeout(r, attempt * 5_000));
    }
    for (const [id, c] of Object.entries(batch!)) out.set(id, c);
    process.stdout.write(`\r  claims: batch ${i + 1}/${batches}`);
  }
  process.stdout.write("\n");
  return out;
}

async function main() {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const { movieLeads, movies, people } = await import("../src/db/schema");
  const w = await import("../src/lib/import/wikidata");

  console.log(`Fetching from Wikidata${REFRESH ? " (refresh)" : ""}…`);
  const filmRows = await sparql("films", FILMS_QUERY);
  // Sort ids so batch cache files stay valid between runs.
  const filmIds = [...new Set(filmRows.map((r) => w.qid(r.f!.value)))].sort();
  const claims = await fetchClaims(filmIds);
  const personIds = [
    ...new Set([...claims.values()].flatMap((c) => [...c.director, ...c.music, ...c.cast.map((m) => m.qid)])),
  ].sort();
  const peopleRows = await batched("people", personIds, peopleQuery);

  // ---- Shape the raw rows -------------------------------------------------
  type WdPerson = { qid: string; en: string | null; te: string | null; popularity: number };
  const wdPeople = new Map<string, WdPerson>();
  for (const r of peopleRows) {
    const id = w.qid(r.p!.value);
    wdPeople.set(id, {
      qid: id,
      en: r.en?.value ?? null,
      te: r.te?.value ?? null,
      popularity: Number(r.links?.value ?? 0),
    });
  }
  // Drop credits pointing at deleted or unlabelled entities.
  const known = (id: string) => wdPeople.has(id);

  type WdFilm = ImportFilm;
  const rawFilms: Omit<ImportFilm, "qids">[] = [];
  let skippedNoYear = 0;
  let skippedNoTitle = 0;
  for (const r of filmRows) {
    const id = w.qid(r.f!.value);
    const en = r.en?.value ? w.cleanTitle(r.en.value) : null;
    const te = r.te?.value ? w.cleanTitle(r.te.value) : null;
    const year = Number(r.year?.value);
    if (!en && !te) {
      skippedNoTitle++;
      continue;
    }
    if (!Number.isInteger(year) || year < 1900) {
      skippedNoYear++;
      continue;
    }
    const c = claims.get(id);
    rawFilms.push({
      qid: id,
      en: en ?? te!,
      te: te ?? en!,
      year,
      popularity: Number(r.links?.value ?? 0),
      // First listed = main credit.
      director: c?.director.find(known) ?? null,
      music: c?.music.find(known) ?? null,
      leads: w.pickLeads((c?.cast ?? []).filter((m) => known(m.qid))),
      languages: w.languageCodes(c?.languages ?? []),
    });
  }

  const films = w.mergeDuplicates(rawFilms);
  const mergedAway = rawFilms.length - films.length;

  // ---- Match against what's already in the database -----------------------
  const existingMovies = await db
    .select({
      id: movies.id,
      slug: movies.slug,
      titleEn: movies.titleEn,
      titleTe: movies.titleTe,
      year: movies.year,
      wikidataId: movies.wikidataId,
      directorId: movies.directorId,
      musicDirectorId: movies.musicDirectorId,
    })
    .from(movies);
  const existingPeople = await db
    .select({ id: people.id, slug: people.slug, nameEn: people.nameEn, wikidataId: people.wikidataId })
    .from(people);
  const moviesWithLeads = new Set(
    (await db.selectDistinct({ id: movieLeads.movieId }).from(movieLeads)).map((r) => r.id),
  );

  const movieByQid = new Map(existingMovies.filter((m) => m.wikidataId).map((m) => [m.wikidataId!, m]));
  // Hand-made movies without a Wikidata id: match on English or Telugu title, allowing the
  // year to be off by one (sources disagree on release dates). English spellings vary a lot
  // ("Chatrapathi" / "Chatrapati"); Telugu titles much less.
  const manual = existingMovies.filter((m) => !m.wikidataId);
  const titleIndex = new Map<string, (typeof existingMovies)[number]>();
  for (const m of manual) {
    for (const title of [m.titleEn, m.titleTe]) {
      for (const year of [m.year - 1, m.year, m.year + 1]) {
        const key = `${w.normalizeTitle(title)}|${year}`;
        if (!titleIndex.has(key)) titleIndex.set(key, m);
      }
    }
  }
  const matchedManual = new Set<number>();
  const findManual = (f: { en: string; te: string; year: number }) => {
    // Exact year first, then the neighbours.
    for (const year of [f.year, f.year - 1, f.year + 1]) {
      for (const title of [f.en, f.te]) {
        const m = titleIndex.get(`${w.normalizeTitle(title)}|${year}`);
        if (m && m.year === year && !matchedManual.has(m.id)) return m;
      }
    }
    for (const title of [f.en, f.te]) {
      const m = titleIndex.get(`${w.normalizeTitle(title)}|${f.year}`);
      if (m && !matchedManual.has(m.id)) return m;
    }
    return undefined;
  };
  const personByQid = new Map(existingPeople.filter((p) => p.wikidataId).map((p) => [p.wikidataId!, p]));
  const personByName = new Map(
    existingPeople.filter((p) => !p.wikidataId).map((p) => [p.nameEn.toLowerCase(), p]),
  );
  const movieSlugs = new Set(existingMovies.map((m) => m.slug));
  const personSlugs = new Set(existingPeople.map((p) => p.slug));

  // People we actually need: credited directors, composers and picked leads.
  const needed = new Set(films.flatMap((f) => [f.director, f.music, ...f.leads].filter(Boolean) as string[]));

  const personUpdates: { id: number; wikidata_id: string; popularity: number }[] = [];
  const personInserts: (typeof people.$inferInsert)[] = [];
  for (const id of needed) {
    const p = wdPeople.get(id)!;
    const en = p.en ?? p.te;
    if (!en) continue;
    const match = personByQid.get(id) ?? personByName.get(en.toLowerCase());
    if (match) {
      personUpdates.push({ id: match.id, wikidata_id: id, popularity: p.popularity });
      personByQid.set(id, match);
      personByName.delete(en.toLowerCase());
    } else {
      personInserts.push({
        slug: w.uniqueSlug(w.slugify(en), id, personSlugs),
        nameEn: en,
        nameTe: p.te ?? en,
        wikidataId: id,
        popularity: p.popularity,
      });
    }
  }

  const matchedFilms: { film: WdFilm; movieId: number }[] = [];
  const newFilms: WdFilm[] = [];
  for (const f of films) {
    // Any id in the merged group counts, in case the primary changes between runs.
    const match = f.qids.map((q) => movieByQid.get(q)).find(Boolean) ?? findManual(f);
    if (match) {
      matchedFilms.push({ film: f, movieId: match.id });
      if (!match.wikidataId) matchedManual.add(match.id);
    } else {
      newFilms.push(f);
    }
  }

  console.log(`\nWikidata: ${filmRows.length} Telugu films (${skippedNoTitle} without a title, ${skippedNoYear} without a year skipped)`);
  console.log(`Duplicate Wikidata items merged: ${mergedAway}`);
  console.log(`Matched to existing movies: ${matchedFilms.length}`);
  const unmatched = manual.filter((m) => !matchedManual.has(m.id));
  if (unmatched.length) {
    console.log(`Hand-made movies with no Wikidata match (kept as they are): ${unmatched.map((m) => `${m.titleEn} (${m.year})`).join(", ")}`);
  }
  console.log(`New movies: ${newFilms.length}`);
  console.log(`People: ${personUpdates.length} matched, ${personInserts.length} new`);
  const complete = films.filter((f) => f.director && f.music && f.leads.length).length;
  console.log(`Films with director, music and leads from Wikidata: ${complete}`);
  const notTeluguFirst = films.filter((f) => f.languages.length && f.languages[0] !== "te").length;
  console.log(`Films whose main original language isn't Telugu (dubs, other-language films): ${notTeluguFirst}`);

  if (DRY_RUN) {
    console.log("\n--dry-run: nothing written. Top 15 new movies by popularity:");
    for (const f of [...newFilms].sort((a, b) => b.popularity - a.popularity).slice(0, 15)) {
      console.log(`  ${f.year}  ${f.en}  /  ${f.te}   (${f.popularity} languages)`);
    }
    process.exit(0);
  }

  // ---- Write --------------------------------------------------------------
  const chunk = <T,>(xs: T[], n = 500) =>
    Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

  let leadsAdded = 0;
  await db.transaction(async (tx) => {
    // People
    for (const part of chunk(personUpdates)) {
      await tx.execute(sql`
        update people p set
          wikidata_id = coalesce(p.wikidata_id, v.wikidata_id),
          popularity = v.popularity
        from jsonb_to_recordset(${JSON.stringify(part)}::jsonb) as v(id int, wikidata_id text, popularity int)
        where p.id = v.id`);
    }
    for (const part of chunk(personInserts)) {
      const rows = await tx
        .insert(people)
        .values(part)
        .returning({ id: people.id, wikidataId: people.wikidataId });
      for (const r of rows) personByQid.set(r.wikidataId!, { id: r.id } as (typeof existingPeople)[number]);
    }
    const personId = (q: string | null) => (q ? (personByQid.get(q)?.id ?? null) : null);

    // Existing movies: link, refresh popularity, fill empty credits only.
    const movieUpdates = matchedFilms.map(({ film, movieId }) => ({
      id: movieId,
      wikidata_id: film.qid,
      popularity: film.popularity,
      director_id: personId(film.director),
      music_director_id: personId(film.music),
      languages: film.languages,
    }));
    for (const part of chunk(movieUpdates)) {
      await tx.execute(sql`
        update movies m set
          wikidata_id = coalesce(m.wikidata_id, v.wikidata_id),
          popularity = v.popularity,
          director_id = coalesce(m.director_id, v.director_id),
          music_director_id = coalesce(m.music_director_id, v.music_director_id),
          original_languages = array(select jsonb_array_elements_text(v.languages))
        from jsonb_to_recordset(${JSON.stringify(part)}::jsonb)
          as v(id int, wikidata_id text, popularity int, director_id int, music_director_id int, languages jsonb)
        where m.id = v.id`);
    }

    // New movies: inactive until reviewed.
    const leadRows: (typeof movieLeads.$inferInsert)[] = [];
    for (const part of chunk(newFilms)) {
      const rows = await tx
        .insert(movies)
        .values(
          part.map((f) => ({
            slug: w.uniqueSlug(w.slugify(`${f.en} ${f.year}`), f.qid, movieSlugs),
            titleEn: f.en,
            titleTe: f.te,
            year: f.year,
            directorId: personId(f.director),
            musicDirectorId: personId(f.music),
            wikidataId: f.qid,
            popularity: f.popularity,
            originalLanguages: f.languages,
            isActive: false,
          })),
        )
        .returning({ id: movies.id, wikidataId: movies.wikidataId });
      const byQid = new Map(part.map((f) => [f.qid, f]));
      for (const r of rows) {
        byQid.get(r.wikidataId!)!.leads.forEach((q, i) => {
          const pid = personId(q);
          if (pid) leadRows.push({ movieId: r.id, personId: pid, billingOrder: i + 1 });
        });
      }
    }

    // Leads for existing movies only if they have none yet.
    for (const { film, movieId } of matchedFilms) {
      if (moviesWithLeads.has(movieId)) continue;
      film.leads.forEach((q, i) => {
        const pid = personId(q);
        if (pid) leadRows.push({ movieId, personId: pid, billingOrder: i + 1 });
      });
    }
    for (const part of chunk(leadRows)) {
      await tx.insert(movieLeads).values(part).onConflictDoNothing();
    }
    leadsAdded = leadRows.length;
  });

  console.log(`\nWritten. ${newFilms.length} movies and ${personInserts.length} people added, ${leadsAdded} lead credits added.`);

  // Wikidata has low-quality copies of some famous films ("Baahubali: The Conclusion" next to
  // "Baahubali 2: The Conclusion"). A copy in search would make players pick the "wrong"
  // Baahubali. Hide an unreviewed import when a reviewed (active) film from the same year has
  // nearly the same title. 0.8 was picked by checking real data: lower values started hiding
  // genuinely different films ("KA" next to "Kalki 2898 AD").
  const hiddenNow = await db.execute<{ year: number; hidden: string; keeps: string }>(sql`
    with n as (
      select id, year, is_active, hidden, title_en,
        lower(regexp_replace(title_en, '[[:space:][:punct:]]', '', 'g')) as k
      from movies
    ),
    copies as (
      select distinct on (b.id) b.id, b.year, b.title_en as hidden, a.title_en as keeps
      from n a
      join n b on b.year = a.year and b.id <> a.id
      where a.is_active and not b.is_active and not b.hidden
        and least(length(a.k), length(b.k)) >= 4
        and greatest(word_similarity(a.k, b.k), word_similarity(b.k, a.k)) >= 0.8
    )
    update movies m set hidden = true
    from copies c where m.id = c.id
    returning c.year, c.hidden, c.keeps`);
  if (hiddenNow.length) {
    console.log(`\nHidden as copies of reviewed films (${hiddenNow.length}):`);
    for (const h of hiddenNow) console.log(`  ${h.year}  "${h.hidden}"  (keeping "${h.keeps}")`);
  }

  const [{ ready }] = await db.execute<{ ready: number }>(sql`
    select count(*)::int as ready from movies m
    where m.is_active and not m.hidden and m.director_id is not null and m.music_director_id is not null
      and m.emoji is not null and exists (select 1 from movie_leads l where l.movie_id = m.id)`);
  console.log(`Movies that can be a daily answer right now: ${ready}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
