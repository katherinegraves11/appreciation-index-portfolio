// Ties each bag a Muse brief mentions to the prices we track, through the app's own matcher, so versions never merge
// (Katie, 2026-10-25: leopard tweed is not cheetah pony hair; a diamond Himalaya is not a palladium one; a Kelly Cut is not a So Kelly).
// Usage: npx tsx scripts/muse-prices.mts <brief_date>
import { DatabaseSync } from "node:sqlite";
import { quickNumbers } from "../src/lib/tracker.ts";
const day = process.argv[2];
const db = new DatabaseSync("/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db");
const rows = db.prepare("select distinct house, bag from muse_mentions where brief_date=? and coalesce(bag,'')<>'' and house not in ('LVMH','Kering','Prada Group','Fashionphile')").all(day) as unknown as { house: string; bag: string }[];
const put = db.prepare("insert or replace into muse_bag_prices(brief_date,house,bag,boutique,sells_lo,sells_hi,sales_n,basis,computed_at) values(?,?,?,?,?,?,?,?,datetime('now','localtime'))");
for (const r of rows) for (const bag of r.bag.split(/\s*\/\s*/).map((b) => b.replace(/\(([^)]*)\)/, "$1").trim()).filter(Boolean)) {
  // a finish in brackets after the list ("(newspaper print)") belongs to every bag in it
  const fin = r.bag.match(/\(([^)]*)\)\s*$/)?.[1] ?? "";
  const name = fin && !bag.includes(fin) ? `${bag} ${fin}` : bag;
  try { const q = quickNumbers(r.house, name, "", null); const p = q?.paths;
    put.run(day, r.house, name, q?.retail_now ?? null, p?.band.lo ?? null, p?.band.hi ?? null, p?.salesN ?? 0, p?.basisNote ?? "no comparable sales for this exact version");
    console.log(`${r.house} ${name}: boutique ${q?.retail_now ?? "-"}, sells ${p ? `${p.band.lo}-${p.band.hi} (${p.salesN ?? 0} sales)` : "no exact-version sales"}`);
  } catch (e) { console.log(`${r.house} ${name}: failed ${String(e).slice(0, 80)}`); }
}
