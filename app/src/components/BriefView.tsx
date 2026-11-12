import { LAYERS } from "@/lib/rubric";
import type { BriefRecord } from "@/lib/db";

function Evidence({ items }: { items: { text: string; source: string; url: string }[] }) {
  return (
    <ul className="ev">
      {items.map((e, i) => (
        <li key={i}>
          {e.text}{" "}
          <span className="src">
            — {e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer">{e.source}</a> : e.source}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function BriefView({ brief }: { brief: BriefRecord }) {
  const r = brief.result;
  const created = new Date(brief.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <article>
      <p className="eyebrow">Value-retention brief · {created}</p>
      <h1>{brief.house} {brief.bag}</h1>
      <p className="k" style={{ marginTop: 10 }}>
        {brief.spec ? `${brief.spec} · ` : ""}{brief.horizon_years}-year horizon · {brief.client_type}{brief.cohort && brief.cohort !== "unknown" ? ` · ${brief.cohort.replace("_", " ")}` : ""}
      </p>

      <div className="callbar">
        <span className="call">{r.call}</span>
        <span className={`tag ${r.confidence}`}>Confidence {r.confidence}</span>
      </div>
      <p className="lede" style={{ marginTop: 18 }}>{r.one_line}</p>

      <h2>At a glance</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Layer</th><th>Weight</th><th>Score</th><th></th><th>Why</th></tr>
          </thead>
          <tbody>
            {LAYERS.map((l) => {
              const layer = r.layers.find((x) => x.key === l.key);
              if (!layer) return null;
              return (
                <tr key={l.key}>
                  <td>{l.name}</td>
                  <td className="num">{l.weight}</td>
                  <td className="num">{layer.score}</td>
                  <td><div className="bar"><span style={{ width: `${layer.score}%` }} /></div></td>
                  <td>{layer.summary}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Evidence</h2>
      {LAYERS.map((l) => {
        const layer = r.layers.find((x) => x.key === l.key);
        if (!layer) return null;
        return (
          <section key={l.key}>
            <h3>{l.name}</h3>
            <Evidence items={layer.evidence} />
          </section>
        );
      })}

      <h2>The social read</h2>
      <p>{r.social_read}</p>

      <h2>Ownership, M&amp;A, and supply chain</h2>
      <p>{r.ownership_and_supply_read}</p>

      <div className="two">
        <section>
          <h2>Bull case</h2>
          <ul>{r.bull_case.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </section>
        <section>
          <h2>Bear case</h2>
          <ul>{r.bear_case.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </section>
      </div>

      <h2>What would change this call</h2>
      <ul>{r.what_would_change_this.map((s, i) => <li key={i}>{s}</li>)}</ul>

      {r.spec_guidance.length > 0 && (
        <>
          <h2>Spec guidance</h2>
          <ul>{r.spec_guidance.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}

      {r.unverified.length > 0 && (
        <>
          <h2>Could not verify</h2>
          <ul>{r.unverified.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}

      {brief.sources.length > 0 && (
        <>
          <h2>Sources consulted</h2>
          <ul>
            {brief.sources.map((s) => (
              <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></li>
            ))}
          </ul>
        </>
      )}


      <p className="disclaimer">{r.disclaimer}</p>
    </article>
  );
}
