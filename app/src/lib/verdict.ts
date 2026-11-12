/** One verdict on the client's price, shared by the panel and the written answer so they can never disagree (Sam, round 5).
 *  Judged against the page's range for this condition: well above the middle is too high even inside a wide range. */
export type PriceWord = "Too high" | "Fair price" | "Good price" | "High" | "In line" | "Below asks";
export function priceWord(price: number, band: { lo: number; mid: number; hi: number }, asksOnly: boolean): PriceWord {
  // a one-point range has no spread, so a price $20 above it is not "too high" (Sam, round 13: $10,000 vs a single $9,980)
  const one = band.hi - band.lo < band.mid * 0.02;
  const high = one ? price > band.mid * 1.1 : price > band.hi || price > band.mid * 1.2;
  const low = one ? price < band.mid * 0.9 : price < band.lo || price < band.mid * 0.85;
  if (asksOnly) return high ? "High" : low ? "Below asks" : "In line";
  return high ? "Too high" : low ? "Good price" : "Fair price";
}

/** ONE calculation for the 1-, 5- and 10-year figures, shared by the cards, the panel's best time to sell and the written answer's
 *  headline numbers, so they can never disagree (Sam, round 8: the headline said +$6,000 while the 1-year card said −$1,650). */
export const payoutRate = (price: number) => price >= 10000 ? 0.85 : price >= 5000 ? 0.8 : price >= 2500 ? 0.75 : price >= 1500 ? 0.7 : price >= 750 ? 0.6 : 0.55;
export const RATE = 0.04; // today's-money discount (Katie: time value of money), roughly what safe savings pay
export type YearFig = { years: number; back: number; pv: number; net: number; pct: number; word: "Yes" | "Watching" | "No"; trigger: string | null; forecast: boolean };
export function yearFigures(p: { basis: string; mixed?: boolean; band: { lo: number; mid: number; hi: number }; growthPct: number | null; horizons: { years: number; lo: number; mid: number; hi: number }[] }, paid: number, way: "new" | "used", sales: number, rising: boolean): { figs: YearFig[]; best: YearFig | null } {
  const keep = (v: number) => Math.round(v * payoutRate(v));
  const salesBasis = p.basis !== "same-material asks" && !p.mixed;
  const strong = salesBasis && (sales >= 5 || (sales >= 3 && rising));
  const figs = [1, 3, 10].map((years) => { // 3 years replaced 5 (panel, 2026-10-25); 10 stays for the record but is never shown as a figure
    const h = years === 1 ? p.band : p.horizons.find((x) => x.years === years) ?? p.band; // "within a year" is today's figure, so the page has one "now" (Sam, round 9)
    let back = keep(h.mid);
    if (way === "used" && years === 1 && (!salesBasis || sales < 3)) back = Math.min(back, keep(paid)); // no gain from asks or a thin read
    const pv = years > 1 ? Math.round(back / Math.pow(1 + RATE, years)) : back;
    const net = pv - paid, pct = Math.round((back / paid) * 100);
    // Zara and Priya (2026-10-24): No needs real sales behind it (5+); anything thinner is "Not yet" with the one thing that settles it
    // a boutique buyer whose LOWEST pre-loved price, after fees, is still half again the boutique price has a gain that thin data cannot
    // undo (Katie, 2026-10-24, Himalaya: "why wouldn't you then immediately resell it?"); asks count here, they only sit higher
    const clear = way === "new" && years === 1 && p.basis !== "same-material asks" && keep(p.band.lo) >= paid * 1.5; // at least one real sale behind it (one ask is never enough: Sam, round 13)
    const word: YearFig["word"] = net <= 0 && salesBasis && sales >= 5 ? "No" : net > 0 && (strong || clear) ? "Yes" : "Watching";
    const need = Math.max(1, 5 - sales);
    const sellFor = `$${Math.round(paid / payoutRate(paid) * (years > 1 ? Math.pow(1 + RATE, years) : 1)).toLocaleString("en-US")}`;
    // a 1-year figure capped at what was paid already clears the sell-for bar: what is missing is sales, not price (Sam, round 25: h5, h6)
    const cappedGain = keep(h.mid) > paid && back <= paid;
    const trigger = word === "Yes" ? null : net > 0 || cappedGain
      ? (salesBasis ? `Turns to Yes when ${need} more sale${need === 1 ? "" : "s"} of this version confirm it.` : "Turns to Yes when real sales, not asking prices, confirm it.")
      : years === 10 ? "Turns to Yes if boutique prices keep rising and pre-loved sales follow." : `Turns to Yes if pre-loved ones sell for ${sellFor} or more${years > 1 ? " by then" : ""}.`;
    return { years, back, pv, net, pct, word, trigger, forecast: years > 1 && p.growthPct != null };
  });
  // a known gain now beats a forecast (Katie: time value of money): the best time is now whenever now is a gain; otherwise the
  // later moment with the biggest figure in today's money, and only when it is a gain (Sam, round 13: "sell right away" vs "best in 10 years")
  // and only a Yes figure is a best time: a gain on asks or a thin read is not settled (Sam, round 14: "Best time: now" on a Maybe panel)
  // the 3-year card beats "now" only if its low end, in today's money, does (Ines); the forever card is a judgement, never the pick
  const lo3 = (() => { const h = p.horizons.find((x) => x.years === 3); return h ? Math.round(keep(h.lo) / Math.pow(1 + RATE, 3)) - paid : -Infinity; })();
  const yes = figs.filter((f) => f.word === "Yes" && f.net > 0 && f.years < 10 && (f.years !== 3 || lo3 > figs[0].net));
  const top = yes.reduce<YearFig | null>((a, b) => (!a || b.net > a.net ? b : a), null);
  return { figs, best: yes.find((f) => f.years === 1) ?? top };
}

/** Every sale the page counts, Katie's own purchases included (Katie, 2026-10-25: "I'm a real sale"). One count for the cards, the
 *  panel and the headline (Sam, round 13: the headline counted private sales and the cards did not). */
type Cnt = { n?: number } | null | undefined;
/** The RealReal's excellent-condition sales (sell) are also among its any-condition sales (trr_sold): count each sale once (Sam, round 15:
 *  "Based on the 60 sales" beside "17 sales in this leather"). */
export const salesCount = (n: { paths?: { salesN?: number } | null; sell?: { n?: number; plain?: boolean } | null; tiers?: { sourcer_sold?: Cnt; trr_sold?: { n?: number; raw?: { condition: string }[] } | null; private_sold?: Cnt } | null } | null | undefined) => {
  if (typeof n?.paths?.salesN === "number") return n.paths.salesN; // the range's own count: the receipts say the same number (Sam, round 16)
  const sell = n?.sell && !n.sell.plain ? n.sell.n ?? 0 : 0, ts = n?.tiers?.trr_sold; // plain-version sales never count for a finish
  const trr = !ts ? 0 : sell && ts.raw ? ts.raw.filter((r) => !/^(Excellent|Pristine)$/.test(r.condition)).length : ts.n ?? 0;
  return sell + trr + (n?.tiers?.sourcer_sold?.n ?? 0) + (n?.tiers?.private_sold?.n ?? 0);
};

type PathsLike = Parameters<typeof yearFigures>[0] & { buyer?: string | null; buy: { isQuote: boolean; price: number }; boutique: { price: number } | null };
/** Which way the page opens: the same rule for the toggle and the code-written headline. */
export const defaultWay = (p: PathsLike | null | undefined): "new" | "used" =>
  p?.buyer === "boutique" ? "new" : p?.buy.isQuote || p?.buyer === "secondhand" || !p?.boutique ? "used" : "new";

/** The boutique panel's word and bold lead, shared with the headline so they can never disagree. Yes needs the 1-year card's Yes
 *  (enough real sales); a gain on asks or a thin read is "Maybe" (Sam, round 13: one ask gave a firm "worth more"). */
export function boutiqueLead(p: PathsLike, bPrice: number, sales: number, rising: boolean): { word: "Yes" | "Maybe" | "No"; lead: string; keepNow: number } {
  const keepNow = Math.round(p.band.mid * payoutRate(p.band.mid)) - bPrice;
  const f1 = yearFigures(p, bPrice, "new", sales, rising).figs[0];
  if (keepNow >= bPrice * 0.1 && f1.word === "Yes") return { word: "Yes", keepNow, lead: keepNow >= bPrice * 0.5 ? "A big payday. Consider selling right away." : "Worth more than you pay, from day one." };
  if (keepNow >= bPrice * 0.1) return { word: "Maybe", keepNow, lead: p.basis === "same-material asks" ? "Sellers ask more than the boutique price; sales would confirm it." : p.mixed ? "Pre-loved ones sell and are listed above the boutique price; more sales would confirm it." : "Pre-loved ones have sold above the boutique price; a few more sales would confirm it." };
  return { word: "No", keepNow, lead: "Not worth more pre-loved. Buy it to wear." };
}
