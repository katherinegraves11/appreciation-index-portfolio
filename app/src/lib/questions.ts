/** The question library (Katie, 2026-10-26: "keep a list of all the iterations of different approach to these questions to be able to
 *  answer potential questions more quickly"). Every question asked is kept with the bag it resolved to and the answer it produced,
 *  dated, never overwritten. A question asked again word for word skips the AI read of the question and goes straight to the answer. */
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import type { BriefInput } from "./schema";

const DB = process.env.TRACKER_DB_PATH ?? "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db";

function open(): DatabaseSync | null {
  if (!fs.existsSync(DB)) return null;
  try {
    const d = new DatabaseSync(DB);
    d.exec("PRAGMA busy_timeout = 5000");
    d.exec(`create table if not exists question_library(id integer primary key, asked_at text, question text, normalized text, horizon int,
      from_photo int, house text, bag text, spec text, input_json text, interpretation text, brief_id text, cached int)`);
    d.exec("create index if not exists ix_ql_norm on question_library(normalized)");
    return d;
  } catch { return null; }
}

/** The same question in any capitalisation or punctuation. */
export const normalizeQuestion = (q: string) => q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9$]+/g, " ").trim();

/** How this exact question was read before (typed questions only; a photo's reading is its own fact). Only the newest reading from the last
 *  14 days is reused, so an old reading never outlives a fix to how questions are read. */
export function knownReading(question: string): { input: BriefInput; interpretation: string } | null {
  const d = open(); if (!d) return null;
  try {
    const r = d.prepare("select input_json, interpretation from question_library where normalized = ? and from_photo = 0 and input_json is not null and substr(replace(asked_at,'T',' '),1,10) >= date('now','-14 days') and replace(asked_at,'T',' ') >= '2026-10-26 13:45' /* readings before the reader stopped adding unnamed finishes (Sam, WGSN round) are never reused */ order by replace(asked_at,'T',' ') desc limit 1").get(normalizeQuestion(question)) as { input_json: string; interpretation: string | null } | undefined;
    if (!r) return null;
    const input = JSON.parse(r.input_json) as BriefInput;
    // a saved reading that added a finish the question never named is never reused (Sam, WGSN round: a "cheetah" Le Teckel looped)
    const asked = question.toLowerCase();
    const added = (`${input.bag} ${input.spec ?? ""}`.toLowerCase().match(/\b(cheetah|leopard|pony ?hair|calf ?hair|sequins?|fringe|feathers?|crocodile|croc|alligator|ostrich|lizard|python|himalaya|suede|tweed|denim|raffia|shearling|mink|fur|newspaper|crystal|strass|beaded)\b/g) ?? [])
      .some((w) => !asked.includes(w.replace(/s$/, "")));
    return added ? null : { input, interpretation: r.interpretation ?? "" };
  } catch { return null; } finally { d.close(); }
}

/** The golden set (Katie, 2026-10-31: "Faster: each golden question stores a verified bag reading … the tool can skip the AI step").
 *  Words are folded so spellings agree (pony hair = ponyhair = calf hair, croc = crocodile, doblis = suede, Himalayan = Himalaya). */
export const goldenNorm = (s: string) => ` ${s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\$\s?[0-9][0-9,.]*\s*k?\b|\b\d{1,3}(,\d{3})+\b|\b\d+(\.\d)?\s?k\b/g, " ") // prices are never detail words
  .replace(/[^a-z0-9]+/g, " ")
  // a condition is a detail only when said as one: "is $9,500 fair?" is about the price, "fair condition" is about the bag
  .replace(/\b(very good|good|fair|excellent|pristine|new) condition\b/g, (_, c: string) => `condition${c.replace(/ /g, "")}`)
  .replace(/\b(pony|calf) ?hair\b/g, "ponyhair").replace(/\bcrocodile\b/g, "croc").replace(/\bdoblis\b/g, "suede").replace(/\bhimalayan\b/g, "himalaya")
  .replace(/\bsequins\b/g, "sequin").replace(/\bwoc\b/g, "wallet").replace(/\bmama\b/g, "mamma").replace(/\s+/g, " ").trim()} `;
// every word that changes which bag, version or condition is meant; a question and a golden reading must name exactly the same ones
const DETAIL = /\b(nano|mini|small|medium|large|maxi|jumbo|teen|mm|pm|gm|bb|ponyhair|cheetah|leopard|zebra|fringe|feathers?|croc|niloticus|porosus|alligator|ostrich|lizard|python|himalaya|suede|grizzly|togo|epsom|clemence|swift|box|evercolor|barenia|caviar|lambskin|calfskin|grained|patent|embossed|tweed|denim|raffia|shearling|mink|swakara|fur|sequin|strass|crystal|beaded|newspaper|mother|pearl|canvas|monogram|taurillon|intrecciato|gold|palladium|silver|ruthenium|diamond|black|white|red|pink|fuchsia|blue|navy|turquoise|green|chartreuse|lime|anise|yellow|brown|tan|beige|cream|grey|gray|purple|burgundy|bordeaux|orange|olive|indigo|vintage|galliano|lagerfeld|viard|blazy|anderson|wallet|clutch|pochette|tote|hobo|bucket|belt|backpack|vanity|pouch|strap|chain|night|sellier|retourne|cut|touch|lock|reissue|condition\w+|pristine|worn|tags|(?:19|20)\d\d|\d{2,3})\b/g;
const HOUSE_WORDS = /\b(hermes|chanel|dior|fendi|loewe|celine|bottega|gucci|prada|miu|vuitton|lv|row|alaia|balenciaga|ysl|saint laurent|ferragamo|goyard|valentino|givenchy)\b/g;

/** An approved golden reading for this question, or null. Strict on purpose: the question names every must-word of the golden reading,
 *  none of its must-not words, exactly the same detail words (size, leather, colour, hardware, condition, year, shape), one house, and no
 *  comparison. Comparisons, families and collections only match their own question word for word. Prices and verdicts are never stored. */
export function goldenReading(question: string): { input: BriefInput; interpretation: string; goldenId: number } | null {
  const d = open(); if (!d) return null;
  try {
    const has = d.prepare("select 1 from sqlite_master where name='golden_questions'").get(); if (!has) return null;
    const rows = d.prepare("select id, question, house, bag, spec, question_type, must_terms, must_not_terms from golden_questions where status='approved'").all() as { id: number; question: string; house: string; bag: string; spec: string | null; question_type: string; must_terms: string; must_not_terms: string }[];
    const q = goldenNorm(question), qn = normalizeQuestion(question);
    const details = (s: string) => [...new Set(s.match(DETAIL) ?? [])].sort().join(" ");
    const houses = new Set(q.match(HOUSE_WORDS) ?? []);
    const compare = houses.size > 1 || /\b(vs|versus|compared?|which (one )?holds?)\b/.test(q);
    const hits = rows.filter((g) => {
      if (g.question_type !== "bag" || compare) return normalizeQuestion(g.question) === qn;
      const must = JSON.parse(g.must_terms) as string[], not = JSON.parse(g.must_not_terms) as string[];
      if (!must.every((m) => m.split("|").some((alt) => q.includes(goldenNorm(alt))))) return false;
      if (not.some((w) => q.includes(goldenNorm(w)))) return false;
      return details(q) === details(goldenNorm(`${g.bag} ${g.spec ?? ""}`));
    });
    if (!hits.length) return null;
    const key = (g: (typeof hits)[number]) => `${g.house}|${g.bag}|${g.spec ?? ""}`;
    if (new Set(hits.map(key)).size > 1) return null; // two readings fit: let the AI read it
    const g = hits[0];
    const input: BriefInput = { house: g.house, bag: g.bag, spec: (g.spec ?? "").replace(/\s*\((compare|vs)[^)]*\)/i, "").trim(),
      horizonYears: /\b(ten|10) ?years?\b|long[- ]term|pass (it )?down|heirloom/i.test(question) ? 10 : 5,
      clientType: /\bcollect/i.test(question) ? "collector" : /\bsourc(e|ing) for\b/i.test(question) ? "sourcer" : "wearer",
      cohort: "unknown", budget: "", notes: `Client's own words: ${question.slice(0, 420)}`.slice(0, 600),
      questionType: (g.question_type === "family" || g.question_type === "collection" ? g.question_type : "bag") as BriefInput["questionType"], season: "" };
    return { input, interpretation: `Reading that as the ${g.house} ${g.bag}${input.spec ? `, ${input.spec}` : ""}.`, goldenId: g.id };
  } catch { return null; } finally { d.close(); }
}

/** Keep every question with what it resolved to; a failure here never stops an answer. */
export function recordQuestion(q: { question: string; horizon: number; fromPhoto: boolean; input: BriefInput; interpretation?: string; briefId?: string; cached?: boolean }) {
  const d = open(); if (!d) return;
  try {
    d.prepare("insert into question_library(asked_at, question, normalized, horizon, from_photo, house, bag, spec, input_json, interpretation, brief_id, cached) values(datetime('now','localtime'),?,?,?,?,?,?,?,?,?,?,?)")
      .run(q.question.replace(/https?:\/\/\S+/g, (m) => cleanLink(m)), normalizeQuestion(q.question), q.horizon, q.fromPhoto ? 1 : 0, q.input.house, q.input.bag, q.input.spec ?? "", JSON.stringify(q.input), q.interpretation ?? "", q.briefId ?? null, q.cached ? 1 : 0);
  } catch { /* the answer still goes out */ } finally { d.close(); }
}

/** A link with the ad and tracking codes taken off (gclid, utm_…), so only the listing itself is kept. */
export function cleanLink(u: string): string {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|gclid|gbraid|wbraid|gad_|fbclid|msclkid|srsltid|_gl|mc_|igsh|ref_?$)/i.test(k)) url.searchParams.delete(k);
    url.hash = "";
    return url.toString().replace(/\?$/, "");
  } catch { return u; }
}

/** The link library (Katie, 2026-10-26: "each time someone pastes a link into the tool can we keep that tracked as well? It will allow
 *  us to make decisions more quickly"): every pasted listing, what we could read from it, dated, never overwritten. */
export function recordLink(l: { url: string; question: string; site?: string; title?: string; price?: number | null; condition?: string | null; note?: string; boutique?: boolean; readOk: boolean }) {
  const d = open(); if (!d) return;
  try {
    d.exec(`create table if not exists link_library(id integer primary key, asked_at text, url text, site text, title text, price real, condition text,
      note text, boutique int, read_ok int, question text)`);
    d.prepare("insert into link_library(asked_at, url, site, title, price, condition, note, boutique, read_ok, question) values(datetime('now','localtime'),?,?,?,?,?,?,?,?,?)")
      .run(cleanLink(l.url), l.site ?? (() => { try { return new URL(l.url).hostname.replace(/^www\./, ""); } catch { return ""; } })(), l.title ?? null, l.price ?? null, l.condition ?? null, l.note ?? null, l.boutique ? 1 : 0, l.readOk ? 1 : 0, l.question.replace(/https?:\/\/\S+/g, (m) => cleanLink(m)));
  } catch { /* the answer still goes out */ } finally { d.close(); }
}

/** The answer given today to this exact question (same words, same dial), for a priced or listing question that otherwise always runs
 *  fresh: the same words on the same day get the same answer (Katie, 2026-10-26, recording the sparkly Fendi Baguette for WGSN). */
export function sameQuestionToday(question: string, horizon: number): string | null {
  const d = open(); if (!d) return null;
  try {
    const r = d.prepare("select brief_id from question_library where normalized = ? and horizon = ? and brief_id is not null and substr(replace(asked_at,'T',' '),1,10) = date('now','localtime') order by id desc limit 1").get(normalizeQuestion(question), horizon) as { brief_id: string } | undefined;
    return r?.brief_id ?? null;
  } catch { return null; } finally { d.close(); }
}

/** Photo memory: the same photo is read once. Its identification is a fact (never-change rule 4), so a second drop of the identical
 *  image returns the same reading at once, and the answer behind it matches (Katie, 2026-10-26, recording for WGSN). */
export function photoReading(hash: string): unknown | null {
  const d = open(); if (!d) return null;
  try {
    d.exec("create table if not exists photo_readings(hash text primary key, read_at text, reading_json text)");
    const r = d.prepare("select reading_json from photo_readings where hash = ?").get(hash) as { reading_json: string } | undefined;
    return r ? JSON.parse(r.reading_json) : null;
  } catch { return null; } finally { d.close(); }
}
export function savePhotoReading(hash: string, reading: unknown) {
  const d = open(); if (!d) return;
  try {
    d.exec("create table if not exists photo_readings(hash text primary key, read_at text, reading_json text)");
    d.prepare("insert or ignore into photo_readings(hash, read_at, reading_json) values(?, datetime('now','localtime'), ?)").run(hash, JSON.stringify(reading));
  } catch { /* the reading still goes out */ } finally { d.close(); }
}
