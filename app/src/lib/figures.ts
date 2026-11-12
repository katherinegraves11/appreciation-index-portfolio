/** Code sets every dollar figure; the model writes only the words (Katie, 2026-10-24). After an answer is written, each dollar figure
 *  in the client's text is checked against the figures the page computed. A figure that is not one of them (within 2%) loses its
 *  sentence, and where that empties a field, code writes the sentence from the page's own numbers. */
import type { QuickNumbers } from "./tracker";
import { priceWord, payoutRate, yearFigures, salesCount, defaultWay, boutiqueLead } from "./verdict";
import { stockSignal } from "./signalKey";

const money = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

export function allowedFigures(n: QuickNumbers | null): number[] {
  if (!n) return [];
  const out: number[] = [];
  const add = (...v: (number | null | undefined)[]) => { for (const x of v) if (typeof x === "number" && isFinite(x) && x > 0) out.push(x); };
  add(n.retail_now, n.retail_launch, n.ask_median, n.sold_median);
  if (n.sell) add(n.sell.retail, n.sell.median_sold, n.sell.lo, n.sell.hi, ...n.sell.prices); // no mean: an average is never "the middle" (Sam, round 23)
  const t = n.tiers;
  if (t?.sites_asks) add(t.sites_asks.lo, t.sites_asks.median, t.sites_asks.hi, ...(t.sites_asks.prices ?? []));
  if (t?.sourcer_sold) add(t.sourcer_sold.lo, t.sourcer_sold.median, t.sourcer_sold.hi, ...(t.sourcer_sold.rows ?? []).map((r) => r.price));
  for (const r of t?.sourcer_sold?.ranges ?? []) for (const m of r.matchAll(/\$([0-9,]+)/g)) add(Number(m[1].replace(/,/g, "")));
  if (t?.trr_sold) add(...t.trr_sold.raw.map((r) => r.price), ...t.trr_sold.prices);
  if (t?.private_quotes) add(t.private_quotes.median, ...t.private_quotes.prices);
  add(...(t?.auction_sold ?? []).map((a) => a.price));
  if (n.path) add(n.path.from_price, n.path.to_price, n.path.last_from);
  const p = n.paths;
  if (p) {
    add(p.band.lo, p.band.mid, p.band.hi, p.buy.price, p.boutique?.price);
    for (const h of p.horizons) add(h.lo, h.mid, h.hi);
    const keep = (v: number) => Math.round(v * payoutRate(v));
    add(keep(p.band.mid), keep(p.band.lo), keep(p.band.hi));
    const sales = salesCount(n);
    for (const paid of [p.buy.price, p.boutique?.price].filter((x): x is number => !!x)) {
      for (const way of ["new", "used"] as const) for (const f of yearFigures(p, paid, way, sales, n.forward?.lean === "rising").figs) add(f.back, f.pv, Math.abs(f.net), Math.abs(f.back - paid));
      add(Math.abs(keep(p.band.mid) - paid), Math.abs(p.band.mid - paid), Math.abs(p.band.hi - paid), Math.abs(p.band.lo - paid));
    }
  }
  return out;
}

const ok = (v: number, allowed: number[], band?: { lo: number; hi: number } | null) =>
  allowed.some((a) => Math.abs(a - v) <= Math.max(60, a * 0.005)) || (!!band && v >= band.lo && v <= band.hi && v % 100 === 0); // a round counter inside the range

function figuresIn(t: string): number[] {
  return [...t.matchAll(/\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k\b|K\b)?/g)].map((m) => Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1)).filter((v) => v >= 100);
}

/** Drop sentences that carry a figure the page did not compute; return the cleaned text and whether anything was dropped. */
let ASKS: number[] = []; let PCT_OK = false; // the asking prices on this page, set per answer, for "below every ask" claims
/** The writer's comparisons are checked against the numbers (Sam, round 22: "double" for 1.37x, "near the top" at the middle, "below every
 *  ask" with a lower ask on file). A false ratio or "every" claim loses its sentence; a wrong end of the range is reworded. */
function compare(s: string, band: { lo: number; hi: number; mid?: number } | null): string | null {
  const f = figuresIn(s);
  if (/\b(double|twice|two times)\b/i.test(s) && f.length >= 2) { const r = Math.max(f[0], f[1]) / Math.min(f[0], f[1]); if (r < 1.8 || r > 2.2) return null; }
  if (/\b(triple|three times)\b/i.test(s) && f.length >= 2) { const r = Math.max(f[0], f[1]) / Math.min(f[0], f[1]); if (r < 2.7 || r > 3.3) return null; }
  if (/\b(half|halve)\b/i.test(s) && f.length >= 2) { const r = Math.max(f[0], f[1]) / Math.min(f[0], f[1]); if (r < 1.8 || r > 2.2) return null; }
  if (ASKS.length && f.length && /\b(below|under|beneath|lower than|less than) (every|all|any)\b/i.test(s) && f[0] >= Math.min(...ASKS)) return null;
  if (ASKS.length && f.length && /\b(above|over|higher than|more than) (every|all|any)\b/i.test(s) && f[0] <= Math.max(...ASKS)) return null;
  if (band && f.length) { const mid = band.mid ?? (band.lo + band.hi) / 2; const v = f[0];
    if (/\b(near(er)?|at|toward|close to) the (top|high end|upper end)\b/i.test(s) && v < mid) s = s.replace(/\b(near(er)?|at|toward|close to) the (top|high end|upper end)\b/i, "inside");
    if (/\b(near(er)?|at|toward|close to) the (bottom|low end|lower end)\b/i.test(s) && v > mid) s = s.replace(/\b(near(er)?|at|toward|close to) the (bottom|low end|lower end)\b/i, "inside");
    if (band.lo === band.hi) s = s.replace(/\b(sits |is )?(inside|within) the range( we found)?\b/i, "matches the one price we found"); }
  return s;
}
function clean(text: string, allowed: number[], band: { lo: number; hi: number; mid?: number } | null): { text: string; dropped: boolean } {
  const parts = text.split(/(?<=[.!?])\s+/);
  const seen = new Set<string>();
  const kept = parts.map((s) => compare(s, band)).filter((s): s is string => s != null)
    .filter((s) => { const k = s.toLowerCase().replace(/[^a-z]+/g, " ").trim().split(" ").filter((w) => !["it", "the", "a", "an", "this", "one", "and", "just"].includes(w)).slice(0, 3).join(" "); if (k && seen.has(k)) return false; seen.add(k); return true; }) // "Buy it to wear … Buy to wear" (Sam, rounds 24-25)
    .filter((s) => !((/€|\beur\b/i.test(s)) && /\b(times|x|double|twice|half)\b/i.test(s))) // a ratio across currencies
    .filter((s) => ASKS.length > 0 || !/\b(priced from|rests? on|resting on|built on|based on)\b[^.]{0,20}\basks?\b|\b(one|two|three|four|five|\d+) (fur |pre-loved |matching |comparable )?(prices?|asks?)\b|\b(an?|the) (single |lone )?ask\b/i.test(s)) // asks the page does not have
    .filter((s) => !/\b\d{1,3}% of (est\w* )?(retail|boutique)\b/i.test(s) || PCT_OK).filter((s) => figuresIn(s).every((v) => ok(v, allowed, band)))
    // "Chanel raised it in April and September" with no figure is unbacked (Sam, round 20: the rises were on other models)
    .filter((s) => !/\b(raised|raises|price (rise|increase|hike)s?|hiked)\b/i.test(s) || figuresIn(s).length > 0)
    // "made in small runs" / "small seasonal runs": a scarcity claim the tracker does not hold
    .filter((s) => !/\bsmall (seasonal |production )?runs?\b|\bmade in (very )?(small|limited) (numbers|quantities)\b/i.test(s))
    // an offer or counter sits inside the range, never under its low (Sam, round 17: "Offer $248,000" under a $248,488 low)
    .filter((s) => !band || !/\b(offer|counter)/i.test(s) || figuresIn(s).every((v) => v >= band.lo || v < band.lo * 0.5))
    // "X beats Y" only when X is the larger figure (Sam, round 17: "$173,313 now beats $201,434 in five years")
    .filter((s) => { if (!/\b(beats?|outweighs?|tops|better than)\b/i.test(s)) return true; const f = figuresIn(s); return f.length < 2 || f[0] >= f[1]; });
  return { text: kept.join(" ").trim(), dropped: kept.length !== parts.length };
}

export function enforceFigures<T extends { plain_answer: string; timing?: string | null; takeaways?: string[]; signals?: { why: string }[] }>(result: T, n: QuickNumbers | null, question = ""): T {
  if (!n) return result;
  ASKS = [...(n.tiers?.sites_asks?.prices ?? [])]; PCT_OK = false;
  const allowed = [...allowedFigures(n), ...figuresIn(question)];
  if (!n.paths) {
    // no computed range (Sam, round 14): the year reasons say "not yet" like the cards, and a figure the tracker does not hold never
    // reaches the client; the headline then says plainly what we found, never a guessed counter
    const out: T = { ...result };
    const pa = clean(result.plain_answer, allowed, null);
    if (pa.dropped || !pa.text) out.plain_answer = `We found no comparable sales for this exact version yet${n.retail_now ? `; the boutique price is ${money(n.retail_now)}` : ""}.`;
    if (result.timing) { const ti = clean(result.timing, allowed, null); out.timing = ti.text && ti.text.split(/\s+/).length >= 5 ? ti.text : "Wait for real sales of this exact version before treating it as an investment."; }
    if (result.takeaways) out.takeaways = result.takeaways.filter((t) => figuresIn(t).every((v) => ok(v, allowed, null)));
    for (const k of ["bull_case", "bear_case", "what_would_change_this"] as const) { const arr = (result as Record<string, unknown>)[k]; if (Array.isArray(arr)) (out as Record<string, unknown>)[k] = arr.filter((t) => typeof t !== "string" || figuresIn(t).every((v) => ok(v, allowed, null))); }
    if (result.signals) out.signals = result.signals.map((sg) => { const c = clean(sg.why, allowed, null); const yr = /^(flip_1y|hold_5y|hold_10y)$/.test((sg as { intent?: string }).intent ?? ""); return { ...sg, ...(yr ? { verdict: "wait" } : {}), why: c.text || "We found no comparable sales for this exact version yet." }; });
    return out;
  }
  if (!allowed.length) return result;
  const p = n.paths; const band = p ? { lo: p.band.lo, hi: p.band.hi, mid: p.band.mid } : null;
  ASKS = [...(n.tiers?.sites_asks?.prices ?? [])];
  const verb = p?.basis === "same-material asks" ? "are listed at" : p?.mixed ? "sell and are listed at" : "sell for";
  const rangeLine = p ? `Pre-loved ones ${verb} about ${p.band.lo === p.band.hi ? money(p.band.mid) : `${money(p.band.lo)} to ${money(p.band.hi)}`}.` : "";
  const out: T = { ...result };
  const pa = clean(result.plain_answer, allowed, band);
  if (pa.dropped || !pa.text) {
    const w = p ? priceWord(p.buy.price, p.band, p.basis === "same-material asks") : null;
    const code = p ? (p.buy.isQuote && w ? `${w} at ${money(p.buy.price)}: ${rangeLine.charAt(0).toLowerCase()}${rangeLine.slice(1)}` : p.boutique ? `Boutique ${money(p.boutique.price)}; ${rangeLine.charAt(0).toLowerCase()}${rangeLine.slice(1)}` : rangeLine) : "";
    // a headline that carried an uncomputed figure is rewritten whole by code, never patched (a half-kept verdict can contradict it)
    out.plain_answer = code || pa.text || result.plain_answer.replace(/\$\s?[0-9][0-9,]*(\.[0-9]+)?/g, "").trim();
  }
  if (result.timing) { const ti = clean(result.timing, allowed, band); out.timing = ti.text && ti.text.split(/\s+/).length >= 5 && !/[;,]$/.test(ti.text) ? ti.text : rangeLine || result.timing; }
  if (result.takeaways) out.takeaways = result.takeaways.filter((t) => figuresIn(t).every((v) => ok(v, allowed, band)));
  // bull, bear and what-would-change carry no figure the page did not compute (Sam, round 14: "Himalaya middle $196,000 to $121,000")
  for (const k of ["bull_case", "bear_case", "what_would_change_this"] as const) { const arr = (result as Record<string, unknown>)[k]; if (Array.isArray(arr)) (out as Record<string, unknown>)[k] = arr.filter((t) => typeof t !== "string" || (figuresIn(t).every((v) => ok(v, allowed, band)) && clean(t, allowed, band).text.trim().length > 0)).map((t) => (typeof t === "string" ? clean(t, allowed, band).text : t)); } // Sam, round 25: bull and bear get every claim check
  // a reason with an uncomputed figure loses that sentence; an emptied reason falls back to the page's range
  if (result.signals) out.signals = result.signals.map((sg) => { const c = clean(sg.why, allowed, band); return { ...sg, why: c.text || rangeLine }; });
  return out;
}

/** The verdict is decided by code from the page's numbers and written as the headline (Katie, 2026-10-25: "rounds where everything is
 *  passing"). The model's words stay in timing and the reasons; the headline can never contradict the panel or the cards. */
/** The question asks about the long view (same words that move the dial to Forever in Ask.tsx). */
export const PASS_DOWN = /\b(10|ten|20|twenty)[- ]?(years?|yrs?)\b|\bdecades?\b|\bforever\b|\bpass(ed)? (it |this |her )?down\b|\bheirloom\b|\bmy (daughter|son|kids|children)\b|\bgenerations?\b/i;

export function decideHeadline<T extends { plain_answer: string; signals?: { intent: string; verdict: string; why: string }[] }>(result: T, n: QuickNumbers | null, question = ""): T {
  const p = n?.paths;
  if (!p) {
    // no computed range (Sam, round 15): the headline is code too, so it never claims asks or sales the page does not hold; the writer's
    // other words move to timing when they make no claim about prices found
    if (!n) return result;
    // the size the boutique price is for (Sam, demo rehearsal: a Maxi Flap showed the Small's $8,800 with no size named)
    const rsz = (n.retail_size ?? "").split(/[,(]/)[0].trim();
    let head = `We found no comparable sales for this exact version yet${n.retail_now ? `; the boutique price is ${money(n.retail_now)}${rsz && rsz.length <= 24 && !/^\d{4}/.test(rsz) ? ` for the ${rsz.toLowerCase()} size`.replace(/ size size$/, " size") : ""}` : ""}.`;
    if (stockSignal(n.catalog?.stock?.status)) head += ` Out of stock at ${n.catalog!.site} as of ${n.catalog!.stock!.date}, a sign of demand.`;
    const said = result.plain_answer.split(/(?<=[.!?])\s+/).filter((x) => x && !/\b(asks?|asking|sales?|sold|comparables?|range|rests? on|resale|pre-loved ones)\b/i.test(x) && !/\$\s?\d/.test(x)).join(" ");
    const r = result as T & { timing?: string | null };
    return { ...result, plain_answer: head, ...(said && said !== head ? { timing: [said, r.timing].filter(Boolean).join(" ") } : {}) };
  }
  const keep = (v: number) => Math.round(v * payoutRate(v));
  const sales = salesCount(n);
  const asksOnly = p.basis === "same-material asks";
  const verb = `${p.middle ? "typically " : ""}${asksOnly ? "are listed at" : p.mixed ? "sell and are listed at" : "sell for"}`;
  const range = p.band.lo === p.band.hi ? `about ${money(p.band.mid)}` : `about ${money(p.band.lo)} to ${money(p.band.hi)}`;
  const rising = n!.forward?.lean === "rising";
  const collector = /himalaya|porosus|diamond/i.test(`${question} ${p.boutique?.label ?? ""}`);
  const way = defaultWay(p);
  let head: string;
  if (p.buyer === "owner") {
    head = `You'd get about ${money(keep(p.band.mid))} after fees; pre-loved ones ${verb} ${range}.`;
  } else if (way === "used" && p.buy.isQuote) {
    const w = priceWord(p.buy.price, p.band, asksOnly);
    const bought = /\b(bought|purchased|paid|picked up)\b/i.test(question);
    const f1 = yearFigures(p, p.buy.price, "used", sales, rising).figs[0];
    if (bought && f1.word === "Yes") head = `Yes, you could sell it now for about ${money(f1.back - p.buy.price)} more than you paid, after fees; pre-loved ones ${verb} ${range}.`;
    else if (bought) head = `You paid ${money(p.buy.price)}; pre-loved ones ${verb} ${range}, so selling now would bring about ${money(f1.back)} after fees.`;
    else head = `${w === "In line" ? "In line with the asks" : w} at ${money(p.buy.price)}: pre-loved ones ${verb} ${range}.`;
  } else if (way === "new" && p.boutique) {
    const b = p.boutique.price, L = boutiqueLead(p, b, sales, rising);
    head = L.word === "Yes"
      ? `Yes: selling now keeps about ${money(L.keepNow)} more than the ${money(b)} boutique price, after fees.${collector ? " Or keep it as a forever bag to pass down." : ""}`
      : L.word === "Maybe"
        ? `Not yet: pre-loved ones ${verb} ${range}, above the ${money(b)} boutique price; ${asksOnly ? "sales" : "more sales"} would confirm a gain.`
        : `Pay for the joy: pre-loved ones ${verb} ${range}, so selling would ${L.keepNow < 0 ? "bring less than" : "barely beat"} the ${money(b)} boutique price after fees.`;
  } else {
    head = `Pre-loved ones ${verb} ${range}${p.buy.isQuote ? `; your price is ${money(p.buy.price)}` : ""}.`;
  }
  // a pass-down question is answered as one (Katie, 2026-10-25: "Yes, pass this down"; Sam, demo rehearsal: the Birkin 30 got "sell now")
  const passQ = PASS_DOWN.test(question) && p.buyer !== "owner" && !(way === "used" && p.buy.isQuote) && !!n!.forever;
  if (passQ) { const fw = n!.forever!.word; const vs = p.boutique ? `, against ${money(p.boutique.price)} new at the boutique` : "";
    head = fw === "Forever bag" ? `Yes, a bag to pass down: pre-loved ones ${verb} ${range}${vs}.`
      : fw === "A moment" ? `Not one to pass down: ${n!.forever!.line.replace(/\.$/, "")}. Pre-loved ones ${verb} ${range}${vs}.`
      : `Too early to call it a bag to pass down: pre-loved ones ${verb} ${range}${vs}.`; }
  // the signal key on the page itself (Katie, 2026-10-25: "out of stock = demand"); takeaways are not shown, so the headline carries it
  const st = n!.catalog?.stock; if (stockSignal(st?.status)) head += ` Out of stock at ${n!.catalog!.site} as of ${st!.date}, a sign of demand.`;
  // the year signals carry the card words, so "show me why" agrees with the cards
  const figs = yearFigures(p, way === "new" && p.boutique ? p.boutique.price : p.buy.price, way === "new" && p.boutique ? "new" : "used", sales, rising).figs;
  const map: Record<string, number> = { flip_1y: 0, hold_5y: 1 }; // the forever card takes the code judgement below
  const fvv = n!.forever?.word === "Forever bag" ? "yes" : n!.forever?.word === "A moment" ? "no" : "wait";
  const signals = result.signals?.map((s) => (s.intent === "hold_10y" ? { ...s, verdict: fvv } : s.intent in map ? { ...s, verdict: figs[map[s.intent]].word === "Yes" ? "yes" : figs[map[s.intent]].word === "No" ? "no" : "wait" } : s));
  // timing never repeats the headline (Sam, round 16: s09, s12 showed the range line twice)
  const r0 = result as T & { timing?: string | null }; const dupe = !!r0.timing && (head.includes(r0.timing.trim()) || r0.timing.trim().startsWith("Pre-loved ones"));
  // and when the writer's timing only repeated it, code writes one plain next step from the same numbers (Sam, round 17: blank timing)
  const next = (() => {
    if (p.buyer === "owner") return `Selling now would bring about ${money(keep(p.band.mid))} after a typical resale fee.`;
    if (way === "used" && p.buy.isQuote) { const w = priceWord(p.buy.price, p.band, asksOnly);
      if (p.band.lo === p.band.hi) return `${money(p.buy.price)} against the one price we found, ${money(p.band.mid)}.`; // Sam, round 24: h6
      return w === "Too high" || w === "High" ? `Offer no more than ${money(p.band.hi)}, the top of the range we found.` : w === "Good price" || w === "Below asks" ? `At ${money(p.buy.price)} it sits ${p.buy.price >= p.band.lo ? "at the low end of" : "below"} the range we found.` : `${money(p.buy.price)} sits inside the range we found.`; }
    const b = way === "new" && p.boutique ? yearFigures(p, p.boutique.price, "new", sales, rising).best : null;
    if (b && passQ) return `Keep it; if you ever needed to sell, ${b.years === 1 ? "today's prices" : `prices in about ${b.years} years`} would beat the boutique price after fees.`;
    if (b) return `Best time to sell: ${b.years === 1 ? "now" : `in about ${b.years} years`}.`;
    if (way === "new" && p.boutique) { const L = boutiqueLead(p, p.boutique.price, sales, rising); // Sam, round 19: c1 "now or wait" had no next step
      return L.word === "Maybe" ? "Not settled yet: a few more real sales of this version would confirm a gain." : "Buy it to wear: pre-loved ones bring less than the boutique price after fees."; }
    // an ask below the sales is a flag, not "fair" (demo rehearsal, 2026-10-26: the cheetah Chanel 25 showed a $12,500 ask under $17,021-$17,995 sales)
    if (way === "used" && !p.buy.isQuote && p.buy.price < p.band.lo * 0.9) return `Asking prices we found run lower, about ${money(p.buy.price)}; check a cheaper listing is the same size and finish before you buy.`;
    return way === "used" && !p.buy.isQuote ? `A typical asking price is ${money(p.buy.price)}; anything inside the range we found is fair.` : ""; // Sam, round 18: s12 had no next step
  })();
  const empty = dupe || !r0.timing || !r0.timing.trim();
  return { ...result, plain_answer: head, ...(empty ? { timing: next } : {}), ...(signals ? { signals } : {}) };
}

/** Code writes every visible line (Katie, 2026-10-25, chose "code writes it": the writer's own sentences kept failing the rounds).
 *  Timing, the card reasons, the case for, the case against and "what would change our mind" are built here from the page's numbers;
 *  the writer's words remain only in the sourced research cards, each with its link. */
export function codeExplain<T extends { plain_answer: string; timing?: string | null; signals?: { intent: string; verdict: string; why: string }[]; bull_case?: string[]; bear_case?: string[]; what_would_change_this?: string[]; spec_guidance?: string[] }>(result: T, n: QuickNumbers | null, question: string, coming: string | null): T {
  const out: T = { ...result };
  const p = n?.paths;
  const usd = (v: number) => money(v);
  const stock = n?.catalog?.stock && stockSignal(n.catalog.stock.status) ? `Out of stock at ${n.catalog.site} as of ${n.catalog.stock.date}, a sign of demand.` : null;
  if (!n || !p) {
    out.timing = [n?.retail_now ? "Buy it to wear; we hold no pre-loved sales of this exact version yet." : "Wait for real sales of this exact version before treating it as an investment.", n?.tiers?.finished ? null : coming].filter(Boolean).join(" ");
    // a name that is two bags (a cheetah "bucket": the Bucket Bag or a Chanel 25 Mini) shows each with its own numbers, never one merged
    // price (Katie: "break out the alternatives with their own numbers; never guess"; coverage sweep, 2026-10-26)
    if (n?.byModel && n.byModel.length >= 2) out.timing = `This could be one of ${n.byModel.length} bags, priced apart: ${n.byModel.map((m) => `${m.model} ${m.band.lo === m.band.hi ? usd(m.band.mid) : `${usd(m.band.lo)} to ${usd(m.band.hi)}`} (${m.n} sale${m.n === 1 ? "" : "s"}${m.retail ? `; boutique ${usd(m.retail)}` : ""})`).join("; ")}.`;
    out.signals = (result.signals ?? []).map((s) => ({ ...s, ...(s.intent === "wear" ? { verdict: "yes" } : {}), why: s.intent === "wear" ? "Pay for the joy, not the resale." : "We found no comparable sales for this exact version yet." }));
    out.bull_case = [n?.retail_now ? `The boutique price is ${usd(n.retail_now)}.` : "", stock ?? ""].filter(Boolean);
    out.bear_case = ["We found no comparable sales for this exact version yet, so any resale figure would be a guess."];
    out.what_would_change_this = ["Real sales of this exact version, which the daily scans log as they appear."];
    out.spec_guidance = [];
    (out as Record<string, unknown>).one_line = out.plain_answer;
    return out;
  }
  const sales = salesCount(n), rising = n.forward?.lean === "rising", way = defaultWay(p), asksOnly = p.basis === "same-material asks";
  const keep = (v: number) => Math.round(v * payoutRate(v));
  const range = p.band.lo === p.band.hi ? usd(p.band.mid) : `${usd(p.band.lo)} to ${usd(p.band.hi)}`;
  // timing: the decided next step, then what is coming to stores
  const step = decideHeadline({ plain_answer: "", timing: "" } as T, n, question).timing ?? "";
  const owns = p.buyer === "owner" || /\b(i bought|i own|i have|i paid|my )\b/i.test(question);
  out.timing = [step, n.tiers?.finished || owns || way !== "new" ? null : coming].filter(Boolean).join(" "); // runway versions are for a buyer of the plain model, never an owner or a finish (Sam, round 26)
  if (n.byModel?.length) { const by = n.byModel.map((m) => `${m.model} ${m.band.lo === m.band.hi ? usd(m.band.mid) : `${usd(m.band.lo)} to ${usd(m.band.hi)}`} (${m.n} sales${m.retail ? `; boutique ${usd(m.retail)}` : ""})`).join("; ");
    out.timing = `By model: ${by}.`; } // runway versions are the plain model's, never a finish's
  if (!n.byModel?.length && n.bySize?.length) { const by = n.bySize.map((m) => `${m.model} ${m.band.lo === m.band.hi ? usd(m.band.mid) : `${usd(m.band.lo)} to ${usd(m.band.hi)}`} (${m.n} sales${m.retail ? `; boutique ${usd(m.retail)}` : ""})`).join("; ");
    out.timing = `By size: ${by}.`; }
  // the card reasons
  const paid = way === "new" && p.boutique ? p.boutique.price : p.buy.price;
  const figs = yearFigures(p, paid, way === "new" && p.boutique ? "new" : "used", sales, rising).figs;
  const at = (i: number) => figs[i];
  out.signals = (result.signals ?? []).map((s) => {
    if (s.intent === "wear") return { ...s, verdict: "yes", why: `Pay for the joy; if you ever needed the money it would bring about ${usd(keep(p.band.mid))} after fees.` };
    if (s.intent === "hold_10y") return { ...s, verdict: n.forever?.word === "Forever bag" ? "yes" : n.forever?.word === "A moment" ? "no" : "wait", why: n.forever?.line ?? "Too early to call it a bag to pass down." };
    const i = s.intent === "flip_1y" ? 0 : s.intent === "hold_5y" ? 1 : -1; if (i < 0) return s;
    const f = at(i);
    if (p.buyer === "owner") return { ...s, why: i === 0 ? `Selling now brings about ${usd(keep(p.band.mid))} after a typical resale fee.` : f.forecast ? `About ${usd(f.back)} after fees in ${f.years} years, on current trends (a forecast).` : `About ${usd(f.back)} after fees in ${f.years} years on today's prices; no trend yet to project.` };
    return { ...s, why: `${i === 0 ? "Within a year" : `In ${f.years} years`}, about ${usd(f.back)} back after fees against ${usd(paid)}${i > 0 ? " (later years in today's money)" : ""}.${f.trigger ? ` ${f.trigger}` : ""}` };
  });
  // the case for and against, from the numbers only
  const bull: string[] = [], bear: string[] = [];
  if (asksOnly) bear.push(`Priced from ${n.tiers?.sites_asks?.prices?.length ?? "a few"} asking prices, not sales; sales would settle it.`);
  else if (sales >= 5) bull.push(`Real sales behind it: ${sales}, at about ${range}.`);
  else bear.push(`A thin read: ${sales} sale${sales === 1 ? "" : "s"} of this version${p.mixed ? ", with asking prices joining them" : ""}.`);
  if (way === "new" && p.boutique && p.buyer !== "owner") { const L = boutiqueLead(p, p.boutique.price, sales, rising);
    if (L.keepNow > 0) bull.push(`Selling now would keep about ${usd(L.keepNow)} more than the ${usd(p.boutique.price)} boutique price, after fees.`);
    else bear.push(`Pre-loved ones bring about ${usd(Math.abs(L.keepNow))} less than the ${usd(p.boutique.price)} boutique price, after fees.`); }
  if (way === "used" && p.buy.isQuote) { const w = priceWord(p.buy.price, p.band, asksOnly);
    if (w === "Too high" || w === "High") bear.push(`${usd(p.buy.price)} is above the ${usd(p.band.hi)} top of what we found.`);
    else if (w === "Good price" || w === "Below asks") bull.push(`${usd(p.buy.price)} is at or below the low end of what we found, ${usd(p.band.lo)}.`);
    else bull.push(p.band.lo === p.band.hi ? `${usd(p.buy.price)} against the one price we found, ${usd(p.band.mid)}.` : `${usd(p.buy.price)} sits inside what we found, ${range}.`); }
  // a finish or exotic (Himalaya, croc, fur…) is never argued from the plain leather's boutique path
  const special = !!n.tiers?.finished || /himalaya|croc|alligator|ostrich|lizard|python|porosus|niloticus|mink|fur|swakara/.test(`${n.tiers?.material ?? ""}`);
  const cap1 = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  for (const sg of n.forward?.signals ?? []) { if ((special || n.tiers?.material) && (sg.name === "Boutique price" || sg.name === "Auctions")) continue; /* Sam, round 26: 25 Birkin lots of every leather on a Himalaya page */ if (sg.dir === "up") bull.push(cap1(sg.evidence)); else if (sg.dir === "down") bear.push(cap1(sg.evidence)); }
  if (stock) bull.push(stock);
  const au = n.tiers?.auction_sold ?? []; if (au.length) { const a = au[au.length - 1]; bull.push(`At auction: ${a.house} ${a.date.slice(0, 4)}, ${usd(a.price)}.`); }
  // a print or novelty finish rides a moment: the later figures assume today's premium holds (Katie, 2026-10-25: "will this craze hold in 5 and 10 years?")
  if (/leopard|cheetah|animal|pony|polka|sequin|fringe|feather|newspaper|knit|crystal|beaded|mother of pearl/.test(`${n.tiers?.material ?? ""} ${(n as { catalog?: { finish?: string } | null }).catalog?.finish ?? ""} ${n.retail_size ?? ""} ${p.basisNote}`.toLowerCase()) && p.boutique && keep(p.band.mid) > p.boutique.price * 1.3)
    bear.push(`Pre-loved buyers pay about ${Math.round((p.band.mid / p.boutique.price) * 10) / 10} times the ${usd(p.boutique.price)} boutique price for this finish; a trend can fade, and the 5- and 10-year figures assume today's premium holds.`);
  bear.push(`A typical resale fee takes about ${Math.round((1 - payoutRate(p.band.mid)) * 100)}% of the sale price.`);
  out.bull_case = bull.slice(0, 3); out.bear_case = bear.slice(0, 3);
  const trig = figs[0].word === "Yes" ? "A run of lower sales of this exact version would change it." : figs.find((f) => f.trigger)?.trigger; // Sam, round 26: no "turns to Yes" under a Yes
  out.what_would_change_this = [trig ?? "A run of lower sales of this exact version would change it."];
  out.spec_guidance = [];
  (out as Record<string, unknown>).one_line = out.plain_answer; // the full brief page reads the code headline (Sam, round 26)
  return out;
}
