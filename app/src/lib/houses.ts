/** The houses the MVP covers (Katie, 2026-10-24: "we're starting because it's an MVP with a very specific luxury list ... Customers need to know"). */
export const COVERED_HOUSES = ["Hermès", "Chanel", "Louis Vuitton", "Dior", "Gucci", "Prada", "Miu Miu", "Fendi", "Celine", "Saint Laurent", "Bottega Veneta", "Loewe", "Balenciaga", "The Row", "Alaïa", "Ferragamo"];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ALIASES: Record<string, string> = { hermes: "Hermès", lv: "Louis Vuitton", "louis vuitton": "Louis Vuitton", "christian dior": "Dior", ysl: "Saint Laurent", "yves saint laurent": "Saint Laurent", "saint laurent": "Saint Laurent", bottega: "Bottega Veneta", alaia: "Alaïa", "salvatore ferragamo": "Ferragamo", "the row": "The Row" };

/** The covered house a name refers to, or null when we do not cover it yet. */
export function coveredHouse(name: string): string | null {
  const f = fold(name);
  if (!f) return null;
  for (const h of COVERED_HOUSES) if (fold(h) === f) return h;
  for (const [k, v] of Object.entries(ALIASES)) if (f === k || f.startsWith(k + " ")) return v;
  return null;
}

export const NOT_COVERED = (asked: string) => `We don't cover ${asked} yet. For now we answer for these 16 houses: ${COVERED_HOUSES.join(", ")}. More are coming.`;
