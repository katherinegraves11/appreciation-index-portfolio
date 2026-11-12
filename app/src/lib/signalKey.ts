/** The signal key (Katie, 2026-10-25: "a code, kind of like a key, that says out of stock = demand"). One fixed table that turns what a
 *  page shows into what it means. The tracker records the signal; this key says how every answer reads it. Add rows only on Katie's word. */
export type SignalKey = { signal: string; means: string; how: string; since: string };
export const SIGNAL_KEY: Record<string, SignalKey> = {
  out_of_stock: { signal: "Out of stock at the boutique", means: "demand", how: "a sign buyers want it more than the house is supplying; it supports holding value, never a price on its own", since: "2026-10-25" },
  on_hold: { signal: "On hold on The RealReal", means: "a sale", how: "counted with the sales at its listed price, labelled on hold", since: "2026-10-25" },
};
/** Read a page's stock wording into the key ("Notify me when available", "Sold out" → out of stock). */
export function stockSignal(availability: string | null | undefined): keyof typeof SIGNAL_KEY | null {
  return /out of stock|sold out|notify me|unavailable/i.test(availability ?? "") ? "out_of_stock" : null;
}
