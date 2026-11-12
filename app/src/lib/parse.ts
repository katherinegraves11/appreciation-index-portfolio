import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic } from "./anthropic";
import { BriefInput } from "./schema";
import { hotList } from "./tracker";

const FAST_MODEL = process.env.BAGINDEX_FAST_MODEL || "claude-sonnet-5";

const Parsed = z.object({
  understood: z.boolean().describe("True if the question names something we can research: a specific bag (house + model), OR a family of bags defined by a designer era, collection, material or finish (e.g. 'Blazy\'s pony hair bags' = Chanel, Métiers d\'Art Paris–New York 2026 cheetah pony-hair pieces). Only false when no house or designer can be inferred at all."),
  house: z.string().describe("Brand, e.g. Chanel. Empty if not understood."),
  bag: z.string().describe("Model line (Classic Flap, Souplissimo, Birkin 30) OR the family in plain words when the question is about a group (e.g. 'Métiers d\'Art 2026 pony hair pieces', 'Blazy-era bags', 'Philo-era Celine bags'). Empty if not understood."),
  spec: z.string().describe("ONLY what the client said or their photo shows: never add details they did not give (no diamond hardware unless they said diamonds), never include prices, counts, averages, saves or anything from the context list below. Size, leather, colour, hardware, finish or collection if given (e.g. 'cheetah-print pony hair; Mini 25 hobo, medium flap, bucket bag, clutch, 31 shopping bag'); else empty."),
  horizonYears: z.union([z.literal(5), z.literal(10)]).describe("10 only if the question says ten years or long-term; else 5."),
  clientType: z.enum(["collector", "wearer", "stylist", "sourcer"]).describe("wearer unless the question says collecting, styling a client, or sourcing."),
  cohort: z.enum(["unknown", "gen_alpha", "gen_z", "millennial", "gen_x", "boomer"]),
  budget: z.string().describe("Budget if stated, else empty."),
  clarification: z.string().describe("If not understood: one friendly sentence asking which bag they mean. Else empty."),
  interpretation: z.string().describe("One short sentence telling the client how you read their question, e.g. 'Reading that as the Chanel Métiers d\'Art 2026 cheetah pony-hair Mini 25.' Empty if not understood."),
  questionType: z.enum(["bag", "family", "collection"]).describe("bag = one named model. family = a group defined by designer era, material, finish or collection. collection = a whole runway show / season, or a timing question about pre-ordering vs waiting for bags that have not reached stores yet."),
  compare_house: z.string().describe("When the client compares two bags ('X or Y?', 'X vs Y'), the SECOND bag's house; else empty."),
  compare_bag: z.string().describe("The second bag's model when comparing; else empty."),
  compare_spec: z.string().describe("The second bag's size, leather, colour if given; else empty."),
  season: z.string().describe("For collection questions: the season and show, e.g. 'Spring 2027 ready-to-wear, Paris, 5 Oct 2026'. Else empty."),
});

/** Turn a plain-English question into the structured input the research pipeline needs. */
export async function parseQuestion(question: string) {
  const hot = hotList();
  const response = await anthropic.messages.parse({
    model: FAST_MODEL,
    max_tokens: 2500,
    output_config: { format: zodOutputFormat(Parsed) },
    messages: [
      {
        role: "user",
        content: `A luxury-handbag client asked: "${question.slice(0, 600)}"\nExtract what they are asking about. Model names that are a house plus a number are models, never a Classic Flap: Chanel 25, Chanel 22, Chanel 19, Chanel 31 (bag "Chanel 25", spec "small"). Teen, Mini, Nano are sizes (Celine "Triomphe" with spec "teen"). When the client asks whether to buy a bag now or wait for a coming season, the bag is the bag they would buy now (e.g. "Small Shopping Bag", spec its leather and colour), questionType "bag", and the coming season goes in season. Designer hints (today is October 2026): Matthieu Blazy = Chanel from Dec 2024 (debut Spring 2026 shown Oct 2025; Métiers d\'Art Paris–New York Dec 2025 with cheetah pony-hair pieces; SS27 shown 5 Oct 2026), and Bottega Veneta 2021–2025 before that. Louise Trotter = Bottega Veneta from Jan 2025 (debut Spring 2026 shown Sep 2025; her SS27 show was 26 Sep 2026: new soft structured bags, doubled-size leather and raffia totes, east-west clutches, in store Jan–Mar 2027). Jonathan Anderson = Dior from 2025 (SS27 shown 29 Sep 2026), Loewe 2013–2025. Jack McCollough & Lazaro Hernandez = Loewe from 2025 (SS27 2 Oct 2026: Pasito, Puzzle Charm, new Flamenco). Michael Rider = Celine from 2025. Demna = Gucci from 2025. Pierpaolo Piccioli = Balenciaga from 2025. Maria Grazia Chiuri = Fendi from 2025. Pieter Mulier = Alaïa 2021–2026 (leaving). Anthony Vaccarello = Saint Laurent 2016–2026 (final show SS27, exit announced 9 Oct 2026). Nadège Vanhée = Hermès women\'s (SS27 3 Oct 2026: Rênes, Saut). Phoebe Philo = Celine 2008–2017. Virginie Viard = Chanel 2019–2024. "Bags coming out in 2027" from any of these designers means their Spring 2027 runway bags, already shown in Sep–Oct 2026. A question about a designer\'s bags, a material, a finish or a collection is a valid family question: fill house, put the family in bag, list the known pieces in spec. Clients often describe a bag loosely ("the pony hair bag that came out that\'s selling for crazy", "the new Chanel everyone has", "the Alaïa with the long strap"). Resolve such phrases using this list of what is moving on resale right now (from our tracker, most-saved and most-sold first):\n${hot}\nPick the best match, say so in interpretation, and only set understood=false when no house or designer can be inferred.\n\nCOLLECTION questions: "the bags that just walked", "the new collection from Paris Fashion Week", "pre-order or wait until it hits stores", "Blazy\'s latest show" are questionType=collection. Fill house, season, and set bag to "<Season> runway bags" (e.g. "Spring 2027 runway bags"); put the known families in spec. Known shows: Chanel Spring 2027 ready-to-wear, Paris, 5 Oct 2026 (Blazy\'s third RTW): oversized CC flap (7 looks), double-pocket flap (6), pocketed hobo (4), flat cut-out-handle tote (4), trapezoid flap, CC Box Bag, strass mini flap, 2.55-inspired curved bag, elongated baguette clutch; in store Jan–Mar 2027. Dior Spring 2027, 29 Sep 2026 (Anderson). Louis Vuitton Spring 2027, 6 Oct 2026. Hermès, Loewe, Celine, Bottega Veneta, Miu Miu, Prada, Balenciaga, Alaïa, The Row also showed Spring 2027 in Sep–Oct 2026.`,
      },
    ],
  });
  const p = response.parsed_output;
  if (!p) throw new Error("Could not read the question.");
  if (!p.understood || !p.house || !p.bag) return { ok: false as const, clarification: p.clarification || "Which bag do you mean? A house and a model, or just describe it: 'the new pony hair Chanel'." };
  const clip = (v: string, n: number) => (v && v.length > n ? v.slice(0, n - 1).replace(/[,;\s]+\S*$/, "") + "…" : v);
  // a finish the client never named is never added to the bag (Sam, WGSN round: "Alaïa Le Teckel" came back as cheetah pony hair)
  const FIN = /\b(cheetah|leopard|pony ?hair|calf ?hair|sequins?|fringe|feathers?|crocodile|croc|alligator|ostrich|lizard|python|himalaya|suede|tweed|denim|raffia|shearling|mink|fur|newspaper|crystal|strass|beaded)\b/gi;
  // the same finish in other words counts as named: "croc" keeps crocodile, "calf hair" keeps pony hair (golden set #47, 2026-10-31)
  const same = (s: string) => s.toLowerCase().replace(/\b(pony|calf) ?hair\b/g, "ponyhair").replace(/\bcrocodile\b/g, "croc") /* alligator is its own leather, never croc */.replace(/\bhimalayan\b/g, "himalaya").replace(/s\b/g, "");
  const asked = same(question);
  p.spec = (p.spec || "").replace(FIN, (w) => (asked.includes(same(w)) ? w : "")).replace(/\(\s*\)|,\s*,/g, ",").replace(/^[\s,;]+|[\s,;]+$/g, "").replace(/\s{2,}/g, " ");
  p.interpretation = (p.interpretation || "").replace(/\$\s?[0-9][0-9,.]*k?/g, "").replace(/\s{2,}/g, " ").trim(); /* no invented figures in the loading line */
  const input = BriefInput.parse({
    // prices never ride in the spec ("$17,900" once read as a size 17)
    house: clip(p.house, 80), bag: clip(p.bag, 160), spec: clip(p.spec.replace(/\$\s?[0-9][0-9,.]*\s*k?\b|\b\d{1,3}(,\d{3})+\b|\b\d+(\.\d)?\s?k\b/gi, "").replace(/\b(listed|priced|asking|selling|offered|purchased|bought|paid)?\s*(at|for)\s+(?=(on|in|from|through|via)\b|[,;.]|$)/gi, "").replace(/\s+([,;.])/g, "$1").replace(/\s{2,}/g, " ").trim(), 600) /* no "listed at on The RealReal" (Sam, round 21) */, horizonYears: p.horizonYears, clientType: p.clientType,
    cohort: p.cohort, budget: p.budget, notes: `Client's own words: ${question.slice(0, 420)}${p.compare_bag ? ` | COMPARE WITH: ${p.compare_house || p.house} ;; ${p.compare_bag} ;; ${p.compare_spec}` : ""}`.slice(0, 600),
    questionType: p.questionType || "bag", season: clip(p.season || "", 120),
  });
  return { ok: true as const, input, interpretation: p.interpretation || "" };
}
