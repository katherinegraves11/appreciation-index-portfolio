"use client";

import { useEffect, useState } from "react";
import type { RaceRow } from "@/lib/tracker";

const ALL = ["Hermès", "Chanel", "Louis Vuitton", "Dior", "Gucci", "Prada", "Miu Miu", "Fendi", "Celine", "Saint Laurent", "Bottega Veneta", "Loewe", "Balenciaga", "The Row", "Alaïa", "Ferragamo"];

export default function RaceBoard({ rows }: { rows: RaceRow[] }) {
  const [off, setOff] = useState<Record<string, boolean>>({});
  useEffect(() => { try { setOff(JSON.parse(localStorage.getItem("ai-houses-off") || "{}")); } catch {} }, []);
  const toggle = (h: string) => { const n = { ...off, [h]: !off[h] }; setOff(n); try { localStorage.setItem("ai-houses-off", JSON.stringify(n)); } catch {} };
  const byHouse = new Map(rows.map((r) => [r.house, r]));
  // Spread each axis over the range the houses actually occupy, then push overlapping chips apart.
  const span = (vals: number[]) => { const lo = Math.min(...vals), hi = Math.max(...vals); return { lo, hi: hi === lo ? lo + 1 : hi }; }
  const sx = span(rows.map((r) => r.sold_pct ?? 30)), sy = span(rows.map((r) => r.heat ?? 30));
  const pos = new Map<string, { x: number; y: number }>();
  rows.forEach((r) => pos.set(r.house, {
    x: 10 + 80 * (((r.sold_pct ?? 30) - sx.lo) / (sx.hi - sx.lo)),
    y: 90 - 78 * (((r.heat ?? 30) - sy.lo) / (sy.hi - sy.lo)),
  }));
  const W = 20, H = 7; // chip footprint in % of the board
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (const a of rows) for (const b of rows) {
      if (a.house >= b.house) continue;
      const pa = pos.get(a.house)!, pb = pos.get(b.house)!;
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      if (Math.abs(dx) < W && Math.abs(dy) < H) {
        const push = (H - Math.abs(dy)) / 2 + 0.3, dir = dy >= 0 ? 1 : -1;
        pa.y = Math.max(8, Math.min(92, pa.y - dir * push)); pb.y = Math.max(8, Math.min(92, pb.y + dir * push)); moved = true;
      }
    }
    if (!moved) break;
  }
  const x = (r: RaceRow) => pos.get(r.house)!.x;
  const y = (r: RaceRow) => pos.get(r.house)!.y;
  const hot = rows.filter((r) => (r.heat ?? 0) >= 70 && (r.sold_pct ?? 0) >= 60).map((r) => r.house);
  const sortedHold = [...rows].filter((r) => r.sold_pct != null && !r.thin).sort((a, b) => (b.sold_pct ?? 0) - (a.sold_pct ?? 0));
  const sortedHeat = [...rows].filter((r) => r.heat != null && !r.thin).sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0));
  return (
    <>
      <div className="houses" aria-label="Houses in the race">
        <p className="lab">houses we track · tap to hide or show</p>
        <div className="hrow">{ALL.map((h) => <button key={h} type="button" className="hbtn" aria-pressed={!off[h]} onClick={() => toggle(h)} style={byHouse.has(h) ? undefined : { borderStyle: "dashed" }}>{h}</button>)}</div>
      </div>
      <div className="board" role="img" aria-label="House race board">
        <span className="quad tl">selling fast · loses value</span><span className="quad tr">selling fast · keeps value</span><span className="quad bl">slow · loses value</span><span className="quad br">slow · keeps value</span>
        <span className="axisline v" aria-hidden="true" /><span className="axisline h" aria-hidden="true" />
        <span className="axis x">sold closer to the store price →</span><span className="axis y">selling faster →</span>
        {rows.map((r) => (
          <span key={r.house} className={`hchip ${hot.includes(r.house) ? "hot" : ""}`} hidden={!!off[r.house]} style={{ left: `${x(r)}%`, top: `${y(r)}%` }}
            title={`Sold at ${r.sold_pct ?? "?"}% of new across ${r.models} models · ${r.sold_90d} sales read · ${r.saves ?? "?"} saves per listing${r.delist_pct != null ? ` · ${r.delist_pct}% of listings cleared in a month` : ""}`}>{r.house}</span>
        ))}
      </div>
      <div className="podium">
        <div className="pod-now"><p className="lab">selling fastest right now</p><ol>{sortedHeat.slice(0, 3).map((r) => <li key={r.house}><b>{r.house}</b> {r.saves ?? "?"} saves per listing{r.delist_pct != null ? `, ${r.delist_pct}% of listings gone within a month, sold or withdrawn` : ""}.</li>)}</ol></div>
        <div className="pod-fore"><p className="lab">keeps its value · sold closest to the store price</p><ol>{sortedHold.slice(0, 3).map((r) => <li key={r.house}><b>{r.house}</b> Sold at {r.sold_pct}% of new across {r.models} model{r.models === 1 ? "" : "s"}.</li>)}</ol></div>
        <div className="pod-cool"><p className="lab">loses the most · sold furthest below the store price</p><ol>{sortedHold.slice(-3).reverse().map((r) => <li key={r.house}><b>{r.house}</b> Sold at {r.sold_pct}% of new.</li>)}</ol></div>
      </div>
      <p className="hint center">Left to right: what bags actually sold for, as a share of today&apos;s store price. Bottom to top: how fast they sell (saves and listings clearing). The board is scaled to the houses shown, so the middle line is the middle of the pack. Asking prices are not used. A house is ranked only with at least two models and 30 sales; {rows.filter((r) => r.thin).map((r) => r.house).join(", ") || "none"} {rows.filter((r) => r.thin).length === 1 ? "has" : "have"} too few to rank yet. A house low on the board loses value on resale; that is not the same as a house whose prices are falling, which we will show once there are enough snapshots to see a drop.</p>
    </>
  );
}
