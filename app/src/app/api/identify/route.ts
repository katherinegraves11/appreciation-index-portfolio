import { createHash } from "crypto";
import { photoReading, savePhotoReading } from "@/lib/questions";
import { checkSpend } from "@/lib/limits";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic } from "@/lib/anthropic";
import { hotList, runwayHints, savePhotoRead, houseCatalogNames } from "@/lib/tracker";
import { referencePhotos } from "@/lib/references";
import { CURRENT_DESIGNER, HOUSE_SITES, currentEra } from "@/lib/designers";

export const runtime = "nodejs";
export const maxDuration = 60;

const FAST_MODEL = process.env.BAGINDEX_FAST_MODEL || "claude-sonnet-5";

const Identified = z.object({
  is_bag: z.boolean().describe("False if the picture is not a handbag, clutch, tote or similar."),
  house: z.string().describe("Brand, e.g. Chanel. Empty if unsure."),
  model: z.string().describe("Model line or family, e.g. Souplissimo, Birkin, Sardine, Coco Beach Clownfish Clutch. Empty if unsure."),
  spec: z.string().describe("Size, material, colour, hardware, era if visible, e.g. 'maxi, grained calfskin, dark brown, gold hardware'."),
  designer_era: z.string().describe("Who designed it if you can tell, e.g. 'Blazy era (2026)', 'Lagerfeld era', 'Daniel Lee era'. Empty if unsure."),
  confidence: z.enum(["high", "medium", "low"]),
  alternatives: z.array(z.string()).describe("Up to three other plausible house + model readings, most likely first."),
  tell: z.string().describe("One short sentence on what in the photo gave it away (hardware, quilting, weave, shape). Under 20 words."),
  listing: z.object({
    site: z.string().describe("If this is a screenshot of a listing: the site (The RealReal, Fashionphile...). Else empty."),
    price: z.number().nullable().describe("The listed price in dollars as shown (the current price if marked down). Null if none visible."),
    condition: z.string().describe("Condition as the listing states it (Pristine, Excellent, Very Good, Good, Fair). Empty if none."),
    year: z.string().describe("Collection year as the listing states it, e.g. 2004. Empty if none."),
  }).describe("What a listing screenshot shows. Read it exactly; never guess."),
  setting: z.enum(["runway", "show or re-see", "campaign", "street or worn", "product shot", "listing screenshot", "unknown"]).describe("Where the photo was taken: a catwalk with a show backdrop is runway; a showroom rack or first-look post is show or re-see."),
});

const MammaLook = z.object({ ratio: z.number().describe("The body's height divided by its width, judged from the photo (a flat oblong is about 0.5; nearly square is about 0.8 or more)."), strap: z.enum(["short, tucked under the arm", "long, hangs on the shoulder", "unclear"]), model: z.enum(["Baguette", "Mamma Baguette", "unsure"]) });
const CatalogLook = z.object({ match: z.string().describe("The exact line from the list that this bag is, or \"none\"."), sure: z.boolean().describe("True only if the shape, closure, strap and material all agree.") });
const RefLook = z.object({ match: z.string().describe("The letter of the reference photo that shows the same bag design, or \"none\"."), sure: z.boolean() });
const TopHandle = z.object({ top_handle: z.boolean().describe("True only if a short rigid handle rises from the top of the flap."), sure: z.boolean().describe("True if the top of the bag is clearly visible.") });

/** Ride-or-die rule (Katie, 2026-10-24): runway photos are never vintage. A bag on a runway, at a show or re-see, or in a campaign
 *  belongs to the house's current designer; an earlier designer is never an option. Enforced here in code, not left to the model. */
// the table lives in lib/designers.ts, shared with the link reader
function runwayNeverVintage(out: z.infer<typeof Identified>) {
  // the reader's "two sizes stacked" is one model worn twice; and a current-stamp Baguette 26424 is never pre-2020 (Sam, round 13)
  out = { ...out, model: out.model.replace(/\s*\((two|2|both)[^)]*\)/i, "").trim(), spec: out.spec.replace(/\b(mink|fox|sable|shearling|pony hair|calf hair|rabbit|swakara)\s*(?:or|\/)\s*[\w-]+(?:-look| look)?/gi, "$1") }; // one fur, never "mink or shearling-look" (Sam, round 14)
  if (/26424/.test(out.model) && /pre-?20|vintage|\b(19|200|201)\d/i.test(out.designer_era)) out = { ...out, designer_era: "current collection" };
  // a screenshot from the house's own site is the current designer's, never vintage (Katie, 2026-10-25)
  if (HOUSE_SITES.test(`${out.listing.site} ${out.tell}`.replace(/\s+/g, "").toLowerCase()) || /^(chanel|dior|herm[eè]s|fendi|louis vuitton|gucci|bottega veneta|celine|loewe|prada|saint laurent|the row|ala[iï]a|balenciaga|miu miu)(\.com)?$/i.test(out.listing.site.trim()))
    return { ...out, designer_era: currentEra(out.house), spec: out.spec.replace(/\bvintage\b[^,;]*/gi, "").replace(/\s{2,}/g, " ").trim(), tell: `${out.tell} From the house's own site: the current collection.`.trim() };
  if (!["runway", "show or re-see", "campaign"].includes(out.setting)) return out;
  const key = Object.keys(CURRENT_DESIGNER).find((k) => out.house.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(k));
  const era = key ? CURRENT_DESIGNER[key] : out.designer_era.replace(/vintage|galliano|chiuri|lagerfeld|viard|simons|tom ford|philo|ghesqui[eè]re|kim jones|sabato|daniel lee|jonathan anderson at loewe/gi, "").trim() || "current designer's newest seasons";
  return { ...out, designer_era: era, spec: out.spec.replace(/\bvintage[^,;]*/gi, "").replace(/\s{2,}/g, " ").trim(), tell: `${out.tell} Runway photo: a newest-season piece, not vintage.`.trim() };
}

/** POST /api/identify { image: dataURL } → what bag this is, so the ask box can be filled from a photo. The photo is kept privately only if the customer opted in ("keep my photos"); never shown to others. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { image?: string; keep?: boolean } | null;
  const m = body?.image?.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
  if (!m) return Response.json({ error: "Send a JPEG, PNG or WebP photo." }, { status: 400 });
  const refused = checkSpend(req, "identify");
  if (refused) return Response.json({ error: refused }, { status: 429 });
  const [, mediaType, data] = m;
  if (data.length > 6_000_000) return Response.json({ error: "That photo is too large. Try a smaller one." }, { status: 413 });
  // the same photo is read once: its identification is a fact (never-change rule 4)
  const hash = createHash("sha256").update(data).digest("hex");
  const seen = new URL(req.url).searchParams.get("fresh") ? null : photoReading(hash) as { is_bag?: boolean; house?: string } | null;
  if (seen) { if (seen.is_bag && seen.house) savePhotoRead(seen as Parameters<typeof savePhotoRead>[0], body?.keep ? { data, mediaType } : undefined); return Response.json(seen); }
  try {
    const res = await anthropic.messages.parse({
      model: FAST_MODEL,
      max_tokens: 2000,
      output_config: { format: zodOutputFormat(Identified) },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data } },
          { type: "text", text: `Identify this luxury handbag: house, model line, and visible spec. Use the quilting, weave, hardware, clasp, strap and shape. Houses we track: Hermès, Chanel, Louis Vuitton, Dior, Gucci, Prada, Miu Miu, Fendi, Celine, Saint Laurent, Bottega Veneta, Loewe, Balenciaga, The Row, Alaïa, Ferragamo (others are fine too). Current designers: Blazy at Chanel (Souplissimo, Chanel 25, Coco Beach 2026, cheetah pony hair), Trotter at Bottega (Blazy's Bottega: Andiamo, Sardine, Kalimero, Hop; Lee's: Cassette, Jodie, Pouch), Anderson at Dior. DESIGNER ERA is the designer whose collection THIS piece comes from, never the designer who first made the model: Dior: Galliano 1996-2011 (the original Saddle, 1999), Simons 2012-2015, Chiuri 2016-2025 (the Saddle reissue from 2018, Book Tote), Jonathan Anderson from 2025 (the Saddle Night Bag with a metal frame and chain, and fringe, feather or bead Saddles, are his: Katie, 2026-10-24). Chanel: Lagerfeld 1983-2019, Viard 2019-2024, Blazy from 2025. Fendi: Silvia Venturini Fendi (Baguette, 1997), Kim Jones 2020-2024. A new or current-looking piece, or one in its box, belongs to the current designer unless a tag, stamp or caption says otherwise; if unsure, write "unsure". A bag photographed on a runway, at a show or re-see, or in a campaign is from the current designer's newest seasons, never vintage: match it to the runway list below (for example Dior's cruise 2027 frame-top Saddle: a Saddle with a metal frame-and-clasp top and D-I-O-R charm, by Jonathan Anderson) and say the season. Bags moving on resale right now, for context:\n${hotList()}\nBags just shown on the runway, not yet in stores (a photo from a show, a re-see or a "first look" post is likely one of these; say the season):\n${runwayHints()}\nShapes that are easy to confuse (read the silhouette before the decoration): the Dior Saddle is a kidney or saddle shape, asymmetric, with a curved flap and a "D" hanging from the side; the Saddle Night Bag adds a metal frame and a chain, and can be covered in fringe, feathers or beads. The Lady Dior is a square, structured box with two rounded top handles and D.I.O.R charms on a handle. A fringe or feather covering does not change the model: name the shape underneath. Hermès Kelly (one handle, flap with a strap and turn-lock) vs Birkin (two handles, flap tucked under straps). If the shape is not clear, put the second reading first in alternatives and set confidence to low.
Chanel 25 (Matthieu Blazy, 2025–): a soft hobo gathered by a chain-threaded drawstring with a CC clasp at the front, chain-and-leather shoulder strap, slip pockets on the sides; sizes mini, small, medium, large. Name it "Chanel 25" with the size, never "hobo". The Métiers d'Art 2026 Bucket Bag is a different bag (an upright bucket without the two side pockets): name it "Bucket Bag". Hermès Kelly Cut: name it "Kelly Cut" (it is already the long pochette); "Kelly Pochette" is a different, smaller bag. Read every visible word first: a listing title, a caption ("Chanel s/s 27" means the spring-summer 2027 runway), a dust bag or box stamp ("BAGUETTE 26424"), a tag. Name a fur exactly: long glossy guard hair is mink or fox; short dense crimped wool is shearling; flat short hair is pony hair (calf hair). Never write "shearling/fur" or "mink/pony": choose one and put the other in alternatives. Hermès shapes that share the Kelly turn-lock, told apart by shape (Katie, 2026-10-24: a So Kelly was misread as a Kelly Danse): Kelly = trapezoid with ONE top handle and a flap with straps; Birkin = TWO top handles; So Kelly = a tall, slouchy, unstructured bucket or hobo in soft leather with a long shoulder strap and the turn-lock on a strap across the front, no top handle and no structured flap; a long shoulder strap with a buckle is NOT a top handle, and a soft body that sags or folds is never a Kelly; two of the same bag worn together are named once (model "So Kelly"), never "two sizes stacked"; Kelly Danse = small, compact and structured, a flap with no top handle, worn crossbody or on the belt; Kelly Elan = flat, long and slim; Kelly Cut / Pochette = a flat clutch with a short top handle; Kelly To Go = a wallet on a strap; Kelly Picnic = a Kelly made of woven wicker with a leather flap (never soft leather). If a photo shows two of the same bag, name that bag once. Name a print exactly (leopard, cheetah, polka dot, zebra). Chanel's 2026 Métiers d'Art calf-hair "cheetah print" is light beige with round black spots: call it cheetah print, not polka dot. Fendi lists its current Baguettes on fendi.com as "Baguette 26424"; write it in the model when a dust bag, tag or caption shows it. A Himalaya comes in two versions priced far apart: always name its hardware in the spec, "palladium hardware" or "18k white gold diamond hardware" (pavé diamonds on the turn-lock, padlock and key bell). Fendi shapes (Katie, 2026-10-25: a knit Mamma Baguette was read as a Baguette): the Baguette is short and wide, a flat oblong worn tucked under the arm on a short strap; the Mamma Baguette (Mamma Forever) is taller and deeper, close to square, and hangs on the shoulder from a longer strap. A knit, crochet, beaded or fur body never changes the model: name it by its shape. Always name the family variant the shape shows (Mamma Baguette, Kelly To Go, Shadow Birkin, Saddle Gaucho, Triomphe Besace), never only the family. A Baguette 26424 is a current piece: its era is the current collection, never "pre-2020" or vintage. Use them over your guess. If it is a screenshot of a listing, the listing title may be visible: use it. Give your best single reading and up to three alternatives.` },
        ],
      }],
    });
    const out = res.parsed_output;
    if (!out) throw new Error("no parse");
    let fixed = runwayNeverVintage(out);
    let refHit = false;
    // Katie's reference photos: the same design she has already identified is named the way she named it (picture to picture)
    if (fixed.house) {
      const refs = referencePhotos(fixed.house, `${fixed.model} ${fixed.spec}`);
      if (refs.length) {
        const L = "ABCDEF";
        const look = await anthropic.messages.parse({
          model: FAST_MODEL, max_tokens: 300, output_config: { format: zodOutputFormat(RefLook) },
          messages: [{ role: "user", content: [
            { type: "text", text: "Photo to identify:" },
            { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data } },
            ...refs.flatMap((r, i) => [{ type: "text" as const, text: `Reference ${L[i]}: ${r.house} ${r.model}, ${r.spec}` }, { type: "image" as const, source: { type: "base64" as const, media_type: r.mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: r.data } }]),
            { type: "text", text: "Is the bag in the photo to identify the same design as one of the references (same model, shape, closure and strap; colour and material may differ only if the reference says so)? Answer with the letter, or \"none\". Say sure only if you would bet on it." },
          ] }],
        }).catch(() => null);
        const o = look?.parsed_output; const i = o?.sure ? L.indexOf(o.match.trim().toUpperCase()) : -1; const r = i >= 0 ? refs[i] : null;
        refHit = !!r;
        if (r) fixed = { ...fixed, house: r.house, model: r.model, spec: r.spec || fixed.spec, /* Katie's own label of a reference photo is the fact (never-change rule 4); Sam: ref009 read "small" */ designer_era: r.era || fixed.designer_era, alternatives: [fixed.model, ...fixed.alternatives].slice(0, 3), tell: `Same design as a ${new RegExp(`^${r.house.split(" ")[0]}`, "i").test(r.model) ? r.model : `${r.house} ${r.model}`} we have identified before.` }; /* never the reference's private label: it can name Katie, her sourcer or a price (Sam, WGSN round) */
      }
    }
    // a product shot or listing is checked against the house's current boutique bags: a match is that current bag, never vintage.
    // Never after a reference match: Katie's label is the fact (2026-11-06: her Souplissimo, ref011, was renamed "CHANEL 25 Small Handbag"
    // because chanel.com sells the Souplissimo as "Maxi Flap Bag" and the nearest grained-calfskin line was taken)
    if (!refHit && ["product shot", "listing screenshot", "unknown"].includes(fixed.setting) && fixed.house) {
      const names = houseCatalogNames(fixed.house);
      if (names.length) {
        const look = await anthropic.messages.parse({
          model: FAST_MODEL, max_tokens: 300, output_config: { format: zodOutputFormat(CatalogLook) },
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data } },
            { type: "text", text: `These are the ${fixed.house} bags in the house's boutiques now (from its own site). Is the bag in the photo one of them? Compare shape, closure, strap and material. Answer with the exact line, or "none" if it is an older or different bag.\n${names.join("\n")}` },
          ] }],
        }).catch(() => null);
        const o = look?.parsed_output; const hit = o?.sure ? names.find((n) => n.toLowerCase() === o.match.trim().toLowerCase()) : undefined;
        if (hit) { const key = Object.keys(CURRENT_DESIGNER).find((k) => fixed.house.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(k));
          fixed = { ...fixed, model: hit.replace(/\s*\(.*\)$/, ""), spec: [hit.match(/\((.*)\)$/)?.[1], fixed.spec.replace(/\bvintage\b[^,;]*/gi, "")].filter(Boolean).join(", ").replace(/\s{2,}/g, " ").trim(), designer_era: key ? CURRENT_DESIGNER[key] : "current collection", alternatives: [fixed.model, ...fixed.alternatives].slice(0, 3), tell: `Matches the ${hit} in ${fixed.house}'s boutiques now.` }; }
      }
    }
    // Baguette vs Mamma Baguette is decided by one look at the proportions (Katie, 2026-10-25: a knit Mamma read as a Baguette twice)
    if (/fendi/i.test(fixed.house) && /\bbaguette\b/i.test(fixed.model) && !/\bmamma|mama|nano|soft\b/i.test(fixed.model)) {
      const look = await anthropic.messages.parse({
        model: FAST_MODEL, max_tokens: 300, output_config: { format: zodOutputFormat(MammaLook) },
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data } },
          { type: "text", text: "Look only at this Fendi bag's proportions and strap, not its material. A Baguette is a flat oblong, about twice as wide as it is tall, on a short strap that tucks it under the arm. A Mamma Baguette is taller and deeper, close to square, on a longer strap that hangs it from the shoulder. Measure the body's height against its width, then say which it is." },
        ] }],
      }).catch(() => null);
      const o = look?.parsed_output;
      if (o && o.model === "Mamma Baguette" && o.ratio >= 0.7 && o.strap === "long, hangs on the shoulder") fixed = { ...fixed, model: fixed.model.replace(/\bbaguette\b/i, "Mamma Baguette"), alternatives: [fixed.model, ...fixed.alternatives.filter((a) => !/mamma/i.test(a))].slice(0, 3), tell: `${fixed.tell} Close to square on a longer shoulder strap: a Mamma Baguette.`.trim() };
    }
    // Kelly vs So Kelly is decided by one look at the top of the bag (Sam, rounds 13-14: two So Kellys read as Kellys twice)
    if (/herm/i.test(fixed.house) && /\bkelly\b/i.test(fixed.model) && !/\bso kelly\b|pochette|cut|danse|elan|picnic|moove|depeches|longue|doll/i.test(fixed.model)) {
      const look = await anthropic.messages.parse({
        model: FAST_MODEL, max_tokens: 300, output_config: { format: zodOutputFormat(TopHandle) },
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data } },
          { type: "text", text: "Look only at how this Hermès bag is carried. A Kelly has a short, rigid, rolled handle rising from the top of the flap, and a structured trapezoid body. A So Kelly has NO top handle: its only carrying piece is a long shoulder strap (often with a buckle), and its soft body sags. Is there a short rigid top handle on the flap?" },
        ] }],
      }).catch(() => null);
      if (look?.parsed_output && !look.parsed_output.top_handle && look.parsed_output.sure) fixed = { ...fixed, model: "So Kelly", alternatives: [fixed.model, ...fixed.alternatives.filter((a) => !/so kelly/i.test(a))].slice(0, 3), tell: `${fixed.tell} No top handle, a shoulder strap and a soft body: a So Kelly.`.trim() };
    }
    // the identified bag is always clocked; the photo itself only when the customer opted in (Katie, 2026-10-25)
    if (fixed.is_bag && fixed.house) savePhotoRead(fixed, body?.keep ? { data, mediaType } : undefined);
    if (fixed.is_bag && fixed.house) savePhotoReading(hash, fixed);
    return Response.json(fixed);
  } catch (err) {
    console.error("[identify]", err instanceof Error ? err.message : err);
    return Response.json({ error: "Couldn't read that photo. Try a clearer shot of the whole bag." }, { status: 500 });
  }
}
