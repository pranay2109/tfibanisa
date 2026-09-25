import { describe, expect, it } from "vitest";
import {
  cleanTitle,
  mergeDuplicates,
  normalizeTitle,
  pickLeads,
  languageCodes,
  qid,
  slugify,
  uniqueSlug,
} from "./wikidata";

describe("qid", () => {
  it("takes the id from an entity URI", () => {
    expect(qid("http://www.wikidata.org/entity/Q25167744")).toBe("Q25167744");
  });
});

describe("cleanTitle", () => {
  it("drops Wikipedia-style disambiguation", () => {
    expect(cleanTitle("Mirai (2025 film)")).toBe("Mirai");
    expect(cleanTitle("Eleven (Telugu film)")).toBe("Eleven");
    expect(cleanTitle("Kushi (film)")).toBe("Kushi");
  });

  it("drops Telugu disambiguation too", () => {
    expect(cleanTitle("కాళిదాస్ (సినిమా)")).toBe("కాళిదాస్");
    expect(cleanTitle("శివ (1989 సినిమా)")).toBe("శివ");
  });

  it("keeps titles that merely contain brackets", () => {
    expect(cleanTitle("Kalki 2898 AD")).toBe("Kalki 2898 AD");
    expect(cleanTitle("Hi Nanna (Hello Daddy)")).toBe("Hi Nanna (Hello Daddy)");
  });
});

describe("slugify", () => {
  it("makes URL-safe slugs", () => {
    expect(slugify("Salaar: Part 1 – Ceasefire")).toBe("salaar-part-1-ceasefire");
  });

  it("returns empty for Telugu-only text", () => {
    expect(slugify("మగధీర")).toBe("");
  });
});

describe("normalizeTitle", () => {
  it("ignores case, spaces and punctuation", () => {
    expect(normalizeTitle("Baahubali: The Beginning")).toBe(normalizeTitle("baahubali the beginning"));
    expect(normalizeTitle("Pushpa 2: The Rule")).toBe("pushpa2therule");
  });
});

describe("pickLeads", () => {
  const c = (qid: string, position: number, ordinal: number | null = null) => ({ qid, position, ordinal });

  it("follows the listed order (hero first)", () => {
    expect(pickLeads([c("Qtyson", 5), c("Qvijay", 0), c("Qananya", 1)])).toEqual(["Qvijay", "Qananya"]);
  });

  it("prefers an explicit billing order when editors added one", () => {
    expect(pickLeads([c("Q1", 0), c("Q2", 1, 2), c("Q3", 2, 1)])).toEqual(["Q3", "Q2"]);
  });

  it("ignores repeated cast rows, keeping the first position", () => {
    expect(pickLeads([c("Q1", 0), c("Q1", 4), c("Q2", 1)])).toEqual(["Q1", "Q2"]);
  });
});

describe("languageCodes", () => {
  it("maps known languages and keeps order", () => {
    expect(languageCodes(["Q5885", "Q8097", "Q5885"])).toEqual(["ta", "te"]);
    expect(languageCodes(["Q999"])).toEqual(["Q999"]);
  });
});

describe("uniqueSlug", () => {
  it("adds the Wikidata id on a clash", () => {
    const taken = new Set(["eega-2012"]);
    expect(uniqueSlug("eega-2012", "Q5", taken)).toBe("eega-2012-q5");
    expect(uniqueSlug("", "Q7", taken)).toBe("q7");
  });
});

describe("mergeDuplicates", () => {
  const film = (qid: string, en: string, year: number, popularity: number, extra = {}) => ({
    qid, en, te: en, year, popularity, director: null, music: null, leads: [], languages: [], ...extra,
  });

  it("merges same title and year, keeping the most-linked item", () => {
    const out = mergeDuplicates([
      film("Q2", "Mahanati", 2018, 1, { music: "Qm", leads: ["Qa"] }),
      film("Q1", "Mahanati", 2018, 9, { director: "Qd" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ qid: "Q1", qids: ["Q1", "Q2"], director: "Qd", music: "Qm", leads: ["Qa"] });
  });

  it("treats spacing and punctuation variants as the same title", () => {
    expect(mergeDuplicates([film("Q1", "Burra Katha", 2019, 2), film("Q2", "Burrakatha", 2019, 1)])).toHaveLength(1);
  });

  it("keeps remakes from different years apart", () => {
    expect(mergeDuplicates([film("Q1", "Devadasu", 1953, 5), film("Q2", "Devadasu", 2006, 5)])).toHaveLength(2);
  });

  it("merges on a shared Telugu title", () => {
    const out = mergeDuplicates([
      { ...film("Q1", "Chatrapathi", 2005, 5), te: "ఛత్రపతి" },
      { ...film("Q2", "Chatrapati", 2005, 1), te: "ఛత్రపతి" },
    ]);
    expect(out).toHaveLength(1);
  });
});
