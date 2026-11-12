import { recordLink } from "./questions";
/** Read a listing from its link (Katie, 2026-10-24: "a function where I can just drop a link in ... so the tool can directly reference
 *  an active listing"). Shopify sourcers expose a public product JSON; The RealReal blocks automated reads, so its link is read from
 *  the address and from our own reads of that listing. Derived fields only; nothing is stored from the page. */
import { trrListing, catalogByUrl } from "./tracker";
import { HOUSE_SITES, currentEra } from "./designers";

export type Listing = { site: string; title: string; price: number | null; condition: string; url: string; note: string; boutique?: boolean };
const SHOPIFY: Record<string, string> = {
  "madisonavenuecouture.com": "Madison Avenue Couture", "fashionphile.com": "Fashionphile", "shop.rebag.com": "Rebag", "rebag.com": "Rebag",
  "priveporter.com": "Privé Porter", "janefinds.com": "Jane Finds",
};
const UA = "BagIndexResearch/0.1 (personal research; contact via github.com/katherinegraves11)";

export function findUrl(text: string): string | null {
  return text.match(/https?:\/\/[^\s)"']+/i)?.[0] ?? null;
}

export async function readListing(raw: string): Promise<Listing | null> {
  let u: URL; try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "");
  const handle = u.pathname.split("/").filter(Boolean).pop() ?? "";
  const words = (s: string) => decodeURIComponent(s).replace(/-[a-z0-9]{5}$/i, "").replace(/[-_]+/g, " ").trim();
  if (SHOPIFY[host] && /\/products\//.test(u.pathname)) {
    try {
      const r = await fetch(`https://${u.hostname}/products/${handle}.json`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const j = (await r.json()) as { product?: { title?: string; variants?: { price?: string; available?: boolean }[]; tags?: string | string[] } };
        const p = j.product; const price = Number(p?.variants?.[0]?.price ?? NaN);
        const title = String(p?.title ?? words(handle));
        const cond = /pre-?owned/i.test(title) ? "pre-loved" : /vintage/i.test(title) ? "vintage" : "new";
        return { site: SHOPIFY[host], title, price: Number.isFinite(price) ? price : null, condition: cond, url: raw, note: "read from the listing" };
      }
      if (r.status === 404) return { site: SHOPIFY[host], title: words(handle), price: null, condition: "", url: raw, note: "this listing is no longer on the site (likely sold)" };
    } catch { /* fall back to the address */ }
    return { site: SHOPIFY[host], title: words(handle), price: null, condition: "", url: raw, note: "read from the address only" };
  }
  if (/therealreal\.com$/.test(host)) {
    const known = trrListing(handle);
    // The RealReal's titles leave out the house ("Mother Of Pearl Baguette"): put it back, from our read or the address (Sam, round 19)
    const houseOf = known?.house || (handle.split("-")[0] ? handle.split("-")[0].replace(/^\w/, (c) => c.toUpperCase()) : "");
    const t0 = known?.title ? known.title.replace(/\s*\[.*$/, "") : words(handle);
    const title = houseOf && !new RegExp(`^${houseOf}\\b`, "i").test(t0) && !new RegExp(`^${houseOf}\\b`, "i").test(words(handle)) ? `${houseOf} ${t0}` : known?.title ? `${houseOf} ${t0}`.trim() : t0;
    return { site: "The RealReal", title, price: known?.price ?? null, condition: known?.condition ?? "", url: raw, note: known ? `from our read of this listing on ${known.read_date}${known.sold ? " (sold)" : ""}` : "The RealReal does not allow automated reads; read from the address" };
  }
  // a house's own site: the product reference in the address finds the bag and its boutique price in our catalogue reads
  const cat = catalogByUrl(raw);
  if (cat) return { site: host, title: `${cat.house} ${cat.model} (${currentEra(cat.house)})${cat.material ? ` in ${cat.material.toLowerCase()}` : ""}${cat.colour ? `, ${cat.colour.toLowerCase()}` : ""}`, price: cat.price, condition: "new", url: raw, note: `from our read of ${host} on ${cat.date}${cat.stock && /out of stock/i.test(cat.stock) ? " (out of stock)" : ""}`, boutique: true };
  // a house's own site we have not read yet: still a new, current-designer bag at the boutique (Katie, 2026-10-25); the price is asked for
  if (HOUSE_SITES.test(host)) { const house = host.split(".")[0].replace(/^(louisvuitton)$/, "Louis Vuitton").replace(/^(bottegaveneta)$/, "Bottega Veneta").replace(/^(maison-alaia|alaia)$/, "Alaïa").replace(/^(therow)$/, "The Row").replace(/^(miumiu)$/, "Miu Miu").replace(/^(hermes)$/, "Hermès").replace(/^(ysl|saintlaurent)$/, "Saint Laurent").replace(/^\w/, (c) => c.toUpperCase());
    return { site: host, title: `${house} ${words(handle).replace(/\b[A-Z0-9_]{8,}\b/g, "").trim()} (${currentEra(house)})`, price: null, condition: "new", url: raw, note: "read from the address only", boutique: true }; }
  return { site: host, title: words(handle), price: null, condition: "", url: raw, note: "read from the address only" };
}

/** A question with a listing link becomes a question about exactly that bag at that price; with no price known, ask for it
 *  (never guess). Shared by the web route and /api/v1 (Sam, round 13: v1 never read links). */
export async function linkQuestion(question: string): Promise<{ question: string } | { need_price: { title: string; site: string } }> {
  const link = findUrl(question); if (!link) return { question };
  const l = await readListing(link);
  // every pasted link is kept, read or not (Katie, 2026-10-26)
  recordLink({ url: link, question, readOk: !!l, site: l?.site, title: l?.title, price: l?.price ?? null, condition: l?.condition ?? null, note: l?.note, boutique: !!l?.boutique });
  if (!l) return { question };
  const rest = question.replace(link, "").trim();
  // a boutique product page is a new bag at the boutique: ask as a boutique buyer, and the boutique price comes from the catalogue
  if (l.boutique && !l.price && !/\$\s?\d|\b\d{1,3},\d{3}\b/.test(rest)) return { need_price: { title: l.title.replace(/\s*\(.*?\)\s*$/, ""), site: l.site } };
  // a price typed with a house link is the boutique price, never a pre-loved quote ("boutique price" keeps parseQuote off it)
  if (l.boutique && !l.price) { const typed = rest.match(/\$\s?[0-9][0-9,]*[0-9](\.[0-9]+)?|\b\d{1,3},\d{3}\b/)?.[0]; if (typed) return { question: `${l.title}, new at the boutique on ${l.site}, boutique price ${typed.startsWith("$") ? typed : `$${typed}`}. ${rest.replace(typed, "").replace(/\s+([,.?!])/g, "$1").replace(/^[\s,.;]+|\s{2,}/g, " ").trim()}`.slice(0, 1150) }; }
  if (l.boutique) return { question: `${l.title}, new at the boutique on ${l.site}${/out of stock/.test(l.note) ? " (out of stock there)" : ""}. ${rest || "Is it worth buying at the boutique, and will it hold its value?"}`.slice(0, 1150) };
  if (!l.price && !/\$\s?\d|\b\d{1,3},\d{3}\b|\b\d+(\.\d)?\s?k\b/i.test(rest)) return { need_price: { title: l.title.replace(/\b\w/g, (c) => c.toUpperCase()), site: l.site } };
  return { question: `${l.title}${l.condition ? `, ${l.condition} condition` : ""}. Listed on ${l.site}${l.price ? ` for $${Math.round(l.price).toLocaleString("en-US")}` : ""}${/no longer/.test(l.note) ? ` (${l.note})` : ""}. ${rest || "Is it worth buying at this price, and will it go up in value?"}`.slice(0, 1150) };
}
