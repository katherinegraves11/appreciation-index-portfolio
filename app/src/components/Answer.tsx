"use client";

import { priceWord, yearFigures, salesCount, defaultWay, boutiqueLead } from "@/lib/verdict";
import { useState } from "react";
import { useHorizon } from "./Horizon";
import type { BriefResult } from "@/lib/schema";
import type { QuickNumbers } from "@/lib/tracker";
import { toCards, toSignals, INTENT_LABEL, SECTION_SOURCES } from "@/lib/cards";
import BagPlate, { seeItLinks } from "./BagPlate";

const WORD: Record<string, string> = { yes: "Yes", no: "No", wait: "Not yet" };
const CLS: Record<string, string> = { yes: "buy", no: "dont", wait: "wait" };
const DEF: Record<string, string> = {
  flip_1y: "If you sold it within a year.",
  hold_5y: "If you kept it about three years.",
  hold_10y: "Worth passing down?",
  wear: "If you bought it to use.",
};
const GLYPH: Record<string, React.ReactNode> = {
  flip_1y: <><path d="M8 20h32l-3 20H11z" /><path d="M16 20c0-8 16-8 16 0" /><path d="M36 10l4 4-4 4" /><path d="M8 14h32" /></>,
  hold_5y: <><circle cx="24" cy="24" r="16" /><path d="M24 12v12l8 5" /></>,
  hold_10y: <><path d="M10 40V18l14-10 14 10v22z" /><path d="M20 40V28h8v12" /></>,
  wear: <><path d="M14 44V22l-6 2 4-10 12-4 12 4 4 10-6-2v22z" /><path d="M18 10c0 6 12 6 12 0" /></>,
};
const money = (v: number | null | undefined) => (v == null ? "—" : `$${Math.round(v).toLocaleString()}`);

/** Words a buyer should never have to decode. The scorer is told the same list; this is the net. */
const PLAIN: [RegExp, string][] = [
  [/\basks? (typically |usually )?eases? after the first season\b/gi, "sellers drop the price after the first season"],
  [/\basks? (typically |usually )?eases?\b/gi, "sellers drop the price after the first season"],
  [/\ban archive code\b/gi, "a shape the house has made for decades"],
  [/\barchive codes?\b/gi, "shapes the house has made for decades"],
  [/\ban era premium\b/gi, "a bump after the designer leaves"],
  [/\bera premium\b/gi, "the bump a designer's bags get after they leave"],
  [/\bclears? at\b/gi, "sells for about"],
  [/\bsell-through\b/gi, "how fast they sell"],
  [/\bliquidity default\b/gi, "the easiest to resell"],
  [/\bliquid(ity)?\b/gi, "easy to resell"],
  [/\bcomposite\b/gi, "overall score"],
  [/\brealised\b/gi, "actual"],
  [/\s*\[\[ask-link\]\]/g, ""],
];
export function plain(t: string | undefined | null): string { let x = t ?? ""; for (const [re, to] of PLAIN) x = x.replace(re, to); return x; }
/** Bold the lead: the words up to the first comma, colon or semicolon (five at most), so a scanning eye gets the verdict before the fact. */
function Lead({ text }: { text: string }) {
  const m = text.match(/^([^,:;.]{1,60}?)([,:;])\s*([\s\S]*)$/);
  if (m && m[1].split(/\s+/).length <= 5) return <><b>{m[1]}{m[2]}</b> {m[3]}</>;
  const w = text.split(" ");
  if (w.length <= 4) return <b>{text}</b>;
  return <><b>{w.slice(0, 3).join(" ")}</b> {w.slice(3).join(" ")}</>;
}
/** Client-facing text with the [[ask-link]] token turned into a quiet link to the listing the asking price came from. */
function Rich({ text, link, lead }: { text: string; link?: { href: string; label: string } | null; lead?: boolean }) {
  const parts = (text ?? "").split("[[ask-link]]");
  return <>{parts.map((p, i) => <span key={i}>{i === 0 && lead ? <Lead text={plain(p).trim()} /> : plain(p)}{i < parts.length - 1 && link ? <> <a className="asklink" href={link.href} target="_blank" rel="noreferrer">{link.label}</a></> : null}</span>)}</>;
}
/** Small engraved glyphs that give each section a face: a speech bubble for the culture board, a ledger for the numbers, a bell for moments. */
const Glyph = ({ kind }: { kind: "chat" | "ledger" | "bell" | "anchor" | "proof" }) => (
  <svg className="sg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "chat" && <><path d="M4 6h16v9H9l-4 3v-3H4z" /><path d="M8 10.5h8M8 13h5" opacity=".7" /></>}
    {kind === "ledger" && <><rect x="5" y="4" width="14" height="16" rx="1.5" /><path d="M8 9h8M8 12h8M8 15h5" opacity=".7" /></>}
    {kind === "bell" && <><path d="M7 16V11a5 5 0 0 1 10 0v5l1.5 2h-13z" /><path d="M10 20a2 2 0 0 0 4 0" /></>}
    {kind === "anchor" && <><circle cx="12" cy="5" r="2" /><path d="M12 7v13M6 13a6 6 0 0 0 12 0M4 12l2 1M20 12l-2 1" /></>}
    {kind === "proof" && <><path d="M6 4h9l3 3v13H6z" /><path d="M9 11h6M9 14h6M9 17h4" opacity=".7" /></>}
  </svg>
);

/** What a consignor keeps on The RealReal at a given sale price (published tiers, rounded; an estimate, not a quote). */
const payoutRate = (price: number) => price >= 10000 ? 0.85 : price >= 5000 ? 0.8 : price >= 2500 ? 0.75 : price >= 1500 ? 0.7 : price >= 750 ? 0.6 : 0.55;
const fmtDate = (d: string) => { const [y, m] = d.split("-"); const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]; return m ? `${M[Number(m) - 1]} ${y}` : y; };

/** Katie, 2026-10-26: "the box that says yes or no is all we need, and then the snapshot." The box's big word answers the dial's question:
 *  now (1 year), in three years, or pass it down (Forever); the line under it says why in one sentence. */
function dialAnswer(n: QuickNumbers, hz: number, paid: number | null, way: "new" | "used"): { word: string; cls: string; ask: string; line: string } | null {
  const p = n.paths; if (!p) return null;
  if (hz === 10 && n.forever) { const w = n.forever.word === "Forever bag" ? "Yes" : n.forever.word;
    return { word: w, cls: w === "Yes" ? "buy" : w === "A moment" ? "dont" : "wait", ask: "a bag to pass down?", line: n.forever.word === "Forever bag" ? `Pass it down. ${passDown(n)}` : n.forever.line }; }
  if (hz === 5 && paid) { const f = yearFigures(p, paid, way, salesCount(n), n.forward?.lean === "rising").figs.find((x) => x.years === 3);
    if (!f) return null; const w = f.word === "Watching" ? "Not yet" : f.forecast && f.word === "Yes" ? "Likely" : f.word;
    const h3 = p.horizons.find((x) => x.years === 3); const k = (v: number) => Math.round(v * payoutRate(v));
    const r = h3 && h3.lo !== h3.hi ? `${money(k(h3.lo))} to ${money(k(h3.hi))}` : money(f.back);
    return { word: w, cls: w === "Yes" || w === "Likely" ? "buy" : w === "No" ? "dont" : "wait", ask: "worth it in three years?", line: `${f.forecast ? "On current trends" : "On today's prices"}, about ${r} back after fees in three years, against the ${money(paid)} you paid.` }; }
  return null;
}

/** The snapshot (Katie, 2026-10-26: "one incredibly accurate snapshot"): sold secondhand, for sale now, new at the boutique. One range each,
 *  the typical middle when there are four or more prices, with its count and sources in one line. Nothing else on the page repeats them. */
function snapshot(n: QuickNumbers) {
  const span = (lo: number, hi: number) => (lo === hi ? money(lo) : `${money(lo)} to ${money(hi)}`);
  const list = (xs: string[]) => (xs.length > 2 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs.join(" and "));
  const p = n.paths; const t = n.tiers;
  const soldSrc = [...new Set([...(n.sell?.n || t?.trr_sold?.n ? ["The RealReal"] : []), ...(t?.sourcer_sold?.sources ?? []), ...(t?.private_sold?.n ? ["private sales"] : []), ...(t?.auction_sold?.length ? ["auctions"] : [])])];
  const sold = p?.sold ? { range: span(p.sold.lo, p.sold.hi), note: `${p.sold.n} sale${p.sold.n === 1 ? "" : "s"}${soldSrc.length ? ` · ${list(soldSrc)}` : ""}` } : null;
  const ap = [...(t?.sites_asks?.prices ?? [])].sort((x, y) => x - y);
  const qq = (f: number) => ap[Math.min(ap.length - 1, Math.max(0, Math.round(f * (ap.length - 1))))];
  const asking = ap.length ? { range: ap.length >= 4 ? span(qq(0.25), qq(0.75)) : span(ap[0], ap[ap.length - 1]), note: `${ap.length} listing${ap.length === 1 ? "" : "s"}${t?.sites_asks?.sources?.length ? ` · ${list(t.sites_asks.sources)}` : ""}` } : null;
  const bp = p?.boutique?.price ?? n.retail_now;
  const boutique = bp ? { price: bp, note: p?.boutique?.label ? `${p.boutique.label}, the house's price` : "The house's price" } : null;
  // never "not sold new": every one of these came from the boutique first, just scarcely (Katie, 2026-10-26)
  const base = n.retail_base; const baseLabel = base ? base.label.split(/[(,;]/)[0].trim() : "";
  const rare = n.vintage
    ? { word: "Vintage", note: `No longer made.${base ? ` Today's ${baseLabel ? `${baseLabel} ` : ""}is ${money(base.price)} new.` : ""}` }
    : { word: "Rare", note: `Sold new in small numbers; no published price for this version.${base ? ` The standard ${baseLabel ? `${baseLabel} ` : ""}version is ${money(base.price)}.` : ""}` };
  return { sold, asking, boutique, rare };
}

/** Katie, 2026-10-26: "how are we contextualizing for customers that the willingness to pay right now for that it-girl bag is much higher
 *  than the retail price?" One line, written by code, only when real sales run at least 1.5x the boutique price. A finish that is a moment
 *  (a print, a one-season fabric) says so; a forever bag's premium is not called a moment. */
function premiumLine(n: QuickNumbers | null, way: "new" | "used"): { lead: string; next: string } | null {
  const p = n?.paths; if (!p || p.basis === "same-material asks" || salesCount(n) < 2) return null;
  const b = p.boutique?.price ?? n?.retail_now ?? (n?.bySize?.length === 1 ? n.bySize[0].retail : null);
  if (!b) return null;
  const r = p.band.mid / b; if (r < 1.5) return null;
  const moment = n?.forever?.word !== "Forever bag";
  const keepNow = Math.round(p.band.mid * payoutRate(p.band.mid)) - b;
  return {
    // in words, never a figure: the snapshot holds the numbers (approved page; Sam: "about 1.6×" in the box)
    lead: `Buyers are paying ${r < 1.85 ? "well above" : r < 2.15 ? "twice" : r < 2.85 ? "more than twice" : r < 3.15 ? "three times" : "more than three times"} the boutique price right now.${moment ? " That's the moment, not the bag." : ""}`,
    next: way === "new"
      ? (keepNow > 0 ? "Got it at the boutique: sell now and keep the gap, or keep it and enjoy it." : "Got it at the boutique: enjoy it; after fees the gap is small.") /* the headline already gives the dollar gain (Margot's rule: nothing said twice) */
      : moment ? "Paying the market price, you're paying for the moment; it can fade." : "Paying the market price, you're paying for access to a bag the boutique rarely sells.",
  };
}

/** Katie, 2026-10-25: the Forever view says "Yes, pass this down" in plain words: the rare finish, how few have sold, then the house history. */
function passDown(n: QuickNumbers | null): string {
  const f = n?.forever; if (!f) return "";
  const sold = n?.paths?.salesN ?? 0;
  const rare = f.rare ? `A rare ${f.rare} one${sold > 0 && sold <= 10 ? `: only ${sold} sold in the sales we found` : ""}.` : "";
  return [rare, f.line].filter(Boolean).join(" ");
}

export default function Answer({ result, bagName, briefId, numbers, photo }: { result: BriefResult; bagName: string; briefId?: string; numbers: QuickNumbers | null; photo?: string | null }) {
  const [open, setOpen] = useState(false);
  const [buying, setBuying] = useState(false);
  const [paid, setPaid] = useState("");
  const [saved, setSaved] = useState(false);
  /** "Watch this bag" (Katie, 2026-10-24): saves the bag with today's card words and pre-loved middle, so My bags can say when a
   *  "Not yet" turns to Yes or the price moves. Kept on this device until there is sign-in; the daily scans refresh the numbers. */
  const [watched, setWatched] = useState(false);
  function saveWatch() {
    if (!briefId || !n?.paths) return;
    try {
      const p = n.paths; const paid = way === "new" ? p.boutique?.price ?? p.buy.price : p.buy.price;
      const sales = salesCount(n);
      const words = yearFigures(p, paid, way, sales, n.forward?.lean === "rising").figs.map((f) => (f.word === "Yes" ? "Y" : f.word === "No" ? "N" : "W")).join("");
      const cur = (document.cookie.match(/(?:^|; )watch=([^;]*)/)?.[1] ?? "").split(",").filter(Boolean).filter((e) => !e.startsWith(`${briefId}:`));
      document.cookie = `watch=${[`${briefId}:${way === "new" ? "n" : "u"}:${Math.round(paid)}:${Math.round(p.band.mid)}:${words}:${new Date().toLocaleDateString("en-CA")}`, ...cur].slice(0, 60).join(",")}; path=/; max-age=31536000; samesite=lax`;
      setWatched(true);
    } catch { /* cookies blocked */ }
  }
  /** "I'm buying it": the bag and what you paid go to My bags (kept on this device until there is sign-in). */
  function saveBought() {
    const price = Math.round(Number(paid.replace(/[^0-9.]/g, "")));
    if (!briefId || !price) return;
    try {
      const cur = (document.cookie.match(/(?:^|; )bought=([^;]*)/)?.[1] ?? "").split(",").filter(Boolean).filter((e) => !e.startsWith(`${briefId}:`));
      const today = new Date().toLocaleDateString("en-CA");
      document.cookie = `bought=${[`${briefId}:${price}:${today}`, ...cur].slice(0, 60).join(",")}; path=/; max-age=31536000; samesite=lax`;
      setSaved(true); setBuying(false);
    } catch { /* cookies blocked */ }
  }
  // open on the buyer the question describes: "I bought it in store" → new at the boutique, a quote or listing → secondhand (Sam, 2026-10-24)
  const [way, setWay] = useState<"new" | "used">(defaultWay(numbers?.paths));
  // Katie, 2026-10-24: a boutique buyer must always see what they would make selling the same day, even when we hold no boutique price
  const [paidIn, setPaidIn] = useState("");
  const { h: hz } = useHorizon();
  const signals = toSignals(result);
  const cards = toCards(result);
  const n = numbers;
  const askLink = n?.asks?.link ? { href: n.asks.link, label: n.asks.link_label } : null;
  const plainAnswer = plain(result.plain_answer || result.one_line);
  const [first, ...rest] = plainAnswer.split(/(?<=\.)\s+/);
  return (
    <div className="answer">
      <section className="verdict ident">
        {photo ? <img src={photo} alt="" className="vphoto" /> : <BagPlate name={bagName} size={132} className="vplate" />}
        <p className="lab who">{bagName.split(" · ").slice(0, 2).join(" · ").toLowerCase()}</p>
        {bagName.split(" · ").length > 2 && <p className="spec">{bagName.split(" · ").slice(2).join(" · ")}</p>}
      </section>
      {n?.paths && (() => { const p = n.paths; const keepOf = (v: number) => Math.round(v * payoutRate(v));
        const isHard = /(hermès|hermes|chanel)/i.test(bagName);
        // a typed price under $100 is a slip ("9" for $9,000), never a boutique price (Katie, 2026-10-25: "$9 you paid")
        const bPrice = p.boutique?.price ?? ((v) => (v >= 100 ? v : null))(Number(paidIn.replace(/[^0-9.]/g, "")) || 0);
        const keepNow = bPrice ? keepOf(p.band.mid) - bPrice : 0;
        const lead = bPrice ? boutiqueLead(p, bPrice, salesCount(n), n?.forward?.lean === "rising") : { word: "No" as const, lead: "", keepNow: 0 }; // shared with the headline (Sam, round 13)
        const later = p.growthPct != null ? p.horizons[2] : { lo: p.band.lo, mid: p.band.mid, hi: p.band.hi };
        const net5 = keepOf(later.mid) - p.buy.price;
        // Sam, 2026-10-24: the secondhand word judges TODAY's price against what this bag in this condition sells for, so it agrees with the headline
        const asksOnly = p.basis === "same-material asks";
        const usedWord = priceWord(p.buy.price, p.band, asksOnly);
        const dial = null as ReturnType<typeof dialAnswer>; const dialU = null as ReturnType<typeof dialAnswer>; /* Katie, 2026-10-26: the four boxes carry each time frame; the box answers now */ void dialAnswer;
        const pl = premiumLine(n, way);
        const range = (lo: number, hi: number) => (lo === hi ? money(lo) : `${money(lo)} to ${money(hi)}`);
        if (p.buyer === "owner") { // selling a bag you own: what you would get, not whether to buy (Sam, 2026-10-24)
          const getMid = keepOf(p.band.mid);
          return (
            <section className="wayask">
              <p className="lab">selling yours</p>
              <div className="waypanel wait">
                <p className="why"><b>You would get about {money(getMid)} after a typical resale fee.</b> {asksOnly ? "Sellers ask" : p.mixed ? "Sales and asks run" : "Buyers pay"} about {range(p.band.lo, p.band.hi)}{p.condition ? ` for ${p.condition} condition` : ""}. A private sourcer can sometimes place it higher.</p>
              </div>
              <p className="twonote">A read on today&apos;s prices, not a promise.</p>
            </section>
          );
        }
        return (
        <section className="wayask">
          <p className="lab">how are you buying it?</p>
          <div className="dial waypick" role="radiogroup" aria-label="How you are buying it">
            <button type="button" role="radio" aria-checked={way === "new"} onClick={() => setWay("new")}>new<small>{p.boutique ? `at the boutique, ${/estimate/i.test(p.boutique.label) ? "about " : ""}${money(p.boutique.price)}${/estimate/i.test(p.boutique.label) ? " (estimate)" : ""}` : "at the boutique"}</small></button>
            <button type="button" role="radio" aria-checked={way === "used"} onClick={() => setWay("used")}>pre-loved<small>{p.buy.isQuote ? p.buy.label === "your sourcer's price" ? `from your sourcer, ${money(p.buy.price)}` : `at ${money(p.buy.price)}, your quote` : p.buy.label === "what recent ones sold for" ? `recent sales about ${money(p.buy.price)}` : `typical ask ${money(p.buy.price)}`}</small></button>
          </div>
          {way === "new" && !bPrice ? (
            <div className="waypanel wait">
              <p className="why">We don&apos;t have this bag&apos;s boutique price yet. What did you pay?</p>
              <p className="paidin">$<input inputMode="numeric" aria-label="What you paid at the boutique" defaultValue={paidIn} onBlur={(e) => setPaidIn(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setPaidIn((e.target as HTMLInputElement).value); }} placeholder="9,000" /></p>
            </div>
          ) : way === "new" && bPrice ? (
            <div className={`waypanel ${dial ? dial.cls : lead.word === "Yes" ? "buy" : lead.word === "Maybe" ? "wait" : "dont"}`}>
              {/* Katie, 2026-10-26: "an emotional experience that resonates one way or another": a question, a word, one line; no dollar figures
                  here (they sit in the four boxes and the snapshot) */}
              <p className="lab dialask">worth more the moment it&apos;s yours?</p>
              <p className="word">{lead.word === "Yes" ? "Yes." : lead.word === "Maybe" ? "Probably." : "No."}</p>
              <p className="takeaway"><b>{lead.word === "Yes" ? lead.lead : lead.word === "Maybe" ? "Early signs say yes; a few more sales would confirm it." : "Buy it because you love it."}</b></p>
              {pl && <p className="why">{pl.lead}</p>}
            </div>
          ) : (
            <div className={`waypanel ${dialU ? dialU.cls : usedWord === "Good price" || usedWord === "Below asks" ? "buy" : usedWord === "Fair price" || usedWord === "In line" ? "wait" : "dont"}`}>
              {/* Katie, 2026-10-26: "am I overpaying?" answered as a feeling; the ranges sit in the snapshot */}
              {(() => { const f1 = yearFigures(p, p.buy.price, "used", salesCount(n), n?.forward?.lean === "rising").figs[0];
                const big = usedWord === "Too high" ? "Yes, by a lot." : usedWord === "High" ? "A little." : usedWord === "Good price" || usedWord === "Below asks" ? "No, it's a good price." : "No, it's fair.";
                const line = usedWord === "Too high" ? "Hold out for a better price." : usedWord === "High" ? "Try for a little less." : f1.back < p.buy.price ? "Buy it to enjoy, not to profit." : "A good buy that could pay you back.";
                return <>
                  <p className="lab dialask">am I overpaying?</p>
                  <p className="word">{big}</p>
                  <p className="takeaway"><b>{line}</b></p>
                </>; })()}
              {pl && <p className="why">{pl.lead}</p>}
            </div>
          )}
          <p className="twonote">A read on today&apos;s prices, not a promise.</p>
        </section>
      ); })()}

      {!n?.paths && <section className="verdict">
        <h2>{first}{rest.length > 0 ? ` ${rest.join(" ")}` : ""}</h2>
        {(() => { const pl = premiumLine(n, way); return pl ? <p className="premium"><b>{pl.lead}</b> {pl.next}</p> : null; })()}
        {hz === 10 && n?.forever?.word === "Forever bag" && <p className="passdown"><b>Yes, this is a bag to pass down.</b> {passDown(n)}</p>}
        {result.timing && (() => { const t = plain(result.timing); const [a, ...r] = t.split(/(?<=[.;:])\s+/); return <p className="timing"><b>{a}</b>{r.length ? " " + r.join(" ") : ""}</p>; })()}
        <p className="seeit"><span className="lab">go look at it</span>{seeItLinks(bagName.split(" · ")[0] ?? "", bagName.split(" · ")[1] ?? "", n?.links).map((l, i) => <a key={i} href={l.href} target="_blank" rel="noreferrer">{l.label}</a>)}</p>
      </section>}

      <div className="tiles" aria-label="What to do">
        {signals.map((s) => {
          // Katie, 2026-10-24: "we've got to be able to give them a sense of what would happen at 5 and 10 years, not just No, not yet".
          // The 1-, 5- and 10-year cards lead with the dollar figure for the way they are buying, and say what would turn them to Yes.
          // Katie, 2026-10-24: the figure-led cards were not customer-friendly; reverted to the simple word and one line while the
          // Gen Z and millennial panel pressure-test a simpler way to show 5 and 10 years. Flip SHOW_FIGURES to bring them back.
          // Katie, 2026-10-24 (after Zara and Priya): the word, one plain dollar sentence, and one "turns to Yes" line. No dollar headline,
          // no percentage, no savings-rate explanation, no "Watching". Time value of money lives in the Yes/No rule, not on the card.
          const SHOW_FIGURES = true;
          const fig = !SHOW_FIGURES ? null : (() => {
            const p = n?.paths; const years = s.intent === "flip_1y" ? 1 : s.intent === "hold_5y" ? 3 : null; // the forever card is a judgement, never a figure
            if (!p || years == null || p.buyer === "owner") return null; // an owner selling gets the selling panel, not buying figures
            const paid = way === "new" ? (p.boutique?.price ?? ((v) => (v >= 100 ? v : null))(Number(paidIn.replace(/[^0-9.]/g, "")) || 0)) : p.buy.price;
            if (!paid) return null;
            const sales = salesCount(n);
            const f = yearFigures(p, paid, way, sales, n?.forward?.lean === "rising").figs.find((x) => x.years === years)!;
            const basis = f.forecast ? `on current trends (boutique prices up about ${p.growthPct}% a year)` : years > 1 ? "on today's prices; no trend yet to project" : "on today's prices";
            return { ...f, paid, basis };
          })();
          // no computed range: the year cards never say a firm Yes or No from the writer's guess (Sam, round 10: "No" with 0 sales)
          // Katie, 2026-10-25: "Does this mean yes, sell every year or keep?": the 1-year Yes is the pick; later Yeses are forecasts
          const bestNow = (() => { const pp = n?.paths; if (!pp) return false; const pd = way === "new" ? pp.boutique?.price ?? null : pp.buy.price; if (!pd) return false; return yearFigures(pp, pd, way, salesCount(n), n?.forward?.lean === "rising").best?.years === 1; })();
          // the forever card is a code judgement with its history (panel, 2026-10-25); a forecast is "Likely", never "Yes" (Mira)
          const fv = s.intent === "hold_10y" ? n?.forever ?? null : null;
          const word = fv ? (fv.word === "Forever bag" ? "Yes" : fv.word) : fig ? (fig.word === "Watching" ? "Not yet" : fig.forecast && fig.word === "Yes" ? "Likely" : fig.word) : s.intent !== "wear" && !n?.paths ? "Not yet" : WORD[s.verdict];
          const badge = fig && bestNow && fig.years === 1 && fig.word === "Yes" ? "Best: sell now" : null;
          // Katie, 2026-10-26: each box shows the money gained or lost, + green / − red, under the customer's own question
          const signed = (v: number) => `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`;
          const k3 = (v: number) => Math.round(v * payoutRate(v));
          const h3r = n?.paths?.horizons.find((x) => x.years === 3);
          const result = fig && fig.years === 1 ? { big: signed(fig.back - fig.paid), up: fig.back >= fig.paid }
            : fig && h3r ? (() => { const lo = k3(h3r.lo) - fig.paid, hi = k3(h3r.hi) - fig.paid; return { big: lo === hi ? signed(lo) : `${signed(lo)} to ${signed(hi)}`, up: lo + hi >= 0 }; })()
            : null;
          const fvWord = fv ? (fv.word === "Forever bag" ? "Yes" : fv.word === "A moment" ? "Not this one" : "Too soon to tell") : null;
          const needPaid = !fig && !fv && (s.intent === "flip_1y" || s.intent === "hold_5y"); // no price to measure against yet
          // Katie, 2026-10-26: "no numbers here, just in the snapshot": each box is its question, a word and one line
          const plainWord = fig ? (fig.back >= fig.paid ? (fig.forecast && fig.years > 1 ? "Likely" : "Yes") : "No") : null;
          const bigWord = needPaid ? "—" : plainWord ?? fvWord ?? word;
          const cls = plainWord ? (plainWord === "No" ? "dont" : plainWord === "Likely" ? "wait" : "buy") : needPaid ? "wait" : fvWord ? (fvWord === "Yes" ? "buy" : fvWord === "Not this one" ? "dont" : "wait") : word === "Yes" ? "buy" : word === "No" ? "dont" : "wait";
          const QUESTION: Record<string, string> = { flip_1y: "make money selling it within a year?", hold_5y: "make money in three years?", hold_10y: "a bag to pass down?", wear: "worth it just to wear?" };
          const mid = n?.paths?.band.mid ?? 0;
          const line = !fig ? null : fig.years === 1
            ? `${n?.paths?.basis === "same-material asks" ? "Pre-loved ones are listed at" : "Pre-loved ones sell for"} about ${money(mid)}; you'd get back about ${money(fig.back)} after fees${fig.back < Math.round(mid * payoutRate(mid)) - 1 ? ", counting no gain over what you paid until real sales confirm one" : ""}.` // Sam, round 24: the capped figure is said to be capped
            : (() => { const h3 = n?.paths?.horizons.find((x) => x.years === 3); const k = (v: number) => Math.round(v * payoutRate(v)); const r = h3 && h3.lo !== h3.hi ? `${money(k(h3.lo))} to ${money(k(h3.hi))}` : money(fig.back);
                return fig.forecast ? `On current trends, about ${r} back after fees by then${bestNow ? "; a forecast, so selling now is the surer gain" : ""}.` : `On today's prices, about ${r} back after fees.`; })();
          // Katie: "pay for the joy": enjoy the bag, and know when it is also building a collection that holds its value
          const back1 = fig ? null : (() => { const p = n?.paths; if (!p) return null; const paid = way === "new" ? p.boutique?.price ?? null : p.buy.price; if (!paid) return null; const k = Math.round(p.band.mid * payoutRate(p.band.mid)); return { k, paid }; })();
          const wearLine = s.intent !== "wear" ? null : back1 ? (back1.k >= back1.paid * 0.8 ? `Pay for the joy, and build a collection that holds its value: if you ever needed the money, it would bring about ${money(back1.k)}.` : `Pay for the joy, not the resale. If you ever needed the money, it would bring about ${money(back1.k)}.`) : "Pay for the joy, not the resale.";
          // Katie, 2026-10-26: one short line per box; the detail lives in the box above and the snapshot below
          const shortLine = (() => {
            if (fv) { if (fv.word !== "Forever bag") return fv.word === "A moment" ? "It's a trend piece: prints fade, classics last." : "A newer shape; it hasn't proved itself yet.";
              const pct = fv.line.match(/about ([0-9.]+)% a year/)?.[1]; return fv.rare ? `A rare ${fv.rare} one, in a shape that lasts.` : pct ? "A classic, and its boutique price keeps climbing." : "A shape the house has made for decades."; }
            if (fig && fig.years === 1) return fig.back >= fig.paid ? "It's worth more than you paid." : "You'd get back less than you paid.";
            if (fig) return fig.back >= fig.paid ? (fig.forecast ? "If today's trends hold." : "It should hold its value.") : "Fees would keep you below what you paid.";
            if (needPaid) return "Add what you paid above to see this.";
            if (s.intent === "wear") { if (!back1) return "Pay for the joy."; const pct = Math.round((100 * back1.k) / back1.paid); return pct >= 100 ? "And it's worth more than you paid." : pct >= 80 ? "It holds most of its value." : "Buy it for love, not resale."; }
            return line ?? wearLine ?? plain(s.why);
          })();
          return (
          <section key={s.intent} className={`tile ${cls}`} data-intent={s.intent}>
            <svg className="frame" viewBox="0 0 100 100" preserveAspectRatio="none" fill="none" stroke="currentColor"><rect x="1.5" y="1.5" width="97" height="97" rx="3" strokeWidth=".6" /><rect x="4" y="4" width="92" height="92" rx="2" strokeWidth=".3" /></svg>
            <svg className="glyph" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">{GLYPH[s.intent]}</svg>
            <p className="lab intent">{QUESTION[s.intent] ?? (INTENT_LABEL[s.intent]?.title ?? s.intent).toLowerCase()}</p>
            <p className="word">{bigWord}</p>
            <p className="why">{shortLine}</p>
          </section>
          );
        })}
      </div>

      {n && (() => { const sn = snapshot(n); if (!sn.sold && !sn.asking && !sn.boutique && !n.retail_base) return null; return (
        <>
          <p className="lab stripcap"><Glyph kind="ledger" />the snapshot</p>
          <div className="strip snapshot">
            <div><div className="lab">sold secondhand</div><div className="v">{sn.sold ? sn.sold.range : "None found yet"}</div><div className="l">{sn.sold ? sn.sold.note : "No real sales of this exact version yet."}</div></div>
            <div><div className="lab">for sale now</div><div className="v">{sn.asking ? sn.asking.range : "None found"}</div><div className="l">{sn.asking ? sn.asking.note : "No listings of this exact version right now."}</div></div>
            <div><div className="lab">new at the boutique</div><div className="v">{sn.boutique ? money(sn.boutique.price) : sn.rare.word}</div><div className="l">{sn.boutique ? sn.boutique.note : sn.rare.note}</div></div>
          </div>
        </>
      ); })()}

      {briefId && (
        <div className="buyit">
          {!buying && !saved && n?.paths && (watched ? <p>Watching. <a href="/bags">My bags</a> will show when this changes.</p> : <button type="button" className="buybtn watchbtn" onClick={saveWatch}>Watch this bag</button>)}
          {saved ? <p>Saved to <a href="/bags">My bags</a>.</p>
            : !buying ? <button type="button" className="buybtn" onClick={() => { setBuying(true); if (!paid && n?.paths) setPaid(String(way === "new" && n.paths.boutique ? n.paths.boutique.price : n.paths.buy.price)); }}>I&apos;m buying it</button>
            : <form onSubmit={(e) => { e.preventDefault(); saveBought(); }}><label>What are you paying? <input inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="$" autoFocus /></label><button type="submit" className="buybtn">Add to My bags</button></form>}
        </div>
      )}

      <button type="button" className="why-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "hide the why" : "show me why"}</button>
      {open && (
        <div className="edit">





          {(() => {
            const b = n?.buzz;
            const house = bagName.split(" · ")[0] ?? "";
            const bagShort = bagName.split(" · ")[1] ?? "this bag";
            const name: Record<string, string> = { google: "Google", instagram: "Instagram", tiktok: "TikTok", "tiktok-cc": "TikTok", youtube: "YouTube", reddit: "Reddit", pinterest: "Pinterest", "vogue-runway": "Vogue Runway" };
            const plat = (b?.detail ?? "").split(" ").map((d) => d.match(/^([a-z-]+):/i)?.[1]).filter(Boolean).map((k) => name[k as string] ?? k) as string[];
            const readFrom = Array.from(new Set(plat));
            const tiktokRead = readFrom.includes("TikTok");
            // a search rise counts only when it is more than a handful of searches (the note carries "last week N")
            const bagWord = bagShort.toLowerCase().split(/\s+/).find((w) => w.length > 2 && !/^\d+$/.test(w) && !house.toLowerCase().includes(w)) ?? "";
            const growth = (b?.movers ?? []).find((m) => m.platform === "google" && m.metric === "growth_pct_7d" && !!bagWord && m.term.toLowerCase().includes(bagWord) && Number((m.note ?? "").match(/last week (\d+)/)?.[1] ?? 0) >= 5);
            const trendsForHouse = (b?.trends ?? []).filter((t) => new RegExp(house.split(" ")[0], "i").test(t.note) && !/engagement, \d+ brands|most-viewed/i.test(t.note));
            const over = trendsForHouse.find((t) => /deinfluenc|moved on|had its moment|backlash|over\b/i.test(t.note));
            const carrying = (b?.trends ?? []).find((t) => /whatsinmybag|what's in my bag/i.test(t.note)) ?? (b?.trends ?? []).find((t) => /carr(y|ied)|rotation|most-shown/i.test(t.note));
            const dupe = (b?.trends ?? []).find((t) => /dupe|inspired by|boujee on a budget/i.test(t.note));
            const recentEvent = (b?.events ?? []).find((e) => !/fashion month on Instagram/i.test(e.note));
            const fmt = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
            const allTags = (b?.movers ?? []).filter((m) => (m.platform === "instagram" || m.platform.startsWith("tiktok")) && m.metric.startsWith("posts"));
            const bagTags = b?.level === "family" ? allTags : [];
            const houseTags = b?.level === "family" ? [] : allTags;
            const tiktokTrends = (b?.trends ?? []).some((t) => /tiktok|#bagtok|#whatsinmybag/i.test(t.note + t.source));
            const strip = (t: string) => { const i = t.indexOf(": "); return (i > 0 && i < 60 ? t.slice(i + 2) : t).replace(/\s*\(top ~?\d+ visible posts, logged out\)/i, ""); };
            const sentence = (t: string) => strip(t);
            /** The one or two sentences of a note that answer the line, not the whole paragraph. */
            const pick = (t: string, re: RegExp, max = 200) => { const parts = strip(t).split(/(?<=[.;])\s+/); const hit = parts.filter((x) => re.test(x)); const list = hit.length ? hit : parts; let out = list[0] ?? ""; if (list[1] && (out + " " + list[1]).length <= max) out += " " + list[1]; return out; };
            const cult = cards.find((c) => c.key === "culture");
            const mood = !b ? "no gossip yet" : over ? "cooling off" : growth && growth.value > 15 ? "buzzing" : "quiet";
            const cultureCard = (
              <article className={`ecard culture ${!b ? "mixed" : over ? "weak" : growth && growth.value > 15 ? "strong" : "mixed"}`}>
                <header><h4><Glyph kind="chat" />The group chat</h4><span className="stamp">{mood}</span></header>
                <p className="h"><b>{b ? (over ? `The chat says ${bagShort} might be having its moment, then moving on.` : growth && growth.value > 15 ? `Searches for “${growth.term}” up ${Math.round(growth.value)}% this week, against the month before.` : `Quiet week in the chat for ${house}; no hype, no backlash.`) : `The chat hasn't found ${house} yet.`}</b></p>
                {/* Katie, 2026-10-26: each card is its top line; everything else sits in one fold */}
                {(b || cult) && (
                  <details>
                    <summary><Glyph kind="chat" />more</summary>
                    {cult && <p className="so">{plain(cult.soWhat ?? cult.headline)}</p>}
                    <p className="from"><b>{SECTION_SOURCES.culture.about}</b> From {SECTION_SOURCES.culture.from.replace(/^./, (x) => x.toLowerCase())}</p>
                    {b && <>
                    <dl className="bz-lines">
                      <div><dt>Is it over?</dt><dd>{over ? pick(over.note, /deinfluenc|moved on|had its moment|backlash|over\b/i) : trendsForHouse.length ? `Not that we can see. ${pick(trendsForHouse[0].note, new RegExp(house.split(" ")[0], "i"))}` : `No one is calling ${house} over this week.`}</dd></div>
                      <div><dt>Who&apos;s carrying it</dt><dd>{carrying && new RegExp(house.split(" ")[0], "i").test(carrying.note) ? `${pick(carrying.note, new RegExp(house.split(" ")[0], "i"), 160)} One feed, not a survey.` : "We don't track who is carrying this bag yet."}</dd></div>
                      <div><dt>The dupe situation</dt><dd>{dupe ? (new RegExp(house.split(" ")[0], "i").test(pick(dupe.note, /dupe|inspired by|boujee|deinfluenc/i, 160)) ? pick(dupe.note, /dupe|inspired by|boujee|deinfluenc/i, 160) : `Dupes and deinfluencing are circulating among younger buyers. Nothing aimed at ${house} this week.`) : "No dupe or deinfluencing wave touching this house this week."}</dd></div>
                      <div><dt>Where it lives online</dt><dd>{bagTags.length ? bagTags.slice(0, 3).map((t) => `#${t.term} (${Math.round(t.value).toLocaleString()} posts)`).join(", ") : houseTags.length ? `No tag of its own yet. The house's: ${houseTags.slice(0, 2).map((t) => `#${t.term} (${Math.round(t.value) >= 1e6 ? (t.value / 1e6).toFixed(1) + "M" : Math.round(t.value / 1000) + "K"})`).join(", ")}.` : `No hashtag of its own yet; ${house}'s tags carry it.`}</dd></div>
                    </dl>
                    {b.events.filter((e) => !/fashion month on Instagram/i.test(e.note)).length > 0 && (
                      <div className="bz-moments"><p className="lab"><Glyph kind="bell" />moments worth knowing</p>
                        <ol>{b.events.filter((e) => !/fashion month on Instagram/i.test(e.note)).slice(0, 2).map((e, i) => <li key={i}><span className="when">{fmt(e.date)}</span><span className="what">{e.note}</span></li>)}</ol></div>
                    )}
                    <p className="bz-read">Read from {[...readFrom, ...(tiktokTrends && !tiktokRead ? ["TikTok tag pages"] : [])].join(", ") || "the tracker"}{b.read_date ? ` on ${fmt(b.read_date)}` : ""}. Counts only; no posts or people are stored.</p></>}
                  </details>
                )}
              </article>
            );
            const f = n?.forward; const tr = n?.trend;
            const LEANW: Record<string, string> = { rising: "rising", cooling: "cooling", mixed: "mixed", steady: "flat" };
            const headingCard = f && f.signals.length > 0 ? (
              <article className={`ecard ${f.lean === "rising" ? "strong" : f.lean === "cooling" ? "weak" : "mixed"}`}>
                <header><h4><Glyph kind="anchor" />Where it&apos;s heading</h4><span className="stamp">{LEANW[f.lean]}</span></header>

                <p className="h"><b>{/* Katie, 2026-10-26: one cheeky top line */ f.lean === "rising" ? "Every number is pointing up" : f.lean === "cooling" ? "The numbers are cooling off" : f.lean === "mixed" ? "The numbers can't make up their mind" : "Steady as she goes"}{f.confidence === "low" ? ", early days" : ""}.</b></p>
                <details>
                  <summary><Glyph kind="proof" />more</summary>
                  {f.nextBoutique && <p className="so">On its current pace the boutique price reaches about {money(f.nextBoutique.price)} by {f.nextBoutique.date}.</p>}
  <p className="from"><b>Which way this bag&apos;s numbers are moving.</b> From five years of weekly Google searches, the boutique price history, resale asking-price snapshots, and auction results from Bonhams and Artcurial.</p>

                  <ul>
                    {f.signals.map((s) => <li key={s.name}><b>{s.name} {s.dir}.</b> {s.evidence}.</li>)}
                    
                    {tr?.auction && <li><b>Searches and auction prices.</b> {tr.auction}</li>}
                    
                    {tr?.moments?.map((m) => <li key={m.date + m.type}><b>Moment, {fmtDate(m.date)}.</b> {m.what} {m.changePct == null ? "" : `Searches ${m.changePct >= 0 ? "up" : "down"} ${Math.abs(m.changePct)}% in the eight weeks after.`}</li>)}
                    {f.bands && <li><b>Resale on current trends.</b> {f.bands.map((b) => `${b.y} year${b.y === 1 ? "" : "s"}: ${money(b.lo)} to ${money(b.hi)}`).join(" · ")}{n?.sell?.plain ? ", any leather" : ""}.</li>}
                  </ul>
                  <p className="bz-read">A forecast from today&apos;s trends, not a promise.</p>
                </details>
              </article>
            ) : null;
            return (
              <div className="ecards">
                {headingCard}
                {cultureCard}
                {cards.filter((c) => c.key !== "buy" && c.key !== "culture").map((c) => {
              const [proof, ...more] = c.evidence;
              return (
                <article key={c.key} className={`ecard ${c.mood}`}>
                  <header><h4>{c.title}</h4><span className="stamp">{c.mood === "strong" ? "good sign" : c.mood === "weak" ? "weak spot" : "mixed"}</span></header>
                  <p className="h"><b>{plain(c.soWhat ?? c.headline).replace(/\.$/, "")}.</b></p>
                  {(c.soWhat || c.about || proof || more.length > 0) && (
                    <details>
                      <summary><Glyph kind="proof" />more</summary>
                      {c.soWhat && <p className="so">{plain(c.headline)}</p>}
                      {c.about && <p className="from"><b>{c.about}</b> From {c.from?.replace(/^./, (x) => x.toLowerCase())}</p>}
                      <ul>{[...(proof ? [proof] : []), ...more].slice(0, 4).map((e, i) => <li key={i}>{e.text} <span className="src">{e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.source}</a> : e.source}</span></li>)}</ul>
                    </details>
                  )}
                </article>
              );
            })}
              </div>
            );
          })()}

          {/* The close, the way a buying committee ends: the instruction first and largest, against before for, and the turn-our-mind line as one quiet italic. Lead words bold; no sentiment colours. */}
          <div className="watch">
            {result.spec_guidance?.length > 0 && <section className="do"><p className="lab">if you do buy</p><ul>{result.spec_guidance.slice(0, 2).map((b, i) => <li key={i}><Rich text={b} link={askLink} lead /></li>)}</ul></section>}
            <div className="forag">
              <section><p className="lab">the case against</p><ul>{result.bear_case.slice(0, 2).map((b, i) => <li key={i}><Rich text={b} link={askLink} lead /></li>)}</ul></section>
              <section><p className="lab">the case for</p><ul>{result.bull_case.slice(0, 2).map((b, i) => <li key={i}><Rich text={b} link={askLink} lead /></li>)}</ul></section>
            </div>
            {result.what_would_change_this?.length > 0 && <section className="turn"><p className="lab">what would change our mind</p><p className="one"><Rich text={result.what_would_change_this[0]} link={askLink} lead /></p></section>}
          </div>
        </div>
      )}

      <p className="disclaimer">{result.disclaimer}{briefId && <> · <a href={`/brief/${briefId}`}>Full brief with every source</a></>}</p>
    </div>
  );
}
