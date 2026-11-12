/**
 * Tracker bridge: reads Katie's Fashion Data Lab SQLite database (read-only) and builds a
 * sourced evidence dossier for one bag BEFORE the model touches the web.
 *
 * Local dev: TRACKER_DB_PATH (defaults to the Desktop Fashion Data Lab).
 * Production: set TRACKER_DB_PATH to a copy of the .db shipped with the deploy, or leave unset
 * to skip (the analyst then researches from the web only and says so).
 */
import { DatabaseSync } from "node:sqlite";
import { connectiveLines, forwardRead, forwardLines, bagTrend, moments, type Forward, type Moment } from "./trends";
import fs from "fs";
import { salesCount, priceWord, yearFigures } from "./verdict";
import { SIGNAL_KEY, stockSignal } from "./signalKey";
import path from "path";

const DESKTOP_DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db";
const BUNDLED_DB = path.join(process.cwd(), "data", "tracker.db");
const DEFAULT_DB = fs.existsSync(DESKTOP_DB) ? DESKTOP_DB : BUNDLED_DB;

type Row = Record<string, string | number | null>;

function open(): DatabaseSync | null {
  const p = process.env.TRACKER_DB_PATH ?? DEFAULT_DB;
  try {
    const d = new DatabaseSync(p, { readOnly: true }); try { d.exec("PRAGMA busy_timeout = 5000"); } catch { /* older sqlite */ } return d; // a write in progress makes reads wait, never fail (Sam, round 19)
  } catch {
    return null;
  }
}

/** Every title, question and catalogue row is translated into the same words before matching (Katie, 2026-10-25: "the wording is
 *  slightly different on all these bags"). Listing sites word one bag many ways; these are the house vocabularies we have met. */
const CANON: [RegExp, string][] = [
  [/\bpony ?hair\b|\bcalf ?hair\b|\bhair ?calf\b|\bpoulain\b|\bcalf ?fur\b/g, "pony hair"], // "calf fur" is the reader's word for calf hair (Sam, round 17)
  [/\bhimalayan\b/g, "himalaya"],
  // a Kelly 20 is the Mini Kelly (II): FWRD and others title it "Kelly 20" with no "mini" (Katie's FWRD screenshots, 2026-10-26)
  [/(?<!mini )\bkelly (ii )?20\b/g, "mini kelly 20"],
  [/\b(\d{2})\s?cm\b/g, "$1"],
  [/\bcrocodile\b|\bcroco\b|\bcroc\b/g, "crocodile"],
  [/\bveau doblis\b/g, "doblis"],
  // box, box calf and box leather are one Hermès leather (2026-10-26: "box leather" missed Katie's box-calf Mini Kelly)
  [/\bbox ?(calf(skin)?|leather)\b/g, "box"],
  [/\bmother ?of ?pearl\b|\bnacre\b/g, "mother of pearl"],
  [/\bmetiers d ?art\b/g, "metiers d art"],
  [/\bmatelasse\b/g, "quilted"],
  [/\bsilver tone\b|\bpalladium plated\b|\bphw\b/g, "palladium"],
  [/\bgold tone\b|\bghw\b/g, "gold"],
  [/\bmonogrammed\b/g, "monogram"],
  [/\bpre ?owned\b|\bpreloved\b|\bpre loved\b/g, "pre loved"],
  [/\bw tags\b|\bwith tags\b|\bnwt\b/g, "with tags"],
  [/\bmini kelly ii\b/g, "mini kelly ii"],
  [/\bdiamond[- ]?(quilting|quilted|quilt|stitch\w*|pattern)\b/g, "quilted"], // a diamond-quilted flap has no diamonds (Sam, round 26: m2)
  // The RealReal writes Fendi's Mamma Baguette as "Mama", "Mama Forever" or "Mamma Baguette": one bag (Katie, 2026-10-25)
  [/\bmama\b/g, "mamma"],
  // swakara (karakul lamb) is fur; a swakara Baguette is never priced against leather ones (Sam, round 13)
  [/\b(swakara|astrakhan|karakul|persian lamb|broadtail)( fur)?\b/g, "$1 fur"],
];
function norm(s: string) {
  let t = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const [rx, to] of CANON) t = t.replace(rx, to);
  return t.replace(/\s+/g, " ");
}

/** True median: the mean of the middle two when the count is even (two asks never report the higher one). */
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}
/** One RealReal listing, however its address was saved: the 2026-11-01 sweep stored "/products/…/slug" and
 *  "https://www.therealreal.com/similar/products/…/slug" for listings read before as "slug", and one $21,000 Kelly Pochette sale counted three times. */
function slugKey(s: unknown): string { return String(s ?? "").replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() ?? ""; }
const SLUG_KEY_SQL = "replace(slug, rtrim(slug, replace(slug, '/', '')), '')"; // the same, in SQL: the part after the last "/"
const EXOTIC_TITLE_SQL = "and lower(title) not like '%ostrich%' and lower(title) not like '%croc%' and lower(title) not like '%alligator%' and lower(title) not like '%lizard%' and lower(title) not like '%porosus%' and lower(title) not like '%niloticus%'";

// House aliases so "Dior" finds "Christian Dior" rows and vice versa.
function houseTerms(house: string): string[] {
  const h = norm(house);
  const alias: Record<string, string[]> = {
    dior: ["dior", "christian dior"],
    "christian dior": ["dior", "christian dior"],
    ysl: ["saint laurent", "ysl"],
    "saint laurent": ["saint laurent", "ysl"],
    lv: ["louis vuitton", "lv"],
    "louis vuitton": ["louis vuitton", "lv"],
    hermes: ["hermès", "hermes"],
    "herm s": ["hermès", "hermes"],
    "bottega veneta": ["bottega veneta", "bv"],
    // SQLite's lower() keeps accents, so an accented house must be searched with its accent too (Katie, 2026-10-24: "The RealReal is full of Teckels")
    alaia: ["alaïa", "alaia"],
    "ala a": ["alaïa", "alaia"],
    celine: ["celine", "céline"],
  };
  return alias[h] ?? [...new Set([h, house.toLowerCase().trim()])]; // any other accented house name, with and without its accents
}

function likeAny(col: string, terms: string[]) {
  return "(" + terms.map(() => `lower(${col}) like ?`).join(" or ") + ")";
}
function likeParams(terms: string[]) {
  return terms.map((t) => `%${t}%`);
}

function section(title: string, lines: string[]): string {
  if (!lines.length) return `### ${title}\n(no rows in tracker)\n`;
  return `### ${title}\n${lines.map((l) => `- ${l}`).join("\n")}\n`;
}

export type TrackerDossier = { text: string; rowCount: number; available: boolean };

export function buildTrackerDossier(house: string, bag: string, spec?: string): TrackerDossier {
  const db = open();
  if (!db) return { text: "", rowCount: 0, available: false };

  const hTerms = houseTerms(house);
  const bagWords = norm(bag)
    .split(" ")
    .filter((w) => w.length > 2 && !/^\d+$/.test(w));
  const bagTerm = bagWords[0] ?? norm(bag);
  const mmB = modelMatch("b.model", bag, house), mmM = modelMatch("model", bag, house), mmG = modelMatch("model_guess", bag, house);
  let n = 0;
  const out: string[] = [];

  const q = <T extends Row>(sql: string, params: (string | number)[] = []): T[] => {
    try {
      const rows = db.prepare(sql).all(...params) as T[];
      n += rows.length;
      return rows;
    } catch {
      return [];
    }
  };

  // 1. Bag identity + 10-year price paths
  const bags = q<Row>(
    `select b.*, group_concat(r.metric || '=' || r.value || ' (' || r.period || '; ' || r.source || ')', ' | ') as signals
     from bags b left join resale_signals r on r.bag_id=b.bag_id
     where ${likeAny("b.house", hTerms)} and ${mmB.sql}
     group by b.bag_id limit 5`,
    [...likeParams(hTerms), ...mmB.params],
  );
  out.push(
    section(
      "Bag identity (tracker)",
      bags.map(
        (b) =>
          `${b.house} ${b.model}: launch ${b.launch_year ?? "?"}, archive code ${b.archive_code ? "yes" : "no/unknown"}, designer at launch ${b.current_cd_at_launch ?? "?"}, season ${b.collection_season ?? "n/a"}, look ${b.runway_look ?? "n/a"}. Notes: ${b.notes ?? ""}. Price signals: ${b.signals ?? "none"}`,
      ),
    ),
  );

  // 2. Resale asking-price aggregates (Chrome reads) + collector medians per source
  const aggs = q<Row>(
    `select source, model, snapshot_date, n_listings, median_ask, median_retention_pct from resale_aggregates
     where ${likeAny("house", hTerms)} and ${mmM.sql} order by snapshot_date desc limit 12`,
    [...likeParams(hTerms), ...mmM.params],
  );
  const listingStats = q<Row>(
    `select source, model_guess, count(*) as n, round(avg(price)) as mean_ask,
            round(min(price)) as min_ask, round(max(price)) as max_ask, max(last_seen) as as_of
     from v_bag_listings where price is not null and ${likeAny("brand", hTerms)} and ${mmG.sql}
     group by source, model_guess having n >= 3 order by n desc limit 12`,
    [...likeParams(hTerms), ...mmG.params],
  );
  out.push(
    section("Resale asking prices (tracker)", [
      ...aggs.map(
        (a) =>
          `${a.source} · ${a.model} · ${a.snapshot_date}: n=${a.n_listings}, median ask $${a.median_ask}${a.median_retention_pct != null ? `, median retention ${a.median_retention_pct}% of est. retail` : ""}`,
      ),
      ...listingStats.map(
        (l) =>
          `${l.source} · ${l.model_guess} (as of ${l.as_of}): n=${l.n}, mean ask $${l.mean_ask}, range $${l.min_ask}–$${l.max_ask}`,
      ),
    ]),
  );

  // 2b. RETAIL vs RESALE — Katie: "comparing retail prices originally to what they sell for second hand is INTEGRAL"
  const retailNow = q<Row>(
    `select house, model, size_or_spec, retail_now, effective_date, source_url from v_retail_current
     where ${likeAny("house", hTerms)} and ${mmM.sql} limit 3`,
    [...likeParams(hTerms), ...mmM.params],
  );
  const retailHist = q<Row>(
    `select year, retail_that_year, price_type, source_url from v_retail_history
     where ${likeAny("house", hTerms)} and ${mmM.sql} order by year limit 10`,
    [...likeParams(hTerms), ...mmM.params],
  );
  const retention = q<Row>(
    `select source, snapshot_date, n_listings, median_ask, retail_now, retention_vs_current_retail_pct, reference_size
     from v_retail_vs_resale_asks where ${likeAny("house", hTerms)} and ${mmM.sql}
     order by snapshot_date desc, n_listings desc limit 10`,
    [...likeParams(hTerms), ...mmM.params],
  );
  const sold = q<Row>(
    `select read_date, era_guess, condition, sold_or_ask, sold, trr_est_retail, pct_of_trr_est_retail, retail_now, pct_of_current_retail
     from v_retail_vs_resale_sold where ${likeAny("house", hTerms)} and ${mmM.sql} order by read_date desc limit 12`,
    [...likeParams(hTerms), ...mmM.params],
  );
  const histLine = retailHist.length
    ? `Retail price path (US, reference size${retailNow[0]?.size_or_spec ? `: ${retailNow[0].size_or_spec}` : ""}): ${retailHist.map((h) => `${h.year} $${h.retail_that_year}${h.price_type === "launch" ? " (launch)" : ""}`).join(" → ")}${(() => { const az = norm(`${bag} ${spec ?? ""}`).match(/\b(nano|micro|mini|small|medium|large|maxi|teen|pm|mm|gm|bb|1[5-9]|[2-4]\d)\b/)?.[1]; return az && !new RegExp(`\\b${az}\\b`).test(norm(String(retailNow[0]?.size_or_spec ?? ""))) ? ` WARNING: this is NOT the size asked (${az}); never quote these years or rises for it. Use HEADLINE NUMBERS for the asked size.` : ""; })()}`
    : "";
  out.push(
    section("RETAIL vs RESALE (tracker; lead the brief with this)", [
      ...retailNow.map((r) => `Current US retail, ${r.size_or_spec}: $${r.retail_now} as of ${r.effective_date} (${r.source_url})`),
      ...(histLine ? [histLine] : []),
      ...retention.map(
        (r) =>
          `${r.source} · ${r.snapshot_date}: n=${r.n_listings}, median ask $${r.median_ask}${r.retail_now ? ` = ${r.retention_vs_current_retail_pct}% of current retail ($${r.retail_now}, ${r.reference_size})` : " (no retail reference yet)"}`,
      ),
      ...sold.map(
        (r) =>
          `RealReal read ${r.read_date}: ${r.era_guess ?? ""} ${r.condition ?? ""} ${r.sold ? "SOLD" : "asking"} $${r.sold_or_ask}${r.trr_est_retail ? ` = ${r.pct_of_trr_est_retail}% of TRR est. retail $${r.trr_est_retail}` : ""}${r.retail_now ? `; ${r.pct_of_current_retail}% of current retail` : ""}`,
      ),
    ]),
  );

  // 2c. FAMILY MATCHES — when the question is about an era, material, finish or collection (pony hair, cheetah,
  // Métiers d'Art, Blazy-era, Philo-era), match listing titles word by word so the dossier is not empty.
  const famWords = norm(`${bag} ${spec ?? ""}`).split(" ").filter((w) => w.length > 3 && !["bags", "bag", "pieces", "piece", "with", "from", "that", "this", "2026", "2025"].includes(w));
  if (famWords.length) {
    const where = famWords.map(() => "lower(title) like ?").join(" or ");
    const fp = famWords.map((w) => `%${w}%`);
    const trrFam = q<Row>(
      `select model_guess, count(*) n, sum(sold) sold, round(avg(price)) avg_ask, min(price) lo, max(price) hi, max(read_date) last_read
       from trr_item_reads where ${likeAny("house", hTerms)} and (${where}) group by model_guess having n >= 2 order by n desc limit 12`,
      [...likeParams(hTerms), ...fp],
    );
    const soldFam = q<Row>(
      `select title, price, read_date from trr_item_reads where ${likeAny("house", hTerms)} and sold=1 and (${where}) order by price desc limit 15`,
      [...likeParams(hTerms), ...fp],
    );
    const listFam = q<Row>(
      `select source, model_guess, count(*) n, round(avg(price)) avg_ask, min(price) lo, max(price) hi from v_bag_listings
       where ${likeAny("brand", hTerms)} and (${where}) group by source, model_guess having n >= 2 order by n desc limit 12`,
      [...likeParams(hTerms), ...fp],
    );
    out.push(
      section(`Family matches (tracker; titles containing: ${famWords.join(", ")})`, [
        ...trrFam.map((r) => `RealReal · ${r.model_guess}: ${r.n} tiles, ${r.sold} SOLD, avg ask $${r.avg_ask} (range $${r.lo}–$${r.hi}), last read ${r.last_read}`),
        ...soldFam.map((r) => `SOLD on RealReal ${r.read_date}: ${String(r.title).slice(0, 90)} — $${r.price}`),
        ...listFam.map((r) => `${r.source} · ${r.model_guess}: ${r.n} asks, avg $${r.avg_ask} (range $${r.lo}–$${r.hi})`),
      ]),
    );
  }

  // 3. Momentum (search, saved searches, supply, rankings)
  const mom = q<Row>(
    `select term, source, metric, value, period_start, period_end from momentum
     where lower(term) like ? or lower(term) like ? order by retrieved_at desc limit 20`,
    [`%${hTerms[0]}%`, `%${bagTerm}%`],
  );
  out.push(section("Momentum (tracker)", mom.map((m) => `${m.term} · ${m.metric}=${m.value} (${m.period_start}→${m.period_end}; ${m.source})`)));

  // 4. Creative directors + executive moves
  const cds = q<Row>(
    `select house, name, start_date, end_date, predecessor, debut_season, debut_reception_notes from creative_directors
     where ${likeAny("house", hTerms)} order by start_date desc limit 6`,
    likeParams(hTerms),
  );
  const moves = q<Row>(
    `select tracker_month, headline, effective from people_moves where ${likeAny("headline", hTerms)} order by id limit 8`,
    likeParams(hTerms),
  );
  out.push(
    section("Creative direction & leadership (tracker)", [
      ...cds.map((c) => `${c.house}: ${c.name} from ${c.start_date}${c.end_date ? ` to ${c.end_date}` : ""} (after ${c.predecessor ?? "?"}); debut ${c.debut_season ?? "?"}. ${c.debut_reception_notes ?? ""}`),
      ...moves.map((m) => `${m.tracker_month}: ${m.headline} (effective ${m.effective}) — Vogue Business People Moves Tracker`),
    ]),
  );

  // 5. Supply chain, ownership, pricing
  const sc = q<Row>(
    `select fact_date, category, description, implication_for_value, source_name, source_url, confidence from supply_chain_facts
     where ${likeAny("house", hTerms)} or lower(parent_group) like ? order by fact_date desc limit 14`,
    [...likeParams(hTerms), `%${hTerms[0]}%`],
  );
  out.push(section("Supply chain, ownership & pricing (tracker)", sc.map((f) => `[${f.fact_date}; ${f.category}; confidence ${f.confidence}] ${f.description} → ${f.implication_for_value ?? ""} (${f.source_name}, ${f.source_url})`)));

  // 6. History & reputation
  const hist = q<Row>(
    `select event_date, category, description, market_effect_notes, still_matters, source_url from history_events
     where ${likeAny("house", hTerms)} or lower(designer) like ? or house like '%cross-house%' order by event_date desc limit 8`,
    [...likeParams(hTerms), `%${hTerms[0]}%`],
  );
  const macro = q<Row>(
    `select date, category, description, houses_affected, source_url from macro_events
     where ${likeAny("houses_affected", hTerms)} order by date desc limit 6`,
    likeParams(hTerms),
  );
  out.push(
    section("History, reputation & events (tracker)", [
      ...hist.map((h) => `[${h.event_date}; ${h.category}; still matters: ${h.still_matters}] ${h.description} Market: ${h.market_effect_notes ?? ""} (${h.source_url})`),
      ...macro.map((m) => `[${m.date}; ${m.category}] ${m.description} (${m.source_url})`),
    ]),
  );

  // 6b. Secondhand sourcer listings in the same material (resale_listings: Privé Porter, Madison Avenue Couture, Fashionphile, Rebag, dealers read one page at a time).
  // Asks unless marked sold; private-sourcer-offer rows are Katie's own quotes and never appear here.
  {
    const MATERIALS = ["doblis", "suede", "crocodile", "croc", "alligator", "ostrich", "lizard", "shearling", "grizzly", "barenia", "box calf", "chevre", "swift", "epsom", "togo", "clemence", "evercolor", "tadelakt"];
    const specN = norm(`${bag} ${spec ?? ""}`);
    const mats = MATERIALS.filter((m) => specN.includes(m));
    const embossedAsked = /\b(embossed|stamped)\b/.test(specN); // an embossed bag compares with embossed bags only, a real croc never with embossed
    const bagWords = norm(bag).split(" ").filter((w) => w.length > 2 && !["bag", "bags", "the", "and", "with", "clutch"].includes(w)).slice(0, 3);
    const sizeN = specN.match(/\b(1[5-9]|[2-4]\d)\b/)?.[1] ?? null;
    if (mats.length && bagWords.length) {
      const rows = q<Row>(
        `select source, title, price, available, last_seen, handle_url from resale_listings
         where coalesce(currency,'USD')='USD' and ${likeAny("brand", hTerms)} and source <> 'private-sourcer-offer'
         ${bagWords.map(() => "and lower(title) like ?").join(" ")}
         and (${mats.map(() => "(lower(title) like ? or lower(coalesce(material_guess,'')) like ?)").join(" or ")})
         and lower(title) ${embossedAsked ? "" : "not "}like '%embossed%'
         order by price desc limit 40`,
        [...likeParams(hTerms), ...bagWords.map((w) => `%${w}%`), ...mats.flatMap((m) => [`%${m}%`, `%${m}%`])],
      );
      const sized = sizeN ? rows.filter((r) => new RegExp(`(^|[^0-9$])${sizeN}(\\s*cm)?([^0-9%,]|$)`).test(String(r.title).toLowerCase().replace(/\$\s*[0-9][0-9,.]*/g, " "))) : rows;
      const others = sizeN ? rows.filter((r) => !sized.includes(r)) : [];
      const SW = ["nano", "micro", "mini", "small", "medium", "large", "maxi", "jumbo", "teen", "baby", "toy"]; const askW = SW.find((w) => new RegExp(`\\b${w}\\b`).test(specN));
      const fit = (r: Row) => { const t = norm(String(r.title ?? "")); return !DISTINCT_MODELS.some((w) => t.includes(w) && !specN.includes(w)) && (!askW || !SW.some((w) => w !== askW && new RegExp(`\\b${w}\\b`).test(t))); };
      const use = [...sized.filter(fit).slice(0, 10), ...others.filter(fit).slice(0, 8)];
      const tag = (r: Row) => {
        const t = String(r.title ?? "").toLowerCase(); const notes: string[] = [];
        if (sizeN && !sized.includes(r)) notes.push("OTHER SIZE");
        if (/\//.test(t) && MATERIALS.filter((m) => t.includes(m)).length > 1) notes.push("MIXED LEATHERS, not a full-material bag");
        if (/snippet/.test(t)) notes.push("price from a search snippet, unconfirmed");
        return notes.length ? ` [${notes.join("; ")}]` : "";
      };
      if (use.length) {
        out.push(section(`Secondhand sourcer listings in the same material (${mats.join(", ")}${sizeN ? `; size ${sizeN} first, then other sizes for context` : ""}). These are ASKS unless marked SOLD; SOLD means the secondhand sourcer marked it placed or sold out at that listed price (count it as a sale). Use these, not plain-leather sales, for any counter on a ${mats.join("/")} quote, and state the size, hardware and condition of each comp you cite.`,
          use.map((r) => `${r.available === 0 ? "SOLD by the sourcer, at listed" : "ask"} $${r.price} · ${r.source} · ${r.title}${tag(r)} · seen ${r.last_seen}${String(r.handle_url ?? "").startsWith("http") ? ` (${r.handle_url})` : ""}`)));
      }
    }
  }

  // 6c. Connective tissue (Katie's daily rule): culture against willingness to pay and sales, with n and "collecting" where thin.
  try {
    const links = connectiveLines(house, bag, spec);
    if (links.length) out.push(section("CONNECTIVE TISSUE: culture vs willingness to pay vs sales (Google Trends history, auction results, The RealReal reads; correlation, never cause)", links));
  } catch { /* trends DB missing: the section is simply absent */ }

  // 7. WGSN forecasts (forward-looking; cite as forecast)
  const wgsn = q<Row>(
    `select report_title, published, signal, derived_note, relevance_bucket, underlying_source from wgsn_signals
     order by published desc limit 14`,
  );
  out.push(section("WGSN forecasts (tracker; forward-looking, cite as 'WGSN, <report>, <date>')", wgsn.map((w) => `${w.report_title} (${w.published}) — ${w.signal}: ${w.derived_note} [buckets: ${w.relevance_bucket}; WGSN cites ${w.underlying_source}]`)));

  db.close();
  const text = `## TRACKER EVIDENCE (The Appreciation Index tracker — verified, sourced rows; treat as primary evidence. Never name the people behind it: cite it as "The Appreciation Index tracker")\n\n${out.join("\n")}`;
  return { text, rowCount: n, available: true };
}


/** What is moving on resale right now: a compact cheat sheet the question parser uses to resolve vague phrasing. */
export function hotList(): string {
  const db = open();
  if (!db) return "(tracker unavailable)";
  try {
    const rows = db.prepare(`
      select house, model_guess, era_guess, count(*) n, sum(sold) sold,
             round(avg(cast(nullif(rtrim(substr(substr(title, instr(title,'saves=')+6), 1, 6), ';] abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ,'),'') as real))) saves,
             round(avg(price)) avg_ask,
             null finish /* Sam, WGSN round: a finish tag here was copied into unrelated questions (a "cheetah" Le Teckel) */
      from trr_item_reads where read_date >= date('now','-45 days') and model_guess is not null and model_guess <> ''
      group by house, model_guess, era_guess having n >= 3 order by sold desc, saves desc limit 40`).all() as Row[];
    db.close();
    // names and activity only: no prices, so the question reader never repeats a figure (Sam: "$4,604 average ask" appeared in a loading line)
    return rows.map((r) => `- ${r.house} ${r.model_guess}${r.era_guess ? ` (${r.era_guess})` : ""}: ${r.n} listed, ${r.sold} sold`).join("\n");
  } catch {
    db.close();
    return "(tracker unavailable)";
  }
}


/** Quick numbers for the answer strip: retail, sold, asks, saves for one house+model (size-matched where possible). */
export type QuickNumbers = {
  bySize?: { model: string; band: { lo: number; mid: number; hi: number }; n: number; retail: number | null }[];
  forever?: { word: "Forever bag" | "A moment" | "Too new to say"; line: string; rare?: string | null };
  byModel?: { model: string; band: { lo: number; mid: number; hi: number }; n: number; retail: number | null }[];
  retail_now: number | null; retail_launch: number | null; retail_size: string | null; abroad?: string[];
  retail_base?: { price: number; label: string } | null;
  vintage?: boolean;
  ask_median: number | null; ask_n: number; sold_median: number | null; sold_n: number; sold_pct_of_retail: number | null;
  saves_avg: number | null; trend_pct: number | null; trr_sold_90d: number; icon: boolean;
  buzz: BuzzNumbers | null;
  links: { house_url: string | null; runway_url: string | null };
  path: { from_price: number; from_date: string; to_price: number; to_date: string; size: string | null; steps?: number; last_from?: number | null; last_from_date?: string | null } | null;
  sell: { retail: number; retail_spec: string; median_sold: number; mean_sold: number; prices: number[]; n: number; window_days: number; matched_on: string; lo: number; hi: number; read_from: string; read_to: string; pristine: number; plain: boolean } | null;
  asks: { median_ask: number; n: number; sold: number; trr_n: number; fwrd_n: number; fwrd_median: number | null; venue: string; link: string | null; link_label: string } | null;
  tiers: PriceTiers;
  catalog: CatalogHit;
  forward: Forward;
  paths: Paths;
  trend: { term: string | null; years: { year: string; avg: number }[]; auction: string | null; resale: string | null; moments: Moment[] } | null;
};
/** Katie's rule: the boutique price is the only absolute price; every secondhand figure is an average.
 *  Secondhand websites (sold and asked) and the private sourcer market (where the sourcer sets the price) are kept apart. */
export type Avg = { mean: number; median: number; n: number; lo: number; hi: number };
/** Two ways in (Katie, 2026-10-23): buy at the boutique and what it is worth secondhand the moment you leave, vs buy secondhand at a price
 *  and what it is likely worth in 6 months, 1 year and 5 years if prices keep the boutique's own pace. Arithmetic on stated evidence, not a model. */
export type Paths = {
  salesN?: number; // the sales in the range, counted once (Sam, round 16)
  middle?: boolean; // the range is the middle half of four or more prices
  sold?: { lo: number; hi: number; n: number } | null; // real sales only (the snapshot), never asks
  basis: "same-material sales" | "same-material asks" | "other-leather sales"; basisNote: string; mixed?: boolean; viaSourcer?: boolean;
  band: { lo: number; mid: number; hi: number }; growthPct: number | null;
  boutique: { price: number; label: string } | null;
  buy: { price: number; label: string; isQuote: boolean };
  horizons: { label: string; years: number; lo: number; mid: number; hi: number }[]; condition?: string | null; buyer?: "boutique" | "secondhand" | "owner" | null;
} | null;
/** A price someone was quoted or offered, from the question's own words ("quoted me $98,000", "$48k"). */
export function parseQuote(text?: string | null): number | null {
  if (!text) return null;
  // a secondhand price: a quote, an ask, or a listing on a resale site ("buy it on The RealReal for $4,200", Zara 2026-10-24)
  // Sam, round 6: "Is $98,000 fair for ...?" and "found one at The 1916 Company for $28,000" are prices the client is weighing too
  const secondhand = /(quot|offer|asking|sourcer|seller|for sale|selling|wants|realreal|real real|fashionphile|rebag|vestiaire|ebay|madison avenue|priv[eé] porter|jane finds|1916|listing|listed|second ?hand|pre-?owned|pre-?loved|resale|used\b|\bfair\b|good (price|deal|buy)|too (high|much)|worth (it|paying|buying)|should i (pay|buy|take)|found (a|one|it|this))/i.test(text);
  if (!secondhand) return null;
  for (const m of text.matchAll(/\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k\b|K\b)?|\b([0-9]{2,3}(?:\.[0-9])?)\s?k\b/g)) {
    // a boutique price in the same breath ("new at $11,400", "boutique price") is not the buyer's secondhand price (Sam, 2026-10-24)
    const before = text.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0).toLowerCase();
    if (/(new at|at the boutique|boutique price|retail|in store|list price|house price|preorder|pre-order)\W*[a-z ]{0,12}$/.test(before)) continue;
    const v = m[1] ? Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1) : Number(m[3]) * 1000;
    if (v >= 1000) return Math.round(v);
  }
  return null;
}
export type PriceTiers = { material: string | null; size: string | null; finished?: boolean; trr_sold?: { prices: number[]; n: number; raw: { price: number; condition: string; held?: boolean }[]; held?: number } | null; auction_sold?: { date: string; house: string; size: string | null; price: number }[] | null; sites_asks: (Avg & { sources: string[]; matched: string; prices?: number[]; bySource?: { source: string; price: number }[] }) | null; sourcer_sold: (Avg & { sources: string[]; ranges: string[]; rows?: { price: number; cond: Cond | null }[] }) | null; private_quotes: (Avg & { prices: number[] }) | null; private_sold?: { prices: number[]; n: number } | null } | null;
/** SQL fragment + params requiring every meaningful word of the bag name to appear in a column (no first-word guessing). */
/** TRR model column for a bag: model_guess, plus the title when the bag is a Hermès sub-model (TRR tags a Kelly Cut as "Kelly"). */
function trrModelCol(bag: string): string {
  return /\b(kelly|birkin)\b/i.test(bag) && /\b(cut|pochette|danse|elan|moove|depeches|longue|doll|shoulder|shopper)\b/i.test(bag)
    ? "(coalesce(model_guess,'') || ' ' || coalesce(title,''))" : "model_guess";
}
function modelMatch(col: string, bag: string, house?: string): { sql: string; params: string[] } {
  if (bag === ANY_MODEL) return { sql: "1", params: [] }; // a finish asked across the house ("Chanel pony hair bag")
  const stop = new Set(["strap", "bag", "bags", "the", "and", "with", "flap", "runway", "pieces", "collection", "mini", "small", "medium", "large", "maxi", "jumbo", "clutch", "ii", "iii", "touch", "sellier", "retourne", "bb", "pm", "mm", "gm", "nano", "teen", "hobo", "handbag", "zucca", "zucchino", "ff"]); // Fendi's Zucca prints describe the canvas, not the model (Sam, round 10) // "Mini Kelly II", "Touch", "Sellier" are priced under "Kelly"
  const toks = norm(bag).split(" ").filter((w) => w.length > 1 && !stop.has(w) && !/^\d{4}$/.test(w));
  const houseWords = new Set(norm(house ?? "").split(" "));
  // an article is not a model word: "Le Boy" is titled "Boy" (coverage sweep, 2026-10-26: 3 of Chanel's Boy reads say "Le Boy")
  const ARTICLE = /^(le|la|les|l|the)$/;
  const alpha = toks.filter((w) => !/^\d+$/.test(w) && !ARTICLE.test(w));
  const nums = toks.filter((w) => /^\d+$/.test(w));
  // a name made of numbers ("Le 5 à 7", "2.55") is matched as the whole phrase, accents folded, never as a lone article or number
  // (coverage sweep, 2026-10-26: "Le 5 à 7" searched every title with "le" in it; "2.55" found nothing)
  if (!alpha.length && /\d/.test(norm(bag))) {
    const phrase = norm(bag).split(" ").filter((w) => !ARTICLE.test(w) && !houseWords.has(w) && !stop.has(w)).join(" ");
    if (phrase && phrase.split(" ").length > 1) {
      const F = (c: string) => `(' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(${c}),'à','a'),'é','e'),'è','e'),'-',' '),',',' '),'.',' '),'/',' '),'''',' '),'(',' '),')',' ') || ' ')`;
      return { sql: `(${F(col)} like ?)`, params: [`% ${phrase} %`] };
    }
  }
  // Sizes ride in another column ("Birkin 30" → model "Birkin"), so numbers are optional, unless the name is only the house plus a number ("Chanel 25").
  // The number is the name, and The RealReal titles the bag "Small 22 Hobo" (4 of 257 titles with " 22 " say "Chanel"), so the house word
  // is dropped there (coverage sweep, 2026-10-26: "Chanel 19 Medium" and "mini 22 bag" were priced from the few titles saying "Chanel")
  let words = alpha.some((w) => !houseWords.has(w)) ? alpha : nums.length && !/^(model|model_guess|bag)$/.test(col) ? nums : [...alpha, ...nums];
  // Chanel's numbered bags keep their number beside another word ("19 Wallet on Chain" is not every wallet on chain); "25 cm" is a size
  if (/chanel/.test(norm(house ?? "")) && alpha.some((w) => !houseWords.has(w)) && !/\b(19|22|25|31)\s?cm\b/i.test(bag)) words = [...words, ...nums.filter((n) => /^(19|22|25|31)$/.test(n))];
  // a Mamma is titled "Mama" with no "Baguette" on The RealReal: match the Mamma alone, spelled either way ("%mama%" finds both)
  if (words.includes("mamma")) words = words.filter((w) => w !== "baguette" && w !== "forever").map((w) => (w === "mamma" ? "mama" : w));
  // a name made only of finish words and a shape ("pony hair hobo") keeps its shape: without it every pony-hair Chanel counted, the
  // $8,500 Metiers d'Art Bucket Bag beside the Chanel 25 Hobos (coverage sweep, 2026-10-26)
  if (words.length && words.every((w) => /^(pony|hair|calf|haircalf|ponyhair|cheetah|leopard|animal|print|printed|mink|fur|shearling|sequin|sequins|tweed|python|croc|crocodile|ostrich|lizard|suede|denim|raffia|spotted|fuzzy)$/.test(w))) words = [...words, ...norm(bag).split(" ").filter((w) => /^(hobo|clutch)$/.test(w))];
  if (!words.length) return { sql: "0", params: [] };
  // a column with its punctuation turned to spaces and padded, so a short word matches whole: "so" never matches "SOLD" (Sam, round 17)
  // SQLite's lower() keeps accents, so a model word is matched with the title's accents folded: The RealReal writes "Pochette Félicie",
  // Fashionphile "Felicie" (coverage sweep, 2026-10-26: "Felicie" found only the unaccented titles)
  const FOLD = (c: string) => `replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(${c}),'é','e'),'É','e'),'è','e'),'ê','e'),'à','a'),'â','a'),'ï','i'),'ô','o'),'ü','u'),'ç','c')`;
  const W = (c: string) => `(' ' || replace(replace(replace(replace(replace(replace(${FOLD(c)},'-',' '),',',' '),'.',' '),'/',' '),'''',' '),'(',' ') || ' ')`;
  if (/chanel/.test(norm(house ?? "")) && words.length === 1 && words[0] === "classic") {
    // Sam, round 10: the cheetah Medium Flap sold as "Medium Flap Bag"; round 17: but a "Medium 19 Flap Bag", a Boy or a Souplissimo is
    // never a Classic Flap. Classic = "classic", "double flap" or "timeless", or a sized flap that names no other Chanel model
    const other = ["o case", "clutch", "accordion", "e w", "travel", "19", "22", "25", "31", "souplissimo", "reissue", "2 55", "boy", "trendy", "coco", "gabrielle", "deauville", "vanity", "wallet", "woc", "o case", "chain rows", "funky town", "travel ligne", "metal beauty", "pearl crush", "hanger", "brick", "cc flap", "xxl", "mademoiselle", "camera", "top handle", "handle", "single flap"];
    const sizes = ["medium", "small", "jumbo", "maxi", "mini"];
    return { sql: `((${W(col)} like ? or ${W(col)} like ? or ${W(col)} like ? or (${W(col)} like ? and (${sizes.map(() => `${W(col)} like ?`).join(" or ")}))) and ${other.map(() => `${W(col)} not like ?`).join(" and ")})`,
      params: ["% classic %", "% double flap %", "% timeless %", "% flap %", ...sizes.map((w) => `% ${w} %`), ...other.map((w) => `% ${w} %`)] };
  }
  // Hermès sub-models are different bags: a "Kelly" must never borrow a Kelly Cut's or Kelly Pochette's price, and vice versa.
  const sub = toks.some((w) => w === "kelly" || w === "birkin") ? ["cut", "pochette", "danse", "elan", "moove", "depeches", "longue", "doll", "shoulder", "shopper"].filter((w) => !toks.includes(w)) : [];
  return { sql: "(" + [...words.map((w) => (w.length <= 3 ? `${W(col)} like ?` : `${FOLD(col)} like ?`)), ...sub.map(() => `lower(${col}) not like ?`)].join(" and ") + ")", params: [...words.map((w) => (w.length <= 3 ? `% ${w} %` : `%${w}%`)), ...sub.map((w) => `%${w}%`)] };
}
/** Sub-models that are different bags within one house's family (Katie, 2026-10-24: "there are a couple of different kinds of Teckel bags"). */
const HOUSE_SUBMODELS: Record<string, string[]> = { alaia: ["flap", "clutch", "shoulder"] };
export function subModelOk(house: string, asked: string, title: string): boolean {
  const subs = HOUSE_SUBMODELS[norm(house).split(" ")[0]] ?? []; const a = norm(asked), t = norm(title);
  return subs.every((w) => !new RegExp(`\\b${w}\\b`).test(t) || new RegExp(`\\b${w}\\b`).test(a));
}
/** Shapes the houses have made for decades: the fallback when the bags table has no launch year. */
const ICONS = /\b(birkin|kelly|constance|bolide|picotin|evelyne|lindy|garden party|classic flap|2\.55|reissue|boy|lady dior|saddle|baguette|peekaboo|speedy|neverfull|alma|keepall|capucines|jackie|bamboo|horsebit|dionysus|galleria|cabat|luggage|classic box|triomphe|sac de jour|city|puzzle|margaux)\b/;
/** Variants of an icon that are newer shapes of their own (Kelly Cut, Kelly Pochette, Kelly Danse…): never "made for decades". */
const NOT_ICON = /\b(cut|pochette|danse|elan|moove|depeches|longue|doll|shopper)\b/;
/** A finish asked about with no model ("Is the Chanel pony hair bag worth buying?"): every bag of the house in that finish counts
 *  (Katie, 2026-10-25: "there is such a big leopard/cheetah fad right now. We need these answers to be airtight"). */
export const ANY_MODEL = "__any model__";
const PRINT_FINISH = /\b(leopard|cheetah|animal print|pony hair|polka|sequin|fringe|feather|newspaper|knit|crystal|strass|beaded|mother of pearl)\b/;
const HOUSE_MODELS: Record<string, [string, string][]> = { chanel: [["Classic Flap", "medium"], ["Chanel 25", "mini"], ["31 Shopping Bag", "mini"], ["Souplissimo", ""], ["Clutch", ""]], fendi: [["Baguette", ""], ["Mamma Baguette", ""], ["Peekaboo", ""]], hermes: [["Birkin", "25"], ["Birkin", "30"], ["Kelly", "25"], ["Kelly", "28"], ["Constance", ""]], dior: [["Saddle", ""], ["Lady Dior", ""]] };
const NOT_A_MODEL = /\b(metiers|d|art|paris|new|york|dallas|edinburgh|bombay|pieces?|collection|bags?|handbags?|purses?|items?|any|one|the|a|style|version|line|print|printed|cheetah|leopard|animal|pony|hair|calf|haircalf|ponyhair|mink|fur|shearling|sequin|sequins|tweed|python|croc|crocodile|ostrich|lizard|suede|denim|raffia)\b/g;
/** Our own catalogue (Katie, 2026-10-24): the house's own US price for this bag, from the product pages we have read.
 *  Used only when the model matches and, if the question names a material or colour, at least one of them matches too. */
export type CatalogHit = { price: number; name: string; url: string; date: string; site: string; finish?: string; stock?: { status: string; date: string } | null } | null;
/* The catalogue view has no index to lean on (about 4 seconds a house, and an answer asks it up to eight times), and catalogue reads land
 *  weekly, so one read per house is kept for ten minutes (coverage sweep, 2026-10-26: 443 phrasings took over ten minutes). */
const CATALOG_CACHE = new Map<string, { at: number; rows: Row[] }>();
function catalogRows(db: DatabaseSync, house: string): Row[] {
  const key = houseTerms(house).join("|"); const hit = CATALOG_CACHE.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.rows;
  const rows = db.prepare(`select c.model, c.material, c.colour, c.price_now, c.last_seen, c.source_url, (select notes from retail_availability_reads r where r.house=c.house and r.reference=c.reference order by read_date desc limit 1) notes, (select availability || '|' || read_date from retail_availability_reads r where r.house=c.house and r.reference=c.reference order by read_date desc, id desc limit 1) stock
      from v_house_catalog c where ${likeAny("c.house", houseTerms(house))} and c.price_now is not null`).all(...likeParams(houseTerms(house))) as Row[];
  CATALOG_CACHE.set(key, { at: Date.now(), rows }); return rows;
}
export function catalogMatch(house: string, bag: string, spec?: string): CatalogHit {
  if (bag === ANY_MODEL) return null;
  const db = open(); if (!db) return null;
  try {
    const rows = catalogRows(db, house);
    const stop = new Set(["bag", "bags", "the", "and", "with", "handbag", "small", "medium", "large", "mini", "maxi"]);
    const houseWords = new Set(norm(house).split(" "));
    const bagToks = norm(bag).split(" ");
    const leadHouse = bagToks.length > 1 && houseWords.has(bagToks[0]); // "Chanel 25" drops "chanel"; "Lady Dior" keeps "dior"
    const toks = bagToks.filter((w, i) => !stop.has(w) && !(houseWords.has(w) && (leadHouse ? i === 0 : false)));
    const alphaW = toks.filter((w) => w.length > 2 && !/^\d+$/.test(w));
    const modelWords = alphaW.length ? alphaW : toks.filter((w) => /^\d+$/.test(w));
    const specWords = norm(spec ?? "").replace(/\b(pre loved|pre owned|preowned|vintage|pristine|excellent|very good|good|fair|condition|with tags|new|used|worn)\b/g, " ").split(" ").filter((w) => w.length > 2 && !stop.has(w)); // Sam, round 21: "pre-loved" picked the haircalf Teckel
    const sizeWord = norm(`${bag} ${spec ?? ""}`).match(/\b(mini|small|medium|large|maxi|nano|teen|pm|mm|gm|bb)\b/)?.[1] ?? null;
    const sizeNum = norm(`${bag} ${spec ?? ""}`).match(/\b(1[5-9]|[2-4]\d)\b/)?.[1] ?? null;
    let best: { r: Row; score: number } | null = null; const fits: Row[] = [];
    for (const r of rows) {
      const model = norm(String(r.model ?? "")); const fin = norm(`${r.material ?? ""} ${r.colour ?? ""} ${r.notes ?? ""}`);
      if (!modelWords.length || !modelWords.every((w) => model.includes(w))) continue;
      { const num = /chanel/i.test(house) ? norm(bag).match(/\b(19|22|25|31)\b/)?.[1] : null; if (num && !new RegExp(`\\b${num}\\b`).test(model)) continue; } // Sam, round 20: p43
      if (DISTINCT_MODELS.some((w) => model.includes(w) && !norm(`${bag} ${spec ?? ""}`).includes(w))) continue; // a Soft Margaux is not a Margaux
      if (/\bclutch\b/.test(model) && !/\bclutch\b/.test(norm(`${bag} ${spec ?? ""}`))) continue;
      if (!variantOk(house, `${bag} ${spec ?? ""}`, String(r.model ?? ""))) continue; // a Mamma Baguette never takes the Baguette's boutique price // a Le Teckel Clutch is not the Le Teckel bag
      if (!subModelOk(house, `${bag} ${spec ?? ""}`, model)) continue; // a Le Teckel Flap is not the Le Teckel
      { const askedP = norm(`${bag} ${spec ?? ""}`); const rowT = norm(`${r.model ?? ""} ${r.material ?? ""} ${r.colour ?? ""} ${r.notes ?? ""}`); // a print the client did not name is another bag
        if (/\b(leopard|cheetah|tiger|zebra|polka|vichy|flower print|python print)\b/.test(rowT) && !/\b(leopard|cheetah|tiger|zebra|polka|vichy|flower|print)\b/.test(askedP)) continue; }
      if (sizeWord && !new RegExp(`\\b${sizeWord}\\b`).test(model)) continue;
      if (sizeNum && /\b\d{2}\b/.test(model) && !new RegExp(`\\b${sizeNum}\\b`).test(model)) continue;
      fits.push(r);
      const score = specWords.filter((w) => fin.includes(w)).length;
      // most of the described finish must match, or it is a different bag: never borrow a price on one shared word
      // a named finish (mink, pony hair, sequins...) decides on its own: a long photo description ("fur, ivory, FF clasp, canvas strap") must not bury it (Sam, round 5)
      const finRx = namedFinishes(bag, spec);
      { const furA = norm(`${bag} ${spec ?? ""}`).match(/\b(mink|swakara|sable|fox|chinchilla|rabbit|shearling)\b/)?.[1]; const rowT = norm(`${r.model ?? ""} ${fin}`); if (furA && /\b(mink|swakara|sable|fox|chinchilla|rabbit|shearling)\b/.test(rowT) && !new RegExp(`\\b${furA}\\b`).test(rowT)) continue; } // Sam, round 21: p47
      if (finRx.length) { if (!finRx.every((rx) => rx.test(norm(`${r.model ?? ""} ${fin} ${r.source_url ?? ""}`)))) continue; }
      else if (specWords.length && score < Math.max(1, Math.ceil(specWords.length * 0.6))) continue;
      // ties: the house's standard leather beats canvas, felt and novelties; with no size asked, the regular size beats a Mini
      const NONSTD = /\b(canvas|toile|felt|raffia|denim|tweed|shearling|sequin|crochet|nylon|jacquard|straw|wicker|velvet|satin|patent|metallic|crystal|strass|beaded|fringe|ostrich|crocodile|lizard|python|alligator|exotic|pony|calf hair)\b/;
      const rank = (x: Row) => (NONSTD.test(norm(`${x.model ?? ""} ${x.material ?? ""} ${x.notes ?? ""}`)) && !namedFinishes(bag, spec).length ? 2 : 0) + (!sizeWord && !sizeNum && /\b(nano|micro|mini|small|teen)\b/.test(norm(String(x.model ?? ""))) ? 1 : 0);
      if (!best || score > best.score || (score === best.score && (rank(r) < rank(best.r) || (rank(r) === rank(best.r) && Number(r.price_now) < Number(best.r.price_now))))) best = { r, score };
    }
    // no finish named and the description words (colour, hardware) did not match: the plainest version of that model and size, labelled as such
    if (!best && fits.length && !namedFinishes(bag, spec).length) {
      // the house's standard leather, never canvas, felt, raffia or a novelty; among those, the most common price
      const nonStd = /\b(canvas|toile|felt|raffia|denim|tweed|shearling|sequin|crochet|nylon|jacquard|straw|wicker|velvet|satin|patent|metallic|crystal|strass|beaded|fringe|ostrich|crocodile|lizard|python|alligator|exotic|pony|haircalf|calf hair|fur|mink|knit)\b/;
      const std = fits.filter((r) => !nonStd.test(norm(`${r.model ?? ""} ${r.material ?? ""} ${r.notes ?? ""}`)));
      if (std.length) { const cnt = new Map<number, number>(); for (const r of std) cnt.set(Number(r.price_now), (cnt.get(Number(r.price_now)) ?? 0) + 1); const top = [...cnt.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]; best = { r: std.find((r) => Number(r.price_now) === top)!, score: 0 }; }
    }
    if (!best && sizeWord) { const sp2 = (spec ?? "").replace(new RegExp(`\\b${sizeWord}\\b`, "gi"), " "); const b2 = bag.replace(new RegExp(`\\b${sizeWord}\\b`, "gi"), " ").trim(); if (b2 && (sp2 !== (spec ?? "") || b2 !== bag)) return catalogMatch(house, b2, sp2); } // Sam, round 26: "small" from a photo dropped the $12,400
    if (!best) return null;
    const url = String(best.r.source_url ?? "");
    const [st, sd] = String(best.r.stock ?? "").split("|");
    return { stock: st ? { status: st, date: sd ?? "" } : null, price: Number(best.r.price_now), name: String(best.r.notes ?? best.r.model).split(";")[0], url, date: String(best.r.last_seen), site: (url.match(/https?:\/\/(?:www\.)?([^/]+)/)?.[1] ?? "the house's site"), finish: `${best.r.material ?? ""} ${best.r.colour ?? ""} ${best.r.notes ?? ""} ${url}` };
  } catch { return null; } finally { db.close(); }
}

/** One size per question (Sam, round 15): "small/medium" or "32cm or 35cm" names no size, never the first one; and the size word the
 *  client typed beats the parser's ("Chanel leopard mini" read as "small" found nothing). */
const SIZE_W = "nano|micro|mini|small|medium|large|maxi|jumbo|teen";
export function settleSize(bag: string, spec: string | undefined, notes?: string | null): { bag: string; spec: string } {
  const either = new RegExp(`\\b(${SIZE_W}|1[5-9]|[2-4]\\d)(\\s?cm)?\\s*(or|/|to|-|and|&)\\s*(${SIZE_W}|1[5-9]|[2-4]\\d)(\\s?cm)?\\b`, "gi");
  let b = bag.replace(either, " ").replace(/\s{2,}/g, " ").trim(), sp = (spec ?? "").replace(either, " ").replace(/\s{2,}/g, " ").trim();
  const said = (notes ?? "").match(/Client's own words:([\s\S]*)$/)?.[1] ?? notes ?? "";
  const words = [...new Set([...said.toLowerCase().matchAll(new RegExp(`\\b(${SIZE_W})\\b`, "g"))].map((m) => m[1]))];
  if (words.length === 1 && !new RegExp(`\\b(${SIZE_W})\\b\\s*(or|/|and|&)`, "i").test(said)) {
    const w = words[0]; const rx = new RegExp(`\\b(${SIZE_W})\\b`, "gi");
    if (rx.test(`${b} ${sp}`) && !new RegExp(`\\b${w}\\b`, "i").test(`${b} ${sp}`)) { b = b.replace(rx, w); sp = sp.replace(rx, w); }
  }
  const tidy = (x: string) => x.replace(/\s*,\s*(,\s*)+/g, ", ").replace(/^[\s,;]+|[\s,;]+$/g, "");
  return { bag: tidy(b) || bag, spec: tidy(sp) };
}

let breakoutDepth = 0; // an ambiguity breakout asks quickNumbers again; it never breaks out a second time
/** The house's own name inside the bag name ("Hermès Evelyne 29", "BV Andiamo", "small YSL Loulou", "The Row Soft Margaux 15") is not a
 *  model word: listing titles rarely repeat the house, so it matched only the few dealer titles that do, or nothing (coverage sweep,
 *  2026-10-26: 60+ customer phrasings missed). Names where the house word IS the model stay whole: Lady Dior, Miss Dior, Dior Toujours,
 *  and Chanel's numbered bags ("Chanel 25" keeps "Chanel" because nothing but a number and a size would be left). */
const SIZE_OR_STOP = /^(nano|micro|mini|small|medium|large|maxi|jumbo|teen|toy|baby|pm|mm|gm|bb|bag|bags|handbag|purse|the|a|an|my|her|\d+)$/;
export function dropHouseWords(house: string, bag: string): string {
  if (!bag || bag === ANY_MODEL) return bag;
  const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const nb = norm(bag);
  if (/\b(lady|miss) dior\b|\bdior toujours\b/.test(nb)) return bag;
  const terms = [...new Set([...houseTerms(house), house].map((t) => norm(t)).filter(Boolean))].sort((a, b) => b.length - a.length);
  const hit = terms.find((t) => new RegExp(`(^| )${t.replace(/ /g, " ")}( |$)`).test(nb)); if (!hit) return bag;
  const rx = new RegExp(`(^|[^a-z0-9])${hit.split(" ").join("[^a-z0-9]+")}('s)?(?=$|[^a-z0-9])`, "gi");
  const rest = fold(bag).replace(rx, "$1").replace(/\s{2,}/g, " ").replace(/^[\s,.-]+|[\s,.-]+$/g, "");
  return norm(rest).split(" ").some((w) => w.length > 1 && !SIZE_OR_STOP.test(w)) ? rest : bag;
}
export function quickNumbers(house: string, bag0: string, spec0?: string, notes?: string | null): QuickNumbers | null {
  bag0 = dropHouseWords(house, bag0);
  // "WOC" is how buyers say wallet on chain; The RealReal titles it "Wallet On Chain" (coverage sweep, 2026-10-26: "19 WOC", "Boy WOC" found nothing)
  bag0 = bag0.replace(/\bwoc\b/gi, "Wallet on Chain");
  // a designer's name is the era, never a model word ("Blazy's pony hair hobo", "Blazy maxi flap"; coverage sweep, 2026-10-26)
  { const d = bag0.replace(/\b(blazy|lagerfeld|viard|anderson|chiuri|galliano|simons|slimane|philo|ghesquiere|ghesquière|demna|michele|de sarno|trotter|rider|piccioli|mccollough|hernandez|lee)('s)?\b/gi, " ").replace(/\s{2,}/g, " ").trim(); if (d && d !== bag0.trim() && /[a-z]/i.test(d)) bag0 = d; }
  // Two Chanel names that are two bags (Katie: "When a name is ambiguous, break out the alternatives with their own numbers; never guess").
  // The "Maxi Flap Bag" on chanel.com is the Souplissimo (our boutique rows: "Souplissimo, Small (Maxi flap bag AS6231)" $8,800, the
  // catalogue's "Maxi Flap Bag" $8,800), but a Classic Flap also comes in maxi: priced as the Souplissimo, the Classic maxi beside it.
  // A cheetah "bucket" may be the Metiers d'Art Bucket Bag ($8,500) or a Chanel 25 Mini read as one ($15,995-$18,000): both, apart.
  const askedRaw = `${bag0} ${spec0 ?? ""}`;
  const maxiAlias = /chanel/i.test(house) && /^\s*(?:(small|large)\s+)?maxi\s+flap(?:\s+bag)?\s*$/i.test(bag0) && !/\b(classic|jumbo|xl|double|single|timeless|vintage|reissue)\b/i.test(askedRaw) && !breakoutDepth;
  const catalogName = maxiAlias ? "Maxi Flap Bag" : null;
  if (maxiAlias) { const sz = bag0.match(/\b(small|large)\b/i)?.[1]; bag0 = "Souplissimo"; if (sz) spec0 = [sz.toLowerCase(), spec0].filter(Boolean).join(", "); }
  const bucketPrint = /chanel/i.test(house) && /\b(bucket|drawstring)\b/i.test(bag0) && /\b(cheetah|leopard|pony ?hair|calf ?hair|spotted)\b/i.test(askedRaw) && !breakoutDepth;
  // a bare "2.55" is the 2.55 Reissue: 51 of the 56 stored titles saying 2.55 also say Reissue (2026-10-26 count)
  if (/chanel/i.test(house) && /^\s*(the\s+)?2[.,]55(\s+(flap|bag|flap bag))?\s*$/i.test(bag0)) bag0 = "2.55 Reissue";
  // Chanel's numbered bags read as "Mini 25" are the Chanel 25 in mini: one name, so the forecast and the sales match (Sam, round 16)
  // and so are "22 bag", "Chanel 19 Medium" and "the 22 in mini" (coverage sweep, 2026-10-26): the size goes to the spec either side of the number
  const cm = /chanel/i.test(house) ? bag0.match(/^\s*(?:the\s+)?(?:chanel\s+)?(?:(nano|mini|small|medium|large|maxi)\s+)?(19|22|25)(?:\s+(?:bag|handbag))?(?:\s+(?:in\s+)?(nano|mini|small|medium|large|maxi))?\s*$/i) : null;
  if (cm) { bag0 = `Chanel ${cm[2]}`; const sz = cm[1] ?? cm[3]; if (sz) spec0 = [sz.toLowerCase(), spec0].filter(Boolean).join(", "); }
  // the Kelly Cut IS Hermès's long pochette: "Kelly Cut Pochette" is the Kelly Cut, never the small Kelly Pochette (Katie, 2026-10-25: her
  // $48,000 suede Kelly Cut was missed when the photo reader added "Pochette")
  if (/herm/i.test(house)) bag0 = bag0.replace(/\bkelly\s+cut\s+(pochette|clutch)\b/i, "Kelly Cut");
  // a GBP or EUR resale row is never read as dollars (2026-10-26: the researcher stored £23,999 and €6,490 rows)
  // the cheetah/leopard pony-hair Chanel 25 is made in Mini only (chanel.com and PurseBop, read 2026-10-26): a photo reader's "small" or
  // "medium" guess for it is the Mini, so the answer finds its sales (demo rehearsal: "small size" found nothing)
  if (/chanel/i.test(house) && /\b(chanel\s+)?25\b/i.test(bag0) && /\b(cheetah|leopard|pony ?hair|calf ?hair)\b/i.test(`${bag0} ${spec0 ?? ""}`)) {
    spec0 = (spec0 ?? "").replace(/\b(small|medium|large)(\s+size)?\b/gi, "mini"); bag0 = bag0.replace(/\b(small|medium|large)\b/gi, "Mini");
    if (!/\b(mini|nano|micro)\b/i.test(`${bag0} ${spec0}`)) spec0 = ["mini", spec0].filter(Boolean).join(", "); } /* no size named: the Mini, its only size */
  // Theo, 2026-10-26: never rename a Chanel "bucket" to the Chanel 25: the Métiers d'Art cheetah pony-hair Bucket Bag is its own bag
  // ($8,500, about half the 25's price). The photo reader is taught the 25's shape instead, with the reference photos.
  // Sam, round 18: what is not the bag never becomes a search word. Packaging ("shown in Chanel box") is not box leather; "box or smooth
  // calfskin" names no leather; a date ("Dec 20") or a guess ("likely 32cm") is not a size; a description in brackets is spec, not the name
  { const c = bag0.indexOf(","); if (c > 0) { spec0 = [spec0, bag0.slice(c + 1).trim()].filter(Boolean).join(", "); bag0 = bag0.slice(0, c).trim(); } } // "Classic Flap (11.12), cheetah…" (Sam, round 19)
  const paren = bag0.match(/\(([^)]*)\)/)?.[1];
  if (paren) { bag0 = bag0.replace(/\s*\([^)]*\)\s*/g, " ").trim(); spec0 = [spec0, paren].filter(Boolean).join(", "); }
  // the photo reader writes "Saddle (Night fringe/feather version)": the bracket names the model, the Saddle Night Bag (a private purchase, 2026-10-31)
  if (paren && /dior/i.test(house) && /^saddle$/i.test(bag0) && /^\s*night\b/i.test(paren)) bag0 = "Saddle Night";
  const MAT_OR = /([\w-]+(?:\s[\w-]+)?)\s*(?:\bor\b|\/)\s*([\w-]+(?:\s[\w-]+)?)/gi;
  const LEATHER = [...TIER_MATERIALS, "calfskin", "lambskin", "goatskin", "leather", "calf", "smooth", "grained", "caviar"];
  const isLeather = (x: string) => LEATHER.some((t) => new RegExp(`\\b${t}\\b`).test(norm(x)));
  spec0 = (spec0 ?? "")
    .replace(/\bno [\w -]{1,40}? (visible|shown|seen)\b/gi, " ") // "no diamond quilting visible" names nothing
    .replace(/\b([a-z]+(?:\/[a-z]+)?)\s+(shoulder\s+)?(strap|straps|handle|handles|trim|piping|lining)\b/gi, (m, w: string) => (/\b(canvas|webbing|nylon|cotton|rope|raffia|fabric|grosgrain|ribbon|silk|jacquard)\b/i.test(w) ? " " : m)) // Sam, rounds 22-23: a canvas strap never makes the bag canvas; "Togo with strap" keeps Togo
    .replace(/\b(small|medium|large|mini)\s+(flap|silhouette|shape|proportions?)\s+(silhouette|shape)?/gi, "$2 ") // "small flap silhouette" is a shape, not a size
    .replace(/\b(shown |comes |came |sold )?(in|with) (the |its |a |an |original |orig |chanel |hermes |hermès |dior |fendi |full )*(box|dust ?bag|box and dust ?bag)\b/gi, " ")
    .replace(MAT_OR, (m, a: string, b: string) => (isLeather(a) && isLeather(b) ? " " : m))
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?\b/gi, " ")
    .replace(/\b(likely|probably|maybe|possibly|perhaps|approx\w*|about|around)\s+\d{2}\s?(cm)?\b/gi, " ");
  // a size word on another model in the description ("Kelly and Mini Kelly" around a So Kelly) is not this bag's size (Sam, round 23: p48)
  if (/\bso kelly\b/i.test(bag0)) spec0 = spec0.replace(/\b(mini|micro|nano)\s+kelly\b/gi, " ").replace(/\(\s*kelly\s+and\s+\)/gi, " ");
  // a Chanel flap named by its finish or collection ("Métiers d'Art cheetah flap", "sequin flap") is the Classic Flap in that finish: the
  // finish and collection words go to the spec, where the finish rules apply (coverage sweep, 2026-10-26: it found nothing)
  if (/chanel/i.test(house) && namedFinishes(bag0, "").length && !/\bsequin/i.test(bag0) /* a sequin flap is usually another model (Rectangular Mini, Waterfall): Sam, morning audit */ && /^\s*((nano|mini|small|medium|large|jumbo|maxi)\s+)?flap(\s+bag)?\s*$/i.test(bag0.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\b(metiers|d|art|paris|new|york|dallas|edinburgh|bombay|collection|cheetah|leopard|animal|print|printed|pony|hair|calf|haircalf|ponyhair|mink|fur|shearling|sequins?|tweed|python|croc|crocodile|ostrich|lizard|suede|denim|raffia|spotted|fuzzy|20\d\d)\b|['\u2019\u2013-]/gi, " ").replace(/\s{2,}/g, " "))) { const sz = bag0.match(/\b(nano|mini|small|medium|large|jumbo|maxi)\b/i)?.[1]; spec0 = [sz?.toLowerCase(), spec0, bag0.replace(/\b(nano|mini|small|medium|large|jumbo|maxi|flap|bag)\b/gi, " ").replace(/\s{2,}/g, " ").trim()].filter(Boolean).join(", "); bag0 = "Classic Flap"; }
  // a bare Chanel "Flap" or "Medium Flap" is the Classic Flap (Sam, round 18: both words were stop words, so nothing matched)
  if (/chanel/i.test(house) && /^\s*((nano|mini|small|medium|large|jumbo|maxi)\s+)?flap(\s+bag)?\s*$/i.test(bag0) && !catalogMatch(house, bag0, spec0)) { const sz = bag0.match(/nano|mini|small|medium|large|jumbo|maxi/i)?.[0]; bag0 = "Classic Flap"; if (sz) spec0 = [sz.toLowerCase(), spec0].filter(Boolean).join(", "); }
  if (norm(house).length && !norm(bag0).replace(new RegExp(`\\b(${norm(house).split(" ").join("|")})\\b`, "g"), " ").replace(NOT_A_MODEL, " ").replace(/\b(19|20)\d{2}\b/g, " ").trim() && namedFinishes(bag0, spec0).length) { /* a year is never a model ("… 2025 cheetah pony-hair pieces") */ spec0 = [spec0, bag0].filter(Boolean).join(", "); bag0 = ANY_MODEL; }
  const { bag, spec } = settleSize(bag0, spec0, notes);
  // "this price on The RealReal" with no number (Katie, 2026-10-25): when we hold exactly one live RealReal listing of this exact bag,
  // its price and condition are the client's quote, said so in the notes; with none or several, nothing is guessed
  if (notes && !parseQuote(notes) && /real ?real/i.test(notes) && /\b(this|that|its|the listed|the) price\b|\bat this\b|\bthis (one|listing|bag)\b/i.test(notes)) {
    const db1 = open();
    if (db1) { try {
      const mmT = modelMatch("title", bag, house); const fin = namedFinishes(bag, spec); const num = norm(`${bag} ${spec ?? ""}`).match(/\b(1[5-9]|[2-4]\d)\b/)?.[1];
      const live = (db1.prepare(`select slug, title, price, condition from trr_item_reads where ${likeAny("house", houseTerms(house))} and ${mmT.sql} and sold=0 and price > 0 and read_date >= date('now','-21 days') order by read_date desc`).all(...likeParams(houseTerms(house)), ...mmT.params) as Row[])
        .filter((r) => { const t = norm(String(r.title ?? "").replace(/\s*\[.*$/, "")); return fin.every((rx) => rx.test(t)) && (!num || new RegExp(`\\b${num}\\b`).test(t)) && !/on hold/i.test(String(r.title)); });
      const slugs = [...new Set(live.map((r) => (r.slug ? slugKey(r.slug) : String(r.title))))];
      if (slugs.length === 1) { const r = live[0]; notes = `${notes} The RealReal listing of this bag (our read): $${Math.round(Number(r.price)).toLocaleString("en-US")}${r.condition ? `, ${String(r.condition)} condition` : ""}.`; }
    } catch { /* no listing found: nothing is guessed */ } finally { db1.close(); } }
  }
  const db = open(); if (!db) return null;
  const hTerms = houseTerms(house); const mm = modelMatch("model", bag, house); const mg = modelMatch(trrModelCol(bag), bag, house); const bagTerm = norm(bag).split(" ").filter((w) => w.length > 2)[0] ?? norm(bag);
  const g = <T extends Row>(sql: string, params: (string | number)[] = []): T | undefined => { try { return db.prepare(sql).get(...params) as T | undefined; } catch { return undefined; } };
  const rc = g<Row>(`select retail_now, size_or_spec from v_retail_current where ${likeAny("house", hTerms)} and ${mm.sql} limit 1`, [...likeParams(hTerms), ...mm.params]);
  const launchRows = (() => { try { return db.prepare(`select price, size_or_spec from retail_reference where ${likeAny("house", hTerms)} and ${mm.sql} and price_type='launch' order by effective_date`).all(...likeParams(hTerms), ...mm.params) as Row[]; } catch { return [] as Row[]; } })();
  const azL = norm(`${bag} ${spec ?? ""}`).match(/\b(nano|micro|mini|small|medium|large|maxi|jumbo|teen|pm|mm|gm|bb|1[5-9]|[2-4]\d)\b/)?.[1] ?? null;
  const launch = azL ? launchRows.find((r) => new RegExp(`\\b${azL}\\b`).test(norm(String(r.size_or_spec ?? "")))) : launchRows[0]; // the Medium's launch, never the Small's
  const soldRow = g<Row>(`select n_sold_same_size n, median_sold m, sold_pct_of_retail p, matched_size from v_sold_vs_retail where ${likeAny("house", hTerms)} and ${mm.sql} limit 1`, [...likeParams(hTerms), ...mm.params]);
  const askZ = norm(`${bag} ${spec ?? ""}`).match(/\b(nano|micro|mini|small|medium|large|maxi|jumbo|teen|pm|mm|gm|bb)\b/)?.[1] ?? norm(`${bag} ${spec ?? ""}`).match(/\b(1[5-9]|[2-4]\d)\b/)?.[1] ?? null;
  const sold = soldRow && (!askZ || new RegExp(`\\b${askZ}\\b`).test(norm(String(soldRow.matched_size ?? "")))) ? soldRow : undefined; // a Medium question never shows the Small's sales
  const ask = g<Row>(`select n_listings_same_size n, median_ask_same_size m from v_retention_scoreboard_sized where ${likeAny("house", hTerms)} and ${mm.sql} limit 1`, [...likeParams(hTerms), ...mm.params]);
  const trr = g<Row>(`select round(avg(cast(nullif(rtrim(substr(substr(title, instr(title,'saves=')+6), 1, 6), ';] abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ,'),'') as real))) saves, sum(sold) sold90 from trr_item_reads where ${likeAny("house", hTerms)} and ${mg.sql} and read_date >= date('now','-90 days')`, [...likeParams(hTerms), ...mg.params]);
  const trend = g<Row>(`select a.median_ask a0, b.median_ask a1 from resale_aggregates a join resale_aggregates b on a.source=b.source and a.house=b.house and a.model=b.model where ${likeAny("a.house", hTerms)} and ${modelMatch('a.model', bag, house).sql} and a.snapshot_date < b.snapshot_date order by b.snapshot_date desc, a.snapshot_date desc limit 1`, [...likeParams(hTerms), ...modelMatch('a.model', bag, house).params]);
  // no US boutique price: what the house charges abroad for this version, in its own currency (Katie's Dior Saddle Night Bag, 2026-10-24)
  const specW = norm(spec ?? "").split(" ").filter((w) => w.length > 3).slice(0, 6);
  const abroad = specW.length ? (db.prepare(`select price, currency, region, source_name from retail_reference where ${likeAny("house", hTerms)} and ${mm.sql} and region <> 'US' and price_type='current' and (${specW.map(() => "lower(size_or_spec) like ?").join(" or ")}) order by effective_date desc limit 3`).all(...likeParams(hTerms), ...mm.params, ...specW.map((w) => `%${w}%`)) as Row[]).map((r) => `${r.currency} ${Number(r.price).toLocaleString("en-US")} (${r.source_name})`) : [];
  const icon = g<Row>(`select launch_year from bags where ${likeAny("house", hTerms)} and ${mm.sql} and launch_year <= 2010 limit 1`, [...likeParams(hTerms), ...mm.params]);
  db.close();
  const sell = sellNow(house, bag, spec);
  const tiers = priceTiers(house, bag, spec);
  // the client's own listing is never one of the asks it is judged against, nor counted in "Based on" (Sam, round 17: h6's $350,000)
  { const qp = parseQuote(notes ?? ""); const a = tiers?.sites_asks; if (qp && a?.prices?.length) { const i = a.prices.findIndex((x) => Math.abs(x - qp) <= Math.max(25, qp * 0.0025));
    if (i >= 0) { const ps = a.prices.filter((_, j) => j !== i); const bk = (a.bySource ?? []).findIndex((x) => x.price === a.prices![i]); const bs = (a.bySource ?? []).filter((_, j) => j !== bk); if (tiers) tiers.sites_asks = ps.length ? { ...a, ...avg(ps)!, prices: ps, bySource: bs } : null; } } }
  const sizeN = norm(`${bag} ${spec ?? ""}`).match(/\b(1[5-9]|[2-4]\d)\b/)?.[1]; const fBag = sizeN && !new RegExp(`\\b${sizeN}\\b`).test(norm(bag)) ? `${bag} ${sizeN}` : bag;
  const forward = (() => { try { return forwardRead(house, fBag, sell ? { prices: sell.prices, retailNow: sell.retail, plain: sell.plain } : null); } catch { return null; } })();
  const cat = catalogMatch(house, catalogName ?? bag, spec);
  // the size the question names wins over the house's reference size ("Mini Kelly II 20" must never take the Kelly 28 price)
  // an embellished version (fringe, feathers, sequins) never takes the plain bag's boutique price
  const fin = namedFinishes(bag, spec);
  // the size the question names must be the size of the boutique price ("Andiamo medium" never takes the small's price)
  const askedAll = norm(`${bag} ${spec ?? ""}`);
  const askSize = askedAll.match(/\b(nano|micro|mini|small|medium|large|maxi|jumbo|teen|pm|mm|gm|bb)\b/)?.[1] ?? askedAll.match(/\b(1[5-9]|[2-4]\d)\b/)?.[1] ?? null;
  // and the reverse: a boutique price for a finish the client did not name never prices the plain bag (2026-10-26: a plain Medium Classic
  // Flap took the cheetah pony-hair Flap's $9,000 instead of $11,700)
  const askedFin = new Set(fin.map((rx) => rx.source));
  const noExtraFinish = (t: unknown) => namedFinishes(String(t ?? ""), "").every((rx) => askedFin.has(rx.source));
  const sizedRetail = askSize ? (() => { const d2 = open(); if (!d2) return null; try {
      return (d2.prepare(`select price as retail_now, size_or_spec from retail_reference where ${likeAny("house", hTerms)} and ${mm.sql} and region='US' and price_type='current' order by effective_date desc`).all(...likeParams(hTerms), ...mm.params) as Row[])
        .find((r) => noExtraFinish(r.size_or_spec) && new RegExp(`\\b${askSize}\\b`).test(norm(String(r.size_or_spec ?? ""))) && fin.every((rx) => rx.test(norm(String(r.size_or_spec ?? "")))) && !DISTINCT_MODELS.some((w) => norm(String(r.size_or_spec ?? "")).includes(w) && !askedAll.includes(w))) ?? null;
    } finally { d2.close(); } })() : null;
  const distinctOk = (spec0: unknown) => !DISTINCT_MODELS.some((w) => norm(String(spec0 ?? "")).includes(w) && !askedAll.includes(w)); // a Soft Margaux 15 is not a Margaux 15 (Sam, round 5)
  const rcSizeOk = rc && distinctOk(rc.size_or_spec) && noExtraFinish(rc.size_or_spec) && (!askSize || new RegExp(`\\b${askSize}\\b`).test(norm(String(rc.size_or_spec ?? "")))) ? rc : null;
  const rcOk = (sizedRetail ?? rcSizeOk) && fin.every((rx) => rx.test(norm(String((sizedRetail ?? rcSizeOk)?.size_or_spec ?? "")))) ? (sizedRetail ?? rcSizeOk) : null;
  const catOk = cat && fin.every((rx) => rx.test(norm(`${cat.name} ${cat.finish ?? ""}`))) ? cat : null; // the Fendi purple sequined Baguette names its sequins in the address
  // Katie, 2026-10-24: a vintage 2004 mink Baguette took today's $12,400 Baguette 26424 price. A vintage piece, or one from three or
  // more years ago, cannot be bought new, so no boutique price stands in for it.
  const yr = Number(norm(`${bag} ${spec ?? ""} ${notes ?? ""}`).match(/\b(19[5-9]\d|20[0-2]\d)\b/)?.[1] ?? 0);
  const vintagePiece = /\bvintage\b/.test(norm(`${bag} ${spec ?? ""}`)) || (yr > 0 && yr <= new Date().getFullYear() - 3);
  const retailNow = vintagePiece ? null : catOk?.price ?? sell?.retail ?? (rcOk?.retail_now as number) ?? null, retailSize = vintagePiece ? null : catOk ? `${catOk.name}, ${catOk.site}, read ${catOk.date}` : sell?.retail ? (sell.retail_spec || null) : ((rcOk?.size_or_spec as string) ?? null);
  const out: QuickNumbers = {
    // Katie, 2026-10-26: a rare version always came from the boutique first, just scarcely; with no published price for it, the standard
    // version's price is shown beside it, labelled, never as this version's price
    retail_base: !retailNow && rc?.retail_now ? { price: Number(rc.retail_now), label: String(rc.size_or_spec ?? "") } : null,
    retail_now: retailNow, retail_launch: (launch?.price as number) ?? null, retail_size: retailSize, catalog: catOk, abroad,
    ask_median: (ask?.m as number) ?? null, ask_n: (ask?.n as number) ?? 0,
    sold_median: (sold?.m as number) ?? null, sold_n: (sold?.n as number) ?? 0, sold_pct_of_retail: (sold?.p as number) ?? null,
    saves_avg: (trr?.saves as number) ?? null, trend_pct: trend?.a0 && trend?.a1 ? Math.round((((trend.a1 as number) - (trend.a0 as number)) / (trend.a0 as number)) * 1000) / 10 : null,
    trr_sold_90d: (trr?.sold90 as number) ?? 0, icon: !!icon || (ICONS.test(norm(bag)) && !NOT_ICON.test(norm(bag))),
    buzz: buzzNumbers(house, bag, spec),
    links: bagLinks(house, bag),
    path: pricePath(house, bag, spec),
    sell,
    trend: (() => { try { const t = bagTrend(house, bag); return { term: t.term, years: t.search?.byYear ?? [], auction: t.auction?.plain ?? (t.auction ? `Too early to say: ${t.auction.n} of ${t.auction.need} auction sales.` : null), resale: t.resale ? (t.resale.plain ?? `Too early to say: ${t.resale.n} of ${t.resale.need} daily reads.`) : null, moments: moments(house, bag, spec) }; } catch { return null; } })(),
    forward,
    tiers,
    // a finish asked across the house is also broken out by model, so the hottest versions are named with their own numbers (Katie, 2026-10-25:
    // the cheetah pony-hair Medium Classic Flap and Chanel 25 Mini were "two of the hottest bags for Blazy")
    forever: (() => { // the long view is a judgement with its history, never a projected price (panel, 2026-10-25)
      const bs = norm(`${bag} ${spec ?? ""}`); const auc = (tiers?.auction_sold ?? []).length;
      if (PRINT_FINISH.test(bs)) return { word: "A moment" as const, line: "A one-season finish: buyers pay for the moment, and a print's premium can fade." };
      // Katie, 2026-10-25: "Yes, pass this down... it's a rare bag": a rare finish is named, and the page counts how few have sold
      // the finish as the client wrote it: the spec clean-up drops "suede/doblis leather" as an either-or, which hid a suede Kelly (2026-11-08)
      const said = `${bs} ${norm(askedRaw)}`;
      const rare = (["himalaya", "diamond", "porosus", "niloticus", "alligator", "crocodile", "ostrich", "lizard", "suede", "mother of pearl", "feather"] as const).find((k) => FINISH_KEYS.find(([f]) => f === k)?.[1].test(said)) ?? null;
      const icon = ICONS.test(bs);
      if (!icon && !auc) return { word: "Too new to say" as const, line: "A newer shape: too early to call it a bag to pass down." };
      // panel, 2026-11-07: a rare finish never borrows the plain leather's boutique prices (a Himalaya Kelly 28 showed the Togo Kelly's
      // $11,200 to $14,400). A path shown beside another leather or a rare finish is labelled with the leathers it is priced in.
      const sig = forward?.signals?.find((x) => x.name === "Boutique price"); const path = sig?.evidence?.replace(/; at that pace.*$/, "") ?? null;
      const borrowed = !!rare && !pricePath(house, bag, [spec, rare].filter(Boolean).join(", ")); // its own path must be priced in that finish
      const namesLeather = /\b(togo|epsom|clemence|swift|box|calf|calfskin|veau|caviar|lambskin|chevre|evercolor|barenia|classic leathers?)\b/.test(said);
      // the path in a sentence with a verb, labelled with the leathers and the size it is priced in when the bag asked differs (Margot,
      // Hélène, 2026-11-08: "For the Kelly 28 in Epsom, the boutique price rose from …")
      const verb = sig?.dir === "down" ? "fell" : sig?.dir === "flat" ? "moved" : "rose";
      const askSize = norm(bag).match(/\b(1[5-9]|[2-4]\d)\b/)?.[1] ?? null;
      const word = (ICONS.exec(bs)?.[1] ?? "").replace(/^./, (c) => c.toUpperCase());
      const where = !sig?.basis ? "" : sig.size && sig.size !== askSize && word ? `For the ${word} ${sig.size} in ${sig.basis}, ` : `In ${sig.basis}, `;
      const ev = !path || (borrowed && !(namesLeather && sig?.basis)) ? null : (borrowed || namesLeather || rare) && where ? `${where}the boutique price ${verb} from ${path}` : `The boutique price ${verb} from ${path}`;
      // dates only from sourced rows, with the source named; a dated finish speaks for itself (Margot, 2026-11-07)
      const d = sourcedSince(house, bag, rare);
      const first = ev ?? d.finish ?? d.shape ?? (icon ? "A shape the house has made for decades" : "");
      const num = (k: number) => ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][k] ?? String(k);
      const sales = auc ? `We found ${num(auc)} auction result${auc === 1 ? "" : "s"}.` : ""; // its own sentence, with a verb, no "so far" (Margot, Priya)
      // what the gap means (Mira, Priya); the finish is named when another leather's path stands beside it (Margot, 2026-11-10)
      const none = borrowed && path ? `We have no boutique price for ${ev ? (rare === "himalaya" ? "Himalaya" : rare) : "this finish"}; we judge it on resale and auction prices.` : "";
      return { word: "Forever bag" as const, rare, line: [first ? `${first}.` : "", sales, none].filter(Boolean).join(" ") };
    })(),
    // Katie, 2026-10-26: a Chanel photo with no size showing fell back to the reference size (Small) and missed the cheetah Chanel 25's
    // Mini sales. With no size named, a Chanel bag is broken out by size from its own sales, never guessed
    byModel: bag === ANY_MODEL ? (HOUSE_MODELS[norm(house).split(" ")[0]] ?? []).map(([m, sz]) => { try { const q = quickNumbers(house, m, [sz, spec].filter(Boolean).join(", "), null); return q?.paths && (q.paths.salesN ?? 0) >= 2 ? { model: `${sz ? `${sz[0].toUpperCase()}${sz.slice(1)} ` : ""}${m}`, band: q.paths.band, n: q.paths.salesN ?? 0, retail: q.retail_now } : null; } catch { return null; } }).filter((x): x is NonNullable<typeof x> => !!x) : undefined,
    // a print or novelty finish never borrows the plain leather's growth: later years stay at today's prices (Katie, 2026-10-25: "will this craze hold?")
    paths: ((pp) => (pp && PRINT_FINISH.test(norm(`${bag} ${spec ?? ""}`)) ? { ...pp, growthPct: null, horizons: pp.horizons.map((h) => ({ ...h, lo: pp.band.lo, mid: pp.band.mid, hi: pp.band.hi })) } : pp))(((pp) => (pp && bag === ANY_MODEL ? { ...pp, basisNote: `across every ${house} model in this finish: ${pp.basisNote}` } : pp))(twoWaysIn(sell, tiers, forward, retailNow, retailSize, parseQuote(notes), notes, /herm/i.test(house)))),
    asks: asksNow(house, bag, spec),
  };
  if (maxiAlias || bucketPrint) {
    const alt = (label: string, m: string, sp: string) => { breakoutDepth++; try { const q = quickNumbers(house, m, sp, null); return q?.paths && (q.paths.salesN ?? 0) >= 1 ? { model: label, band: q.paths.band, n: q.paths.salesN ?? 0, retail: q.retail_now } : null; } catch { return null; } finally { breakoutDepth--; } };
    // the finish can sit in the bag's name ("cheetah drawstring bag") as well as the spec: both travel (Sam, morning audit: the breakout showed
    // plain-leather Chanel 25 prices, $7,898-$10,375, for a cheetah bag that sells at $16,995-$17,995)
    const finWords = (bag.match(/\b(cheetah|leopard|dalmatian|animal print|pony ?hair|calf ?hair|haircalf|tweed|sequin\w*|shearling|fur|mink|crochet|knit)\b/gi) ?? []).join(" ");
    const fin = [finWords, spec ?? ""].filter(Boolean).join(", ").replace(/\b(small|large|mini|medium|maxi)\b/gi, " ").replace(/\s{2,}/g, " ").replace(/^[,\s]+|[,\s]+$/g, "").trim();
    const alts = maxiAlias
      ? [out.paths && (out.paths.salesN ?? 0) >= 1 ? { model: "Maxi Flap Bag (Souplissimo)", band: out.paths.band, n: out.paths.salesN ?? 0, retail: out.retail_now } : null, alt("Classic Flap in maxi", "Classic Flap", ["maxi", fin].filter(Boolean).join(", "))]
      : [alt("Bucket Bag", "Bucket Bag", fin), alt("Chanel 25 Mini", "Chanel 25", ["mini", fin].filter(Boolean).join(", "))];
    const got = alts.filter((x): x is NonNullable<typeof x> => !!x);
    if (got.length >= 2) out.byModel = got;
  }
  // only when the reference size finds too little: the per-size breakdown costs one lookup per size
  // two asking prices are not a market: with fewer than three, a question with no price of its own is judged against the real sales
  // (2026-10-26: a vintage Galliano Saddle's "typical ask" was the average of a $720 and a $19,500 listing)
  if (out.paths && !out.paths.buy.isQuote && out.paths.basis !== "same-material asks" && (out.tiers?.sites_asks?.n ?? 0) < 3 && out.paths.sold)
    out.paths = { ...out.paths, buy: { ...out.paths.buy, price: out.paths.band.mid, label: "what recent ones sold for" } };
  // a vintage piece is no longer made: the snapshot says so, beside today's standard version (Katie, 2026-10-26)
  out.vintage = /\bvintage\b|\bgalliano\b|\b(19[5-9]\d|200\d)\b/i.test(`${bag} ${spec ?? ""}`);
  // a finish asked across the house ("the pony-hair Chanels") is answered from the models we can name in it, never from every item in that
  // finish (2026-10-26: accessories and other pieces pulled the pony-hair "typical ask" to $9,925 while the named bags sell at about $17,000)
  if (bag === ANY_MODEL && out.paths && out.byModel?.length && !out.paths.buy.isQuote) {
    const lo = Math.min(...out.byModel.map((m) => m.band.lo)), hi = Math.max(...out.byModel.map((m) => m.band.hi)), n = out.byModel.reduce((a, m) => a + m.n, 0);
    const asks = (out.tiers?.sites_asks?.prices ?? []).filter((v) => v >= lo * 0.7 && v <= hi * 1.3).sort((a, b) => a - b);
    const mid = Math.round((lo + hi) / 2);
    out.paths = { ...out.paths, band: { lo, mid, hi }, sold: { lo, hi, n }, salesN: n, middle: false, mixed: false, basis: "same-material sales",
      buy: asks.length ? { ...out.paths.buy, price: asks[Math.floor(asks.length / 2)] } : out.paths.buy };
    if (out.tiers?.sites_asks && asks.length) out.tiers = { ...out.tiers, sites_asks: { ...out.tiers.sites_asks, prices: asks, n: asks.length, lo: asks[0], hi: asks[asks.length - 1] } };
    const rs = out.byModel.map((m) => m.retail).filter((v): v is number => v != null);
    // these are the boutique prices of the named pieces themselves, so they are this answer's boutique price, from the lowest
    if (!out.retail_now && rs.length) { const label = out.byModel.filter((m) => m.retail).map((m) => `${m.model} $${Number(m.retail).toLocaleString("en-US")}`).join(" · ");
      out.retail_now = Math.min(...rs); out.retail_size = label; out.paths = { ...out.paths, boutique: { price: Math.min(...rs), label: `from: ${label}` } }; out.retail_base = null; }
  }
  if ((out.paths?.salesN ?? 0) < 2 && bag !== ANY_MODEL && !/^(mini|small|medium|large|jumbo|maxi),/i.test(spec ?? "") && /chanel/i.test(house) && !/\b(nano|micro|mini|small|medium|large|maxi|jumbo)\b/i.test(`${bag} ${spec ?? ""}`)) out.bySize = (["mini", "small", "medium", "large", "jumbo", "maxi"] as const).map((sz) => { try { const q = quickNumbers(house, bag, [sz, spec].filter(Boolean).join(", "), null); return q?.paths && (q.paths.salesN ?? 0) >= 2 ? { model: `${sz[0].toUpperCase()}${sz.slice(1)} ${bag}`, band: q.paths.band, n: q.paths.salesN ?? 0, retail: q.retail_now } : null; } catch { return null; } }).filter((x): x is NonNullable<typeof x> => !!x);
  return out;
}

/** What sellers want right now for this exact bag (title words), when there is no store price to compare against. */
export function asksNow(house: string, bag: string, spec?: string): QuickNumbers["asks"] {
  const db = open(); if (!db) return null;
  const hTerms = houseTerms(house);
  const words = norm(`${bag}`).split(" ").filter((w) => w.length > 2 && !["bag", "bags", "the", "and", "with", "clutch", "flap"].includes(w)).slice(0, 4);
  const q = <T extends Row>(sql: string, params: (string | number)[] = []): T[] => { try { return db.prepare(sql).all(...params) as T[]; } catch { return []; } };
  // a two-digit size in the name ("Birkin 30") must appear in the title too, so a 30 never borrows a 25's price
  const houseWords = new Set(norm(house).split(" "));
  const nameIsHousePlusNumber = !norm(bag).split(" ").some((w) => w.length > 1 && !/^\d+$/.test(w) && !houseWords.has(w));
  // "Chanel 25": the number is the model, and listing titles rarely repeat the house, so match the number, not "chanel" (Sam, round 5)
  const sizeNum = nameIsHousePlusNumber ? (norm(bag).match(/\b(\d{2,3})\b/)?.[1] ?? null) : (norm(`${bag} ${spec ?? ""}`).match(/\b(1[5-9]|[2-4]\d)\b/)?.[1] ?? null);
  if (nameIsHousePlusNumber && sizeNum) words.splice(0, words.length);
  if (!words.length && !sizeNum) { db.close(); return null; }
  const titleLike = words.map(() => "and lower(title) like ?").join(" ") + (sizeNum ? " and (title like ? or title like ? or title like ? or title like ?)" : "");
  const wp = [...words.map((w) => `%${w}%`), ...(sizeNum ? [`% ${sizeNum} %`, `% ${sizeNum}`, `% ${sizeNum},%`, `%${sizeNum}cm%`] : [])];
  const exoticOk = /(ostrich|croc|alligator|lizard|porosus|niloticus)/i.test(spec ?? "");
  const trr = q<Row>(`select price, sold, slug from trr_item_reads where ${likeAny("house", hTerms)} and read_date >= date('now','-45 days') and price is not null ${titleLike} ${exoticOk ? "" : EXOTIC_TITLE_SQL} order by price`, [...likeParams(hTerms), ...wp]);
  // FWRD Renew (fwrd.com pre-owned): Katie trusts its pricing for vetted second hand. Weekly page read; asks only, FWRD shows no sold data.
  const fwrd = q<Row>(`select price from v_fwrd_latest where ${likeAny("house", hTerms)} and read_date >= date('now','-45 days') ${titleLike} order by price`, [...likeParams(hTerms), ...wp]);
  db.close();
  const trrAskRows = trr.filter((r) => !r.sold);
  const trrAsks = trrAskRows.map((r) => r.price as number);
  const fwrdAsks = fwrd.map((r) => r.price as number);
  const asks = [...trrAsks, ...fwrdAsks].sort((a, b) => a - b);
  if (!asks.length) return null;
  // Every ask names its venue and links out: the listing itself when The RealReal gave us one slug, otherwise the search for this bag;
  // FWRD Renew rows carry no product id by design, so they link to the shelf.
  const venue = trrAsks.length && fwrdAsks.length ? "The RealReal and FWRD Renew" : trrAsks.length ? "The RealReal" : "FWRD Renew";
  const slug = trrAskRows.length === 1 && trrAskRows[0].slug ? slugKey(trrAskRows[0].slug) : null;
  const link = slug ? `https://www.therealreal.com/products/${slug}` : trrAsks.length ? `https://www.therealreal.com/products?keywords=${encodeURIComponent(`${house} ${bag}`)}&taxons[]=493` : "https://www.fwrd.com/brand-fwrd-renew/e90c01/?sr=true";
  const link_label = slug ? "see the listing on The RealReal" : trrAsks.length ? "see it on The RealReal" : "see the FWRD Renew shelf";
  return { median_ask: median(asks), n: asks.length, sold: trr.filter((r) => !!r.sold).length, trr_n: trrAsks.length, fwrd_n: fwrdAsks.length, fwrd_median: fwrdAsks.length ? median(fwrdAsks) : null, venue, link, link_label };
}

/** One block of headline numbers the scorer must use, so the words and the tiles never disagree. */
const TIER_MATERIALS = ["box calf", "box", "fringe", "feather", "sequin", "beaded", "crystal", "embroidered", "doblis", "suede", "crocodile", "croc", "alligator", "ostrich", "lizard", "shearling", "grizzly", "barenia", "box calf", "chevre", "swift", "epsom", "togo", "clemence", "evercolor", "tadelakt", "caviar", "lambskin", "patent", "tweed", "canvas", "denim", "raffia", "pony hair", "himalaya", "mink", "fur"];
function avg(xs: number[]): Avg | null {
  if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y);
  return { mean: Math.round(a.reduce((s, x) => s + x, 0) / a.length), median: median(a), n: a.length, lo: a[0], hi: a[a.length - 1] };
}
/** The secondhand tiers for one bag: website asks (dealers, platforms, The RealReal, FWRD) and private sourcer quotes, as averages with n.
 *  Same model; same size when one is given; same material when the question names one. Exotics only when asked for. */
export function priceTiers(house: string, bag: string, spec?: string): PriceTiers {
  const db = open(); if (!db) return null;
  const hTerms = houseTerms(house);
  const q = <T extends Row>(sql: string, params: (string | number)[] = []): T[] => { try { return db.prepare(sql).all(...params) as T[]; } catch { return []; } };
  const words = norm(bag).split(" ").filter((w) => w.length > 2 && !/^\d+$/.test(w) && !["bag", "bags", "the", "and", "with", "clutch", "flap"].includes(w)).slice(0, 3);
  if (!words.length && modelMatch("title", bag, house).sql === "0") { db.close(); return null; } // "Le 5 à 7" and "2.55" are whole-phrase names (2026-10-26)
  const all = norm(`${bag} ${spec ?? ""}`);
  // a Touch bag (leather body, exotic trim) compares only with other Touch bags
  const material = /\btouch\b/.test(all) ? "touch" : /\b(embossed|stamped)\b/.test(all) ? "embossed" : /himalaya/.test(all) ? "himalaya" : /mother.of.pearl|\bnacre\b/.test(all) ? "mother of pearl" : TIER_MATERIALS.find((m) => new RegExp(`\\b${m}\\b`).test(all)) ?? null; // whole words: "crochet" is not croc (Sam, round 19); "Himalaya niloticus crocodile" is a Himalaya, not plain crocodile
  const houseWords = new Set(norm(house).split(" "));
  const nameIsHousePlusNumber = !norm(bag).split(" ").some((w) => w.length > 1 && !/^\d+$/.test(w) && !houseWords.has(w));
  const size = nameIsHousePlusNumber ? null : (all.match(/\b(1[5-9]|[2-4]\d)\b/)?.[1] ?? null);
  const wantsExotic = /(ostrich|croc|alligator|lizard|porosus|niloticus|himalaya)/.test(all);
  // "Kelly II 20, magenta" names the size before a comma; "20,000" is a number (2026-10-26: Katie's magenta Mini Kelly was missed)
  const sizeOk = (t: string) => !size || new RegExp(`(^|[^0-9])${size}(\\s*cm)?($|[^0-9%,.]|,\\s)`).test(t.replace(/\[.*$/, "").toLowerCase().replace(/\$\s*[0-9][0-9,.]*/g, " ").replace(/[0-9]+(\.[0-9]+)?\s*%/g, " "));
  const SAME: Record<string, string[]> = { suede: ["suede", "doblis", "grizzly"], doblis: ["doblis", "suede", "grizzly"], grizzly: ["grizzly", "doblis", "suede"], croc: ["croc", "crocodile", "porosus", "niloticus"], crocodile: ["croc", "crocodile", "porosus", "niloticus"], "pony hair": ["pony hair", "ponyhair", "pony", "calf hair", "calfhair", "haircalf"] }; // The RealReal writes "Ponyhair", Alaïa "haircalf" (Katie, 2026-10-24)
  // same material, and not a mixed-leather bag ("Swift/Suede/Togo") when a material is asked for
  const matOk = (t: string) => {
    // "brand new in box" is packaging, not box leather (the cheetah flap purchase was dropped for it)
    if (!material) return true; const low = norm(t).replace(/\b(in|with|and|full|original|orig) (the )?box\b|\bbox (and|&) dust ?bag\b|\bdust ?bag\b/g, " "); if (material === "touch") return /\btouch\b/.test(low);
    if (material === "embossed") return /\b(embossed|stamped)\b/.test(low); // an embossed bag compares with embossed bags only (panel, 2026-10-31)
    if (/^(crocodile|croc|alligator|lizard|python)$/.test(material) && /\b(embossed|stamped)\b/.test(low)) return false; // and a real skin never with embossed
    if (material === "himalaya") return /himalaya/.test(low);
    if (material === "mother of pearl") return /pearl|\bshells?\b|nacre/.test(low); // the embellishment decides; the base fabric under it does not // a Himalaya is always niloticus crocodile; plain crocodile is a different price (Sam, round 5)
    if (material === "mink") return /\bmink\b/.test(low) && !/\b(rabbit|fox|faux|lapin)\b/.test(low); // a "Rabbit & Mink" blend is not a mink Baguette (Sam, round 14) // a rabbit-fur Baguette is not a mink one (Katie, 2026-10-24)
    // a named premium fur is its own price: swakara, sable or chinchilla are never priced from rabbit or fox asks (Sam, round 13)
    if (material === "fur") { const named = all.match(/\b(swakara|astrakhan|karakul|persian lamb|broadtail|sable|chinchilla)\b/)?.[1]; return named ? (named === "sable" || named === "chinchilla" ? new RegExp(`\\b${named}\\b`).test(low) : /\b(swakara|astrakhan|karakul|persian lamb|broadtail)\b/.test(low)) : /\b(mink|fur|sable|fox|chinchilla|rabbit)\b/.test(low); }
    const same = SAME[material] ?? [material];
    if (!same.some((m) => low.includes(m))) return false;
    if (["pony hair", "fur", "mink", "shearling", "himalaya"].includes(material)) return true; // a calf-hair flap trimmed in lambskin is still calf hair (Sam, round 23: k5)
    if (material === "grizzly" && !/grizzly/.test(low)) return false; // a Grizzly (suede trimmed in smooth leather) sells far below a full doblis bag (Katie, 2026-10-24)
    if ((material === "doblis" || material === "suede") && /grizzly/.test(low)) return false;
    // a Grizzly is suede trimmed in smooth leather by design, so its trim is not a second leather; a full doblis suede bag stays apart (Katie, 2026-10-24)
    const trim = material === "grizzly" ? ["swift", "box", "box calf", "evercolor", "togo", "epsom", "barenia"] : [];
    // a leather the client also named is not a stray second leather ("Crystal Embellished Metallic Lambskin", "Epsom & Niloticus Lizard"; coverage sweep, 2026-10-26)
    return !TIER_MATERIALS.some((m) => !same.includes(m) && !trim.includes(m) && m !== "canvas" && low.includes(m) && !new RegExp(`\\b${m}\\b`).test(all));
  };
  const exoticOk = (t: string) => wantsExotic || !/(ostrich|croc|alligator|lizard|porosus|niloticus)/i.test(t);
  const sub = /\b(kelly|birkin)\b/.test(norm(bag)) ? ["cut", "pochette", "danse", "elan", "moove", "depeches", "longue", "doll", "shoulder", "shopper"].filter((w) => !norm(bag).includes(w)) : [];
  const subOk = (t: string) => !sub.some((w) => new RegExp(`\\b${w}\\b`, "i").test(norm(t)));
  // the same model match as everywhere else: size words and print names (Zucchino, FF) optional, Chanel "Classic Flap" = any flap (Sam, round 10)
  const mmT = modelMatch("title", bag, house); const like = `and ${mmT.sql}`; const lp = mmT.params;
  // dollars only: a euro or pound price is never read as dollars (2026-10-26: Labellov's EUR 6,490 bucket was counted as $6,490)
  const dealer = q<Row>(`select source, title, price from resale_listings where coalesce(currency,'USD')='USD' and ${likeAny("brand", hTerms)} ${like} and available=1 and price > 0 and source <> 'private-sourcer-offer' and last_seen >= date('now','-60 days')`, [...likeParams(hTerms), ...lp]);
  const trr = q<Row>(`select slug, title, price from trr_item_reads where ${likeAny("house", hTerms)} ${like} and sold=0 and price > 0 and coalesce(${SLUG_KEY_SQL},'') not in (select ${SLUG_KEY_SQL} from trr_item_reads where lower(title) like '%on hold%' and slug is not null) and read_date >= date('now','-45 days')`, [...likeParams(hTerms), ...lp]);
  // Katie, 2026-10-25: a RealReal listing on hold is a pending sale at its price, so it counts with the sales, never as an ask
  // Sam, round 6: a rare finish has few excellent-condition sales, so The RealReal's sales in any condition count too, scaled to excellent with the measured condition steps
  // Katie, 2026-10-24: collector bags (Himalaya) need their auction history; dollar results count as sales of that finish
  const auct = q<Row>(`select sale_date, auction_house, model_guess, size_guess, material, colour, hardware, hammer_price from auction_results where ${likeAny("house", hTerms)} and sold=1 and currency='USD' and hammer_price > 0 and lower(coalesce(model_guess,'')) like ? order by sale_date`, [...likeParams(hTerms), `%${norm(bag).split(" ").filter((w) => !/^\d+$/.test(w) && !/^(ii|iii)$/.test(w)).join(" ")}%`]).filter((r) => norm(String(r.model_guess ?? "").replace(/\(.*?\)/g, " ").split(",")[0]) === norm(bag).split(" ").filter((w) => !/^\d+$/.test(w) && !/^(ii|iii)$/.test(w)).join(" ")); // the auction's own model is the bag asked about: a Kelly never counts a So Black Kelly (Hélène, 2026-11-08)
  const trrSold = q<Row>(`select slug, title, price, condition from trr_item_reads where ${likeAny("house", hTerms)} ${like} and (sold=1 or lower(title) like '%on hold%') and price > 0 and read_date >= date('now','-365 days')`, [...likeParams(hTerms), ...lp]);
  const fwrd = q<Row>(`select title, price from v_fwrd_latest where ${likeAny("house", hTerms)} ${like} and price > 0`, [...likeParams(hTerms), ...lp]);
  const placed = q<Row>(`select source, title, price from resale_listings where coalesce(currency,'USD')='USD' and ${likeAny("brand", hTerms)} ${like} and available=0 and price > 0 and source <> 'private-sourcer-offer'`, [...likeParams(hTerms), ...lp]);
  const priv = q<Row>(`select title, price from resale_listings where coalesce(currency,'USD')='USD' and source='private-sourcer-offer' and ${likeAny("brand", hTerms)} ${like} and price > 0 and coalesce(tags,'') not like '%duplicate of%'`, [...likeParams(hTerms), ...lp]);
  db.close();
  // "Chanel 19", "Chanel 25", "Chanel 22": the number IS the model; without it every Chanel bag would count (Zara, 2026-10-24)
  const modelNum = nameIsHousePlusNumber && (norm(bag).match(/\d+/g) ?? []).length === 1 ? (norm(bag).match(/\b(\d{2,3})\b/)?.[1] ?? null) : null; // "2.55" is matched as a phrase
  const numOk = (t: string) => !modelNum || new RegExp(`(^|[^0-9$,.])${modelNum}([^0-9%,.]|$)`).test(t.replace(/\[.*$/, "").replace(/\$\s*[0-9][0-9,.]*/g, " ").replace(/\b(19|20)\d{2}\b/g, " "));
  const finRx = titleFinishes(bag, spec);
  // Sam's test, 2026-10-24: a medium question counted smalls, minis and a Jumbo; a Chanel Shopping Bag counted Cerf totes; a Baguette counted a Nano charm
  const SIZEW = ["nano", "micro", "mini", "small", "medium", "large", "maxi", "jumbo", "teen", "baby", "toy"];
  // Louis Vuitton and Hermès title sizes by letter (PM, MM, GM: petit, moyen, grand modèle): "Neverfull large" is the Neverfull GM
  // (coverage sweep, 2026-10-26: "Neverfull large" and "Evelyne GM" found nothing or every size)
  // and a size word inside a name is not a size: Bottega's "Maxi Intrecciato" is a weave, and Chanel's Souplissimo is the "Maxi Flap Bag" in
  // Small and Large (coverage sweep, 2026-10-26: "Suede Large Maxi Flap Bag" and "Maxi Intrecciato Mini" found nothing)
  const LETTER = (x: string) => x.replace(/\bpm\b/g, "small").replace(/\bmm\b/g, "medium").replace(/\bgm\b/g, "large").replace(/\bmaxi intrecciato\b/g, "intrecciato").replace(/\bmaxi (?=(souplissimo )?flap\b)/g, (m) => (/souplissimo/.test(x) ? "" : m));
  const askedSizeW = SIZEW.find((w) => new RegExp(`\\b${w}\\b`).test(LETTER(all))) ?? null;
  // a title that names no size at all is the regular size, so it counts for "medium" (Sam, round 10: python Baguettes are titled without a size)
  const sizeWOk = (t: string) => { const low = LETTER(norm(t)); if (askedSizeW) return (new RegExp(`\\b${askedSizeW}\\b`).test(low) || (askedSizeW === "medium" && !SIZEW.some((w) => new RegExp(`\\b${w}\\b`).test(low)))) && !SIZEW.some((w) => w !== askedSizeW && new RegExp(`\\b${w}\\b`).test(low)); return !/\b(nano|micro|charm|keychain|key holder)\b/.test(low); };
  const DISTINCT = DISTINCT_MODELS; void ["cerf", "deauville", "gst", "pst", "executive", "boy", "gabrielle", "trendy", "affinity", "reissue", "vanity", "camera", "charm", "wallet", "woc", "mamma", "soft", "first", "iseeu", "dome", "touch", "cut", "pochette", "danse", "elan", "ghillies", "verso", "en desordre", "officier", "jonathan", "picnic", "cargo", "shadow", "lucky daisy", "faubourg", "so black", "himalaya", "inside out", "panier", "cabas", "ceinture", "cerises", "heart", "d joy", "dioramour"];
  const otherOk = (t: string) => { const low = norm(t); return !DISTINCT.some((w) => low.includes(w) && !all.includes(w) && !(DISTINCT_IMPLIED[w] ?? []).some((m) => all.includes(m))) && subModelOk(house, all, t); };
  const EXTRA = /\b(diamond|himalaya|fringe|feather|sequin|beaded|crystal|strass|suede|doblis|grizzly|shearling|ostrich|lizard|python|alligator|porosus|pony|mink|fur|leopard|cheetah|polka|pearl|shells?|nacre)(?:hair)?\b/g; // "Ponyhair" counts as pony (Sam, round 5)
  const extraOk = (t: string) => [...norm(t).matchAll(EXTRA)].every((m) => all.includes(m[1]) || (["doblis", "suede", "grizzly"].includes(m[1]) && /doblis|suede|grizzly/.test(all)) || (["leopard", "cheetah"].includes(m[1]) && /leopard|cheetah/.test(all)) || (m[1] === "pony" && /leopard|cheetah/.test(all)) || (m[1] === "porosus" && /crocodile|croc/.test(all) && !/niloticus|himalaya/.test(all)));
  // the bracketed part of a title is our own note ("[SOLD; sweep ...]"), never a product word (Katie, 2026-10-25: a note made a Mama "knit")
  const keep = (t0: string) => { const t = t0.replace(/\s*\[.*$/, ""); return keep1(t); };
  // Katie, 2026-10-26: "rare or specialized bags are edge cases". A plain Hermès bag's sales and asks never include special orders, Horseshoe
  // stamps, So Black, Himalaya, Zebra, Dalmatian or buffalo pieces, Faubourg, Shadow, Cargo or Picnic, unless the client names that piece
  // (the plain Birkin 30's asks ran $8,400 special-order Chèvre Mysore to $198,000 Zebra)
  const SPECIAL = /\b(special order|horseshoe|so black|zebra|dalmatian|buffalo|himalaya\w*|faubourg|shadow|cargo|picnic)\b/i;
  const specialOk = (t: string) => !/herm/i.test(house) || !SPECIAL.test(t) || SPECIAL.test(all);
  const keep1 = (t: string) => specialOk(t) && noveltyOk(t, all) && classicOk(house, bag, spec, t) && variantOk(house, all, t) && vintageOk(all, t) && itemOk(all, t) && canvasOk(house, all, t) && sizeWOk(t) && otherOk(t) && extraOk(t) && sizeOk(t) && matOk(t) && exoticOk(t) && subOk(t) && numOk(t) && finRx.every((rx) => rx.test(norm(t)));
  const narrow = narrowWords(bag, spec, trrSold.filter((r) => keep(String(r.title))).map((r) => String(r.title)));
  const keepN = (t0: string) => keep(t0) && narrow.every((w) => new RegExp(`\\b${w}`).test(norm(t0.replace(/\s*\[.*$/, ""))));
  const seenSlug = new Set<string>();
  const asks: { src: string; price: number }[] = [
    // a RealReal listing can sit in both resale_listings and trr_item_reads: count it once (Sam, round 8: the $170,450 Himalaya counted twice)
    ...dealer.filter((r) => keepN(String(r.title)) && !(String(r.source) === "therealreal" && [...trr, ...trrSold.filter((t) => /on hold/i.test(String(t.title)))].some((t) => Number(t.price) === Number(r.price)))).map((r) => ({ src: String(r.source), price: Number(r.price) })),
    ...trr.filter((r) => keepN(String(r.title)) && !(r.slug && seenSlug.has(slugKey(r.slug))) && (r.slug ? (seenSlug.add(slugKey(r.slug)), true) : true)).map((r) => ({ src: "therealreal", price: Number(r.price) })),
    ...fwrd.filter((r) => keepN(String(r.title))).map((r) => ({ src: "fwrd", price: Number(r.price) })),
  ];
  const STEP = /herm/i.test(house) ? COND_STEP_HERMES : COND_STEP_ALL;
  const CMAP: Record<string, Cond> = { Pristine: "P", "Very Good": "VG", Good: "G", Fair: "F" };
  const soldSeen = new Set<string>();
  const soldRows = trrSold.filter((r) => keepN(String(r.title)) && r.condition && !soldSeen.has(r.slug ? slugKey(r.slug) : String(r.title)) && (soldSeen.add(r.slug ? slugKey(r.slug) : String(r.title)), true));
  const trrSoldT = soldRows.length ? { prices: soldRows.map((r) => Math.round(Number(r.price) / (CMAP[String(r.condition)] ? STEP[CMAP[String(r.condition)]] : 1))).sort((x, y) => x - y), n: soldRows.length, raw: soldRows.map((r) => ({ price: Number(r.price), condition: String(r.condition), held: /on hold/i.test(String(r.title)) })), held: soldRows.filter((r) => /on hold/i.test(String(r.title))).length } : null;
  const auctKeep = auct.filter((r) => keep(`${bag} ${r.size_guess ?? ""} ${r.material ?? ""} ${r.colour ?? ""} ${r.hardware ?? ""}`.replace(/\b(1[5-9]|[2-4]\d)\b/g, "") + ` ${r.size_guess ?? ""}`));
  const a = avg(asks.map((x) => x.price)); const pq = avg(priv.filter((r) => keep(String(r.title))).map((r) => Number(r.price)));
  const NAME: Record<string, string> = { therealreal: "The RealReal", fwrd: "FWRD Renew", fashionphile: "Fashionphile", rebag: "Rebag", madisonavenuecouture: "Madison Avenue Couture", priveporter: "Privé Porter", tabvintage: "Tab Vintage", wararni: "Wararni", janefinds: "Jane Finds", the1916company: "The 1916 Company" };
  return {
    material, size, finished: namedFinishes(bag, spec).length > 0,
    trr_sold: trrSoldT,
    auction_sold: auctKeep.length ? auctKeep.map((r) => ({ date: String(r.sale_date), house: String(r.auction_house), size: (r.size_guess as string) ?? null, price: Number(r.hammer_price) })) : null,
    sites_asks: a ? { ...a, bySource: asks.map((x) => ({ source: NAME[x.src] ?? x.src, price: x.price })).sort((x, y) => y.price - x.price), prices: asks.map((x) => x.price).sort((x, y) => x - y), sources: [...new Set(asks.map((x) => NAME[x.src] ?? x.src))], matched: [size ? `size ${size}` : "", material ? material : "any leather"].filter(Boolean).join(", ") } : null,
    sourcer_sold: (() => { const k = placed.filter((r) => keepN(String(r.title))); const a2 = avg(k.map((r) => Number(r.price))); return a2 ? { ...a2, rows: k.map((r) => ({ price: Number(r.price), cond: conditionOf(String(r.title)) })), sources: [...new Set(k.map((r) => NAME[String(r.source)] ?? String(r.source)))], ranges: k.map((r) => String(r.title).match(/realized (\$[0-9,]+\s*[–-]\s*\$[0-9,]+)/i)?.[1]).filter((x): x is string => !!x) } : null; })(),
    // Sourcer quotes Katie received are hers to share (2026-10-24); HIDE_PRIVATE=1 withholds them if ever needed
    private_quotes: pq && process.env.HIDE_PRIVATE !== "1" ? { ...pq, prices: priv.filter((r) => keep(String(r.title))).map((r) => Number(r.price)) } : null,
    // Katie, 2026-10-25: "my own purchases should be a comparison ... that is what our edge is". A bag a luxury shopper actually bought,
    // at a known price, is a completed sale for every shopper who asks about that bag (never named as hers on the page).
    private_sold: (() => { const b = priv.filter((r) => keep(String(r.title)) && /\bBOUGHT\b/.test(String(r.title))).map((r) => Number(r.price)); return b.length ? { prices: b, n: b.length } : null; })(),
  };
}

function q(xs: number[], p: number): number { const a = [...xs].sort((x, y) => x - y); const i = (a.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return Math.round(a[lo] + (a[hi] - a[lo]) * (i - lo)); }
function twoWaysIn(sell: QuickNumbers["sell"], tiers: PriceTiers, forward: Forward, retailNow: number | null, retailSize: string | null, quote: number | null, notes?: string | null, isHermes = false): Paths {
  // the evidence for "what it is worth secondhand today", best first
  let basis: NonNullable<Paths>["basis"] | null = null; let pts: number[] = []; let note = "";
  const ss = tiers?.sourcer_sold;
  let salesN = 0; // one count of the sales in the range: the receipts, the Based-on line and the Yes thresholds all use it
  const sameSold = [...(sell && !sell.plain ? sell.prices : [])];
  // The RealReal's sales in any condition (Sam, rounds 6-7). The page shows what buyers really paid: with no condition asked,
  // the actual prices; with a condition asked (or for a rare finish), each sale is converted to that condition by the measured steps.
  const condAsked = conditionOf(notes ?? "");
  const ts = tiers?.trr_sold && (!sameSold.length || condAsked) ? tiers.trr_sold : null;
  let tsN = 0; let tsRows: { price: number; condition: string; held?: boolean }[] = [];
  if (ts) {
    const ST = isHermes ? COND_STEP_HERMES : COND_STEP_ALL; const CM: Record<string, Cond> = { Pristine: "P", "Very Good": "VG", Good: "G", Fair: "F" };
    // excellent and pristine sales are already in the excellent-condition read when there is one: count each sale once
    // the client's own listing, now on hold, never judges itself (Sam, round 19: h5's range began at its own $110,500)
    const rows = ts.raw.filter((r) => !(r.held && quote && Math.abs(r.price - quote) <= Math.max(25, quote * 0.0025))).filter((r) => !/as is/i.test(r.condition)).filter((r) => !(sameSold.length && /^(Excellent|Pristine)$/.test(r.condition)));
    tsN = rows.length; tsRows = rows; // the sales actually used, so the page counts each once (Sam, round 16)
    // with a condition asked, each sale is put on that footing; with none, the sales stand as they sold, very good or better when there are
    // three of them (Sam, round 17: a Fair $3,200 beside an Excellent $8,645; round 18: converting everything inflated 1997 Fair sales to $31,667)
    const better = rows.filter((r) => /^(Pristine|Excellent|Very Good)$/i.test(r.condition));
    const used = condAsked || better.length < 3 ? rows : better;
    if (!condAsked) { tsN = used.length; tsRows = used; }
    sameSold.push(...used.map((r) => (condAsked ? Math.round(r.price / (CM[r.condition] ? ST[CM[r.condition]] : 1)) : r.price)));
  }
  const ps = tiers?.private_sold ?? null; // private purchases by luxury shoppers: real sales at real prices, bought new
  if (ps) sameSold.push(...ps.prices);
  const au = !sell || sell.plain ? (tiers?.auction_sold ?? []).filter((x) => x.date >= String(new Date().getFullYear() - 5)) : [];
  if (au.length) sameSold.push(...au.map((x) => x.price));
  // Katie, 2026-10-26 (the snapshot): sourcer sales always join the sold range, beside The RealReal ("one range of recent sales second hand
  // including luxury sourcer numbers"); before, they were left out whenever RealReal sales existed, so $26,056 sat outside "$17,000 to $25,000"
  const ssUsed = !!ss;
  if (ssUsed && ss) {
    for (const r of ss.ranges) { const m = r.match(/\$([0-9,]+)\s*[–-]\s*\$([0-9,]+)/); if (m) sameSold.push(Number(m[1].replace(/,/g, "")), Number(m[2].replace(/,/g, ""))); }
    // each placement at its own price; when a condition is in play, a worn placement is first brought to excellent (Jane Finds' "condition 3 very good")
    const ST2 = isHermes ? COND_STEP_HERMES : COND_STEP_ALL;
    const plain = (ss.rows ?? []).filter((r) => !ss.ranges.length || true).map((r) => condAsked && r.cond ? Math.round(r.price / ST2[r.cond]) : r.price);
    if (!ss.ranges.length) sameSold.push(...(plain.length ? plain : [ss.lo, ...(ss.hi !== ss.lo ? [ss.hi] : [])]));
  }
  // fewer than three sales: the same-finish asks join them, so one auction result never sets the range alone (Himalaya B25, 2026-10-24)
  const soldOnly = [...sameSold]; // the snapshot's "sold secondhand" range never includes asks
  let mixed = false;
  let joined = 0; // the asks actually joined, never the client's own listing (Sam, round 15: l2 counted its own link)
  if (sameSold.length && sameSold.length < 3 && tiers?.sites_asks?.prices?.length) { const ap = [...tiers.sites_asks.prices]; const self = quote ? ap.findIndex((x) => Math.abs(x - quote) <= quote * 0.01) : -1; if (self >= 0) ap.splice(self, 1); if (ap.length) { sameSold.push(...ap); mixed = true; joined = ap.length; } }
  if (sameSold.length) { basis = "same-material sales"; pts = sameSold; const cnt = (sell && !sell.plain ? sell.n : 0) + (ssUsed ? ss?.n ?? 0 : 0) + tsN + au.length + (ps?.n ?? 0); salesN = cnt;
    // the receipts list what makes up the count, so an auction or a private purchase never reads as an extra sale (Sam, round 21)
    const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
    const parts = [sell && !sell.plain ? `${sell.n} excellent-or-better RealReal sale${sell.n === 1 ? "" : "s"} (${sell.prices.length > 1 ? `${usd(Math.min(...sell.prices))} to ${usd(Math.max(...sell.prices))}` : usd(sell.prices[0])})` : "", ssUsed && ss ? `${ss.n} sourcer placement${ss.n === 1 ? "" : "s"} (${(ss.rows ?? []).map((r) => usd(r.price)).join(", ") || ss.ranges.join(", ")})` : "", tsRows.length ? `The RealReal sold at ${tsRows.map((r) => `${usd(r.price)} (${r.condition.toLowerCase()}${r.held ? ", on hold" : ""})`).join(", ")}` : "", ps ? `${ps.n} private purchase${ps.n === 1 ? "" : "s"} by a luxury shopper through a sourcer (${ps.prices.map(usd).join(", ")})` : "", au.length ? `${au.length} auction result${au.length === 1 ? "" : "s"} (${au.map((x) => `${x.house} ${x.date.slice(0, 4)} ${usd(x.price)}`).join(", ")})` : ""].filter(Boolean);
    note = `${cnt} sale${cnt === 1 ? "" : "s"} ${tiers?.material ? "in this leather" : tiers?.finished ? "in this finish" : "of this bag, in any leather"}${ss?.ranges.length ? ", one stated as a range" : ""}${parts.length ? `: ${parts.join("; ")}` : ""}${joined ? `, plus ${joined} ${tiers?.material || tiers?.finished ? "same-finish " : ""}asking price${joined === 1 ? "" : "s"} because sales are few` : ""}`; }
  else if (tiers?.sites_asks) {
    // the listing the client is asking about is not its own comparable (Sam, round 6: the 1916 Grizzly was judged against itself)
    const ap = [...(tiers.sites_asks.prices ?? [tiers.sites_asks.lo, tiers.sites_asks.median, tiers.sites_asks.hi])];
    const self = quote ? ap.findIndex((x) => Math.abs(x - quote) <= quote * 0.01) : -1;
    if (self >= 0) ap.splice(self, 1);
    if (ap.length) { basis = "same-material asks"; pts = ap; note = `${ap.length} asking price${ap.length === 1 ? "" : "s"} ${tiers?.material ? "in this leather" : tiers?.finished ? "in this finish" : "of this bag"}, not sales${self >= 0 ? ", leaving out the listing you are asking about" : ""}`; }
  }
  if (!basis && sell) { basis = "other-leather sales"; pts = sell.prices; note = `${sell.n} sold listings of the plain version, not this leather`; }
  if (!basis || !pts.length) return null;
  const band0 = pts.length >= 4 ? { lo: q(pts, 0.25), mid: q(pts, 0.5), hi: q(pts, 0.75) } : { lo: Math.min(...pts), mid: q(pts, 0.5), hi: Math.max(...pts) };
  // The comparables are mostly excellent or new; a buyer quoting a worn bag is judged against what that condition sells for
  // (steps measured on The RealReal sold listings, 2026-10-23; Hermès steps differ from other houses).
  // Katie, 2026-10-24: a bag from a private sourcer is new unless she says it was worn; the premium over the boutique is the cost of access
  // Sam, round 9: converting every sale to "new" for a sourcer's bag inflated real prices (a 1997 bag's Fair sales became $25k-$36k).
  // A sourcer's bag is still treated as new in the words and shown beside new asks, but the range stays at real sale prices.
  const viaSourcer = ((!quote && !!tiers?.private_quotes?.n) || /\b(from|through|via|with) (my|a|her|his|our|the) (luxury )?sourcer\b/i.test(notes ?? "")) && !/\bvintage\b|\b(19[5-9]\d|200\d|201\d)\b/i.test(notes ?? "");
  const cond = conditionOf(notes ?? "");
  const f = cond ? (isHermes ? COND_STEP_HERMES : COND_STEP_ALL)[cond] : 1;
  const band = { lo: Math.round(band0.lo * f), mid: Math.round(band0.mid * f), hi: Math.round(band0.hi * f) };
  const g = forward?.nextBoutique ? forward.nextBoutique.ratePct / 100 : null;
  const grow = (v: number, t: number) => Math.round(v * Math.pow(1 + (g ?? 0), t));
  const horizons = [{ label: "6 months", years: 0.5 }, { label: "1 year", years: 1 }, { label: "5 years", years: 5 }, { label: "10 years", years: 10 }, { label: "3 years", years: 3 }].map((h) => ({ ...h, lo: grow(band.lo, h.years), mid: grow(band.mid, h.years), hi: grow(band.hi, h.years) }));
  // Katie, 2026-10-24 ("I have told you so many times: I am buying this bag for this"): a logged sourcer price for this exact
  // version is the price being paid, ahead of a typical website ask
  const pq = tiers?.private_quotes;
  const buy = quote ? { price: quote, label: "the price you were quoted", isQuote: true } : pq && pq.n && /\bsourcer\b/i.test(notes ?? "") ? { price: pq.median, label: "your sourcer's price", isQuote: true } : { price: tiers?.sites_asks?.median ?? band.mid, label: tiers?.sites_asks ? "the middle asking price on secondhand sites" : "today's middle secondhand price", isQuote: false };
  // "I own two Birkin 30s, should I buy a third?" is a buyer: owning only counts when they ask about selling or what theirs is worth (Sam, round 5)
  const buying = /\b(should i (buy|get|take|pay)|buy (another|a third|one more|it)|is \$?[0-9,.]+k? (fair|right|too much)|worth (buying|paying))\b/i.test(notes ?? "");
  const hypothetical = /\b(if i (got|get|buy|bought|were to (get|buy))|were i to (get|buy)|should i (buy|get))\b/i.test(notes ?? "");
  const owner = !buying && !hypothetical && /\b(sell my|selling my|sell (it|mine|her|this one)|what will i get|what would i get|what'?s (mine|it) worth|what is (mine|it) worth|consign (my|it|mine)|i own\b[^.?]*\b(sell|worth|get for))\b/i.test(notes ?? "");
  const resaleSite = /\b(on|from|at|through) (the )?(real ?real|fashionphile|rebag|madison avenue|priv[eé] porter|1stdibs|ebay|vestiaire|what goes around|fwrd|the 1916)/i.test(notes ?? "") && !/\bboutique\b/i.test(notes ?? "");
  const buyer = owner ? "owner" : resaleSite && !quote ? "secondhand" : /\b(bought|picked up|in store|in-store|at the boutique|from the boutique|boutique allocation|offered (it|one|me)|got (it|one) (at|from) the)\b/i.test(notes ?? "") && !quote ? "boutique" : hypothetical && /\bboutique|from hermes|at hermes|in store\b/i.test(notes ?? "") && !quote ? "boutique" : quote ? "secondhand" : null;
  // a Hermès boutique price in another leather is not this bag's price: a box or doblis Birkin is never set against the Togo price
  // (Sam, round 14); the panel then asks what they paid rather than compare across leathers
  const HERMES_PRICED = ["box", "box calf", "doblis", "suede", "grizzly", "barenia", "chevre", "crocodile", "croc", "alligator", "ostrich", "lizard"];
  const SAMEL: Record<string, string[]> = { box: ["box"], "box calf": ["box"], doblis: ["doblis", "suede", "grizzly"], suede: ["doblis", "suede", "grizzly"], grizzly: ["grizzly"], crocodile: ["croc", "porosus", "niloticus"], croc: ["croc", "porosus", "niloticus"] };
  const labelN = norm(retailSize ?? "");
  const otherLeather = isHermes && !!tiers?.material && HERMES_PRICED.includes(tiers.material) && !(SAMEL[tiers.material] ?? [tiers.material]).some((m) => labelN.includes(m));
  // with four or more prices the range is the middle half; the page says "typically" so it never reads as the full spread (Sam, demo rehearsal)
  // the snapshot shows what buyers really paid, never a condition-adjusted figure (Sam, WGSN round: a $3,810 sale read as $1,791); the
  // verdict may judge on a condition footing, but the numbers a customer reads are real sales
  const soldBand = soldOnly.length ? ((b) => ({ lo: Math.round(b.lo), hi: Math.round(b.hi) }))(soldOnly.length >= 4 ? { lo: q(soldOnly, 0.25), hi: q(soldOnly, 0.75) } : { lo: Math.min(...soldOnly), hi: Math.max(...soldOnly) }) : null;
  return { sold: soldBand && salesN ? { ...soldBand, n: salesN } : null, middle: pts.length >= 4, basis, mixed, viaSourcer, basisNote: cond ? `${note}, adjusted to ${COND_LABEL[cond]} condition` : note, band, growthPct: g == null ? null : Math.round(g * 1000) / 10, boutique: retailNow && !otherLeather ? { price: retailNow, label: retailSize ?? "" } : null, salesN, buy, horizons, condition: cond ? COND_LABEL[cond] : null, buyer };
}

export function headlineNumbers(house: string, bag: string, spec?: string, notes?: string | null): string {
  const n = quickNumbers(house, bag, spec, notes); if (!n) return "";
  const lines: string[] = [];
  // Katie, 2026-10-25: a buyer today may want to wait for the new version: name the latest runway takes on this model and when they reach stores
  { const db = open(); if (db) { try { const mm = modelMatch("model_guess", bag, house);
      const rw = db.prepare(`select distinct season, expected_in_store, model_guess, colour, material from runway_pipeline where ${likeAny("house", houseTerms(house))} and ${mm.sql} and show_date >= date('now','-240 days') order by show_date desc limit 6`).all(...likeParams(houseTerms(house)), ...mm.params) as Row[];
      const askedN = norm(`${bag} ${spec ?? ""}`); const rw2 = rw.filter((r) => { const m = norm(String(r.model_guess ?? "")); return !DISTINCT_MODELS.some((w) => m.includes(w) && !askedN.includes(w)) && ![...m.matchAll(/\b(19|22|25|31)\b/g)].some((x) => !askedN.includes(x[1])); }); rw.splice(0, rw.length, ...rw2);
      if (rw.length) lines.push(`COMING TO STORES (runway, tracker): ${rw.map((r) => `${String(r.season).replace(/-/g, " ")}: ${r.model_guess} in ${[r.colour, r.material].filter((x) => x && !/not stated/.test(String(x))).join(" ")}${r.expected_in_store ? ` (expected ${r.expected_in_store})` : ""}`).join("; ")}. A buyer today may wait for one of these; say so in one clause when it fits, never as a price.`);
    } catch { /* runway table missing: nothing to add */ } finally { db.close(); } } }
  { const k = stockSignal(n.catalog?.stock?.status); if (k) lines.push(`SIGNAL KEY: ${SIGNAL_KEY[k].signal} (${n.catalog!.site}, ${n.catalog!.stock!.date}) = ${SIGNAL_KEY[k].means}: ${SIGNAL_KEY[k].how}. Say it in one plain clause.`); }
  if (n.retail_now) lines.push(`Boutique price today: $${n.retail_now}${n.retail_size ? ` (${n.retail_size})` : ""}${n.retail_launch && n.retail_launch !== n.retail_now ? `; was $${n.retail_launch} at launch` : ""}.`);
  if (n.sell) lines.push(`SOLD PRICE TO QUOTE: $${n.sell.median_sold} median (range $${n.sell.lo}-$${n.sell.hi}), ${n.sell.n} sold listings in excellent condition or better (${n.sell.pristine} graded pristine), seen on The RealReal in reads from ${n.sell.read_from} to ${n.sell.read_to}; sale dates are unknown, so say "sold listings seen", never "sales in the last N days". Matched on: ${n.sell.matched_on}. ${n.sell.plain ? `IMPORTANT: these are PLAIN ${bag} sales, NOT the leather/colour/finish asked about. Say exactly that ("plain ${bag}s, not this leather") and never call them the same edition or name a leather they were not.` : ""} Against $${n.sell.retail} retail (${n.sell.retail_spec}). Never call these pristine. Never quote a single outlier sale as the sold price.`);
  // Sam, round 6: the model-wide sold median (any version, e.g. Soft Margaux under "Margaux") contradicted the page's range; when the page has a range it is context only
  else if (n.sold_n && !namedFinishes(bag, spec).length && !n.paths) lines.push(`SOLD PRICE TO QUOTE: $${n.sold_median} median, ${n.sold_n} same-size sales (any condition), ${n.sold_pct_of_retail}% of today's retail.`);
  else if (n.sold_n) lines.push(`MODEL-WIDE SALES (context only; never quote these as this bag's sold price, never put them beside THE PAGE'S RANGE): $${n.sold_median} median across ${n.sold_n} sales of any ${bag} version and leather.`); // Sam, round 5: a Himalaya never quotes plain Kelly sales
  else if (n.asks && n.paths?.basis === "same-material asks") lines.push(`This exact edition is priced from asks here. The model itself sells: ${n.asks.sold} sold listings of this model seen in recent reads of The RealReal (all colours, sizes and leathers; sale dates unknown)${n.trr_sold_90d ? `, ${n.trr_sold_90d} in 90 days` : ""}. Sellers want $${n.asks.median_ask}: ${n.asks.n} listing${n.asks.n === 1 ? "" : "s"} on ${n.asks.venue}, an ask, not a sale. RULES: say what the price rests on and how many of the model sold (e.g. "Fourteen Sardines sold; this turquoise mini is priced from two asks"); never claim this edition has not sold. Whenever you quote this asking price, name the venue, call it an ask, and put the token [[ask-link]] immediately after the dollar figure (the page turns it into a link to the listing).`);
  if (n.ask_median) lines.push(namedFinishes(bag, spec).length ? `PLAIN-VERSION ASKS (context only, never the ask for this finish): $${n.ask_median} middle across ${n.ask_n} listings of the ${bag}, any leather.` : `Asking median: $${n.ask_median} across ${n.ask_n} listings (asks, not sales).`);
  if (n.asks?.fwrd_n && n.asks.fwrd_median) lines.push(`FWRD Renew (vetted pre-owned, a trusted price reference; asks, not sales): $${n.asks.fwrd_median} median across ${n.asks.fwrd_n} listings this week.`);
  // one basis for the whole page (Sam, 2026-10-24): the verdict on a price uses the same range the page shows
  if (n.paths) lines.push(`THE PAGE'S RANGE (the panel shows it; judge any quote, "fair", "too high" and any counter ONLY against this, never against another average in the dossier): ${n.paths.basis === "same-material asks" ? "sellers ask" : n.paths.mixed ? "sales and asks together run" : "buyers pay"} $${n.paths.band.lo} to $${n.paths.band.hi}, middle $${n.paths.band.mid} (${n.paths.basisNote}). ${n.paths.buy.isQuote ? `The client's price: $${n.paths.buy.price}. THE PAGE'S VERDICT on that price, shown in the panel: "${priceWord(n.paths.buy.price, n.paths.band, n.paths.basis === "same-material asks")}". plain_answer, timing and every signal must say the same verdict in words (too high / a fair price / a good price; for asks: above, in line with or below the asks). A counter on a fair price is optional and stays inside the range.` : ""}${n.paths.buyer === "owner" ? " The client OWNS this bag and is selling: answer what they would get, never whether to buy." : ""}`);
  if (n.paths?.boutique && n.paths.basis !== "same-material asks" && n.paths.buyer !== "owner") { // an owner is never told the boutique buyer's gain (Sam, round 25: h2)
    // the same calculation the page's cards and panel use (Sam, round 8), in today's money for later years
    const salesN = salesCount(n);
    const { figs, best } = yearFigures(n.paths, n.paths.boutique.price, "new", salesN, n.forward?.lean === "rising");
    const f = (v: number) => `${v >= 0 ? "+" : "-"}$${Math.abs(v)}`;
    lines.push(`BEST TIME TO SELL for someone who buys at the boutique (computed; the page's cards and panel show exactly these; plain_answer, timing and every signal must agree and must not quote any other gain): ${best ? (best.years === 1 ? "now" : `in about ${best.years} years`) : figs.some((x) => x.net > 0) ? "not settled yet; real sales of this version would confirm a gain, so never say sell now" : "no time to sell for a gain; buy it to wear"}. Keep after fees against the boutique price: now ${f(figs[0].net)}, in five years ${f(figs[1].net)}, in ten years ${f(figs[2].net)} (later years in today's money at 4% a year). Card labels: 1 year ${figs[0].word}, 5 years ${figs[1].word}, 10 years ${figs[2].word}.${n.paths.mixed ? " This range mixes a few sales with asking prices: call it 'sales and asks', never 'buyers pay'." : ""}`);
  }
  if (n.paths?.buy.isQuote && n.paths.buyer !== "owner") {
    const salesN = salesCount(n);
    const f1 = yearFigures(n.paths, n.paths.buy.price, "used", salesN, n.forward?.lean === "rising").figs[0];
    lines.push(`FLIP AFTER FEES for the client's price (computed; any "sell now" or "flip" figure must be this one, after the typical resale fee): selling right away keeps about $${f1.back}, ${f1.net >= 0 ? "+" : "-"}$${Math.abs(f1.back - n.paths.buy.price)} against the $${n.paths.buy.price} paid${/shipping/i.test(notes ?? "") ? " (before their shipping cost)" : ""}.`);
  }
  // Katie, 2026-10-24: "if you were to get this at the boutique ... sell now and make a ton of money, or keep it as a collector's item and sell in 10 years"
  const hist = n.tiers?.auction_sold ?? [];
  // Katie, 2026-10-25: "are there any other markets I could sell it in where I could make money?": every place this exact version is listed
  // or has sold, highest first, so the answer can name them (asks are asks, auctions are results; fees differ by venue)
  { const bs = n.tiers?.sites_asks?.bySource ?? []; const au = n.tiers?.auction_sold ?? [];
    if (bs.length || au.length) lines.push(`WHERE THIS VERSION IS LISTED OR SOLD (tracker; name these when the client asks where to sell)${bs.length > 6 ? `: ${bs.length} asks from $${Math.min(...bs.map((x) => x.price))} to $${Math.max(...bs.map((x) => x.price))}; the highest are` : ""}: ${[...bs.slice(0, 6).map((x) => `${x.source} asks $${x.price}`), ...au.slice(-3).map((x) => `${x.house} ${x.date.slice(0, 4)} sold $${x.price}`)].join("; ")}. Asks are not sales; a consignor or auction house takes its own fee.`); }
  // Katie, 2026-10-25: there are two Himalayas, palladium and diamond hardware, priced far apart; never mix them, and say which one is priced
  if (/himalaya/.test(norm(`${bag} ${spec ?? ""}`))) lines.push(/diamond/.test(norm(`${bag} ${spec ?? ""}`)) ? `HIMALAYA VERSION: this is the 18k white gold diamond-hardware Himalaya; every price here is for diamond-hardware bags only.` : `HIMALAYA VERSION: priced as the palladium-hardware Himalaya${/palladium/.test(norm(`${bag} ${spec ?? ""}`)) ? "" : " (the client did not name the hardware; say so in one clause)"}; the 18k white gold diamond-hardware version is a separate, much higher price and none of its sales are used here.`);
  if (hist.length) lines.push(`AUCTION HISTORY for this finish (dollar results, as reported; cite them by year, never as a promise): ${hist.map((x) => `${x.date.slice(0, 7)} ${x.house}${x.size ? ` size ${x.size}` : ""} $${x.price}`).join("; ")}.`);
  if (n.paths?.boutique && /himalaya|porosus|diamond/.test(norm(`${bag} ${spec ?? ""}`)) && n.paths.buyer !== "secondhand" && n.paths.buyer !== "owner") lines.push(`COLLECTOR OPTION (Katie, 2026-10-24): for a boutique buyer of a bag this rare, plain_answer gives two clear choices with figures: sell now for the gain above, or keep it as a collector's piece for ten years or more, citing the AUCTION HISTORY years and prices. Ten years is allowed here because the price history exists. Say it is a forecast, never that it will certainly rise; if recent auction results fell, say so in one clause.`);
  if (n.path) lines.push(`Retail path for this size (${n.path.size ?? ""}): $${n.path.from_price} (${n.path.from_date}) → $${n.path.to_price} (${n.path.to_date}).${n.path.last_from ? ` MOST RECENT STEP, the only one to call "the January step": $${n.path.last_from} (${n.path.last_from_date}) → $${n.path.to_price} (${n.path.to_date}), +${(((n.path.to_price - n.path.last_from) / n.path.last_from) * 100).toFixed(1)}%. Quote rises only from this line.` : ""}`);
  {
    const t = n.tiers; const parts: string[] = [];
    parts.push(`(1) Boutique price, the only absolute price: ${n.retail_now ? `$${n.retail_now}${n.retail_size ? ` (${n.retail_size})` : ""}` : n.abroad?.length ? `not sold by US boutiques; the house sells this version abroad at ${n.abroad.join(", ")}. Quote these in their own currency, say no US boutique sells it, and compare any price paid against them as "about N times", never converting to a dollar figure you cannot cite, and never basing a counter on them` : "not in our records"}.`);
    parts.push(`(2) Secondhand websites, averages: ${n.sell ? `sold, average $${n.sell.mean_sold} (median $${n.sell.median_sold}) across ${n.sell.n} sold listings${n.sell.plain ? ", plain leather, not the one asked about" : ""}` : "no matching sold listings"}; ${t?.sites_asks ? `${t?.sourcer_sold ? (t.sourcer_sold.ranges.length && t.sourcer_sold.ranges.length === t.sourcer_sold.n ? `sold through secondhand sourcers, stated as a range: ${t.sourcer_sold.ranges.join("; ")} (${t.sourcer_sold.n} sale${t.sourcer_sold.n === 1 ? "" : "s"}, from ${t.sourcer_sold.sources.join(", ")}; quote the range, there is no single price); ` : `sold through secondhand sourcers (marked placed or sold out, at their listed price), average $${t.sourcer_sold.mean} across ${t.sourcer_sold.n}, from ${t.sourcer_sold.sources.join(", ")}${t.sourcer_sold.ranges.length ? ` (some stated as ranges: ${t.sourcer_sold.ranges.join("; ")})` : ""}; `) : ""}asking, average $${t.sites_asks.mean} (median $${t.sites_asks.median}, $${t.sites_asks.lo} to $${t.sites_asks.hi}) across ${t.sites_asks.n} listings matched on ${t.sites_asks.matched}, from ${t.sites_asks.sources.join(", ")}` : "no matching asks"}.`);
    parts.push(`(3) Private sourcer market (the sourcer sets the price; willingness to pay runs higher): ${t?.private_quotes ? `average $${t.private_quotes.mean} across ${t.private_quotes.n} logged quote${t.private_quotes.n === 1 ? "" : "s"}${t.private_quotes.n < 3 ? ", too few to call an average" : ""}` : "no logged quotes for this bag"}.`);
    lines.push(`THREE PRICES: ${parts.join(" ")} Say every secondhand figure as an average with its count ("averages $21,300 across 25 sold listings"); never call a secondhand figure "the price".`);
  }
  if (n.paths) { const p = n.paths; const h5 = p.horizons[2];
    lines.push(`TWO WAYS IN (state both in timing or plain_answer; arithmetic, not a forecast): worth secondhand today $${p.band.lo} to $${p.band.hi}${p.basisNote.includes("range") ? "" : ` (middle $${p.band.mid})`}, from ${p.basisNote}. (A) From the boutique${p.boutique ? ` at $${p.boutique.price}${p.boutique.label ? ` (${p.boutique.label})` : ""}` : ""}: ${p.boutique ? `that is ${Math.round((p.band.mid / p.boutique.price) * 10) / 10} times the boutique price, so a boutique buyer could resell at once for more than they paid, before fees` : "no boutique price on record"}. (B) Secondhand at $${p.buy.price} (${p.buy.label}): ${p.growthPct != null ? `if secondhand prices keep the boutique's pace of ${p.growthPct}% a year, about $${h5.lo} to $${h5.hi} in five years` : "no boutique pace to project with; if prices hold it stays at today's range"}. Compare that with $${p.buy.price} plainly.`); }
  const fwd = forwardLines(n.forward);
  if (fwd.length) lines.push(`FORWARD READ (lead the five- and ten-year signals with this; it is a forecast, say so): ${fwd.join(" ")}`);
  return lines.length ? section("HEADLINE NUMBERS (the page shows exactly these; your takeaways, plain_answer and signals must use the same figures)", lines) : "";
}

/** Like for like for the access buyer: the exact edition (model + finish words) and size, pristine or tagged, sold in the last 45 days,
 *  against the retail row for that same spec. Null under three sales, so the tile never shows a thin or mismatched number. */
export function sellNow(house: string, bag: string, spec?: string): QuickNumbers["sell"] {
  const db = open(); if (!db) return null;
  const hTerms = houseTerms(house);
  const q = <T extends Row>(sql: string, params: (string | number)[] = []): T[] => { try { return db.prepare(sql).all(...params) as T[]; } catch { return []; } };
  const stop = new Set(["bag", "bags", "the", "and", "with", "flap", "runway", "pieces", "collection", "print", "hobo", "mini", "small", "medium", "large", "maxi", "jumbo"]);
  const rawSpec = norm(spec ?? "").split(" ").filter((w) => w.length > 2 && !stop.has(w) && !/^\d+$/.test(w));
  // finish words match as "any of", with adjacent words also tried joined ("pony hair" → "ponyhair"), because listing titles vary
  // Sam, 2026-10-24: "sellier" or "leather" must not count as a finish match; only leather and finish words narrow the sales
  const FINISH_VOCAB = new Set([...TIER_MATERIALS, "pony", "ponyhair", "calfhair", "calf hair", "monogram", "damier", "epi", "empreinte", "vernis", "jacquard", "denim", "raffia", "nylon", "satin", "velvet", "metallic", "quilted", "matelasse", "intrecciato", "toile", "canvas", "himalaya", "porosus", "niloticus"]);
  const specWords = Array.from(new Set([...rawSpec, ...rawSpec.slice(0, -1).map((w, i) => w + rawSpec[i + 1])])).filter((w) => FINISH_VOCAB.has(w)).slice(0, 6);
  // size: a size word first; else a two-digit number, which is a size ("Birkin 30") unless the name is only the house plus a number ("Chanel 25")
  const all = norm(`${bag} ${spec ?? ""}`);
  const houseWords = new Set(norm(house).split(" "));
  const nameIsHousePlusNumber = !norm(bag).split(" ").some((w) => w.length > 1 && !/^\d+$/.test(w) && !houseWords.has(w));
  let sizeWord: string | null = (all.match(/\b(mini|small|medium|large|maxi|jumbo|tpm|pm|mm|gm)\b/) ?? [])[0] ?? (nameIsHousePlusNumber ? null : ((all.match(/\b\d{2}\b/g) ?? [])[0] ?? null));
  const exotic = /(ostrich|croc|alligator|lizard|porosus|special order|himalaya)/i;
  // "Touch" is Epsom or Madame with an exotic trim (Katie, 2026-10-24): price it from the leather body, and compare with Touch sales.
  const isTouch = /\btouch\b/i.test(`${bag} ${spec ?? ""}`);
  const wantsExotic = exotic.test(spec ?? "") && !isTouch;
  const tryMatch = (words: string[], label: string) => {
    const mm = modelMatch("model", bag, house);
    const anyOf = (col: string) => words.length ? `and (${words.map(() => `lower(replace(${col},' ','')) like ?`).join(" or ")})` : "";
    // no size given: use the house's reference size for this model, so a "Birkin" compares 30 to 30, never special orders
    if (!sizeWord) {
      const ref = q<Row>(`select size_key from retail_reference where ${likeAny("house", hTerms)} and ${mm.sql} and is_reference_size=1 and size_key is not null and size_key <> '' order by effective_date desc limit 1`, [...likeParams(hTerms), ...mm.params])[0];
      if (ref?.size_key) sizeWord = String(ref.size_key).toLowerCase();
    }
    const retailRows = q<Row>(`select price, size_or_spec from retail_reference where ${likeAny("house", hTerms)} and ${mm.sql} and region='US' and price_type in ('current','launch') and coalesce(source_url,'') not like 'private:%' ${wantsExotic ? "" : "and lower(size_or_spec) not like '%ostrich%' and lower(size_or_spec) not like '%croc%' and lower(size_or_spec) not like '%alligator%' and lower(size_or_spec) not like '%lizard%' and lower(size_or_spec) not like '%special order%'"} ${anyOf("size_or_spec")} ${sizeWord ? "and lower(size_or_spec) like ?" : ""} order by effective_date desc`,
      [...likeParams(hTerms), ...mm.params, ...words.map((w) => `%${w}%`), ...(sizeWord ? [`%${sizeWord}%`] : [])]);
    const fin = namedFinishes(bag, spec);
    // the newest boutique row that carries the named finish ("leopard" finds the cheetah pony-hair Mini, not the calfskin one)
    const rr = retailRows.find((r) => fin.every((rx) => rx.test(norm(String(r.size_or_spec ?? "")))));
    if (!rr) return null; retailRows.splice(0, retailRows.length, rr);
    const mg = modelMatch(trrModelCol(bag), bag, house);
    const numericSize = !!sizeWord && /^\d+$/.test(sizeWord);
    const soldRaw = q<Row>(`select price, title, read_date, condition, slug from trr_item_reads where ${likeAny("house", hTerms)} and ${mg.sql} and sold=1 and price is not null and read_date >= date('now','-45 days')
        and (coalesce(condition,'') in ('Pristine','Excellent') or title like '%w/Tags%' or title like '%w/ Tags%')
        ${wantsExotic ? "" : `and (${isTouch ? "lower(title) like '%touch%' or " : ""}(lower(title) not like '%ostrich%' and lower(title) not like '%croc%' and lower(title) not like '%alligator%' and lower(title) not like '%lizard%' and lower(title) not like '%porosus%'))`}
        ${anyOf("title")} ${sizeWord && !numericSize ? "and lower(title) like ?" : ""} order by price`,
      [...likeParams(hTerms), ...mg.params, ...words.map((w) => `%${w}%`), ...(sizeWord && !numericSize ? [`%${sizeWord}%`] : [])]);
    // A numeric size ("30") must be a whole size token in the title, never part of a price or a discount ("$30,000", "30% off").
    const sizeRe = numericSize ? new RegExp(`(^|[^0-9])${sizeWord}(\\s*cm)?($|[^0-9%,.])`) : null;
    const sized = sizeRe ? soldRaw.filter((r) => sizeRe.test(String(r.title ?? "").replace(/\[.*$/, "").toLowerCase().replace(/\$\s*[0-9][0-9,.]*/g, " ").replace(/[0-9]+(\.[0-9]+)?\s*%/g, " "))) : soldRaw;
    // the same sold tile can appear in several reads: count it once (title without the bracketed status, plus price)
    const seen = new Set<string>();
    const askedMats = TIER_MATERIALS.filter((m) => all.includes(m));
    const EXTRA2 = /\b(diamond|himalaya|fringe|feather|sequin|beaded|crystal|strass|shearling|ostrich|lizard|python|alligator|pony|mink|fur|leopard|cheetah|polka|pearl|shells?|nacre)(?:hair)?\b/g; // a plain Chanel 25 Mini never counts the cheetah pony-hair sales
    const seenSlug = new Set<string>();
    const finT = titleFinishes(bag, spec);
    const sold = sized.map((r) => ({ ...r, title: String(r.title ?? "").replace(/\s*\[.*$/, "") }) as Row).filter((r) => noveltyOk(String(r.title ?? ""), all) && classicOk(house, bag, spec, String(r.title ?? "")) && variantOk(house, all, String(r.title ?? "")) && vintageOk(all, String(r.title ?? "")) && itemOk(all, String(r.title ?? "")) && canvasOk(house, all, String(r.title ?? ""))).filter((r) => finT.every((rx) => rx.test(norm(String(r.title ?? ""))))).filter((r) => subModelOk(house, all, String(r.title ?? ""))).filter((r) => !DISTINCT_MODELS.some((w) => norm(String(r.title ?? "")).includes(w) && !all.includes(w)))
      .filter((r) => !askedMats.length || !TIER_MATERIALS.some((m) => !askedMats.includes(m) && norm(String(r.title ?? "")).includes(m))) // no Chèvre or Barenia in an Epsom read
      .filter((r) => [...norm(String(r.title ?? "")).matchAll(EXTRA2)].every((m) => all.includes(m[1]) || (["leopard", "cheetah"].includes(m[1]) && /leopard|cheetah/.test(all)) || (m[1] === "pony" && /leopard|cheetah/.test(all)))) // no diamond-hardware bag in a plain Himalaya read
      .filter((r) => { const sl = slugKey(r.slug); if (!sl) return true; if (seenSlug.has(sl)) return false; seenSlug.add(sl); return true; })
      .filter((r) => r.slug || (() => { const k = `${String(r.title ?? "").replace(/\[.*$/, "").trim().toLowerCase()}|${r.price}`; if (seen.has(k)) return false; seen.add(k); return true; })());
    { const nw = narrowWords(bag, spec, sold.map((r) => String(r.title ?? ""))); if (nw.length) sold.splice(0, sold.length, ...sold.filter((r) => nw.every((w) => new RegExp(`\\b${w}`).test(norm(String(r.title ?? "")))))); }
    if (sold.length < 3) return null;
    const prices = sold.map((r) => r.price as number).sort((a, b) => a - b);
    const dates = sold.map((r) => String(r.read_date)).sort();
    return { retail: retailRows[0].price as number, retail_spec: (retailRows[0].size_or_spec as string) ?? "", median_sold: median(prices), prices, mean_sold: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length), n: prices.length, window_days: 45, matched_on: label,
      lo: prices[0], hi: prices[prices.length - 1], read_from: dates[0], read_to: dates[dates.length - 1], pristine: sold.filter((r) => r.condition === "Pristine").length, plain: label.endsWith(", plain") && TIER_MATERIALS.some((m) => norm(spec ?? "").includes(m)) }; // "plain" only when a leather was asked for and these sales are not it
  };
  const out = (specWords.length ? tryMatch(specWords, `${bag} ${specWords.join(" ")}${sizeWord ? ` ${sizeWord}` : ""}`) : null) ?? tryMatch([], `${bag}${sizeWord ? ` ${sizeWord}` : ""}, plain`);
  db.close();
  return out;
}

/** The anchor: the oldest and newest US reference-size prices within 30 months, when the price went up. */
/** Sourced dates for the forever card (panel, 2026-11-07): the shape's launch year, and a rare finish's first year, each with its source.
 *  Only rows whose note names a source count ("launch_year from PurseBop, …"); "from general knowledge" rows never reach the page. */
function sourcedSince(house: string, bag: string, finish: string | null): { shape: string | null; finish: string | null } {
  const db = open(); if (!db) return { shape: null, finish: null };
  const hTerms = houseTerms(house); const b = norm(bag);
  const site = (u: string) => /sothebys/.test(u) ? "Sotheby's" : /pursebop/.test(u) ? "PurseBop" : /christies/.test(u) ? "Christie's" : (u.match(/\/\/(?:www\.)?([^/]+)/)?.[1] ?? "");
  try {
    const rows = db.prepare(`select model, launch_year, notes from bags where ${likeAny("house", hTerms)} and launch_year is not null`).all(...likeParams(hTerms)) as Row[];
    const src = (r: Row) => String(r.notes ?? "").match(/^launch_year (?:shown as "[^"]+" )?from ([A-Z][\w'’]*)/)?.[1] ?? null;
    const yr = (r: Row) => String(r.notes ?? "").match(/^launch_year shown as "([^"]+)"/)?.[1] ?? String(r.launch_year); // Sotheby's: "In the 1930s"
    const hits = rows.filter((r) => src(r) && new RegExp(`^${norm(String(r.model))}\\b`).test(b)).sort((x, y) => String(y.model).length - String(x.model).length); // the model leads the name: a So Kelly is not the Kelly
    const own = hits[0]; const parent = own ? hits.find((r) => r !== own && norm(String(own.model)).startsWith(norm(String(r.model)))) : undefined;
    const named = (r: Row) => /renaming/.test(String(r.notes ?? "")) ? `${r.model} shape` : /\bfirst: /.test(String(r.notes ?? "")) ? `first ${r.model}` : String(r.model); // the 1930s bag was the Sac à Dépêches, renamed Kelly in 1977
    const gone = (r: Row) => String(r.notes ?? "").match(/discontinued it in (\d{4})/)?.[1];
    const one = (r: Row) => /reintroduced/.test(String(r.notes ?? "")) ? `The ${r.model} returned in ${yr(r)} (${src(r)})`
      : gone(r) ? `The ${named(r)} dates from ${yr(r)}; Hermès discontinued it in ${gone(r)} (${src(r)})` : `The ${named(r)} dates from ${yr(r)} (${src(r)})`;
    // a Mini with no year of its own is never dated from the full-size bag (panel, 2026-11-07)
    const mini = !own ? rows.find((r) => src(r) && new RegExp(`^(mini|micro|nano) ${norm(String(r.model))}\\b`).test(b)) : undefined;
    // the reader's bag first (Margot, 2026-11-10); a first version with a later one names both (Hélène: the first Mini Kelly, 1957; the II, 2016)
    const next = own && !parent ? rows.find((r) => src(r) && /reintroduced/.test(String(r.notes ?? "")) && norm(String(r.model)).startsWith(`${norm(String(own.model))} `)) : undefined;
    const pair = (a: Row, b: Row, aName: string, bName: string) => src(a) === src(b) ? `The ${aName} dates from ${yr(a)}; the ${bName} from ${yr(b)} (${src(a)})` : `The ${aName} dates from ${yr(a)} (${src(a)}); the ${bName} from ${yr(b)} (${src(b)})`;
    const shape = own ? (parent ? pair(own, parent, String(own.model), named(parent)) : next ? pair(own, next, named(own), String(next.model)) : one(own))
      : mini ? `We have no date for the ${b.split(" ")[0].replace(/^./, (c) => c.toUpperCase())}; the ${named(mini)} dates from ${yr(mini)} (${src(mini)})` : null; // the missing date first (Priya)
    let fin: string | null = null;
    if (finish) {
      const ev = (db.prepare(`select event_date, description, source_url from history_events where ${likeAny("house", hTerms)} and category = 'finish-first' order by event_date`).all(...likeParams(hTerms)) as Row[])
        .map((r) => { const [f, m, sz] = String(r.description).split(":")[0].split("|").map((x) => x.trim()); return { f, m, sz, y: String(r.event_date).slice(0, 4), u: String(r.source_url ?? "") }; })
        .filter((r) => norm(r.f) === norm(finish) && new RegExp(`\\b${norm(r.m)}\\b`).test(b));
      const size = b.match(/\b(1[5-9]|[2-4]\d)\b/)?.[1];
      const hit = ev.find((r) => size && r.sz === size && r !== ev[0]) ?? ev[0];
      if (hit) fin = `The ${hit.f} ${hit.m}${hit !== ev[0] ? ` ${hit.sz}` : ""} dates from ${hit.y} (${site(hit.u)})`;
    }
    return { shape, finish: fin };
  } finally { db.close(); }
}

export function pricePath(house: string, bag: string, spec?: string): QuickNumbers["path"] {
  const db = open(); if (!db) return null;
  const hTerms = houseTerms(house); const mm = modelMatch("model", bag, house);
  try {
    const askedAll = norm(`${bag} ${spec ?? ""}`);
    const askSize = askedAll.match(/\b(nano|micro|mini|small|medium|large|maxi|jumbo|teen|pm|mm|gm|bb)\b/)?.[1] ?? askedAll.match(/\b(1[5-9]|[2-4]\d)\b/)?.[1] ?? null;
    const allRows = db.prepare(`select price, effective_date, size_or_spec, is_reference_size from retail_reference where ${likeAny("house", hTerms)} and ${mm.sql} and region='US' and effective_date >= date('now','-30 months') order by effective_date`).all(...likeParams(hTerms), ...mm.params) as Row[];
    const fin = namedFinishes(bag, spec);
    const sizedRows = askSize ? allRows.filter((r) => new RegExp(`\\b${askSize}\\b`).test(norm(String(r.size_or_spec ?? ""))) && fin.every((rx) => rx.test(norm(String(r.size_or_spec ?? ""))))) : [];
    // one leather line only, so a rise is like for like (the most-priced spec for that size)
    const bySpec = new Map<string, Row[]>(); for (const r of sizedRows) { const k = norm(String(r.size_or_spec)); bySpec.set(k, [...(bySpec.get(k) ?? []), r]); }
    // the leather asked (Epsom) across every row of that size that names it, so "25 Epsom Sellier" and "25 Togo Retourne / Epsom Sellier" are one line
    const askedLeather = TIER_MATERIALS.find((m) => askedAll.includes(m));
    const leatherLine = askedLeather ? sizedRows.filter((r) => norm(String(r.size_or_spec ?? "")).includes(askedLeather)) : [];
    const sizedLine = leatherLine.length >= 2 ? leatherLine : [...bySpec.values()].sort((x, y) => y.length - x.length)[0] ?? [];
    const rows = askSize ? sizedLine : allRows.filter((r) => Number(r.is_reference_size) === 1 && fin.every((rx) => rx.test(norm(String(r.size_or_spec ?? "")))));
    db.close();
    if (rows.length < 2) return null;
    const a = rows[0], b = rows[rows.length - 1];
    if ((b.price as number) <= (a.price as number)) return null;
    const steps = rows.slice(1).filter((r, i) => (r.price as number) > (rows[i].price as number)).length;
    const prev = rows[rows.length - 2];
    return { from_price: a.price as number, from_date: String(a.effective_date), to_price: b.price as number, to_date: String(b.effective_date), size: (b.size_or_spec as string) ?? null, steps, last_from: prev ? (prev.price as number) : null, last_from_date: prev ? String(prev.effective_date) : null };
  } catch { db.close(); return null; }
}

/* ---------------- THE BUZZ: cultural-moment layer (buzz_terms / buzz_reads / buzz_events) ---------------- */

export type BuzzNumbers = {
  score: number | null; direction: "rising" | "steady" | "fading" | null; platforms: number; level: "family" | "house" | null;
  detail: string | null; movers: { term: string; platform: string; metric: string; value: number; note: string | null }[];
  events: { date: string; type: string; note: string }[];
  trends: { date: string; note: string; source: string }[];
  read_date: string | null;
};

function bagFamilyTerm(db: DatabaseSync, hTerms: string[], bag: string): string | null {
  const words = norm(bag).split(" ").filter((w) => w.length > 2 && !/^\d+$/.test(w) && !["bag", "bags", "the", "and", "with", "flap"].includes(w));
  if (!words.length) return null;
  try {
    const row = db.prepare(`select family from buzz_terms where ${likeAny("house", hTerms)} and family is not null and (${words.map(() => "lower(family) like ?").join(" or ")}) group by family order by count(*) desc limit 1`)
      .get(...likeParams(hTerms), ...words.map((w) => `%${w}%`)) as Row | undefined;
    return (row?.family as string) ?? null;
  } catch { return null; }
}

export function buzzNumbers(house: string, bag: string, spec?: string): BuzzNumbers | null {
  const db = open(); if (!db) return null;
  const hTerms = houseTerms(house);
  const q = <T extends Row>(sql: string, params: (string | number)[] = []): T[] => { try { return db.prepare(sql).all(...params) as T[]; } catch { return []; } };
  const fam = bagFamilyTerm(db, hTerms, bag);
  const famScore = fam ? q<Row>(`select * from v_buzz_score where ${likeAny("house", hTerms)} and family = ?`, [...likeParams(hTerms), fam])[0] : undefined;
  const houseScore = q<Row>(`select * from v_buzz_score where ${likeAny("house", hTerms)} and family is null`, likeParams(hTerms))[0];
  const sc = famScore ?? houseScore;
  const movers = q<Row>(
    `select t.term, t.platform, t.metric, t.latest as value, r.note, t.read_date from v_buzz_trend t
       join buzz_terms b on b.platform=t.platform and b.term=t.term
       left join buzz_reads r on r.platform=t.platform and r.term=t.term and r.metric=t.metric and r.read_date=t.read_date
      where ${likeAny("b.house", hTerms)} ${fam ? "and b.family = ?" : "and b.family is null"} and t.metric in ('growth_pct_7d','interest_0_100','posts_total','views_7d','posts_7d','videos_7d','mentions_7d','most_viewed_rank_ss27','fw_ss27_engagements','posts_visible') and t.latest is not null
      group by t.platform, t.term, t.metric order by case when t.metric='growth_pct_7d' then 0 else 1 end, abs(t.latest) desc limit 8`,
    [...likeParams(hTerms), ...(fam ? [fam] : [])]);
  // If the family has no hashtag counts yet, borrow the house's so the board always shows what people are posting.
  const hasTags = movers.some((m) => (m.platform === "instagram" || m.platform === "tiktok" || m.platform === "tiktok-cc") && String(m.metric).startsWith("posts"));
  const hasGrowth = movers.some((m) => m.platform === "google" && m.metric === "growth_pct_7d");
  if (fam && !hasGrowth) {
    movers.push(...q<Row>(`select t.term, t.platform, t.metric, t.latest as value, r.note, t.read_date from v_buzz_trend t join buzz_terms b on b.platform=t.platform and b.term=t.term
      left join buzz_reads r on r.platform=t.platform and r.term=t.term and r.metric=t.metric and r.read_date=t.read_date
      where ${likeAny("b.house", hTerms)} and b.family is null and t.platform='google' and t.metric='growth_pct_7d' and t.latest is not null order by abs(t.latest) desc limit 1`, likeParams(hTerms)));
  }
  if (fam && !hasTags) {
    const houseTags = q<Row>(
      `select t.term, t.platform, t.metric, t.latest as value, r.note from v_buzz_trend t
         join buzz_terms b on b.platform=t.platform and b.term=t.term
         left join buzz_reads r on r.platform=t.platform and r.term=t.term and r.metric=t.metric and r.read_date=t.read_date
        where ${likeAny("b.house", hTerms)} and b.family is null and t.platform in ('instagram','tiktok','tiktok-cc') and t.metric in ('posts_total','posts_7d','views_7d','posts_visible') and t.latest is not null
        group by t.platform, t.term, t.metric order by t.latest desc limit 6`, likeParams(hTerms));
    movers.push(...houseTags);
  }
  const eventsAll = q<Row>(`select event_date, event_type, derived_note, material, public_line from buzz_events where ${likeAny("house", hTerms)} ${fam ? "and (family = ? or family is null)" : ""} order by event_date desc limit 25`, [...likeParams(hTerms), ...(fam ? [fam] : [])]);
  const askedFor = norm(`${bag} ${spec ?? ""}`);
  const SAMEMAT: Record<string, string[]> = { suede: ["suede", "doblis", "grizzly"], doblis: ["suede", "doblis", "grizzly"], grizzly: ["suede", "doblis", "grizzly"] }; // Hermès calls its suede doblis or Grizzly (Katie, 2026-10-24)
  // a named finish shows only moments about that finish (Katie: no Kylie bag wall on a Himalaya answer)
  const fins = ["himalaya", "suede", "doblis", "grizzly", "ostrich", "porosus", "niloticus", "crocodile", "lizard", "pony", "mink", "sequin", "fringe", "diamond"].filter((w) => askedFor.includes(w));
  const events = eventsAll.filter((e) => fins.length ? fins.some((w) => norm(`${e.material ?? ""} ${e.derived_note ?? ""} ${e.public_line ?? ""}`).includes(w)) : (!e.material || (SAMEMAT[String(e.material)] ?? [String(e.material)]).some((m) => askedFor.includes(m)))).slice(0, 5);
  const trends = q<Row>(`select scan_date, derived_note, source from daily_signals where (${likeAny("house", hTerms)} or house in ('Multi','Culture')) and (signal like 'tiktok%' or signal like '%viral%' or signal like '%trend%' or signal like 'fashion_month%' or signal like 'buyer_pick' or signal like 'bestseller%') and scan_date >= date('now','-45 days') order by scan_date desc limit 6`, likeParams(hTerms));
  db.close();
  if (!sc && !movers.length && !events.length && !trends.length) return null;
  return {
    score: (sc?.buzz_0_100 as number) ?? null, direction: ((sc?.direction as string) ?? null) as BuzzNumbers["direction"], platforms: (sc?.platforms as number) ?? 0,
    level: famScore ? "family" : houseScore ? "house" : null, detail: (sc?.detail as string) ?? null,
    movers: movers.map((m) => ({ term: m.term as string, platform: m.platform as string, metric: m.metric as string, value: m.value as number, note: (m.note as string) ?? null })),
    // Katie, 2026-10-24: a moment about one leather (the suede Birkin) shows only for that leather, and customers read a plain sentence
    events: events.map((e) => ({ date: e.event_date as string, type: e.event_type as string, note: (e.public_line as string) || String(e.derived_note ?? "").split(/(?<=[.;])\s/)[0].slice(0, 160) })),
    trends: trends.map((t) => ({ date: t.scan_date as string, note: t.derived_note as string, source: t.source as string })),
    read_date: (movers[0]?.read_date as string | undefined) ?? (trends[0]?.scan_date as string | undefined) ?? null,
  };
}

/** Text block for the research dossier. */
export function buzzDossier(house: string, bag: string): string {
  const b = buzzNumbers(house, bag);
  if (!b) return "";
  const lines: string[] = [];
  lines.push(`Buzz score ${b.score ?? "n/a"}/100 (${b.direction ?? "no direction yet"}; ${b.platforms} platform${b.platforms === 1 ? "" : "s"}; ${b.level === "family" ? "bag-family level" : "house level, no bag-specific terms yet"}). Formula: 50 + 0.35×week-over-week growth% + volume bonus, averaged across platforms. One platform = weak read.`);
  for (const m of b.movers) lines.push(`${m.platform} · "${m.term}" · ${m.metric} = ${m.value}${m.note ? ` (${m.note})` : ""}`);
  for (const e of b.events) lines.push(`event ${e.date} · ${e.type}: ${e.note}`);
  return section("BUZZ (tracker: Google Trends week-over-week, TikTok/Instagram reads, logged events; derived numbers only)", lines);
}

/** Runway-to-market evidence for collection / pre-order questions: the show, how often each bag walked, delivery window,
 *  and precedent: what this house's recent new bags did on resale once they landed. */
export function collectionDossier(house: string, season?: string): string {
  const db = open(); if (!db) return "";
  const hTerms = houseTerms(house);
  const q = <T extends Row>(sql: string, params: (string | number)[] = []): T[] => { try { return db.prepare(sql).all(...params) as T[]; } catch { return []; } };
  const notes = q<Row>(`select season, show_date, designer, new_bag_families, returning_icons, novelty_count, archive_refs, press_read, in_store_window, source_urls from show_notes where ${likeAny("house", hTerms)} order by show_date desc limit 2`, likeParams(hTerms));
  const seasons = q<Row>(`select season, show_date, expected_in_store, count(*) looks_with_bags, count(distinct model_guess) distinct_bags, max(source_url) source_url from runway_pipeline where ${likeAny("house", hTerms)} group by season order by show_date desc limit 3`, likeParams(hTerms));
  const latest = seasons[0]?.season as string | undefined;
  const fams = latest ? q<Row>(`select model_guess, count(*) looks, group_concat(distinct material) materials, group_concat(distinct novelty) novelty from runway_pipeline where ${likeAny("house", hTerms)} and season = ? group by model_guess order by looks desc limit 14`, [...likeParams(hTerms), latest]) : [];
  const famRows = q<Row>(`select family, n_looks, look_numbers, description from bag_families where ${likeAny("house", hTerms)} and (family like '%SS27%' or family like '%Spring 2027%' or family like '%Resort 27%') order by n_looks desc limit 14`, likeParams(hTerms));
  const precedent = q<Row>(`select model, matched_size, retail_now, n_sold_same_size, median_sold, sold_pct_of_retail, last_read from v_sold_vs_retail where ${likeAny("house", hTerms)} order by last_read desc limit 12`, likeParams(hTerms));
  const traj = q<Row>(`select model_guess, trajectory, count(*) n, round(avg(pct_change_since_first),1) avg_pct from item_trajectories where ${likeAny("house", hTerms)} and times_seen > 1 group by 1,2 order by n desc limit 16`, likeParams(hTerms));
  const prices = q<Row>(`select model, year, retail_that_year from v_retail_history where ${likeAny("house", hTerms)} order by model, year limit 40`, likeParams(hTerms));
  const cds = q<Row>(`select * from creative_directors where ${likeAny("house", hTerms)} order by rowid desc limit 2`, likeParams(hTerms));
  db.close();
  if (!notes.length && !seasons.length) return "";
  const out: string[] = [];
  out.push(section(`COLLECTION PIPELINE (tracker: Vogue Runway look-by-look capture${season ? `; client asked about ${season}` : ""})`, [
    ...seasons.map((r) => `${r.season}: shown ${r.show_date}; ${r.looks_with_bags} looks carried a bag, ${r.distinct_bags} distinct bags; expected in store ${r.expected_in_store ?? "unknown"} (${r.source_url})`),
    ...notes.map((n) => `Show notes ${n.season} (${n.show_date}, ${n.designer}): new families: ${n.new_bag_families}. Returning icons: ${n.returning_icons ?? "n/a"}. Novelty count ${n.novelty_count}. Archive refs: ${n.archive_refs ?? "n/a"}. Press read: ${n.press_read ?? "n/a"}. In-store window: ${n.in_store_window ?? "unknown"}. Sources: ${n.source_urls}`),
  ]));
  out.push(section("How often each bag walked (more looks = commercial pillar the house will produce in volume; 1–2 looks = runway special, scarce)", [
    ...famRows.map((f) => `${f.family}: ${f.n_looks} looks (${f.look_numbers}). ${f.description}`),
    ...(famRows.length ? [] : fams.map((f) => `${f.model_guess}: ${f.looks} looks; materials ${f.materials}; novelty ${f.novelty}`)),
  ]));
  out.push(section("PRECEDENT: what this house's bags did once they reached resale (size-matched confirmed sales vs today's retail)", precedent.map((p) => `${p.model} ${p.matched_size ?? ""}: ${p.n_sold_same_size} sold, median $${p.median_sold} = ${p.sold_pct_of_retail}% of $${p.retail_now} retail (last read ${p.last_read})`)));
  out.push(section("PRECEDENT: listing trajectories on The RealReal (asks raised / marked down / sold, per model)", traj.map((t) => `${t.model_guess}: ${t.trajectory} ×${t.n}${t.avg_pct != null ? ` (avg ${t.avg_pct}% since first seen)` : ""}`)));
  out.push(section("Retail price path by year (US reference size)", prices.map((p) => `${p.model} ${p.year}: $${p.retail_that_year}`)));
  if (cds.length) out.push(section("Creative director (tracker)", cds.map((c) => JSON.stringify(c))));
  return out.filter(Boolean).join("\n\n");
}

/** The race board: one row per house, from sold prices (holds value) and sell-through/saves (heat). */
export type RaceRow = { house: string; models: number; sales: number; sold_pct: number | null; heat: number | null; delist_pct: number | null; saves: number | null; sold_90d: number; thin: boolean };
export function raceBoard(): RaceRow[] {
  const db = open(); if (!db) return [];
  try {
    const rows = db.prepare(`
      with hold as (select house, count(*) models, sum(n_sold_same_size) sales, round(avg(sold_pct_of_retail)) sold_pct from v_sold_vs_retail group by house),
      heat as (select house, round(avg(cast(nullif(rtrim(substr(substr(title, instr(title,'saves=')+6), 1, 6), ';] abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ,'),'') as real))) saves, sum(sold) sold90 from trr_item_reads where read_date >= date('now','-90 days') group by house),
      dl as (select brand house, round(100.0*sum(gone)/sum(listed_before),1) delist from v_disappearance group by brand)
      select h.house, h.models, h.sales, h.sold_pct, t.saves, t.sold90, d.delist
      from hold h left join heat t on t.house=h.house left join dl d on d.house=h.house order by h.sold_pct desc`).all() as Row[];
    db.close();
    return rows.map((r) => ({ house: String(r.house), models: Number(r.models), sales: Number(r.sales ?? 0), thin: Number(r.models) < 2 || Number(r.sales ?? 0) < 30, sold_pct: (r.sold_pct as number) ?? null, saves: (r.saves as number) ?? null, sold_90d: Number(r.sold90 ?? 0), delist_pct: (r.delist as number) ?? null,
      heat: r.saves != null ? Math.round(Math.min(100, (r.saves as number) * 1.2 + ((r.delist as number) ?? 0))) : null }));
  } catch { db.close(); return []; }
}


/** PESTEL watch list (tracker table pestel_watch): the macro layer's standing evidence. */
export function pestelDossier(house: string): string {
  const db = open(); if (!db) return "";
  const q = <T extends Row>(sql: string, params: (string | number)[] = []): T[] => { try { return db.prepare(sql).all(...params) as T[]; } catch { return []; } };
  const rows = q<Row>(`select dimension, item, region, status, direction, why_it_matters, houses, next_check, source_name, source_url, updated_at from pestel_watch where active=1 order by case status when 'active' then 0 else 1 end, dimension`);
  const recent = q<Row>(`select date, category, description, houses_affected, source_url from macro_events where date >= date('now','-45 days') order by date desc limit 8`);
  db.close();
  if (!rows.length && !recent.length) return "";
  const rel = (h: string | null) => !h || /all/i.test(h) || h.toLowerCase().includes(house.toLowerCase().slice(0, 5));
  const lines = rows.map((r) => `${r.dimension} · ${r.status}${r.direction ? ` (${r.direction})` : ""}${rel(r.houses as string) ? " · RELEVANT TO THIS HOUSE" : ""}: ${r.item}. Why: ${r.why_it_matters} [${r.source_name}, updated ${String(r.updated_at).slice(0, 10)}; ${r.source_url}]`);
  const ev = recent.map((e) => `${e.date} · ${e.category}: ${e.description} (${e.houses_affected ?? "n/a"}) ${e.source_url}`);
  return [section("PESTEL WATCH (tracker: standing list of world factors that move bag values; use for the macro layer and for timing)", lines), ev.length ? section("Recent macro events (last 45 days)", ev) : ""].filter(Boolean).join("\n\n");
}


/** Who controls the house and what they just decided (tracker: ownership_map + stakeholder_decisions). */
export function ownershipDossier(house: string): string {
  const db = open(); if (!db) return "";
  const hTerms = houseTerms(house);
  const q = <T extends Row>(sql: string, params: (string | number)[] = []): T[] => { try { return db.prepare(sql).all(...params) as T[]; } catch { return []; } };
  const o = q<Row>(`select * from ownership_map where ${likeAny("house", hTerms)} limit 1`, likeParams(hTerms))[0];
  const parent = o?.parent as string | undefined;
  const siblings = parent ? q<Row>(`select house, creative_director, last_major_decision, decision_date from ownership_map where parent = ? and house <> ?`, [parent, o!.house as string]) : [];
  const dec = q<Row>(`select decision_date, house, actor, decision, implication_for_bags, source_name, source_url from stakeholder_decisions where ${likeAny("house", hTerms)} ${parent ? "or house in (select house from ownership_map where parent = ?)" : ""} order by decision_date desc limit 8`, [...likeParams(hTerms), ...(parent ? [parent] : [])]);
  db.close();
  if (!o) return "";
  const lines = [
    `${o.house}: parent ${o.parent ?? "independent"}${o.listed ? ` (listed, ${o.ticker})` : " (private)"}. Controlling holder: ${o.controlling_holder} via ${o.holder_vehicle}${o.stake_capital_pct != null ? `, ${o.stake_capital_pct}% of capital / ${o.stake_votes_pct}% of votes as of ${o.stake_as_of}` : ""}. [${o.source_name}; ${o.source_url}; confidence ${o.confidence}]`,
    `Decision-makers: chair ${o.chair}; CEO ${o.ceo}${o.fashion_president && o.fashion_president !== "—" ? `; fashion president ${o.fashion_president}` : ""}; creative director ${o.creative_director} (since ${o.cd_since}).`,
    `Succession: ${o.succession_notes}`,
    `Cross-holdings: ${o.cross_holdings}`,
    `Last major decision (${o.decision_date}): ${o.last_major_decision}. Implication for bags: ${o.implication_for_bags}`,
    ...(siblings.length ? [`Sister houses under the same owner: ${siblings.map((s) => `${s.house} (${s.creative_director}; ${s.last_major_decision}, ${s.decision_date})`).join(" · ")}`] : []),
    ...dec.map((d) => `Decision log ${d.decision_date} · ${d.house} · ${d.actor}: ${d.decision}. → ${d.implication_for_bags} [${d.source_name}; ${d.source_url}]`),
  ];
  return section("OWNERSHIP & STAKEHOLDERS (tracker: who controls the house, who decides, what they decided)", lines);
}


/** Where the real thing can be seen: the house's own product page (if the reference price came from one) and the latest runway look. */
export function bagLinks(house: string, bag: string): { house_url: string | null; runway_url: string | null } {
  const db = open(); if (!db) return { house_url: null, runway_url: null };
  const hTerms = houseTerms(house); const mm = modelMatch("model", bag, house);
  const g = <T extends Row>(sql: string, params: (string | number)[] = []): T | undefined => { try { return db.prepare(sql).get(...params) as T | undefined; } catch { return undefined; } };
  const hp = g<Row>(`select source_url from retail_reference where ${likeAny("house", hTerms)} and ${mm.sql} and (source_url like '%/product%' or source_url like '%/products/%' or source_url like '%/p/%') and source_url not like 'private:%' order by effective_date desc limit 1`, [...likeParams(hTerms), ...mm.params]);
  const rw = g<Row>(`select source_url from runway_pipeline where ${likeAny("house", hTerms)} and (${modelMatch('model_guess', bag, house).sql} or ${modelMatch('bag_description', bag, house).sql}) and source_url like '%vogue.com%' order by show_date desc limit 1`, [...likeParams(hTerms), ...modelMatch('model_guess', bag, house).params, ...modelMatch('bag_description', bag, house).params]);
  db.close();
  return { house_url: (hp?.source_url as string) ?? null, runway_url: (rw?.source_url as string) ?? null };
}


/** Every bag with a current boutique price, for the Browse page. */
/** The masthead ticker (Katie, 2026-10-25): market news, never our workings. The houses, hot bags, what social listening heard, the economy,
 *  the best sales clocked, sold out at the boutique, the shows. Never counts of what we collect or where we read it. */
export function tickerLines(): string[] {
  const db = open(); if (!db) return [];
  const all = <T extends Row>(sql: string): T[] => { try { return db.prepare(sql).all() as T[]; } catch { return []; } };
  const usd = (n: unknown) => `$${Math.round(Number(n)).toLocaleString("en-US")}`;
  const clean = (t: unknown) => String(t ?? "").replace(/\s*\[.*$/, "").replace(/\s*w\/\s*tags?/i, "").trim();
  // sourced editorial lines, written only from facts we opened and stored
  const notes = all<Row>(`select kind, line from ticker_notes where expires is null or expires >= date('now') order by note_date desc, id`);
  const sales: string[] = [];
  // the top sale this week, and the best one for a bag that sold years after its stamp
  const week = all<Row>(`select house, title, price from trr_item_reads where sold=1 and price > 0 and read_date >= date('now','-7 days') order by price desc limit 40`);
  const top = week[0];
  if (top) sales.push(`Top sale this week: ${top.house} ${clean(top.title)}, ${usd(top.price)}`);
  const yr = new Date().getFullYear();
  const held = week.find((r) => r !== top && Number(clean(r.title).match(/^(19|20)\d\d\b/)?.[0] ?? yr) <= yr - 3);
  if (held) { const t = clean(held.title); sales.push(`Sold this week, ${yr - Number(t.slice(0, 4))} years after its stamp: a ${t.slice(0, 4)} ${held.house} ${t.slice(5)}, ${usd(held.price)}`); }
  const auc = all<Row>(`select house, model_guess m, size_guess s, hammer_price p, auction_house a from auction_results where sold=1 and hammer_price > 0 and sale_date >= date('now','-45 days') order by hammer_price desc limit 1`)[0];
  if (auc) sales.push(`At auction: ${auc.house} ${auc.m}${auc.s ? ` ${auc.s}` : ""}, ${usd(auc.p)} at ${auc.a}`);
  // signal key: out of stock at the boutique = demand
  const out = all<Row>(`select house, model, max(material) material from retail_availability_reads where availability like 'out of stock%' and read_date >= date('now','-14 days') group by house, model order by max(read_date) desc limit 2`)
    .map((r) => { const m = String(r.material ?? "").toLowerCase().replace(/-effect/g, "").split(" ").slice(0, 7).join(" "); return `Sold out at ${r.house}: the ${r.model}${m ? ` in ${m}` : ""}`; });
  const best = all<Row>(`select house, model, sold_pct_of_retail p from v_sold_vs_retail where n_sold_same_size >= 5 order by sold_pct_of_retail desc limit 1`)[0];
  const hold = best ? [`Holding value best: the ${best.house} ${best.model}, reselling at ${Math.round(Number(best.p))}% of its boutique price`] : [];
  const buzz = all<Row>(`select house, family, event_type from buzz_events where event_type in ('celebrity_carry','viral_video','dupe_wave','backlash') and event_date >= date('now','-30 days') order by event_date desc limit 1`)
    .map((e) => `The talk: ${e.house}${e.family ? ` ${e.family}` : ""}, ${({ viral_video: "a viral video", dupe_wave: "a dupe wave", backlash: "backlash", celebrity_carry: "a celebrity carry" } as Record<string, string>)[String(e.event_type)]}`);
  const people = all<Row>(`select headline from people_moves order by id desc limit 1`).map((m) => String(m.headline).slice(0, 90));
  db.close();
  // interleave so no two of a kind sit side by side
  const groups = [notes.filter((n) => n.kind === "auction" || n.kind === "hot bag").map((n) => String(n.line)), sales, notes.filter((n) => n.kind === "runway").map((n) => String(n.line)),
    out, notes.filter((n) => !["auction", "hot bag", "runway"].includes(String(n.kind))).map((n) => String(n.line)), hold, buzz, people];
  const lines: string[] = [];
  for (let i = 0; groups.some((g) => g[i]); i++) for (const g of groups) if (g[i]) lines.push(g[i]);
  return lines;
}

export type CatalogueRow = { house: string; model: string; retail_now: number | null; sold_pct: number | null; sold_n: number; launch_year: number | null };
export function catalogue(): CatalogueRow[] {
  const db = open(); if (!db) return [];
  const q = <T extends Row>(sql: string): T[] => { try { return db.prepare(sql).all() as T[]; } catch { return []; } };
  const rows = q<Row>(`select c.house, c.model, min(c.retail_now) retail_now,
       (select sold_pct_of_retail from v_sold_vs_retail s where s.house=c.house and s.model=c.model limit 1) sold_pct,
       (select n_sold_same_size from v_sold_vs_retail s where s.house=c.house and s.model=c.model limit 1) sold_n,
       (select launch_year from bags b where b.house=c.house and lower(b.model)=lower(c.model) and b.launch_year is not null limit 1) launch_year
     from v_retail_current c group by c.house, c.model
     order by case c.house when 'Hermès' then 0 when 'Chanel' then 1 when 'Louis Vuitton' then 2 when 'Dior' then 3 when 'Bottega Veneta' then 4 when 'The Row' then 5 when 'Loewe' then 6 when 'Celine' then 7 else 9 end, c.house, c.model`);
  db.close();
  return rows.map((r) => ({ house: r.house as string, model: r.model as string, retail_now: (r.retail_now as number) ?? null, sold_pct: (r.sold_pct as number) ?? null, sold_n: (r.sold_n as number) ?? 0, launch_year: (r.launch_year as number) ?? null }));
}

/** Guardrail (Katie, 2026-10-24: "how do we create guardrails so these mistakes don't keep happening?"). Before an answer skips the web,
 *  check the tracker holds prices for the exact version asked about: its finish (Himalaya, diamond hardware, crocodile, ostrich, fringe,
 *  suede...) as well as the model. Plain Birkins must never stand in for a Himalaya, nor plain Saddles for a fringe Night Bag. */
/** The finishes a question names (Himalaya, diamond, crocodile, fringe...), each as a test a title or boutique row must pass. */
/** For listing titles: a print the client named passes a title that names no print at all (many sale titles drop "cheetah"),
 *  but never a title naming a different print. Boutique and catalogue rows still need the print itself. */
const PRINT_WORDS = /\b(leopard|cheetah|animal print|polka|zebra|tiger|snake print|python print|giraffe)/;
export function titleFinishes(bag: string, spec?: string): RegExp[] {
  // lenient only when the material that carries the print is named too ("cheetah pony hair"); "leopard Mini 25" alone needs the print in the title
  const all = namedFinishes(bag, spec); const hasMaterial = all.some((rx) => !/leopard|polka/.test(rx.source));
  // a title naming only a solid colour is a solid bag, never the print (snapshot, 2026-10-26: Black and Dark Khaki pony-hair Mini 25s at
  // $8,995-$12,995 were counted as cheetah ones); beige, brown or neutrals stay possible, since sale titles drop "cheetah"
  const solidOnly = (t: string) => /\b(black|khaki|white|ivory|pink|red|blue|green|grey|gray|navy|purple|burgundy|silver)\b/.test(t) && !/\b(beige|brown|neutrals?|tan|camel|multi\w*)\b/.test(t);
  return all.map((rx) => /leopard|polka/.test(rx.source) ? { test: (t: string) => rx.test(t) || (!PRINT_WORDS.test(t) && !solidOnly(t) && (hasMaterial || /\bpony(hair)?\b|calf ?hair|haircalf/.test(t))) } as unknown as RegExp : rx);
}
export function namedFinishes(bag: string, spec?: string): RegExp[] {
  const asked = norm(`${bag} ${spec ?? ""}`);
  if (/\btouch\b/.test(asked)) return [];
  const found = FINISH_KEYS.filter(([, rx]) => rx.test(asked));
  // a fur bag the photo reader calls "mink/pony-style" is fur: pony is then a look, not a second finish
  // Himalaya is always niloticus crocodile, so a title saying only "Himalayan" counts (Privé Porter's $298,000 Birkin 25 was missed)
  // mother of pearl decides on its own: its beads or crystals are part of it, never a second finish (Sam, round 15: l2 missed the $7,500 sale)
  // Katie, 2026-10-25: a fringe bag's beads or feathers ARE its fringe (the pink glass-bead fringe Saddle Night Bag, a private purchase,
  // titled "fishnet fringe", was missed when the reader said "fringe/feather" and "bead"): fringe decides on its own. Dior's own receipt
  // says "embroidered with teardrop sequins" for the same fringe, so sequins on a fringe bag are its fringe too (2026-10-31)
  return found.filter(([k]) => !((k === "beaded" || k === "feather" || k === "sequin") && found.some(([g]) => g === "fringe"))).filter(([k]) => !((k === "beaded" || k === "crystal") && found.some(([g]) => g === "mother of pearl"))).filter(([k]) => ((k !== "niloticus" && k !== "crocodile") || !found.some(([g]) => g === "himalaya")) && (k !== "pony hair" || !found.some(([g]) => g === "fur")) && (k !== "shearling" || !found.some(([g]) => g === "fur"))).map(([, rx]) => rx);
}
export type EvidenceCheck = { finish: string | null; retail: number; prices: number; gap: boolean; why: string };
const FINISH_KEYS: [string, RegExp][] = [
  ["himalaya", /himalaya/], ["diamond", /diamond/], ["porosus", /porosus/], ["niloticus", /niloticus/], ["alligator", /^(?!.*\b(embossed|stamped)\b).*(alligator|\bgator\b)/],
  // embossed is calfskin with a pattern, never the skin it copies (panel on Katie's Chanel dossier, 2026-10-31: 16 embossed Chanel listings
  // were counted as real lizard or croc). Chanel prices it apart: 26K Small Shopping Bag $6,900 croc-embossed vs $6,700 smooth (PurseBop 2026-10-16)
  ["embossed", /\b(embossed|stamped)\b/],
  ["crocodile", /^(?!.*\b(embossed|stamped)\b).*(crocodile|\bcroc\b)/], ["ostrich", /ostrich/], ["lizard", /^(?!.*\b(embossed|stamped)\b).*lizard/], ["python", /^(?!.*\b(embossed|stamped)\b).*python/], ["fringe", /fringe/], ["feather", /feather/],
  ["sequin", /sequin|paillette/], ["beaded", /bead/], ["crystal", /crystal|strass/], ["suede", /suede|doblis|grizzly/], ["shearling", /shearling/],
  // Sam, round 5: pony hair and fur are priced finishes too (Chanel 25 cheetah pony hair $8,400 vs $6,600 calfskin; Baguette mink $12,400)
  ["fur", /\bmink\b|\bfur\b|\bsable\b|\bfox\b|chinchilla|swakara|astrakhan|karakul|persian lamb|broadtail/], ["pony hair", /\bpony(hair)?\b|calf ?hair|haircalf|cavallino/],
  // prints are priced finishes too: leopard and cheetah are one print to a buyer; polka dots are not cheetah (Sam, round 6)
  ["animal print", /\b(leopard|cheetah|animal print)\b/], ["polka dot", /\bpolka/],
  // Katie, 2026-10-24: a mother-of-pearl Baguette is not a denim Baguette ($7,500 Fair on The RealReal vs about $2,400 plain denim)
  ["mother of pearl", /mother.of.pearl|\bnacre\b|\bshells?\b/],
  // Katie, 2026-10-25: Dior's newspaper print (Anderson's 2026 Saddle, Bow, D-Joy, Rodeo; Galliano's originals) is its own price, never a
  // plain Saddle; the Daniel Arsham collaboration's newspaper print is a different bag
  ["newspaper", /^(?!.*\barsham\b).*\b(newspaper|gazette)\b/],
  // Katie, 2026-10-25: a knit or crochet bag (the cream bobble-knit Mamma) is its own price, never a leather or canvas one
  ["knit", /\b(knit|knitted|crochet|pom ?poms?|bobble)\b/],
];
export function evidenceCheck(house: string, bag: string, spec?: string): EvidenceCheck {
  const asked = norm(`${bag} ${spec ?? ""}`);
  const isTouch = /\btouch\b/.test(asked);
  const found = FINISH_KEYS.filter(([, rx]) => rx.test(asked)).map(([k, rx]) => ({ k, rx }));
  const key = isTouch ? null : found[0] ?? null;
  if (!key) { // no special finish: still a gap if we hold fewer than three prices for this model in this size (Katie: "we should never not have a solution")
    const db0 = open(); if (!db0) return { finish: null, retail: 0, prices: 0, gap: true, why: "tracker not available" };
    try {
      const hT = houseTerms(house); const tm0 = modelMatch("title", bag, house);
      const sz = asked.match(/\b(nano|micro|mini|small|medium|large|maxi|jumbo|teen|pm|mm|gm|bb|1[5-9]|[2-4]\d)\b/)?.[1] ?? null;
      const t0 = [...(db0.prepare(`select title from resale_listings where coalesce(currency,'USD')='USD' and ${likeAny("brand", hT)} and ${tm0.sql} and price > 0 and last_seen >= date('now','-120 days')`).all(...likeParams(hT), ...tm0.params) as Row[]),
                  ...(db0.prepare(`select title from trr_item_reads where ${likeAny("house", hT)} and ${tm0.sql} and price > 0 and read_date >= date('now','-120 days')`).all(...likeParams(hT), ...tm0.params) as Row[])]
        .map((r) => norm(String(r.title ?? ""))).filter((t) => !sz || new RegExp(`\\b${sz}\\b`).test(t));
      return { finish: null, retail: 0, prices: t0.length, gap: t0.length < 3, why: t0.length < 3 ? `the tracker holds ${t0.length} secondhand price${t0.length === 1 ? "" : "s"} for a ${bag}${sz ? ` in size ${sz}` : ""}` : "" };
    } catch { return { finish: null, retail: 0, prices: 0, gap: false, why: "" }; } finally { db0.close(); }
  }
  const db = open(); if (!db) return { finish: key.k, retail: 0, prices: 0, gap: true, why: "tracker not available" };
  try {
    const hTerms = houseTerms(house); const mm = modelMatch("model", bag, house); const tm = modelMatch("title", bag, house);
    const titles = [
      ...(db.prepare(`select title from resale_listings where coalesce(currency,'USD')='USD' and ${likeAny("brand", hTerms)} and ${tm.sql} and price > 0 and coalesce(tags,'') not like '%duplicate of%' and last_seen >= date('now','-120 days')`).all(...likeParams(hTerms), ...tm.params) as Row[]),
      ...(db.prepare(`select title from trr_item_reads where ${likeAny("house", hTerms)} and ${tm.sql} and price > 0 and read_date >= date('now','-120 days')`).all(...likeParams(hTerms), ...tm.params) as Row[]),
    ].map((r) => norm(String(r.title ?? "")));
    const retailSpecs = (db.prepare(`select size_or_spec from retail_reference where ${likeAny("house", hTerms)} and ${mm.sql} and price_type='current'`).all(...likeParams(hTerms), ...mm.params) as Row[]).map((r) => norm(String(r.size_or_spec ?? "")));
    const all = found.filter((f) => f.k !== "niloticus" || !found.some((g) => g.k === "himalaya")); // every finish named must agree
    const ok = (t: string) => all.every((f) => f.rx.test(t));
    const prices = titles.filter(ok).length, retail = retailSpecs.filter(ok).length;
    const gap = prices < 3 || retail === 0;
    const why = gap ? `the tracker holds ${prices} secondhand price${prices === 1 ? "" : "s"} and ${retail === 0 ? "no boutique price" : `${retail} boutique price${retail === 1 ? "" : "s"}`} for a ${bag} in ${all.map((f) => f.k).join(" + ")}` : "";
    return { finish: all.map((f) => f.k).join(" + "), retail, prices, gap, why };
  } catch { return { finish: key.k, retail: 0, prices: 0, gap: true, why: "check failed" }; } finally { db.close(); }
}

/** Web findings for an exact version (house + bag + finish), written by the answer pipeline's gap search and read back next time. */
function writable(): DatabaseSync | null { try { const p = process.env.TRACKER_DB_PATH ?? DEFAULT_DB; return fs.existsSync(p) ? new DatabaseSync(p) : null; } catch { return null; } }
/** Refusals and tool-limit notes stored before 2026-10-25 are dropped when findings are read back (Sam, round 20). */
const REFUSAL = /\b(i cannot|i can'?t|i'?m unable|unable to (find|access|verify)|tool use limit|limit (was |has been )?exceeded|i don'?t have (verified|access|enough)|resend|send another message|could you please)\b/i;
export function saveWebFinding(house: string, bag: string, finish: string, text: string, sources: { title: string; url: string }[], unpriced = false) {
  const db = writable(); if (!db) return;
  try {
    db.exec(`create table if not exists web_findings(id integer primary key, house text, bag text, finish text, found_at text, text text, sources text)`);
    // keep findings only, never the model's working notes ("Let me…", "It's a JSON string…")
    const NOTE = /\b(let me|i'?ll|i will|i need|i cannot|i can'?t|i'?m unable|unable to|i'?ve (hit|used|exhausted)|search (limit|budget)|tool use limit|limit (was |has been )?exceeded|now i|it'?s a json|searching|no price shown|this turn|this pass)\b/i; // Sam, round 20: refusal text was kept
    const fromHeading = text.includes("#") ? text.slice(text.search(/(^|\n|\.)\s*#/) + 1).replace(/^\s*#/, "#") : text; // the model's preamble ends at its first heading
    const clean = fromHeading.split("\n").map((l) => l.split(/(?<=[.!?])\s+/).filter((x) => !NOTE.test(x)).join(" ")).filter((l) => l.trim()).join("\n").trim();
    if (!unpriced && !/\$\s?\d|€\s?\d|\d{2,3},\d{3}/.test(clean)) return; // nothing priced: nothing worth keeping (cultural standing is kept without prices)
    db.prepare(`insert into web_findings(house, bag, finish, found_at, text, sources) values(?,?,?,datetime('now'),?,?)`).run(house, bag, finish, clean.slice(0, 6000), JSON.stringify(sources.slice(0, 20)));
  } finally { db.close(); }
}
export function webFindings(house: string, bag: string, finish: string): string {
  const db = open(); if (!db) return "";
  try {
    const mm = modelMatch("bag", bag, house);
    const rows = (db.prepare(`select found_at, text, sources from web_findings where ${likeAny("house", houseTerms(house))} and ${mm.sql} and finish = ? and found_at >= datetime('now','-30 days') order by found_at desc limit 2`).all(...likeParams(houseTerms(house)), ...mm.params, finish) as Row[]).map((r) => ({ ...r, text: String(r.text ?? "").split(/(?<=[.!?])\s+/).filter((x) => !REFUSAL.test(x)).join(" ") }) as Row);
    return rows.map((r) => `(${String(r.found_at).slice(0, 10)}) ${String(r.text).slice(0, 2500)}\nSources: ${(JSON.parse(String(r.sources ?? "[]")) as { url: string }[]).map((x) => x.url).slice(0, 6).join(", ")}`).join("\n\n");
  } catch { return ""; } finally { db.close(); }
}

/** Bags from each house's newest runway season (shown in the last 120 days), so the photo reader can name a runway or re-see bag. */
export function runwayHints(): string {
  const db = open(); if (!db) return "";
  try {
    // every season still reaching stores (Katie, 2026-10-24: a cruise 2027 frame-top Saddle was read as vintage Galliano), with what makes each new take recognisable
    const rows = db.prepare(`select house, season, model_guess, max(colour) colour, max(material) material, max(hardware) hardware, max(novelty) novelty from runway_pipeline where show_date >= date('now','-240 days') and model_guess is not null and model_guess not in ('unknown') group by house, season, model_guess`).all() as Row[];
    const by = new Map<string, string[]>();
    for (const r of rows) { const k = `${r.house} ${String(r.season).replace(/-/g, " ")}`; const d = [r.material, r.hardware].filter((x) => x && x !== "unknown").join(", "); by.set(k, [...(by.get(k) ?? []), `${r.model_guess}${d ? ` (${String(d).slice(0, 70)})` : ""}`]); }
    return [...by.entries()].map(([k, v]) => `${k} (not in stores yet or just arriving): ${v.slice(0, 16).join("; ")}`).join("\n");
  } catch { return ""; } finally { db.close(); }
}

/** A fabric or novelty the client did not name is another price: a plain "black Classic Flap" never takes velvet, tweed, denim or
 *  "Airlines" flaps (Sam, round 17: $2,948 to $7,200 for a medium Classic Flap). */
const NOVELTY_T = /\b(neoprene|toile|velvet|tweed|denim|sequins?|airlines|crochet|raffia|straw|wicker|satin|jersey|nylon|canvas|felt|terry|boucle|plexi|acrylic|resin|rubber|lucite|knit|wool|cotton|linen|corduroy|vinyl|pvc)\b/g;
export function noveltyOk(title: string, asked: string): boolean {
  const a = norm(asked), t = norm(title);
  if (![...t.matchAll(NOVELTY_T)].every((m) => a.includes(m[1].replace(/s$/, "")))) return false;
  // and the other way (coverage sweep, 2026-10-26: a neoprene Baguette took 72 leather Baguette sales, a nylon Re-Edition Mini the leather
  // ones): a fabric the client names as the bag's own is the fabric sold. Not a trim, lining, strap or handle ("leather and satin trim"),
  // not canvas (Louis Vuitton titles drop it), and never when a finish decides (a mother-of-pearl Baguette on denim is priced by its shells)
  if (namedFinishes(asked).length) return true;
  const own = a.replace(/\b(\w+ (and|&) )?\w+ (trims?|linings?|lined|piping|straps?|handles?|accents?|details?|tassels?|charms?|pouch)\b/g, " ").replace(/\b(w|with) \w+\b/g, " ");
  return [...own.matchAll(NOVELTY_T)].every((m) => m[1] === "canvas" || m[1] === "toile" || t.includes(m[1].replace(/s$/, "")));
}
/** A plain Chanel Classic Flap question (no finish named) compares only with Classic Flaps: "classic", "double flap" or "timeless" in the
 *  title, never a seasonal or Métiers d'Art flap (Sam, round 17: Simply CC, Label Click, French Riviera and Paris-Greece flaps counted). */
export function classicOk(house: string, bag: string, spec: string | undefined, title: string): boolean {
  if (!/chanel/i.test(house) || !/\bclassic\b/.test(norm(bag)) || namedFinishes(bag, spec).length) return true;
  const t = norm(title); return /\b(classic|double flap)\b/.test(t) && /\bflap\b/.test(t) && !/\breissue\b/.test(t) && !/\b(simply cc|label click|riviera|travel|double stitch|metiers|paris|o case|clutch|accordion|mademoiselle|e w|xxl|single flap|card|case|tote|zip|zipped|wallet|pouch|cosmetic|vanity|belt|camera|backpack)\b/.test(t); // Sam, round 25: a Timeless zip tote and a card case were Classic asks
}
/** Family variants (Katie, 2026-10-25: "look at all of our pulls from the RealReal and ... the edge case scenarios of the different
 *  sorts of bags"; a Mamma Baguette read as a Baguette). From an audit of 13,829 RealReal reads: within each family, these words name a
 *  different bag with its own price, so a title carrying one counts only when the client named it too. Add words from the data, never guesses. */
const FAMILY_VARIANTS: Record<string, Record<string, string[]>> = {
  fendi: { baguette: ["mamma", "soft", "nano", "phone"] },
  hermes: {
    birkin: ["shadow", "faubourg", "cargo", "haut a courroies", "hac"],
    kelly: ["to go", "wallet", "pocket", "belt", "so", "picnic", "ado", "lakis", "flat", "relax", "sport", "strap"], // "Kelly Bag Strap" is a strap (coverage sweep, 2026-10-26)
    picotin: ["cargo", "eclat"],
    constance: ["slim", "to go", "long", "wallet", "elan"],
  },
  chanel: {
    shopping: ["grand", "petit", "petite", "deauville", "neo", "cabas", "urban", "essentials", "archetype"],
    boy: ["reverso", "messenger", "chain around", "brick", "wallet", "tote", "o case", "camera"], // Boy Tote, Boy O-Case, Coco Boy Camera: other bags (2026-10-26 reads)
    "19": ["pouch", "o case", "wallet", "phone holder", "phone", "coin purse", "coin", "clutch", "card"], /* Sam, morning audit: a 19 Phone Holder, Round Clutch and Coin Purse were counted as bag sales */
  },
  dior: { saddle: ["gaucho", "pochette", "belt", "pouch", "wallet", "card"], "lady dior": ["pouch", "wallet", "pochette"] },
  "louis vuitton": { neverfull: ["pouch", "inside out", "pochette"], /* "Neverfull Pochette" is the pouch (2026-10-26 reads) */ speedy: ["nano"], pochette: ["felicie", "metis", "papillon", "multi pochette", "orsay", "accessoires", "kirigami", "voyage"] },
  gucci: { jackie: ["1961", "bouvier", "o"], horsebit: ["1955"], bamboo: ["1947"] },
  "bottega veneta": { andiamo: ["pouch", "phone"] },
  celine: {
    triomphe: ["soft", "besace", "macadam", "pouch", "nino", "classic", "panier", "halfmoon", "half moon", "phone", "victoire", "frame", "envelope", "boogie", "cabas", "clutch", "vanity"], // 20 Triomphe Clutch reads, 17 sold (2026-10-26)
    luggage: ["shopper", "smile", "phantom"],
  },
  loewe: { puzzle: ["fold", "edge", "pochette"], flamenco: ["tassel"] }, /* "Flamenco Tassel": 8 reads averaging $641 against $1,100-$2,300 (2026-10-26) */
  prada: { "re edition": ["1978", "2000", "2005"] },
};
/* Words that name a variant but also turn up in a photo reader's description ("long strap", "card slot", "classic colour", "flat
 *  handle", "gold-tone frame top"): they still keep an unnamed variant out, but naming one is not enough to demand it in every title. */
const VARIANT_DESCRIPTIVE = new Set(["long", "card", "classic", "flat", "sport", "soft", "frame", "o", "belt", "edge", "so", "pocket", "slim", "phone", "strap"]);
export function variantOk(house: string, asked: string, title: string): boolean {
  const fam = FAMILY_VARIANTS[norm(house).replace(/^maison /, "")] ?? FAMILY_VARIANTS[norm(house).split(" ")[0]]; if (!fam) return true;
  // "with pouch", "w/ strap", "w/ tags" describe what comes with the bag, not another bag
  const comes = (s: string) => norm(s).replace(/\b(w|with)( \w+)? (pouch|strap|tags|dust ?bag|box)\b/g, " ");
  const t = ` ${comes(title)} `, a = ` ${comes(asked)} `;
  for (const [core, vs] of Object.entries(fam)) {
    if (!t.includes(` ${core} `) || !a.includes(` ${core} `)) continue;
    if (vs.some((v) => t.includes(` ${v} `) && !a.includes(` ${v} `))) return false;
    // and the other way (coverage sweep, 2026-10-26): a variant the client names must be the bag sold. "Triomphe Macadam" was priced
    // from 69 Triomphe sales of every kind ($795-$1,596 against its own $425), "Kelly To Go" from Kelly 28s ($17,625 against $7,000)
    if (vs.some((v) => !VARIANT_DESCRIPTIVE.has(v) && a.includes(` ${v} `) && !t.includes(` ${v} `))) return false;
  }
  return true;
}
/** A vintage piece is priced from vintage sales (coverage sweep, 2026-10-26: a vintage Piston Lock Jackie sells near $725, the current
 *  one near $1,900; a vintage Lady Dior near $900). The RealReal titles one "Vintage" or by its year; a question that does not say
 *  vintage keeps every year. */
/** Not a bag: sunglasses, a ring, a belt, a wallet, a strap or a pouch share the model's name ("Triomphe Sunglasses", "Kelly Amulet
 *  Ring", "Kelly Bag Strap") but never its price (coverage sweep, 2026-10-26: Celine sunglasses were priced from 66 Triomphe bag sales).
 *  A title naming one counts only when the client names it too, and a client who names one is priced from those alone. "With strap",
 *  "w/ pouch" are what comes with a bag; "belt bag" and "wallet on chain" are bags. */
const OBJECT_WORDS = ["sunglasses", "glasses", "eyewear", "ring", "rings", "earrings", "earring", "bracelet", "necklace", "pendant", "brooch", "belt", "wallet", "card holder", "card case", "cardholder", "keychain", "key holder", "key ring", "key pouch", "bag charm", "scarf", "twilly", "bandeau", "sandals", "shoes", "sneakers", "watch", "strap", "pouch", "agenda", "notebook", "bag strap"]; // "Kelly Bag Strap" is a strap however it is asked
/* a photo reader says "shoulder strap" or "zip pouch" about the bag itself: naming one never demands it */
const OBJECT_SOFT = new Set(["strap", "pouch"]);
export function itemOk(asked: string, title: string): boolean {
  const comes = (s: string) => ` ${norm(s).replace(/\b(w|with)( \w+)? (pouch|strap|straps|tags|dust ?bag|box)\b/g, " ").replace(/\bbelt bag\b|\bwallet on (a )?(chain|strap)\b|\bchain wallet\b|\b[a-z] rings?\b|\bring (hardware|handles?|closure|detail)\b/g, " bagitem ")} `; /* a "D-ring" is hardware */
  const a = comes(asked), t = comes(title);
  // a strap or pouch is the item only when the title ends with it ("Kelly Bag Strap", "Neverfull Pouch"); "cream leather strap and FF clasp"
  // in an auction lot describes the bag (Christie's $3,810 mother-of-pearl Baguette)
  const tail = ` ${t.trim().split(" ").slice(-2).join(" ")} `;
  return OBJECT_WORDS.every((w) => { const th = OBJECT_SOFT.has(w) ? tail.includes(` ${w} `) : t.includes(` ${w} `); return th === a.includes(` ${w} `) || (!th && OBJECT_SOFT.has(w)); });
}
/** Louis Vuitton's canvases are priced apart (2026-10-26 reads: Damier Azur Neverfull MM about $898, Monogram about $991, Damier Ebene
 *  GM about $1,031): a canvas the client names must be the canvas sold. "Monogram" is a canvas only at Louis Vuitton (Gucci's GG and Saint
 *  Laurent's monogram are not), and Empreinte is leather, Monogram Denim is denim, Giant is its own print. */
const LV_CANVAS: [string, RegExp][] = [["damier azur", /\bdamier azur\b|\bazur\b/], ["damier ebene", /\bdamier ebene\b|\bebene\b/], ["damier graphite", /\bgraphite\b/], ["empreinte", /\bempreinte\b/], ["epi", /\bepi\b/], ["vernis", /\bvernis\b/], ["monogram denim", /\bmonogram denim\b|\bdenim\b/], ["giant", /\bgiant\b|\breverse\b/], ["monogram", /\bmonogram\b/]];
export function canvasOk(house: string, asked: string, title: string): boolean {
  if (!/vuitton|^lv$/.test(norm(house))) return true;
  const a = norm(asked), t = norm(title);
  const want = LV_CANVAS.find(([, rx]) => rx.test(a)); if (!want) return true;
  const got = LV_CANVAS.find(([, rx]) => rx.test(t));
  return !!got && got[0] === want[0];
}
/** A short description the client gives ("Jackie, piston"; "Andiamo, intrecciato") narrows the sales to the titles that carry its words,
 *  when at least three sold titles do and some do not: the word is the sellers' own name for that version (coverage sweep, 2026-10-26:
 *  "Jackie piston" took every Jackie; "Lady Dior cannage" every Lady Dior). Colours, sizes, condition and plain leather words never
 *  narrow, and a long photo description (four words or more) is left to the finish rules. Katie's purchases are never narrowed away. */
const NARROW_STOP = /^(leather|calfskin|lambskin|goatskin|smooth|grained|bag|bags|with|black|white|brown|beige|camel|tan|navy|blue|red|pink|green|grey|gray|cream|ivory|nude|gold|silver|tone|hardware|palladium|nano|micro|mini|small|medium|large|maxi|jumbo|teen|vintage|condition|excellent|pristine|good|fair|very|new|used|pre|loved|owned|the|and|shoulder|crossbody|handle|strap|chain|print|printed|classic|signature)$/;
export function narrowWords(bag: string, spec: string | undefined, soldTitles: string[]): string[] {
  const own = norm(spec ?? "").split(" ").filter((w) => w.length > 3 && !NARROW_STOP.test(w) && !/\d/.test(w) && !norm(bag).split(" ").includes(w));
  if (!own.length || own.length > 3 || soldTitles.length < 4) return [];
  const ts = soldTitles.map((t) => norm(t.replace(/\s*\[.*$/, "")));
  return own.filter((w) => { const n = ts.filter((t) => new RegExp(`\\b${w}`).test(t)).length; return n >= 3 && n < ts.length; });
}
export function vintageOk(asked: string, title: string): boolean {
  if (!/\bvintage\b/.test(norm(asked))) return true;
  const t = norm(title); const y = Number(t.match(/\b(19[5-9]\d|20[0-2]\d)\b/)?.[1] ?? 0);
  return /\bvintage\b/.test(t) || (y > 0 && y <= new Date().getFullYear() - 20);
}

/** A house's own product link (chanel.com /p/AS6482B2605694305/…, dior.com …/M0455VDRO_M08I): the reference in the address is looked
 *  up in our catalogue reads, so the tool knows the bag and its boutique price without reading the page (Katie, 2026-10-25: chanel.com
 *  blocks our server, and the tool asked her for a price we already held). */
export function catalogByUrl(url: string): { house: string; model: string; material: string | null; colour: string | null; price: number | null; date: string; stock: string | null } | null {
  const toks = [...new Set((url.toUpperCase().match(/[A-Z0-9_]{8,}/g) ?? []))]; if (!toks.length) return null;
  const db = open(); if (!db) return null;
  try {
    const r = db.prepare(`select c.house, c.model, c.material, c.colour, c.price_now, c.last_seen, (select availability from retail_availability_reads x where x.house=c.house and x.reference=c.reference order by read_date desc, id desc limit 1) avail from v_house_catalog c where upper(replace(c.reference,' ','')) in (${toks.map(() => "?").join(",")}) order by c.last_seen desc limit 1`).get(...toks) as Row | undefined;
    return r ? { house: String(r.house), model: String(r.model), material: (r.material as string) ?? null, colour: (r.colour as string) ?? null, price: (r.price_now as number) ?? null, date: String(r.last_seen), stock: (r.avail as string) ?? null } : null;
  } catch { return null; } finally { db.close(); }
}

/** The house's current boutique bags from our catalogue reads, one line per model and material, for the photo reader's second look
 *  (Katie, 2026-10-25: a current Chanel bag on a white product shot was read as a vintage Lagerfeld flap). */
export function houseCatalogNames(house: string, limit = 90): string[] {
  const db = open(); if (!db) return [];
  try {
    const rows = db.prepare(`select distinct model, material from v_house_catalog where ${likeAny("house", houseTerms(house))} and last_seen >= date('now','-60 days') order by model limit ${limit}`).all(...likeParams(houseTerms(house))) as Row[];
    return rows.map((r) => `${r.model}${r.material ? ` (${String(r.material).toLowerCase()})` : ""}`);
  } catch { return []; } finally { db.close(); }
}

/** What is coming to stores for this model (runway rows of the last 240 days), as one plain clause for the code-written timing line. */
export function comingToStores(house: string, bag: string, spec?: string): string | null {
  const db = open(); if (!db) return null;
  try {
    const mm = modelMatch("model_guess", bag, house); const askedN = norm(`${bag} ${spec ?? ""}`);
    const rw = (db.prepare(`select distinct season, expected_in_store, model_guess from runway_pipeline where ${likeAny("house", houseTerms(house))} and ${mm.sql} and show_date >= date('now','-240 days') order by show_date desc limit 8`).all(...likeParams(houseTerms(house)), ...mm.params) as Row[])
      .filter((r) => { const m = norm(String(r.model_guess ?? "")); return !DISTINCT_MODELS.some((w) => m.includes(w) && !askedN.includes(w)) && ![...m.matchAll(/\b(19|22|25|31)\b/g)].some((x) => !askedN.includes(x[1])); });
    if (!rw.length) return null;
    const r = rw[0]; const season = String(r.season).replace(/-ready-to-wear$/, "").replace(/-/g, " ");
    return `New ${season} versions walked the runway${r.expected_in_store ? ` and are expected in stores ${r.expected_in_store}` : ""}; you could wait for one.`;
  } catch { return null; } finally { db.close(); }
}

/** A model whose own name carries one of those words: every stored Félicie and Métis is titled "Pochette Félicie" / "Pochette Métis"
 *  (2026-10-26 reads: 14 of 18 Métis titles say Pochette), so naming the Félicie never shuts out its own titles. */
const DISTINCT_IMPLIED: Record<string, string[]> = { pochette: ["felicie", "metis"] };
/** Words that name a different bag sharing a model word (a Cerf is not a Shopping Bag, an En Désordre is not a plain Birkin). */
const DISTINCT_MODELS = ["rodeo", "night", "cerf", "deauville", "gst", "pst", "executive", "boy", "gabrielle", "trendy", "affinity", "reissue", "vanity", "camera", "charm", "wallet", "woc", "mamma", "soft", "first", "iseeu", "dome", "touch", "cut", "pochette", "danse", "elan", "ghillies", "verso", "en desordre", "officier", "jonathan", "picnic", "cargo", "shadow", "lucky daisy", "faubourg", "so black", "himalaya", "urban essential", "urbena", "cc bar", "coco base", "east west", "inside out", "panier", "cabas", "ceinture", "cerises", "heart", "d joy", "dioramour"];

type Cond = "P" | "VG" | "G" | "F";
const COND_LABEL: Record<Cond, string> = { P: "pristine", VG: "very good", G: "good", F: "fair" };
// against excellent = 1 (bags/page.tsx uses the same measured steps)
const COND_STEP_HERMES: Record<Cond, number> = { P: 1.24, VG: 0.81, G: 0.63, F: 0.48 };
const COND_STEP_ALL: Record<Cond, number> = { P: 1.11, VG: 0.82, G: 0.615, F: 0.47 };
function conditionOf(text: string): Cond | null {
  const t = text.toLowerCase();
  if (/\bvery[- ]good\b|\bpre-?loved\b|lightly (used|worn|carried)|worn (a little|once|twice|lightly)|gently (used|worn)/.test(t)) return "VG"; // Katie's sourcer calls a lightly worn bag "pre-loved"
  if (/\b(fair[- ]condition|condition:? ?fair|in fair shape|heavy wear|as is|bad shape|rough shape)\b/.test(t)) return "F";
  if (/\b(good[- ]condition|worn|wear and tear|scuff|stain|corner wear|corners rubbed|rubbed corners)\b/.test(t) || /condition:?\s*good\b/.test(t)) return "G";
  if (/\b(pristine|never (worn|carried)|brand new|with tags|w\/ ?tags)\b/.test(t)) return "P";
  return null;
}

/** When the tracker holds too few prices for the exact version asked, look it up on Madison Avenue Couture's public store search
 *  (one request, the same public JSON the weekly read uses) and keep what comes back (Katie, 2026-10-24: "secondhand websites
 *  like The RealReal and Madison Avenue Couture will usually have inventory or previously had this inventory"). */
export async function macLookup(house: string, bag: string, spec?: string): Promise<number> {
  const words = norm(`${house} ${bag} ${spec ?? ""}`).split(" ").filter((w) => w.length > 2 && !["bag", "bags", "the", "and", "with", "hardware", "leather"].includes(w)).slice(0, 7);
  if (!words.length) return 0;
  try {
    const url = `https://madisonavenuecouture.com/search/suggest.json?q=${encodeURIComponent(words.join(" "))}&resources%5Btype%5D=product&resources%5Blimit%5D=10`;
    const res = await fetch(url, { headers: { "User-Agent": "AppreciationIndexResearch/1.0 (low-rate public search)" } });
    if (!res.ok) return 0;
    const products = ((await res.json()) as { resources?: { results?: { products?: { id: number; title: string; price: string; available: boolean; url: string }[] } } }).resources?.results?.products ?? [];
    const db = writable(); if (!db) return 0;
    let n = 0;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const mw = norm(bag).split(" ").filter((w) => w.length > 2 && !["bag", "bags", "the", "and", "with"].includes(w) && !norm(house).split(" ").includes(w));
      for (const p of products) {
        if (!p.title || !Number(p.price)) continue;
        const t = norm(p.title);
        if (!mw.every((w) => t.includes(w)) || DISTINCT_MODELS.some((w) => t.includes(w) && !norm(`${bag} ${spec ?? ""}`).includes(w))) continue; // only the bag asked about
        const exists = db.prepare(`select id from resale_listings where source='madisonavenuecouture' and (source_product_id = ? or title = ?)`).get(String(p.id), p.title) as Row | undefined;
        if (exists) { db.prepare(`update resale_listings set last_seen = ?, price = ? where id = ?`).run(today, Number(p.price), Number(exists.id)); continue; }
        db.prepare(`insert into resale_listings(source, source_product_id, handle_url, brand, title, price, currency, available, tags, first_seen, last_seen) values('madisonavenuecouture', ?, ?, ?, ?, ?, 'USD', ?, 'found by the store search during an answer (gap in the weekly read)', ?, ?)`)
          .run(String(p.id), `https://madisonavenuecouture.com${p.url ?? ""}`.split("?")[0], house, p.title, Number(p.price), p.available ? 1 : 0, today, today);
        n++;
      }
    } finally { db.close(); }
    return n;
  } catch { return 0; }
}

/** Katie, 2026-10-24: "This is not just a numbers situation. This is cultural knowledge." How the press and search describe a bag
 *  (rarity, desirability, who can get one, who carries it), kept from an earlier answer for 120 days. */
export function bagStanding(house: string, bag: string, finish: string): string {
  const db = open(); if (!db) return "";
  try {
    const mm = modelMatch("bag", bag, house);
    const rows = (db.prepare(`select found_at, text, sources from web_findings where ${likeAny("house", houseTerms(house))} and ${mm.sql} and finish = ? and found_at >= datetime('now','-7 days') order by found_at desc limit 1`).all(...likeParams(houseTerms(house)), ...mm.params, `standing:${finish}`) as Row[]).map((r) => ({ ...r, text: String(r.text ?? "").split(/(?<=[.!?])\s+/).filter((x) => !REFUSAL.test(x)).join(" ") }) as Row);
    return rows.map((r) => `${String(r.text)}\n(read ${String(r.found_at).slice(0, 10)}; sources: ${(JSON.parse(String(r.sources ?? "[]")) as { title: string; url: string }[]).slice(0, 5).map((x) => `${x.title} ${x.url}`).join("; ")})`).join("\n");
  } catch { return ""; } finally { db.close(); }
}

/** A dated cultural moment found by the per-answer social listening: VERIFIED with two sources, else UNCONFIRMED; never a duplicate. */
export function saveMoment(house: string, bag: string, finish: string, m: { date?: string; who?: string; what?: string; sources?: { name?: string; url?: string }[] }) {
  if (!m?.what || !m.date || !/^\d{4}-\d{2}(-\d{2})?$/.test(m.date) || !m.sources?.length || !m.sources[0]?.url) return;
  const db = writable(); if (!db) return;
  try {
    const date = m.date.length === 7 ? `${m.date}-01` : m.date;
    const fam = norm(bag).split(" ").filter((w) => !/^\d+$/.test(w)).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
    if (db.prepare(`select 1 from buzz_events where house = ? and substr(event_date,1,7) = ? and lower(derived_note) like ?`).get(house, date.slice(0, 7), `%${norm(m.who ?? m.what).split(" ").slice(0, 2).join(" ")}%`)) return;
    const status = m.sources.filter((x) => x.url).length >= 2 ? "VERIFIED (two sources)" : "UNCONFIRMED (one source)";
    db.prepare(`insert into buzz_events(event_date, house, family, event_type, derived_note, source_url, material, public_line, retrieved_at) values(?,?,?,?,?,?,?,?,datetime('now'))`)
      .run(date, house, fam, "moment_found_in_answer", `${status}: ${m.who ? `${m.who}: ` : ""}${m.what} Sources: ${m.sources.map((x) => `${x.name ?? ""} ${x.url ?? ""}`.trim()).join("; ")}`, m.sources[0].url, finish || null, `${m.what}${status.startsWith("UNCONFIRMED") ? " (one report so far)" : ""}`);
  } catch { /* moments are extra */ } finally { db.close(); }
}

/** Katie, 2026-10-24 ("every time I drop a photo in and you identify the exact bag, you should clock it"): every photo read is kept
 *  as a record (what was identified, never the photo), so the bag is remembered and what people ask about becomes a demand signal. */
export function savePhotoRead(r: { house: string; model: string; spec: string; designer_era: string; confidence: string; setting?: string; tell?: string }, image?: { data: string; mediaType: string }) {
  const db = writable(); if (!db) return;
  try {
    db.exec(`create table if not exists photo_reads(id integer primary key, read_at text, house text, model text, spec text, designer_era text, confidence text, setting text, tell text)`);
    try { db.exec(`alter table photo_reads add column image_path text`); } catch { /* already there */ }
    // Katie, 2026-10-25: photos are kept privately in the backend for comparison (never shown to anyone else)
    let path: string | null = null;
    if (image) {
      try {
        const dir = (process.env.TRACKER_PHOTOS_DIR ?? "/Users/katiegraves/Desktop/Fashion Data Lab/photos/uploads") + "/" + new Date().toISOString().slice(0, 10);
        fs.mkdirSync(dir, { recursive: true });
        path = `${dir}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${image.mediaType.split("/")[1] === "jpeg" ? "jpg" : image.mediaType.split("/")[1]}`;
        fs.writeFileSync(path, Buffer.from(image.data, "base64"));
      } catch { path = null; }
    }
    db.prepare(`insert into photo_reads(read_at, house, model, spec, designer_era, confidence, setting, tell, image_path) values(datetime('now'),?,?,?,?,?,?,?,?)`).run(r.house, r.model, r.spec, r.designer_era, r.confidence, r.setting ?? "", (r.tell ?? "").slice(0, 300), path);
  } catch { /* the answer still runs */ } finally { db.close(); }
}

/** Our latest read of one RealReal listing, by the last part of its address (the slug). */
export function trrListing(slugOrHandle: string): { title: string; price: number; condition: string; sold: boolean; read_date: string; house: string } | null {
  const db = open(); if (!db) return null;
  try {
    const r = db.prepare(`select title, price, condition, sold, read_date, house from trr_item_reads where slug = ? or slug like ? order by read_date desc limit 1`).get(slugOrHandle, `%${slugOrHandle}`) as Row | undefined;
    return r ? { title: String(r.title), price: Number(r.price), condition: String(r.condition ?? ""), sold: Number(r.sold) === 1, read_date: String(r.read_date), house: String(r.house ?? "") } : null;
  } catch { return null; } finally { db.close(); }
}
