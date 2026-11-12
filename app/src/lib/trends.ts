/**
 * Trends and connective tissue (Katie's daily rule, 2026-10-23): every day, line up what people say and search
 * (culture) against what buyers are willing to pay (asks, saves, auction estimates) and what actually sells
 * (sold prices, hammer prices), per bag, and say how strong each link is and how many readings back it.
 *
 * Honesty rules built in:
 * - A relationship is reported only with enough paired readings (MIN_PAIRS); below that it says "collecting".
 * - Correlation is never called cause. Every line carries n, the date span and the source.
 * - The scenario is arithmetic on today's ratio and the boutique price path, labelled "not a forecast; no backtest".
 *
 * Read-only on both databases. Runs inside Next and standalone (`node scripts/daily-trends.ts`).
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const LAB = "/Users/katiegraves/Desktop/Fashion Data Lab/db";
const MIN_PAIRS = 8;

type Row = Record<string, string | number | null>;

function openDb(envPath: string | undefined, desktop: string, bundled: string): DatabaseSync | null {
  const p = envPath ?? (fs.existsSync(desktop) ? desktop : bundled);
  try { return fs.existsSync(p) ? new DatabaseSync(p, { readOnly: true }) : null; } catch { return null; }
}
const trackerDb = () => openDb(process.env.TRACKER_DB_PATH, `${LAB}/luxury_bags.db`, path.join(process.cwd(), "data", "tracker.db"));
const trendsDb = () => openDb(process.env.TRENDS_DB_PATH, `${LAB}/trends.db`, path.join(process.cwd(), "data", "trends.db"));

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
function median(a: number[]): number { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function quantile(a: number[], q: number): number { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * q; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); }
function ranks(a: number[]): number[] {
  const idx = a.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]); const r = new Array(a.length).fill(0);
  for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
  return r;
}
/** Spearman rank correlation, ties averaged. */
export function spearman(x: number[], y: number[]): number {
  const rx = ranks(x), ry = ranks(y); const mx = mean(rx), my = mean(ry);
  let n = 0, dx = 0, dy = 0; for (let i = 0; i < rx.length; i++) { n += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx && dy ? n / Math.sqrt(dx * dy) : 0;
}
/** Share of label shuffles that give a correlation at least this strong: a plain-language "could this be chance". */
function permutationP(x: number[], y: number[], rho: number, runs = 2000): number {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let hits = 0; const yy = [...y];
  for (let r = 0; r < runs; r++) { for (let i = yy.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [yy[i], yy[j]] = [yy[j], yy[i]]; } if (Math.abs(spearman(x, yy)) >= Math.abs(rho)) hits++; }
  return hits / runs;
}
const strength = (rho: number) => { const a = Math.abs(rho); return a < 0.2 ? "no clear link" : a < 0.4 ? "a weak link" : a < 0.6 ? "a moderate link" : "a strong link"; };
const pct = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v)}%`;

// ---------- data flow ----------
export type FlowRow = { feed: string; last: string | null; ageDays: number | null; days30: number; rows7: number; status: "daily" | "regular" | "irregular" | "stale" | "empty" };
export function dataFlow(today = new Date()): FlowRow[] {
  const db = trackerDb(); const tdb = trendsDb(); const out: FlowRow[] = [];
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const d30 = iso(new Date(today.getTime() - 30 * 864e5)), d7 = iso(new Date(today.getTime() - 7 * 864e5)), d3 = iso(new Date(today.getTime() - 3 * 864e5));
  const feeds: [DatabaseSync | null, string, string, string][] = [
    [db, "The RealReal tiles (asks, saves, sold)", "trr_item_reads", "read_date"],
    [db, "Secondhand sourcer listings (asks)", "resale_listings", "substr(last_seen,1,10)"],
    [db, "Resale ask snapshots", "resale_aggregates", "snapshot_date"],
    [db, "FWRD Renew shelf (asks)", "fwrd_renew_reads", "read_date"],
    [db, "Search and social reads", "buzz_reads", "read_date"],
    [db, "Buzz events", "buzz_events", "substr(retrieved_at,1,10)"],
    [db, "Auction lots", "auction_results", "substr(retrieved_at,1,10)"],
    [db, "Boutique prices", "retail_reference", "substr(retrieved_at,1,10)"],
    [db, "WGSN signals", "wgsn_signals", "substr(retrieved_at,1,10)"],
    [tdb, "Google search history (weekly)", "search_interest", "collected_date"],
  ];
  for (const [d, feed, table, col] of feeds) {
    if (!d) { out.push({ feed, last: null, ageDays: null, days30: 0, rows7: 0, status: "empty" }); continue; }
    try {
      const r = d.prepare(`select max(${col}) last, count(distinct case when ${col} >= ? then ${col} end) days30, sum(case when ${col} >= ? then 1 else 0 end) rows7 from ${table}`).get(d30, d7) as Row;
      const last = (r.last as string) ?? null; const days30 = Number(r.days30 ?? 0);
      const status = !last ? "empty" : last < d3 ? "stale" : days30 >= 20 ? "daily" : days30 >= 4 ? "regular" : "irregular";
      const ageDays = last ? Math.max(0, Math.round((new Date(iso(today)).getTime() - new Date(last.slice(0, 10)).getTime()) / 864e5)) : null;
      out.push({ feed, last, ageDays, days30, rows7: Number(r.rows7 ?? 0), status });
    } catch { out.push({ feed, last: null, ageDays: null, days30: 0, rows7: 0, status: "empty" }); }
  }
  db?.close(); tdb?.close();
  return out;
}

// ---------- culture: search history ----------
export function searchTerms(): string[] {
  const t = trendsDb(); if (!t) return [];
  try { return (t.prepare("select distinct term from search_interest order by term").all() as Row[]).map((r) => String(r.term)); } catch { return []; } finally { t.close(); }
}
/** Model words used everywhere: letters first ("Lady Dior" → lady); a name that is only a number ("Chanel 25") keeps the number. */
function modelWords(model: string): string[] {
  const toks = norm(model).split(" ").filter((w) => w && !["bag", "bags", "the"].includes(w));
  const alpha = toks.filter((w, i) => (w.length > 2 || (w === "so" && toks[i + 1] === "kelly")) && !/^\d+$/.test(w)); // a So Kelly is never forecast from the Kelly (Sam, round 24: p48)
  return alpha.length ? alpha : toks.filter((w) => /^\d+$/.test(w));
}
/** The search term for a bag: it must contain the house's first word and every model word. */
export function termFor(house: string, model: string): string | null {
  const h = norm(house).split(" ")[0]; const words = modelWords(model);
  if (!words.length) return null;
  const hits = searchTerms().filter((t) => { const n = norm(t); return n.includes(h) && words.every((w) => n.includes(w)); });
  return hits.sort((a, b) => a.length - b.length)[0] ?? null;
}
export type Week = { week: string; v: number };
export function searchSeries(term: string): Week[] {
  const t = trendsDb(); if (!t) return [];
  try { return (t.prepare("select week, interest from search_interest where term=? order by week").all(term) as Row[]).map((r) => ({ week: String(r.week), v: Number(r.interest) })); } catch { return []; } finally { t.close(); }
}
export type SearchRead = { term: string; weeks: number; from: string; to: string; recent13: number; yearAgo13: number; yoyPct: number | null; vsFiveYearPct: number | null; byYear: { year: string; avg: number }[] };
export function searchRead(term: string): SearchRead | null {
  const s = searchSeries(term); if (s.length < 60) return null;
  const last13 = s.slice(-13).map((w) => w.v), yearAgo = s.slice(-65, -52).map((w) => w.v), all = s.map((w) => w.v);
  const r13 = mean(last13), y13 = mean(yearAgo), m5 = mean(all);
  const years = new Map<string, number[]>(); for (const w of s) { const y = w.week.slice(0, 4); years.set(y, [...(years.get(y) ?? []), w.v]); }
  return {
    term, weeks: s.length, from: s[0].week, to: s[s.length - 1].week, recent13: Math.round(r13), yearAgo13: Math.round(y13),
    yoyPct: y13 > 0 ? ((r13 - y13) / y13) * 100 : null, vsFiveYearPct: m5 > 0 ? ((r13 - m5) / m5) * 100 : null,
    byYear: [...years].map(([year, v]) => ({ year, avg: Math.round(mean(v)) })),
  };
}
/** How hot searches were in the 8 weeks before a date, against the 52 weeks before that (1 = normal). */
function heatBefore(s: Week[], date: string): number | null {
  const i = s.findIndex((w) => w.week > date); const end = i === -1 ? s.length : i;
  if (end < 60) return null;
  const recent = mean(s.slice(end - 8, end).map((w) => w.v)), base = mean(s.slice(end - 60, end - 8).map((w) => w.v));
  return base > 0 ? recent / base : null;
}

// ---------- connective tissue ----------
export type Link = {
  label: string;           // what is being compared
  culture: string;         // the culture signal
  money: string;           // the WTP or sales signal
  n: number; need: number; // paired readings and the minimum to report
  rho: number | null; p: number | null; read: string;  // plain-language result (dossier)
  plain?: string;          // one customer sentence: direction in words, n, chance
  span: string; source: string;
};

/** Auction lots of this bag: does hotter US search before the sale go with a higher price against estimate, or more lots sold? */
export function auctionLink(house: string, model: string): Link | null {
  const term = termFor(house, model); const db = trackerDb(); if (!db) return null;
  const words = modelWords(model); if (!words.length) { db.close(); return null; }
  let lots: Row[] = [];
  try {
    lots = db.prepare(`select sale_date, hammer_price, estimate_low, estimate_high, sold, auction_house from auction_results
      where lower(house) like ? ${words.map(() => "and lower(coalesce(model_guess,'')) like ?").join(" ")} and estimate_low > 0 and estimate_high > 0 and sale_date is not null`)
      .all(`%${norm(house).split(" ")[0].slice(0, 3)}%`, ...words.map((w) => `%${w}%`)) as Row[];
  } catch { lots = []; } finally { db.close(); }
  if (!lots.length) return null;
  const base: Omit<Link, "n" | "rho" | "p" | "read"> = {
    label: `${house} ${model}: search heat before an auction vs price against estimate`, culture: term ? `US Google searches for “${term}”, 8 weeks before the sale against the year before` : "no search history for this bag yet",
    money: "hammer price ÷ middle of the estimate (sold lots), currency-neutral", need: MIN_PAIRS,
    span: `${lots.map((l) => String(l.sale_date)).sort()[0]} to ${lots.map((l) => String(l.sale_date)).sort().slice(-1)[0]}`,
    source: `${[...new Set(lots.map((l) => String(l.auction_house)))].join(", ")} results; Google Trends`,
  };
  if (!term) return { ...base, n: 0, rho: null, p: null, read: "Collecting: no search history for this bag yet." };
  const s = searchSeries(term);
  const pairs = lots.filter((l) => Number(l.sold) === 1 && l.hammer_price != null).map((l) => ({ heat: heatBefore(s, String(l.sale_date)), ratio: Number(l.hammer_price) / ((Number(l.estimate_low) + Number(l.estimate_high)) / 2) })).filter((p) => p.heat != null) as { heat: number; ratio: number }[];
  const unsold = lots.filter((l) => Number(l.sold) !== 1).map((l) => heatBefore(s, String(l.sale_date))).filter((h) => h != null) as number[];
  if (pairs.length < MIN_PAIRS) return { ...base, n: pairs.length, rho: null, p: null, read: `Collecting: ${pairs.length} sold lots with search history; ${MIN_PAIRS} needed before we call a link.` };
  const rho = spearman(pairs.map((p) => p.heat), pairs.map((p) => p.ratio)); const p = permutationP(pairs.map((x) => x.heat), pairs.map((x) => x.ratio), rho);
  const hot = pairs.filter((x) => x.heat > 1).map((x) => x.ratio), cool = pairs.filter((x) => x.heat <= 1).map((x) => x.ratio);
  const split = hot.length >= 3 && cool.length >= 3 ? ` Lots sold after above-normal searching made ${Math.round(median(hot) * 100)}% of mid-estimate (${hot.length} lots); after normal or quiet searching, ${Math.round(median(cool) * 100)}% (${cool.length} lots).` : "";
  const unsoldNote = unsold.length ? ` ${unsold.length} lots went unsold; their median search heat was ${median(unsold).toFixed(2)}× normal.` : "";
  const plainLine = Math.abs(rho) < 0.2 ? `No clear pattern between searches and auction prices (${pairs.length} sales).` : `When searches ran hotter, auction prices came in ${rho > 0 ? "a little higher" : "a little lower"} against estimate (${pairs.length} sales)${p >= 0.05 ? ", but that could be chance" : ""}.`;
  return { ...base, plain: plainLine, n: pairs.length, rho, p, read: `${strength(rho)[0].toUpperCase()}${strength(rho).slice(1)} (rank correlation ${rho.toFixed(2)}, ${pairs.length} sold lots; a shuffle test matches it ${Math.round(p * 100)}% of the time, so ${p < 0.05 ? "unlikely to be chance" : "it could be chance"}).${split}${unsoldNote} Correlation, not cause.` };
}

/** The RealReal reads of this bag: as searches move week to week, do saves (intent), sold share and sold price move with them? */
export function resaleLink(house: string, model: string): Link | null {
  const term = termFor(house, model); const db = trackerDb(); if (!db) return null;
  const words = modelWords(model); if (!words.length) { db.close(); return null; }
  let reads: Row[] = [];
  try {
    reads = db.prepare(`select read_date, count(*) tiles, sum(sold) sold, avg(case when sold=1 then pct_of_retail end) sold_pct,
        avg(cast(nullif(rtrim(substr(substr(title, instr(title,'saves=')+6), 1, 6), ';] abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ,'),'') as real)) saves
      from trr_item_reads where lower(house) like ? ${words.map(() => "and lower(coalesce(model_guess,'')) like ?").join(" ")} group by read_date having tiles >= 10 order by read_date`)
      .all(`%${norm(house).split(" ")[0].slice(0, 3)}%`, ...words.map((w) => `%${w}%`)) as Row[];
  } catch { reads = []; } finally { db.close(); }
  const span = reads.length ? `${reads[0].read_date} to ${reads[reads.length - 1].read_date}` : "none";
  const base = { label: `${house} ${model}: searches vs The RealReal saves, sold share and sold price`, culture: term ? `US Google searches for “${term}” in the week of each read` : "no search history for this bag yet", money: "saves per tile (willingness to pay), share of tiles sold, sold price as % of estimated retail", need: MIN_PAIRS, span, source: "The RealReal reads; Google Trends" };
  if (reads.length < MIN_PAIRS || !term) return { ...base, n: reads.length, rho: null, p: null, read: `Collecting: ${reads.length} dated reads of this bag (${span}); ${MIN_PAIRS} needed before we call a link. Each daily scan adds one.` };
  const s = searchSeries(term); const at = (d: string) => { const w = [...s].reverse().find((x) => x.week <= d); return w ? w.v : null; };
  const pts = reads.map((r) => ({ q: at(String(r.read_date)), saves: Number(r.saves) })).filter((x) => x.q != null && Number.isFinite(x.saves)) as { q: number; saves: number }[];
  if (pts.length < MIN_PAIRS) return { ...base, n: pts.length, rho: null, p: null, read: `Collecting: ${pts.length} reads line up with search weeks; ${MIN_PAIRS} needed.` };
  const rho = spearman(pts.map((x) => x.q), pts.map((x) => x.saves)); const p = permutationP(pts.map((x) => x.q), pts.map((x) => x.saves), rho);
  const plainLine = Math.abs(rho) < 0.2 ? `No clear pattern between searches and saves (${pts.length} reads).` : `When searches rose, saves ${rho > 0 ? "rose" : "fell"} too (${pts.length} reads)${p >= 0.05 ? ", but that could be chance" : ""}.`;
  return { ...base, plain: plainLine, n: pts.length, rho, p, read: `Searches and saves: ${strength(rho)} (rank correlation ${rho.toFixed(2)}, ${pts.length} reads, ${p < 0.05 ? "unlikely to be chance" : "could be chance"}). Correlation, not cause.` };
}

/** Boutique price path next to search interest, year by year: shown side by side, never correlated (too few years). */
export function retailVsSearch(house: string, model: string): string | null {
  const term = termFor(house, model); const db = trackerDb(); if (!db || !term) { db?.close(); return null; }
  const words = modelWords(model); if (!words.length) { db.close(); return null; }
  let rows: Row[] = [];
  try {
    rows = db.prepare(`select substr(effective_date,1,4) y, max(price) price, size_or_spec from retail_reference where lower(house) like ? ${words.map(() => "and lower(model) like ?").join(" ")} and region='US' and is_reference_size=1 group by y order by y`)
      .all(`%${norm(house).split(" ")[0].slice(0, 3)}%`, ...words.map((w) => `%${w}%`)) as Row[];
  } catch { rows = []; } finally { db.close(); }
  const sr = searchRead(term); if (!sr || rows.length < 2) return null;
  const sy = new Map(sr.byYear.map((b) => [b.year, b.avg]));
  return `Boutique price and search interest by year (${rows[rows.length - 1].size_or_spec ?? "reference size"}): ${rows.map((r) => `${r.y} $${Number(r.price).toLocaleString()}${sy.has(String(r.y)) ? `, searches ${sy.get(String(r.y))}/100` : ""}`).join(" · ")}. Too few years to measure a link; shown side by side.`;
}

// ---------- scenario ----------
export type Scenario = { retailNow: number; cagrPct: number; years: number; ratioMid: number; ratioLo: number; ratioHi: number; n: number; at: { y: number; lo: number; mid: number; hi: number }[] } | null;
/** Arithmetic, not a forecast: today's sold-to-boutique ratio (middle half of sold listings) applied to the boutique price grown at its own past rate. */
export function scenario(retailPath: { y: string; price: number }[], soldPrices: number[], retailNow: number): Scenario {
  if (retailPath.length < 3 || soldPrices.length < 8 || !retailNow) return null;
  const first = retailPath[0], last = retailPath[retailPath.length - 1]; const yrs = Number(last.y) - Number(first.y); if (yrs < 2) return null;
  const g = Math.pow(last.price / first.price, 1 / yrs) - 1;
  const ratios = soldPrices.map((p) => p / retailNow);
  const lo = quantile(ratios, 0.25), mid = median(ratios), hi = quantile(ratios, 0.75);
  return { retailNow, cagrPct: g * 100, years: yrs, ratioLo: lo, ratioMid: mid, ratioHi: hi, n: soldPrices.length,
    at: [1, 5, 10].map((y) => { const r = retailNow * Math.pow(1 + g, y); return { y, lo: Math.round(r * lo), mid: Math.round(r * mid), hi: Math.round(r * hi) }; }) };
}

// ---------- moments: what searches did around each logged cultural moment for this bag ----------
export type Moment = { date: string; what: string; type: string; before: number | null; after: number | null; changePct: number | null };
// Katie, 2026-10-24: a Himalaya answer shows Himalaya moments, never the Kylie bag wall; a plain answer never shows a one-finish moment
const FINISH_GROUPS: string[][] = [["himalaya"], ["suede", "doblis", "grizzly"], ["ostrich"], ["porosus", "niloticus", "crocodile", "croc", "alligator"], ["lizard"], ["pony", "ponyhair", "calf hair"], ["mink", "fur", "shearling"], ["sequin"], ["fringe"], ["diamond"]];
export function moments(house: string, model: string, spec?: string): Moment[] {
  const words = modelWords(model); const db = trackerDb(); if (!db || !words.length) { db?.close(); return []; }
  let rows: Row[] = [];
  try {
    rows = db.prepare(`select event_date, event_type, derived_note, material, public_line from buzz_events where lower(house) like ? and (${words.map(() => "lower(coalesce(family,'') || ' ' || coalesce(derived_note,'')) like ?").join(" and ")}) and event_date is not null order by event_date desc limit 12`)
      .all(`%${norm(house).split(" ")[0].slice(0, 3)}%`, ...words.map((w) => `%${w}%`)) as Row[];
    const asked = norm(`${model} ${spec ?? ""}`);
    const group = FINISH_GROUPS.find((g) => g.some((w) => asked.includes(w))) ?? null;
    const about = (r: Row) => norm(`${r.material ?? ""} ${r.derived_note ?? ""} ${r.public_line ?? ""}`);
    rows = rows.filter((r) => group ? group.some((w) => about(r).includes(w)) : !r.material).slice(0, 4);
  } catch { rows = []; } finally { db.close(); }
  const term = termFor(house, model); const s = term ? searchSeries(term) : [];
  return rows.map((r) => {
    const d = String(r.event_date).slice(0, 10); const i = s.findIndex((w) => w.week >= d);
    const before = i >= 8 ? Math.round(mean(s.slice(i - 8, i).map((w) => w.v))) : null;
    const after = i >= 0 && s.length - i >= 8 ? Math.round(mean(s.slice(i, i + 8).map((w) => w.v))) : null;
    return { date: d, type: String(r.event_type ?? "").replace(/_/g, " "), what: String(r.public_line || String(r.derived_note ?? "").split(/(?<=[.;])\s/)[0]).slice(0, 180), before, after, changePct: before && after != null ? Math.round(((after - before) / before) * 100) : null };
  });
}

// ---------- the dossier block ----------
/** Lines for the answer's evidence dossier. Every line says its n and whether it is a link or still collecting. */
export function connectiveLines(house: string, model: string, spec?: string): string[] {
  const out: string[] = [];
  const term = termFor(house, model);
  if (term) {
    const sr = searchRead(term);
    if (sr) out.push(`Search trend (Google Trends, US, weekly, ${sr.from} to ${sr.to}, each term scaled to its own five-year peak = 100): “${term}” averaged ${sr.recent13}/100 over the last 13 weeks, ${sr.yoyPct == null ? "no year-ago base" : `${pct(sr.yoyPct)} on the same weeks a year ago`}, ${sr.vsFiveYearPct == null ? "" : `${pct(sr.vsFiveYearPct)} against its five-year average`}. Year averages: ${sr.byYear.map((b) => `${b.year} ${b.avg}`).join(", ")}.`);
  } else out.push("Search trend: no weekly search history for this bag yet.");
  for (const l of [auctionLink(house, model), resaleLink(house, model)]) if (l) out.push(`${l.label}. Culture: ${l.culture}. Money: ${l.money}. ${l.read} Span ${l.span}. Source: ${l.source}.`);
  const rv = retailVsSearch(house, model); if (rv) out.push(rv);
  for (const m of moments(house, model, spec)) out.push(`Moment ${m.date} (${m.type}): ${m.what} Searches for this bag ${m.changePct == null ? "around it: not enough weeks on both sides yet" : `averaged ${m.before}/100 in the 8 weeks before and ${m.after}/100 in the 8 weeks after (${m.changePct >= 0 ? "+" : ""}${m.changePct}%)`}. A pattern, not proof the moment caused it.`);
  return out;
}

/** One bag's full read, for the /trends page and the daily report. */
export function bagTrend(house: string, model: string) {
  const term = termFor(house, model);
  return { house, model, term, search: term ? searchRead(term) : null, auction: auctionLink(house, model), resale: resaleLink(house, model) };
}

/** The bags the daily report and /trends page cover: every bag with a weekly search history. */
export const TRACKED: [string, string][] = [
  ["Hermès", "Birkin"], ["Hermès", "Kelly"], ["Hermès", "Constance"], ["Hermès", "Picotin"], ["Hermès", "Evelyne"],
  ["Chanel", "Classic Flap"], ["Chanel", "25"], ["Dior", "Lady Dior"], ["Dior", "Saddle"], ["Dior", "Book Tote"], ["Fendi", "Baguette"],
  ["Gucci", "Jackie"], ["Loewe", "Puzzle"], ["Prada", "Galleria"], ["Celine", "Triomphe"], ["Balenciaga", "City"],
  ["Bottega Veneta", "Jodie"], ["Louis Vuitton", "Speedy"], ["Louis Vuitton", "Neverfull"], ["Miu Miu", "Wander"], ["The Row", "Margaux"], ["Goyard", "Saint Louis"],
];

// ---------- the forward read (Katie, 2026-10-23: "advice more based off of trend forecasting, not stuck in the past") ----------
/** The leathers a boutique path is priced in, from its first and last years' rows: "Togo" when both ends are Togo (Hélène, 2026-11-07). */
function leathersOf(first: string, last: string): string {
  const find = (t: string) => ["togo", "epsom", "caviar", "lambskin"].filter((w) => t.includes(w));
  const a = find(first), b = find(last); const both = a.filter((w) => b.includes(w));
  return (both.length ? both : [...new Set([...a, ...b])]).map((w) => (w === "togo" || w === "epsom" ? w[0].toUpperCase() + w.slice(1) : w)).join(" or ");
}
export type ForwardSignal = { name: string; dir: "up" | "down" | "flat"; evidence: string; basis?: string; size?: string | null }; // basis: the leathers the boutique path is priced in ("Togo"); size: the size it is for
export type Forward = {
  lean: "rising" | "cooling" | "mixed" | "steady"; confidence: "low" | "medium"; signals: ForwardSignal[];
  nextBoutique: { price: number; date: string; ratePct: number; years: number } | null;
  bands: { y: number; lo: number; mid: number; hi: number }[] | null; bandsNote: string | null;
} | null;

/** Where the forward-looking signals point for one bag. A transparent tally, not a fitted model: each signal shows its evidence,
 *  confidence is "medium" only when three or more agree and none disagree, never "high" (no backtest yet). */
export function forwardRead(house: string, model: string, sold?: { prices: number[]; retailNow: number; plain: boolean } | null): Forward {
  const words = modelWords(model); if (!words.length) return null;
  const db = trackerDb(); if (!db) return null;
  const h = `%${norm(house).split(" ")[0].slice(0, 3)}%`; const signals: ForwardSignal[] = [];
  const q = (sql: string, ...p: (string | number)[]) => { try { return db.prepare(sql).all(...p) as Row[]; } catch { return []; } };
  // 1. search momentum
  const term = termFor(house, model); const sr = term ? searchRead(term) : null;
  if (sr?.yoyPct != null) signals.push({ name: "Searches", dir: sr.yoyPct >= 10 ? "up" : sr.yoyPct <= -10 ? "down" : "flat", evidence: `US Google searches for “${term}” ${sr.yoyPct >= 0 ? "up" : "down"} ${Math.abs(Math.round(sr.yoyPct))}% on a year ago (last 13 weeks); yearly average ${sr.byYear[0]?.avg ?? "?"} in ${sr.byYear[0]?.year ?? "?"} to ${sr.byYear[sr.byYear.length - 1]?.avg ?? "?"} in ${sr.byYear[sr.byYear.length - 1]?.year ?? "?"}` });
  // 2. boutique price path → next January
  const rpRef = q(`select substr(effective_date,1,4) y, max(price) price, group_concat(lower(size_or_spec), '|') sp from retail_reference where lower(house) like ? ${words.map(() => "and lower(model) like ?").join(" ")} and region='US' and is_reference_size=1 group by y order by y`, h, ...words.map((w) => `%${w}%`));
  // the asked size's own boutique path when we hold three years of it: a Kelly 25 is never forecast from the Kelly 28 (Sam, round 21)
  const sz = norm(`${model}`).match(/\b(1[5-9]|[2-4]\d)\b/)?.[1];
  const rpSize = sz ? q(`select substr(effective_date,1,4) y, max(price) price, group_concat(lower(size_or_spec), '|') sp from retail_reference where lower(house) like ? ${words.map(() => "and lower(model) like ?").join(" ")} and region='US' and (size_key = ? or lower(size_or_spec) like ?) and lower(coalesce(size_or_spec,'')) not like '%special order%' group by y order by y`, h, ...words.map((w) => `%${w}%`), sz, `%${sz}%`) : [];
  // and the standard leathers only, so a Box Sellier or Barenia row never sets the path (Sam, round 21: $18,800 Box Sellier)
  const rpStd = sz ? q(`select substr(effective_date,1,4) y, max(price) price, group_concat(lower(size_or_spec), '|') sp from retail_reference where lower(house) like ? ${words.map(() => "and lower(model) like ?").join(" ")} and region='US' and (size_key = ? or lower(size_or_spec) like ?) and (lower(size_or_spec) like '%togo%' or lower(size_or_spec) like '%epsom%' or lower(size_or_spec) like '%caviar%' or lower(size_or_spec) like '%lambskin%' or lower(size_or_spec) like '%grained%') and lower(size_or_spec) not like '%electrum%' and lower(size_or_spec) not like '%faubourg%' and lower(size_or_spec) not like '%touch%' and lower(size_or_spec) not like '%so black%' group by y order by y`, h, ...words.map((w) => `%${w}%`), sz, `%${sz}%`) : [];
  const rp = rpStd.length >= 3 ? rpStd : rpSize.length >= 3 ? rpSize : rpRef;
  let nextBoutique: NonNullable<Forward>["nextBoutique"] = null; let rate = 0;
  if (rp.length >= 3) {
    const f = rp[0], l = rp[rp.length - 1]; const yrs = Number(l.y) - Number(f.y);
    if (yrs >= 2 && Number(f.price) > 0) {
      rate = Math.pow(Number(l.price) / Number(f.price), 1 / yrs) - 1;
      nextBoutique = { price: Math.round(Number(l.price) * (1 + rate) / 50) * 50, date: `January ${Number(l.y) + 1}`, ratePct: Math.round(rate * 1000) / 10, years: yrs };
      signals.push({ name: "Boutique price", dir: rate >= 0.03 ? "up" : rate <= 0 ? "down" : "flat", ...(leathersOf(String(f.sp ?? ""), String(l.sp ?? "")) ? { basis: leathersOf(String(f.sp ?? ""), String(l.sp ?? "")), size: String(f.sp ?? "").match(/\b(1[5-9]|[2-4]\d)\b/)?.[1] ?? null } : {}), evidence: `$${Number(f.price).toLocaleString()} in ${f.y} to $${Number(l.price).toLocaleString()} in ${l.y}, about ${nextBoutique.ratePct}% a year; at that pace about $${nextBoutique.price.toLocaleString()} by ${nextBoutique.date} (a projection, not an announced price)` });
    }
  }
  // 3. resale asks between the last two snapshots
  // same source, at least 20 listings in each snapshot, and sizes within 3x of each other, or the change is noise
  const ra = q(`select source s, snapshot_date d, median_ask m, n_listings n from resale_aggregates where lower(house) like ? ${words.map(() => "and lower(model) like ?").join(" ")} and median_ask > 0 and n_listings >= 20 order by snapshot_date desc, n_listings desc`, h, ...words.map((w) => `%${w}%`));
  const bySource = new Map<string, Row[]>(); for (const r of ra) { const k = String(r.s); const list = bySource.get(k) ?? []; if (!list.some((x) => x.d === r.d)) list.push(r); bySource.set(k, list); }
  const pair = [...bySource.values()].map((l) => l.slice(0, 2)).find((l) => l.length === 2 && Math.max(Number(l[0].n), Number(l[1].n)) <= 3 * Math.min(Number(l[0].n), Number(l[1].n)));
  const snaps = pair ?? [];
  if (snaps.length === 2) { const ch = ((Number(snaps[0].m) - Number(snaps[1].m)) / Number(snaps[1].m)) * 100; signals.push({ name: "Resale asks", dir: ch >= 5 ? "up" : ch <= -5 ? "down" : "flat", evidence: `median ask $${Number(snaps[1].m).toLocaleString()} (${snaps[1].d}) to $${Number(snaps[0].m).toLocaleString()} (${snaps[0].d}) on ${snaps[0].s}, ${snaps[1].n} and ${snaps[0].n} listings, ${ch >= 0 ? "+" : ""}${Math.round(ch)}%; two snapshots only` }); }
  // 4. auctions: price against estimate, last 12 months vs the 12 before
  const lots = q(`select sale_date d, hammer_price/((estimate_low+estimate_high)/2.0) r from auction_results where lower(house) like ? ${words.map(() => "and lower(coalesce(model_guess,'')) like ?").join(" ")} and sold=1 and hammer_price > 0 and estimate_low > 0 and estimate_high > 0`, h, ...words.map((w) => `%${w}%`));
  const cut = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10), cut2 = new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10);
  const recent = lots.filter((l) => String(l.d) >= cut).map((l) => Number(l.r)), prior = lots.filter((l) => String(l.d) < cut && String(l.d) >= cut2).map((l) => Number(l.r));
  if (recent.length >= 5 && prior.length >= 5) { const a = median(recent), b = median(prior); signals.push({ name: "Auctions", dir: a - b >= 0.05 ? "up" : b - a >= 0.05 ? "down" : "flat", evidence: `sold at ${Math.round(a * 100)}% of mid-estimate in the last 12 months (${recent.length} lots) against ${Math.round(b * 100)}% the year before (${prior.length} lots)` }); }
  db.close();
  const ups = signals.filter((s) => s.dir === "up").length, downs = signals.filter((s) => s.dir === "down").length;
  const lean = ups && !downs ? "rising" : downs && !ups ? "cooling" : ups && downs ? "mixed" : "steady";
  const agree = Math.max(ups, downs);
  const confidence = agree >= 3 && !(ups && downs) ? "medium" : "low";
  // projected resale band: today's sold-to-boutique ratio (middle half) applied to the boutique price grown at its own past rate
  let bands: NonNullable<Forward>["bands"] = null, bandsNote: string | null = null;
  if (sold && sold.prices.length >= 8 && sold.retailNow && rp.length >= 3) {
    const sc = scenario(rp.map((r) => ({ y: String(r.y), price: Number(r.price) })), sold.prices, sold.retailNow);
    if (sc) { bands = sc.at; bandsNote = `today's sold-to-boutique ratio across ${sc.n} sold listings${sold.plain ? " of plain leather, not the one asked about" : ""} (middle half ${Math.round(sc.ratioLo * 100)}% to ${Math.round(sc.ratioHi * 100)}%), applied to the boutique price growing ${Math.round(sc.cagrPct * 10) / 10}% a year (its ${sc.years}-year pace). A projection, not a forecast of this bag; no backtest yet.`; }
  }
  return { lean, confidence, signals, nextBoutique, bands, bandsNote };
}

export function forwardLines(f: Forward): string[] {
  if (!f || !f.signals.length) return [];
  const out = [`FORWARD LEAN: ${f.lean.toUpperCase()}, confidence ${f.confidence} (${f.signals.length} forward signal${f.signals.length === 1 ? "" : "s"}; medium needs three agreeing, never high without a backtest).`];
  for (const s of f.signals) out.push(`${s.name}: ${s.dir}. ${s.evidence}.`);
  if (f.bands) out.push(`Projected resale range (middle half): ${f.bands.map((b) => `${b.y} year${b.y === 1 ? "" : "s"} $${b.lo.toLocaleString()} to $${b.hi.toLocaleString()} (middle $${b.mid.toLocaleString()})`).join("; ")}. Basis: ${f.bandsNote}`);
  return out;
}
