import Link from "next/link";
import { listBriefs, storageMode } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function BriefsPage() {
  const briefs = await listBriefs();
  return (
    <main className="wrap">
      <p className="eyebrow">Library</p>
      <h1>Past briefs</h1>
      {storageMode() === "file" && (
        <p className="k" style={{ marginTop: 12 }}>
          Briefs are saved as local files. Add Supabase keys before deploying.
        </p>
      )}
      {briefs.length === 0 ? (
        <p>No briefs yet. <Link href="/">Write the first one.</Link></p>
      ) : (
        <ul className="list">
          {briefs.map((b) => (
            <li key={b.id}>
              <span>
                <Link href={`/brief/${b.id}`}>{b.house} {b.bag}</Link>
                {b.spec ? <span className="meta"> · {b.spec}</span> : null}
                <div className="meta">{b.result.call} · {b.result.composite}/100 · {b.horizon_years}y</div>
              </span>
              <span className="meta">{new Date(b.created_at).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
