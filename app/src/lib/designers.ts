/** The houses' current designers, and the houses' own sites. Katie, 2026-10-25: "if I'm sending you anything from a Chanel.com link, that
 *  is from the most recent designer. Same goes for any of the brands." A runway photo and a house-site link or screenshot are both the
 *  current designer's, never vintage. Houses without a named designer here read as "current collection". */
export const CURRENT_DESIGNER: Record<string, string> = {
  dior: "Jonathan Anderson era (2025–)", chanel: "Matthieu Blazy era (2025–)", "bottega veneta": "Louise Trotter era (2025–)",
  gucci: "Demna era (2025–)", loewe: "McCollough and Hernandez era (2025–)", balenciaga: "Pierpaolo Piccioli era (2025–)", celine: "Michael Rider era (2025–)",
};
export const HOUSE_SITES = /\b(chanel|dior|hermes|fendi|louisvuitton|gucci|bottegaveneta|celine|loewe|prada|ysl|saintlaurent|therow|maison-alaia|alaia|balenciaga|miumiu|ferragamo|valentino|loropiana|jacquemus|chloe)\.com\b/i;
export function currentEra(house: string): string {
  const h = house.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const k = Object.keys(CURRENT_DESIGNER).find((x) => h.includes(x)); return k ? CURRENT_DESIGNER[k] : "current collection";
}
