import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isPrivateRequest, listJudgments } from "@/lib/insider";
import InsiderForm from "./InsiderForm";

export const dynamic = "force-dynamic";

/** The insider log (Katie, 2026-10-26): private pass / wait / buy calls. Opens only on Katie's laptop or home Wi-Fi. */
export default async function Insider() {
  if (!isPrivateRequest(await headers())) notFound();
  const rows = listJudgments(60);
  return (
    <main className="insider">
      <section className="bookhead"><p className="lab">private · never shown to customers</p><h1 className="vh">The <i>insider</i> log.</h1>
        <p className="hint">Every bag you or your sourcer passed on, waited on or bought after seeing it in person, and why.</p></section>
      <InsiderForm />
      <section className="insider-list">
        <p className="lab">your calls · {rows.length}</p>
        {rows.length === 0 && <p className="hint">Nothing logged yet.</p>}
        {rows.map((r) => (
          <article key={r.id} className={`icall ${r.decision}`}>
            <p className="lab">{r.judged_on} · {r.decision}</p>
            <h3>{r.house} <i>{r.model}</i></h3>
            {r.spec && <p className="spec">{r.spec}</p>}
            {r.reason_type && <p className="why"><b>{r.reason_type}</b></p>}
            {r.reason && <p className="why">{r.reason}</p>}
            {r.instead && <p className="why">Instead: {r.instead}</p>}
          </article>
        ))}
      </section>
    </main>
  );
}
