"use client";

import { useEffect, useRef, useState } from "react";
import BagPlate from "./BagPlate";

type Id = { is_bag: boolean; house: string; model: string; spec: string; designer_era: string; confidence: "high" | "medium" | "low"; alternatives: string[]; tell: string ; listing?: { site: string; price: number | null; condition: string; year: string }; setting?: string };

/** Shrink the photo in the browser so we send a small JPEG, then ask the server what bag it is. */
async function shrink(file: File, max = 1024): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } finally { URL.revokeObjectURL(url); }
}

export default function PhotoDrop({ onAsk, onNewPhoto, disabled, horizon, draft }: { onAsk: (question: string, preview?: string | null, ident?: { house: string; model: string; spec: string; era: string } | null) => void; onNewPhoto?: () => void; disabled?: boolean; horizon: 1 | 5 | 10; draft?: string }) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [id, setId] = useState<Id | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  // Katie, 2026-10-24: drop a photo AND ask your own question about it ("listed on The RealReal for $7,500 — worth buying? will it go up?")
  const [extra, setExtra] = useState("");
  // Katie, 2026-10-25: customers choose. Default: read and not kept. Opt in: kept privately for faster matching (remembered on this
  // device until there is sign-in, where it becomes an account setting).
  const [keep, setKeep] = useState(false);
  useEffect(() => { try { setKeep(localStorage.getItem("keep-photos") === "1"); } catch { /* storage blocked */ } }, []);
  const toggleKeep = (v: boolean) => { setKeep(v); try { localStorage.setItem("keep-photos", v ? "1" : "0"); } catch { /* storage blocked */ } };
  const fileRef = useRef<HTMLInputElement>(null);

  async function handle(file: File | undefined) {
    if (!file || disabled) return;
    if (!/^image\/(jpeg|png|webp|gif|heic|heif)$/i.test(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) { setErr("Drop a photo (JPEG, PNG or WebP)."); return; }
    setErr(null); setId(null); setBusy(true); const typed = (draft ?? "").trim(); setExtra(typed);
    try {
      const image = await shrink(file);
      setPreview(image);
      onNewPhoto?.();
      const res = await fetch("/api/identify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image, keep }) });
      const j = (await res.json()) as Id & { error?: string };
      if (!res.ok || j.error) throw new Error(j.error || "Couldn't read that photo.");
      if (!j.is_bag || !j.house) throw new Error("That doesn't look like a bag we can place. Try a clearer photo of the whole bag.");
      setId(j);
      // a listing screenshot: what the listing says (site, price, condition, year) goes into the question, beside anything typed (Katie, 2026-10-24)
      const L = j.listing;
      if (L && (L.price || L.site)) { const said = `Listed${L.site ? ` on ${L.site}` : ""}${L.price ? ` for $${Math.round(L.price).toLocaleString("en-US")}` : ""}${L.condition ? `, ${L.condition} condition` : ""}${L.year ? `, ${L.year}` : ""}.`; setExtra((x) => (x ? `${said} ${x}` : said)); }
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't read that photo."); setPreview(null); }
    finally { setBusy(false); }
  }

  const question = (name: string) => horizon === 1 ? `Is the ${name} worth buying right now?` : horizon === 5 ? `Will I get my money back on the ${name} in three years?` : `Is the ${name} a bag to pass down?`;
  const name = id ? `${id.house} ${id.model}${id.spec ? ` (${id.spec})` : ""}` : "";
  // the identified bag travels as facts the answer must use; the typed question adds only price, condition and what is asked (Katie, 2026-10-24)
  const ask = (n: string, main = false) => onAsk(extra.trim() ? `${n}. ${extra.trim()}` : question(n), preview, main && id ? { house: id.house, model: id.model, spec: [id.spec, id.listing?.year && !id.spec.includes(id.listing.year) ? `${id.listing.year}` : ""].filter(Boolean).join(", "), era: id.designer_era } : null);

  return (
    <div className="photodrop">
      {!id && (
        <div
          className={`dropzone ${over ? "over" : ""} ${busy ? "busy" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files?.[0]); }}
          onClick={() => fileRef.current?.click()}
          role="button" tabIndex={0} aria-label="Drop a photo of the bag, or tap to choose one"
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
        >
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => handle(e.target.files?.[0] ?? undefined)} />
          {busy ? <span className="dz-main">Reading the photo…</span> : <><span className="dz-main">Drop your photo here</span><span className="dz-sub">or tap to choose one · a screenshot of a listing works</span></>}
        </div>
      )}
      {err && <p className="status error" role="alert">{err}</p>}
      {id && (
        <div className="idcard">
          {preview && <img src={preview} alt="" className="idthumb" />}
          <div className="idbody">
            <p className="lab">looks like · {id.confidence} confidence</p>
            <p className="idname"><b>{id.house}</b> <i>{id.model}</i>{id.spec ? <span className="idspec"> · {id.spec}</span> : null}</p>
            {id.designer_era && <p className="idera">{id.designer_era}</p>}
            <p className="idtell">{id.tell}</p>
            <label className="idq"><span className="lab">your question about this bag (optional)</span>
              <textarea rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(name, true); } }}
                placeholder="e.g. Listed on The RealReal for $7,500, fair condition. Worth buying? Will it go up in value?" /></label>
            <div className="idactions">
              <button type="button" className="go" onClick={() => ask(name, true)}>Ask about this bag</button>
              {id.alternatives.slice(0, 3).map((a) => <button key={a} type="button" className="alt" onClick={() => ask(a)}>or: {a}</button>)}
              <button type="button" className="alt" onClick={() => { setId(null); setPreview(null); }}>different photo</button>
            </div>
          </div>
          <BagPlate name={name} size={64} className="idplate" />
        </div>
      )}
      <label className="photonote keepphotos"><input type="checkbox" checked={keep} onChange={(e) => toggleKeep(e.target.checked)} /> Keep my photos privately for faster matching next time. {keep ? "They are never shown to anyone else." : "Unticked, photos are read once and not kept."}</label>
    </div>
  );
}
