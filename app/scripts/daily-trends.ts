/**
 * Daily connective-tissue run (Katie's rule, 2026-10-23): every day, after the scans, line up culture against
 * willingness to pay and sales for every tracked bag, check the data is arriving, and write the result to
 * Fashion Data Lab/findings/trends/<date>.md plus a JSON snapshot, with the change since the last run.
 * Read-only on the databases. Run: node scripts/daily-trends.ts
 */
import fs from "node:fs";
import path from "node:path";
import { dataFlow, bagTrend, forwardRead, TRACKED } from "../src/lib/trends.ts";

const OUT = process.env.TRENDS_OUT_DIR ?? "/Users/katiegraves/Desktop/Fashion Data Lab/findings/trends";
const today = new Date().toLocaleDateString("en-CA"); // local date, YYYY-MM-DD
fs.mkdirSync(OUT, { recursive: true });

const flow = dataFlow();
const bags = TRACKED.map(([h, m]) => ({ ...bagTrend(h, m), fwd: forwardRead(h, m, null) }));
const snap = { date: today, flow, bags: bags.map((b) => ({ bag: `${b.house} ${b.model}`, term: b.term, yoy: b.search?.yoyPct ?? null, recent13: b.search?.recent13 ?? null, auction_rho: b.auction?.rho ?? null, auction_n: b.auction?.n ?? 0, auction_p: b.auction?.p ?? null, resale_n: b.resale?.n ?? 0, resale_rho: b.resale?.rho ?? null, lean: b.fwd?.lean ?? null, lean_signals: b.fwd?.signals.map((s) => `${s.name} ${s.dir}`) ?? [] })) };

const prevFile = fs.readdirSync(OUT).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f < `${today}.json`).sort().pop();
const prev = prevFile ? JSON.parse(fs.readFileSync(path.join(OUT, prevFile), "utf8")) : null;
const was = (bag: string) => prev?.bags?.find((b: { bag: string }) => b.bag === bag);

const r = (v: number | null | undefined, d = 0) => (v == null ? "n/a" : v.toFixed(d));
const lines: string[] = [];
lines.push(`# Connective tissue, ${today}`, "", `Culture (US Google searches) against willingness to pay (auction estimates, The RealReal saves) and sales (hammer and sold prices). Correlation, never cause. Links need 8 paired readings. ${prevFile ? `Changes are against ${prevFile.replace(".json", "")}.` : "First run: no earlier report to compare."}`, "");
lines.push("## Is the data arriving?", "", "| Feed | Last read | Days read, last 30 | Rows, last 7 days | Status |", "|---|---|---|---|---|");
for (const f of flow) lines.push(`| ${f.feed} | ${f.last ?? "none"} | ${f.days30} | ${f.rows7} | ${f.status} |`);
const stale = flow.filter((f) => f.status === "stale" || f.status === "empty");
lines.push("", stale.length ? `**Action:** ${stale.map((f) => f.feed).join("; ")} ${stale.length === 1 ? "is" : "are"} stale or empty. Trends cannot grow until the daily scan completes.` : "All feeds current.", "");
lines.push("## Bag by bag", "", "| Bag | Looking ahead | Search term | Searches, last 13 weeks | vs a year ago | Searches and auction prices | Searches and The RealReal | Change since last run |", "|---|---|---|---|---|---|---|---|");
for (const b of bags) {
  const s = snap.bags.find((x) => x.bag === `${b.house} ${b.model}`)!; const w = was(s.bag);
  const auction = b.auction ? (b.auction.rho == null ? `collecting (${b.auction.n})` : `rho ${r(b.auction.rho, 2)}, n ${b.auction.n}, chance ${Math.round((b.auction.p ?? 1) * 100)}%`) : "no lots";
  const resale = b.resale ? (b.resale.rho == null ? `collecting (${b.resale.n}/8)` : `rho ${r(b.resale.rho, 2)}, n ${b.resale.n}`) : "no reads";
  const change = !w ? "new" : [s.resale_n !== w.resale_n ? `RealReal reads ${w.resale_n}→${s.resale_n}` : "", s.auction_n !== w.auction_n ? `auction lots ${w.auction_n}→${s.auction_n}` : "", w.lean && s.lean !== w.lean ? `lean ${w.lean}→${s.lean}` : "", s.yoy != null && w.yoy != null && Math.abs(s.yoy - w.yoy) >= 5 ? `searches vs year ago ${r(w.yoy)}%→${r(s.yoy)}%` : ""].filter(Boolean).join("; ") || "no change";
  lines.push(`| ${s.bag} | ${b.fwd ? `${b.fwd.lean} (${b.fwd.signals.map((x) => `${x.name} ${x.dir}`).join(", ")})` : "n/a"} | ${b.term ?? "none"} | ${r(b.search?.recent13)}/100 | ${b.search?.yoyPct == null ? "n/a" : `${b.search.yoyPct >= 0 ? "+" : ""}${r(b.search.yoyPct)}%`} | ${auction} | ${resale} | ${change} |`);
}
lines.push("", "## Readings worth a sentence", "");
const notable = bags.filter((b) => b.auction?.rho != null && (b.auction.p ?? 1) < 0.05);
lines.push(notable.length ? notable.map((b) => `- ${b.house} ${b.model}: ${b.auction!.read}`).join("\n") : "- No link passes the chance test yet. Say so plainly; do not round a weak link up.");
const movers = bags.filter((b) => b.search?.yoyPct != null && Math.abs(b.search.yoyPct) >= 25);
if (movers.length) lines.push(...movers.map((b) => `- Searches for “${b.term}” are ${b.search!.yoyPct! >= 0 ? "up" : "down"} ${Math.abs(Math.round(b.search!.yoyPct!))}% on a year ago (last 13 weeks). Check whether asks, saves and sold prices for this bag moved the same way before saying anything.`));
lines.push("", "_Value-retention analysis of the US market, in dollars, based on public market data, not investment advice._", "");

fs.writeFileSync(path.join(OUT, `${today}.md`), lines.join("\n"));
fs.writeFileSync(path.join(OUT, `${today}.json`), JSON.stringify(snap, null, 2));
console.log(`wrote ${path.join(OUT, `${today}.md`)} (${bags.length} bags, ${stale.length} stale feeds)`);
