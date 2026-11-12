import { z } from "zod";
import { CALLS, LAYERS } from "./rubric";

const layerKeys = LAYERS.map((l) => l.key) as [string, ...string[]];

export const EvidenceItem = z.object({
  text: z.string().describe("One factual sentence with the date it refers to."),
  source: z.string().describe("Publisher name, e.g. 'Sotheby's' or 'Rebag Clair Report 2025'."),
  url: z.string().describe("Source URL from the dossier, or empty string if none."),
});

export const LayerScore = z.object({
  key: z.enum(layerKeys),
  score: z.number().int().describe("0 to 100."),
  summary: z.string().describe("One sentence on why this score, under 22 words."),
  so_what: z.string().optional().describe("The card's one top line (Katie, 2026-10-26): a cheeky, plain-spoken distillation of this layer, under 12 words, the way a sharp friend would say it, true to the evidence, no number the evidence lacks, e.g. 'Hermès raises prices like clockwork; resale follows politely.'"),
  evidence: z.array(EvidenceItem).describe("One to six items. The FIRST item is the single strongest, most numeric fact; the reader may see only that one."),
});

export const SIGNAL_INTENTS = ["flip_1y", "hold_5y", "hold_10y", "wear"] as const;
export const Signal = z.object({
  intent: z.enum(SIGNAL_INTENTS).describe("flip_1y = buy now, sell within a year. hold_5y = buy now, sell in about five years. hold_10y = buy now, keep ten years. wear = buy to use, value is secondary."),
  verdict: z.enum(["yes", "no", "wait"]).describe("yes = do it. no = don't, for this intent. wait = not yet; say what to wait for in why."),
  why: z.string().describe("One plain sentence, under 25 words, no jargon, that a non-expert understands. Name the one fact that decides it."),
});

export const BriefResult = z.object({
  takeaways: z.array(z.string()).optional().describe("Exactly three, each under 12 words, each a fact with a number where possible. The reader who reads nothing else reads these."),
  plain_answer: z.string().describe("The whole answer in one short sentence, under 11 words, written for someone who will read nothing else. No numbers unless one number IS the answer."),
  signals: z.array(Signal).describe("Exactly four entries, one per intent, in the order flip_1y, hold_5y, hold_10y, wear."),
  timing: z.string().describe("One sentence on WHEN to buy or sell: a price increase ahead, a season to wait for, a market that is cooling. Under 25 words."),
  options: z.array(z.object({
    label: z.string().describe("The buying moment, e.g. 'Pre-order now', 'Buy in store at launch', 'Buy on resale later'."),
    verdict: z.enum(["yes", "no", "wait"]),
    why: z.string().describe("One plain sentence, under 25 words, naming the deciding fact."),
  })).optional().describe("Only for timing questions (pre-order vs launch vs later): exactly three options. Omit otherwise."),
  call: z.enum(CALLS),
  confidence: z.enum(["High", "Medium", "Low"]),
  one_line: z.string().describe("The call in plain English for a client, one sentence."),
  composite: z.number().int().describe("Weighted average of the layer scores, 0 to 100."),
  layers: z.array(LayerScore).describe("Exactly one entry per layer key."),
  bull_case: z.array(z.string()).describe("One to five points."),
  bear_case: z.array(z.string()).describe("One to five points."),
  what_would_change_this: z.array(z.string()).describe("One to five points."),
  spec_guidance: z
    .array(z.string())
    .describe("Size, leather, color, hardware guidance the data supports."),
  social_read: z
    .string()
    .describe("Two or three sentences on the TikTok / Instagram / Pinterest picture and whether search confirms it."),
  ownership_and_supply_read: z
    .string()
    .describe("Two or three sentences on ownership, M&A, and supply-chain facts that bear on scarcity and stability."),
  unverified: z.array(z.string()).describe("Claims that could not be verified and were excluded from scoring."),
  disclaimer: z.string(),
});

export type BriefResult = z.infer<typeof BriefResult>;
export type Signal = z.infer<typeof Signal>;
export type EvidenceItem = z.infer<typeof EvidenceItem>;

export const BriefInput = z.object({
  house: z.string().trim().min(1).max(80),
  bag: z.string().trim().min(1).max(160),
  spec: z.string().trim().max(600).optional().or(z.literal("")),
  horizonYears: z.union([z.literal(5), z.literal(10)]),
  clientType: z.enum(["collector", "wearer", "stylist", "sourcer"]),
  cohort: z.enum(["unknown", "gen_alpha", "gen_z", "millennial", "gen_x", "boomer"]).default("unknown"),
  budget: z.string().trim().max(60).optional().or(z.literal("")),
  notes: z.string().trim().max(600).optional().or(z.literal("")),
  questionType: z.enum(["bag", "family", "collection"]).default("bag"),
  season: z.string().trim().max(120).optional().or(z.literal("")),
});
export type BriefInput = z.infer<typeof BriefInput>;
