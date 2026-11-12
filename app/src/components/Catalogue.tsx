"use client";

import { useState } from "react";
import Link from "next/link";
import BagPlate, { silhouetteFor } from "./BagPlate";
import type { CatalogueRow } from "@/lib/tracker";

const FAMILY: Record<string, string> = { trapeze: "top handle", flap: "flap", eastwest: "east–west", saddle: "saddle", hobo: "hobo", tote: "tote", bucket: "bucket", box: "box", longstrap: "crossbody", puzzle: "soft" };

/**
 * The catalogue: every bag the tracker prices, as a ruled grid of engraved cells. Each cell carries the same
 * geometry (house top-left, silhouette family top-right, the plate large and centred, the model, then what it
 * sold at and what it costs new, the launch year in the corner), so forty cells read as one object.
 */
export default function Catalogue({ rows }: { rows: CatalogueRow[] }) {
  const houses = Array.from(new Set(rows.map((r) => r.house)));
  const [house, setHouse] = useState<string | null>(null);
  const shown = house ? rows.filter((r) => r.house === house) : rows;
  return (
    <>
      <div className="filter" role="group" aria-label="Filter by house">
        <span className="lab">filter</span>
        <button type="button" className={!house ? "on" : ""} onClick={() => setHouse(null)}>All</button>
        {houses.map((h) => <button key={h} type="button" className={house === h ? "on" : ""} onClick={() => setHouse(house === h ? null : h)}>{h}</button>)}
      </div>
      <div className="catalogue">
        {shown.map((r) => {
          const name = `${r.house} ${r.model}`;
          return (
            <Link key={name} href={`/?q=${encodeURIComponent(`Is the ${name} worth buying right now?`)}`} className="cell">
              <span className="chouse">{r.house}</span>
              <span className="cfam lab">{FAMILY[silhouetteFor(name)]}</span>
              <span className="cplate"><BagPlate name={name} size={150} /></span>
              <span className="cmodel">{r.model}</span>
              <span className="ctags">
                {r.sold_pct != null && <em className={r.sold_pct >= 85 ? "good" : r.sold_pct < 45 ? "weak" : ""}>sold at {Math.round(r.sold_pct)}%</em>}
                {r.retail_now ? <em>${Math.round(r.retail_now).toLocaleString()} new</em> : <em>price pending</em>}
              </span>
              <span className="cyear">{r.launch_year ?? ""}</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
