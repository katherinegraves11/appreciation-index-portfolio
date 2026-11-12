"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Horizon = 1 | 5 | 10;
const Ctx = createContext<{ h: Horizon; setH: (h: Horizon) => void }>({ h: 1, setH: () => {} });
export const useHorizon = () => useContext(Ctx);

/** The dial is the lens: 1 year = now, 10 years = forever. Drives the question, the order of the signals and the mood. */
export function HorizonProvider({ children }: { children: React.ReactNode }) {
  const [h, setHState] = useState<Horizon>(1);
  useEffect(() => {
    try { const u = parseInt(new URLSearchParams(window.location.search).get("h") || "", 10); const s = [1, 5, 10].includes(u) ? u : parseInt(localStorage.getItem("ai-horizon") || "1", 10); if ([1, 5, 10].includes(s)) setHState(s as Horizon); } catch {}
  }, []);
  useEffect(() => {
    const r = document.documentElement; r.classList.remove("h1", "h5", "h10", "forever"); r.classList.add(`h${h}`); if (h === 10) r.classList.add("forever");
    try { localStorage.setItem("ai-horizon", String(h)); } catch {}
    // an answer's address keeps its dial, so a shared link opens the way it was asked (Sam, demo rehearsal)
    try { const u = new URL(window.location.href); if (u.searchParams.get("brief") && u.searchParams.get("h") !== String(h)) { u.searchParams.set("h", String(h)); window.history.replaceState(null, "", u.toString()); } } catch {}
  }, [h]);
  return <Ctx.Provider value={{ h, setH: setHState }}>{children}</Ctx.Provider>;
}

export function Dial() {
  const { h, setH } = useHorizon();
  return (
    <div className="dial" role="radiogroup" aria-label="Horizon">
      {([1, 5, 10] as Horizon[]).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={h === v} onClick={() => setH(v)}>{v === 1 ? "1 year" : v === 5 ? "3 years" : "Forever bag"}<small>{v === 1 ? "worth the money today?" : v === 5 ? "will I get my money back?" : "worth passing down?"}</small></button>
      ))}
    </div>
  );
}

export function ModeCorners() {
  const { h, setH } = useHorizon();
  return (
    <>
      <button type="button" className="mode now" aria-pressed={h === 1} onClick={() => setH(1)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></svg>1 year
      </button>
      <button type="button" className="mode fore" aria-pressed={h === 10} onClick={() => setH(10)}>
        Forever<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></svg>
      </button>
    </>
  );
}
