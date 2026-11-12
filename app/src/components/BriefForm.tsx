"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function BriefForm() {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    setStatus("Starting…");

    const fd = new FormData(e.currentTarget);
    const payload = {
      house: String(fd.get("house") ?? ""),
      bag: String(fd.get("bag") ?? ""),
      spec: String(fd.get("spec") ?? ""),
      horizonYears: Number(fd.get("horizonYears") ?? 5),
      clientType: String(fd.get("clientType") ?? "wearer"),
      cohort: String(fd.get("cohort") ?? "unknown"),
      budget: String(fd.get("budget") ?? ""),
      notes: String(fd.get("notes") ?? ""),
    };

    try {
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status}).`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line) as { status?: string; error?: string; done?: boolean; id?: string };
          if (evt.status) setStatus(evt.status);
          if (evt.error) throw new Error(evt.error);
          if (evt.done && evt.id) {
            setStatus("Done. Opening your brief…");
            router.push(`/brief/${evt.id}`);
            return;
          }
        }
      }
      throw new Error("The connection closed before the brief finished. Try again.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
      setStatus(null);
    }
  }

  return (
    <form className="brief" onSubmit={onSubmit}>
      <label>House
        <input name="house" required placeholder="Fendi" maxLength={80} />
      </label>
      <label>Bag
        <input name="bag" required placeholder="Baguette 26424" maxLength={120} />
      </label>
      <label className="full">Spec (optional)
        <input name="spec" placeholder="Medium, black nappa, gold hardware" maxLength={200} />
      </label>
      <label>Horizon
        <select name="horizonYears" defaultValue="5">
          <option value="5">5 years</option>
          <option value="10">10 years</option>
        </select>
      </label>
      <label>Client
        <select name="clientType" defaultValue="wearer">
          <option value="wearer">Wearer (buys to use)</option>
          <option value="collector">Collector (buys to hold)</option>
          <option value="stylist">Stylist (advising a client)</option>
          <option value="sourcer">Sourcer (hunting a piece)</option>
        </select>
      </label>
      <label>Client generation
        <select name="cohort" defaultValue="unknown">
          <option value="unknown">Not stated</option>
          <option value="gen_alpha">Gen Alpha</option>
          <option value="gen_z">Gen Z</option>
          <option value="millennial">Millennial</option>
          <option value="gen_x">Gen X</option>
          <option value="boomer">Boomer</option>
        </select>
      </label>
      <label>Budget (optional)
        <input name="budget" placeholder="$4,000–$6,000" maxLength={60} />
      </label>
      <label className="full">Notes for the analyst (optional)
        <textarea name="notes" maxLength={600} placeholder="Client already owns a Peekaboo; considering this versus a Lady Dior." />
      </label>
      <div className="full">
        <button className="primary" type="submit" disabled={busy}>{busy ? "Working…" : "Write the brief"}</button>
        <p className="k" style={{ marginTop: 10 }}>Takes two to four minutes. Keep this tab open.</p>
      </div>
      {status && <div className="status full" aria-live="polite">{status}</div>}
      {error && <div className="status error full" role="alert">{error}</div>}
    </form>
  );
}
