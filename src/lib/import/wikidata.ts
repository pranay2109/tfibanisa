// Pure helpers for the Wikidata import. No network or DB code here.

// "http://www.wikidata.org/entity/Q123" -> "Q123"
export function qid(uri: string): string {
  return uri.slice(uri.lastIndexOf("/") + 1);
}

// Wikidata labels sometimes carry Wikipedia-style disambiguation, in English or Telugu:
// "Mirai (2025 film)", "కాళిదాస్ (సినిమా)", "శివ (1989 సినిమా)".
export function cleanTitle(label: string): string {
  return label
    .replace(/\s*\((?:\d{4}\s+)?(?:[\p{L}-]+\s+)?film\)\s*$/iu, "")
    .replace(/\s*\((?:\d{4}\s+)?(?:[\p{L}\p{M}-]+\s+)?సినిమా\)\s*$/u, "")
    .trim();
}

// ASCII-only slug; empty for titles with no Latin letters.
export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Same idea as the movies.search_key column: lowercase, no spaces or punctuation.
export function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

// position = where the cast member appears in the Wikidata statement list, which follows the
// Wikipedia infobox "Starring" order (hero first). ordinal = an explicit billing order, if any.
export type CastMember = { qid: string; ordinal: number | null; position: number };

export function pickLeads(cast: CastMember[], n = 2): string[] {
  const unique = [...new Map([...cast].reverse().map((c) => [c.qid, c])).values()];
  return unique
    .sort((a, b) => (a.ordinal ?? Infinity) - (b.ordinal ?? Infinity) || a.position - b.position)
    .slice(0, n)
    .map((c) => c.qid);
}

// Wikidata language items for the original-language list.
const LANGUAGE_CODES: Record<string, string> = {
  Q8097: "te",
  Q5885: "ta",
  Q1568: "hi",
  Q33673: "kn",
  Q36236: "ml",
  Q1860: "en",
  Q1571: "mr",
  Q9610: "bn",
};

export function languageCodes(qids: string[]): string[] {
  return [...new Set(qids.map((q) => LANGUAGE_CODES[q] ?? q))];
}

export function uniqueSlug(base: string, fallback: string, taken: Set<string>): string {
  const root = base || fallback.toLowerCase();
  let slug = root;
  if (taken.has(slug)) slug = `${root}-${fallback.toLowerCase()}`;
  for (let i = 2; taken.has(slug); i++) slug = `${root}-${fallback.toLowerCase()}-${i}`;
  taken.add(slug);
  return slug;
}

export type ImportFilm = {
  qid: string;
  // Every Wikidata item merged into this film, primary first.
  qids: string[];
  en: string;
  te: string;
  year: number;
  popularity: number;
  director: string | null;
  music: string | null;
  leads: string[];
  languages: string[];
};

// Wikidata has duplicate items for some films (same title and year, different ids). Two
// copies would break the game: guessing the "other" Mahanati would count as wrong. Merge
// them: the most-linked item wins and the others fill its gaps.
export function mergeDuplicates(films: Omit<ImportFilm, "qids">[]): ImportFilm[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  const byKey = new Map<string, string>();
  for (const f of films) {
    parent.set(f.qid, f.qid);
    for (const title of new Set([f.en, f.te])) {
      const key = `${normalizeTitle(title)}|${f.year}`;
      const seen = byKey.get(key);
      if (seen) parent.set(find(f.qid), find(seen));
      else byKey.set(key, f.qid);
    }
  }

  const groups = new Map<string, Omit<ImportFilm, "qids">[]>();
  for (const f of films) {
    const root = find(f.qid);
    groups.set(root, [...(groups.get(root) ?? []), f]);
  }

  return [...groups.values()].map((group) => {
    const [primary, ...rest] = [...group].sort(
      (a, b) => b.popularity - a.popularity || a.qid.localeCompare(b.qid),
    );
    const fill = <K extends "director" | "music">(k: K) =>
      primary[k] ?? rest.find((f) => f[k])?.[k] ?? null;
    return {
      ...primary,
      qids: [primary.qid, ...rest.map((f) => f.qid)],
      director: fill("director"),
      music: fill("music"),
      leads: primary.leads.length ? primary.leads : (rest.find((f) => f.leads.length)?.leads ?? []),
      languages: primary.languages.length
        ? primary.languages
        : (rest.find((f) => f.languages.length)?.languages ?? []),
    };
  });
}
