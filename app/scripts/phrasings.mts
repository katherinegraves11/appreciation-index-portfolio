// Phrasings sweep (Katie, 2026-10-26: "make sure more of our entries start actually pulling up meaningful data"). Every customer and
// photo-reader phrasing the product manager wrote (findings/coverage/phrasings.jsonl: house, asked_bag, asked_spec, the expected range
// from stored sales) is run through the app's own quickNumbers (no AI calls, no cost) and scored:
//   PASS   the answer's band overlaps [expected_low, expected_high] and its middle sits near it; for a line with no range, the answer
//          finds no sales rather than borrowing another version's; for an ambiguous line, the answer picks the right version or breaks
//          out the alternatives (bySize / byModel) with one of them in range, and never silently merges versions
//   MISS   a range is expected and the answer finds nothing
//   WRONG  the answer's band misses the expected range (another version's price)
//   MERGED an ambiguous line answered with one band far wider than the version's own range (versions merged)
//   BORROWED no stored sale for this version, yet the answer shows sales
// Usage: npx tsx scripts/phrasings.mts [--house Chanel] [--limit 100] [--out file.json] [--fails]
import fs from "node:fs";
import { quickNumbers } from "../src/lib/tracker.ts";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const onlyHouse = arg("--house"), limit = Number(arg("--limit") ?? 100000);
const src = arg("--in") ?? "/Users/katiegraves/Desktop/Fashion Data Lab/findings/coverage/phrasings.jsonl";
const out = arg("--out") ?? "/Users/katiegraves/Desktop/Fashion Data Lab/findings/coverage/phrasings-latest.json";
type L = { house: string; asked_bag: string; asked_spec: string; must_match_title_words?: string[]; expected_low: number | null; expected_high: number | null; ambiguous?: boolean; ambiguous_with?: string; kind?: string; evidence?: string };
const lines = fs.readFileSync(src, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as L)
  .filter((l) => !onlyHouse || l.house === onlyHouse).slice(0, limit);

type Band = { lo: number; mid: number; hi: number };
const overlaps = (b: Band, lo: number, hi: number) => b.hi >= lo && b.lo <= hi;
// in range: the band touches the expected range and its middle is not another version's price
const inRange = (b: Band, lo: number, hi: number) => overlaps(b, lo, hi) && b.mid >= lo / 1.5 && b.mid <= hi * 1.5;
const rows: Record<string, unknown>[] = []; const tally: Record<string, number> = {};
for (const l of lines) {
  let q: ReturnType<typeof quickNumbers> = null; let err = "";
  try { q = quickNumbers(l.house, l.asked_bag, l.asked_spec, null); } catch (e) { err = String(e).slice(0, 160); }
  const p = q?.paths ?? null; const lo = l.expected_low, hi = l.expected_high;
  const alts = [...(q?.bySize ?? []), ...(q?.byModel ?? [])];
  let verdict: string;
  if (lo == null || hi == null) {
    // no stored sale of this version: honest = no sales shown (asks of the version, or nothing at all)
    verdict = !p || (p.salesN ?? 0) === 0 ? "PASS" : "BORROWED";
  } else if (l.ambiguous) {
    const altHit = alts.length >= 2 && alts.some((a) => inRange(a.band, lo, hi));
    const merged = !!p && p.band.hi / Math.max(1, p.band.lo) > Math.max(2.2, (1.3 * hi) / Math.max(1, lo));
    verdict = altHit ? "PASS" : !p ? "MISS" : !inRange(p.band, lo, hi) ? "WRONG" : merged ? "MERGED" : "PASS";
  } else {
    verdict = !p ? "MISS" : inRange(p.band, lo, hi) ? "PASS" : "WRONG";
  }
  tally[verdict] = (tally[verdict] ?? 0) + 1;
  rows.push({ verdict, house: l.house, bag: l.asked_bag, spec: l.asked_spec, kind: l.kind, ambiguous: !!l.ambiguous, expected: lo == null ? null : `${lo}-${hi}`,
    band: p ? `${p.band.lo}-${p.band.hi}` : null, mid: p?.band.mid ?? null, sales: p?.salesN ?? 0, basis: p?.basis ?? null, note: p?.basisNote?.slice(0, 160) ?? null,
    alts: alts.length ? alts.map((a) => `${a.model} ${a.band.lo}-${a.band.hi} (${a.n})`) : undefined, retail: q?.retail_now ?? null, must: l.must_match_title_words, err: err || undefined });
}
const n = rows.length; const pass = tally.PASS ?? 0;
const byHouse: Record<string, { n: number; ok: number }> = {};
for (const r of rows) { const h = String(r.house); byHouse[h] ??= { n: 0, ok: 0 }; byHouse[h].n++; if (r.verdict === "PASS") byHouse[h].ok++; }
const byKind: Record<string, { n: number; ok: number }> = {};
for (const r of rows) { const k = String(r.kind); byKind[k] ??= { n: 0, ok: 0 }; byKind[k].n++; if (r.verdict === "PASS") byKind[k].ok++; }
const fmt = (o: Record<string, { n: number; ok: number }>) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1].n - a[1].n).map(([h, x]) => [h, `${x.ok}/${x.n} (${Math.round((100 * x.ok) / x.n)}%)`]));
const summary = { at: new Date().toISOString(), tested: n, pass_pct: Math.round((1000 * pass) / Math.max(1, n)) / 10, ...tally, byHouse: fmt(byHouse), byKind: fmt(byKind) };
fs.mkdirSync(out.replace(/\/[^/]+$/, ""), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
if (process.argv.includes("--fails")) for (const r of rows.filter((x) => x.verdict !== "PASS")) console.log(`${r.verdict}\t${r.house} | ${r.bag} | ${r.spec} | exp ${r.expected} | got ${r.band} (${r.sales}) ${r.alts ? JSON.stringify(r.alts) : ""}`);
