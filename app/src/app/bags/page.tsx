import Link from "next/link";
import { cookies, headers } from "next/headers";
import { listBriefs } from "@/lib/db";
import { quickNumbers } from "@/lib/tracker";
import SellSun, { SUN, sunPhase } from "@/components/SellSun";
import BagCondition from "@/components/BagCondition";

/** What each condition sells for against "Excellent", measured on 2026-10-23 from sold listings on The RealReal in the tracker
 *  (same model, pooled; Hermès separately). All houses: n = 156 / 878 / 1,615 / 882 / 187. Hermès: n = 65 / 217 / 244 / 139 / 36. */
const COND_ALL: Record<string, number> = { P: 1.11, E: 1, VG: 0.82, G: 0.615, F: 0.47 };
const COND_HERMES: Record<string, number> = { P: 1.24, E: 1, VG: 0.81, G: 0.63, F: 0.48 };
import BagPlate from "@/components/BagPlate";
import { toSignals } from "@/lib/cards";
import { yearFigures } from "@/lib/verdict";

export const dynamic = "force-dynamic";

/** Keep card titles to two lines: strip parentheses and cut at four words; the full name shows underneath. */
function shortName(bag: string): string {
  const base = bag.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const words = base.split(" ");
  const cut = base.length > 24 ? 3 : 4;
  return words.length > cut ? words.slice(0, cut).join(" ") : base;
}

const W: Record<string, string> = { yes: "Yes", no: "No", wait: "Not yet" };

/** My bags: only the bags you marked "I'm buying it", with what you paid and when (kept on this device until there is sign-in). */
export default async function Bags() {
  const bought = new Map(((await cookies()).get("bought")?.value ?? "").split(",").filter(Boolean).map((e) => { const [id, price, date, cond] = e.split(":"); return [id, { price: Number(price), date, cond: cond || "E" }] as const; }));
  void headers;
  const watch = new Map(((await cookies()).get("watch")?.value ?? "").split(",").filter(Boolean).map((e) => { const [id, way, paid, mid, words, date] = e.split(":"); return [id, { way: way === "n" ? "new" as const : "used" as const, paid: Number(paid), mid: Number(mid), words: words ?? "", date }] as const; }));
  const all = bought.size || watch.size ? await listBriefs(300) : [];
  const rows = all.filter((b) => bought.has(b.id));
  const watched = all.filter((b) => watch.has(b.id));
  const money = (v: number) => `$${Math.round(v).toLocaleString()}`;
  return (
    <main className="mybags">
      <section className="bookhead">
        <p className="lab">my bags · {rows.length} {rows.length === 1 ? "bag" : "bags"}</p>
        <h1 className="vh">The bags <i>you bought.</i></h1>
        <p className="hint">When you decide to buy a bag, tap &ldquo;I&apos;m buying it&rdquo; on its answer and add what you paid. It lands here.</p>
      </section>
      <div className="bags">
        {rows.map((b) => {
          const sig = toSignals(b.result);
          const paid = bought.get(b.id)?.price ?? 0;
          const nn = (() => { try { return quickNumbers(b.house, b.bag, b.spec || undefined); } catch { return null; } })();
          const cond = bought.get(b.id)?.cond ?? "E";
          const f = (/herm/i.test(b.house) ? COND_HERMES : COND_ALL)[cond] ?? 1;
          const band = nn?.paths ? { lo: Math.round(nn.paths.band.lo * f), mid: Math.round(nn.paths.band.mid * f), hi: Math.round(nn.paths.band.hi * f) } : null;
          const worth = band?.mid ?? null;
          const keepNow = worth ? Math.round(worth * (worth >= 10000 ? 0.85 : worth >= 5000 ? 0.8 : worth >= 2500 ? 0.75 : 0.7)) : null;
          const gainPct = keepNow && paid ? Math.round(((keepNow - paid) / paid) * 100) : null;
          const phase = sunPhase(gainPct, nn?.forward?.signals.length ? nn.forward.lean : null);
          return (
            <div key={b.id} className="bag sq">
              <div className="bag-top">
                <div><p className="lab">bought {bought.get(b.id)?.date ? new Date(`${bought.get(b.id)!.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""} · paid {money(bought.get(b.id)?.price ?? 0)}</p><h3>{b.house} <i>{shortName(b.bag)}</i></h3>{shortName(b.bag) !== b.bag && <p className="spec">{b.bag}</p>}</div>
                <BagPlate name={`${b.house} ${b.bag}`} size={72} className="cplate" />
              </div>
              <BagCondition id={b.id} current={cond} />
              <div className={`sunrow ${phase}`}><SellSun phase={phase} id={b.id.slice(0, 8)} /><div><p className="sunword">{SUN[phase].word}</p><p className="sunline">{SUN[phase].line}{keepNow && nn?.paths && band ? ` Today ${nn.paths.basis === "same-material asks" ? "sellers ask about" : "it would sell for about"} ${band.lo === band.hi ? money(band.mid) : `${money(band.lo)} to ${money(band.hi)}`}${f !== 1 ? ` in this condition (${f > 1 ? `${Math.round((f - 1) * 100)}% more` : `${Math.round((1 - f) * 100)}% less`} than carried with care, from sold listings on The RealReal)` : ""}; in the middle of that, after fees, you would keep ${gainPct! >= 0 ? `${gainPct}% more` : `${Math.abs(gainPct!)}% less`} than the ${money(paid)} you paid.` : ""} A read on today&apos;s numbers, not a promise.</p></div></div>

            <p className="openit"><Link href={`/?brief=${b.id}`}>the advice before you bought it</Link></p>
            </div>
          );
        })}
        {rows.length === 0 && <div className="sq empty"><p className="lab">nothing here yet</p><p className="hint">Your first bag lands in this square.</p></div>}
      </div>
      {/* Katie, 2026-10-24: "Watch this bag": when a "Not yet" turns to Yes, or the price moves, it shows here (the daily scans refresh it) */}
      <section className="bookhead watching">
        <p className="lab">watching · {watched.length} {watched.length === 1 ? "bag" : "bags"}</p>
        <p className="hint">Tap &ldquo;Watch this bag&rdquo; on any answer. We check it against each day&apos;s prices and flag it here when something changes.</p>
      </section>
      <div className="bags">
        {watched.map((b) => {
          const w = watch.get(b.id)!;
          const nn = (() => { try { return quickNumbers(b.house, b.bag, b.spec || undefined); } catch { return null; } })();
          const p = nn?.paths;
          const sales = (nn?.sell?.n ?? 0) + (nn?.tiers?.sourcer_sold?.n ?? 0) + (nn?.tiers?.trr_sold?.n ?? 0);
          const now = p ? yearFigures(p, w.paid, w.way, sales, nn?.forward?.lean === "rising").figs.map((f) => (f.word === "Yes" ? "Y" : f.word === "No" ? "N" : "W")).join("") : "";
          const say = (c: string) => (c === "Y" ? "Yes" : c === "N" ? "No" : "Not yet");
          const labels = ["within a year", "three years", "forever"];
          const turned = now ? [...now].map((c, i) => (c !== w.words[i] ? `${labels[i]}: ${say(w.words[i] ?? "W")} → ${say(c)}` : "")).filter(Boolean) : [];
          const midNow = p ? Math.round(p.band.mid) : null;
          const moved = midNow && w.mid ? Math.round(((midNow - w.mid) / w.mid) * 100) : 0;
          const changed = turned.length > 0 || Math.abs(moved) >= 5;
          return (
            <div key={b.id} className={`bagrow sq ${changed ? "changed" : ""}`}>
              <div className="sqhead"><p className="lab">watching since {w.date ? new Date(`${w.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""} · {w.way === "new" ? "new at the boutique" : "pre-loved"} at {money(w.paid)}</p><h3>{b.house} <i>{b.bag}</i></h3></div>
              <p className="sunline">{changed ? <b>Changed. </b> : "No change yet. "}{turned.length ? `${turned.join("; ")}. ` : ""}{midNow ? `Pre-loved middle ${money(w.mid)} then, ${money(midNow)} now${moved ? ` (${moved > 0 ? "+" : ""}${moved}%)` : ""}.` : ""}</p>
              <p className="openit"><Link href={`/?brief=${b.id}`}>open the answer</Link></p>
            </div>
          );
        })}
        {watched.length === 0 && <div className="sq empty"><p className="lab">nothing watched yet</p><p className="hint">Tap &ldquo;Watch this bag&rdquo; on an answer.</p></div>}
      </div>
    </main>
  );
}
