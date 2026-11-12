"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const REASONS = ["leather", "hardware", "stitching or construction", "colour", "shape", "price", "something better coming", "other"];

/** About thirty seconds: the bag, the call, why, and what you got instead. */
export default function InsiderForm() {
  const router = useRouter();
  const [decision, setDecision] = useState<"pass" | "wait" | "buy">("pass");
  const [why, setWhy] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const f = new FormData(e.currentTarget);
    const body = { house: f.get("house"), model: f.get("model"), spec: f.get("spec"), judged_on: f.get("judged_on"), reason: f.get("reason"), instead: f.get("instead"), decision, reason_type: why.join(", ") };
    const r = await fetch("/api/insider", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ error: "Couldn't save. Try again." }));
    setBusy(false);
    if (r.error) { setMsg(r.error); return; }
    (e.target as HTMLFormElement).reset(); setWhy([]); setMsg("Saved."); router.refresh();
  }
  return (
    <form className="insider-form" onSubmit={submit}>
      <div className="row2">
        <label>House<input name="house" required placeholder="Chanel" /></label>
        <label>Bag<input name="model" required placeholder="Mini Souplissimo flap" /></label>
      </div>
      <label>Exact version<input name="spec" placeholder="chartreuse grained calfskin, gold hardware, Pre-Fall 2026" /></label>
      <div className="dial waypick" role="radiogroup" aria-label="Your call">
        {(["pass", "wait", "buy"] as const).map((d) => <button key={d} type="button" role="radio" aria-checked={decision === d} onClick={() => setDecision(d)}>{d}</button>)}
      </div>
      <fieldset className="chips"><legend className="lab">why</legend>
        {REASONS.map((r) => <button key={r} type="button" className={`chip${why.includes(r) ? " on" : ""}`} aria-pressed={why.includes(r)} onClick={() => setWhy(why.includes(r) ? why.filter((x) => x !== r) : [...why, r])}>{r}</button>)}
      </fieldset>
      <label>Note<textarea name="reason" rows={2} placeholder="The grain looked coarse and the CC hardware finish was uneven in person." /></label>
      <div className="row2">
        <label>What you got instead<input name="instead" placeholder="Hermès Kelly Cut, yellow-green Doblis suede" /></label>
        <label>Date<input name="judged_on" type="date" defaultValue={new Date().toLocaleDateString("en-CA")} /></label>
      </div>
      <button type="submit" className="savecall" disabled={busy}>{busy ? "saving" : "save the call"}</button>
      {msg && <p className="hint">{msg}</p>}
    </form>
  );
}
