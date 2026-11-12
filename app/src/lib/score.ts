import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, MODEL, FAST } from "./anthropic";
import { ANALYST_SYSTEM, COHORT_LABELS, LAYERS, SCORING_INSTRUCTIONS } from "./rubric";
import { BriefResult } from "./schema";
import type { BriefInput } from "./schema";
import type { BriefResult as BriefResultT } from "./schema";

/**
 * Step 2: turn the dossier into a scored, structured brief.
 * Structured outputs guarantee the JSON shape; we still re-check the composite math.
 */
export async function runScoring(input: BriefInput, dossier: string) {
  // Ask for the structured shape, but parse leniently: the model occasionally adds a sixth layer or a stray key,
  // and one bad key should not throw away a four-minute research turn. Unknown layers are dropped, then validated.
  const request = {
    model: MODEL,
    max_tokens: 16000,
    system: [{ type: "text" as const, text: ANALYST_SYSTEM, cache_control: { type: "ephemeral" as const } }],
    thinking: { type: "adaptive" as const },
    output_config: { effort: (FAST ? "low" : "medium") as "low" | "medium", format: zodOutputFormat(BriefResult) },
    messages: <{ role: "user" | "assistant"; content: string }[]>[
      {
        role: "user" as const,
        content: `Bag: ${input.house} ${input.bag}${input.spec ? ` (${input.spec})` : ""}\n${input.questionType === "collection" ? `Question type: COLLECTION TIMING${input.season ? ` (${input.season})` : ""}. The client is choosing between pre-order now, buy in store at launch, or buy later on resale. Fill options.\n` : ""}Client: ${input.clientType}, cohort ${COHORT_LABELS[input.cohort ?? "unknown"]}, ${input.horizonYears}-year horizon${input.budget ? `, budget ${input.budget}` : ""}.\n${input.notes ? `Notes and the client's own words: ${input.notes}\n` : ""}\n${SCORING_INSTRUCTIONS}\n\n=== DOSSIER ===\n${dossier}`,
      },
    ],
  };
  const known = new Set(LAYERS.map((l) => l.key as string));
  const validIntents = new Set(["flip_1y", "hold_5y", "hold_10y", "wear"]);
  let parsed: BriefResultT | null = null;
  let usage = { input_tokens: 0, output_tokens: 0 };
  let lastError = "";
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const response = await anthropic.messages.create(request);
    usage = { input_tokens: usage.input_tokens + response.usage.input_tokens, output_tokens: usage.output_tokens + response.usage.output_tokens };
    if (response.stop_reason === "refusal") throw new Error("The model declined this request.");
    const text = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    try {
      const raw = JSON.parse(text) as Record<string, unknown>;
      if (Array.isArray(raw.layers)) raw.layers = (raw.layers as { key?: string }[]).filter((l) => l && known.has(String(l.key)));
      if (Array.isArray(raw.signals)) raw.signals = (raw.signals as { intent?: string }[]).filter((x) => x && validIntents.has(String(x.intent)));
      const check = BriefResult.safeParse(raw);
      if (check.success) parsed = check.data;
      else lastError = check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      // Katie, 2026-10-24: a collector bag bought at the boutique leads with the two choices, never "buy it to carry"
      if (parsed && attempt === 0 && /COLLECTOR OPTION/.test(dossier) && !/\bsell\b/i.test(parsed.plain_answer)) {
        lastError = "plain_answer must lead with the collector choices";
        request.messages.push({ role: "assistant" as const, content: text }, { role: "user" as const, content: `The dossier has a COLLECTOR OPTION. Rewrite plain_answer to lead with the boutique buyer's two choices, in one sentence with figures: sell now for the gain after fees, or keep it as a collector's piece for ten years or more. Never "buy it to carry". Keep everything else consistent. Same JSON shape.` });
        parsed = null;
      }
      // Sam, rounds 4-6: a two-bag question must be answered for both bags; one retry with the reason if the second is missing
      const cmp = (input.notes ?? "").match(/COMPARE WITH: (.*?) ;; (.*?) ;;/);
      const second = cmp ? cmp[2].trim().split(/\s+/).filter((w) => w.length > 2 && !/^(small|medium|large|mini|bag)$/i.test(w))[0] : null;
      if (parsed && second && attempt === 0 && !new RegExp(second, "i").test(`${parsed.plain_answer} ${parsed.timing ?? ""}`)) {
        lastError = `plain_answer and timing never name the second bag (${cmp![1]} ${cmp![2]})`;
        request.messages.push({ role: "assistant" as const, content: text }, { role: "user" as const, content: `The client asked about two bags. Rewrite so plain_answer names both, the ${input.house} ${input.bag} and the ${cmp![1]} ${cmp![2]}, and says which holds value better with one figure each; timing gives the next fact for the one you pick. Same JSON shape.` });
        parsed = null;
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  if (!parsed) throw new Error("Scoring returned an unreadable brief: " + lastError);
  parsed = scopeClaims(parsed);

  // Clamp scores to 0-100 and make sure every layer is present, since the schema can't enforce it.
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const layers = LAYERS.map((l) => {
    const found = parsed.layers.find((x) => x.key === l.key);
    return found
      ? { ...found, score: clamp(found.score) }
      : { key: l.key, score: 0, summary: "No evidence found for this layer.", evidence: [{ text: "No evidence in dossier.", source: "n/a", url: "" }] };
  });

  // Recompute the composite from the weights so the number on the page is always the rubric's number.
  const totalWeight = LAYERS.reduce((s, l) => s + l.weight, 0);
  const composite = Math.round(
    LAYERS.reduce((sum, l) => {
      const layer = layers.find((x) => x.key === l.key);
      return sum + (layer ? layer.score * l.weight : 0);
    }, 0) / totalWeight,
  );

  return { result: { ...parsed, layers, composite }, usage };
}

/** Katie, 2026-10-24: "Only three suede sales exist" reads as a census of the market. A count is what we found in the
 *  sites we track, so absolute count claims are rewritten to "we found N comparable ..." wherever the client reads. */
const NUM = "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a few|a handful of|\\d+)";
const COUNTED = "(?:sales?|sold listings?|listings?|asks?|asking prices?|comps?|comparables?|results?|lots?)";
export function scopeClaim(t: string): string {
  const cap = (x: string, like: string) => (/^[A-Z]/.test(like) ? x[0].toUpperCase() + x.slice(1) : x);
  return t
    // "Only three suede sales exist" / "only 3 sales are on record"
    .replace(new RegExp(`\\b(only|just)\\s+(${NUM})\\s+([^.;:,]{0,40}?\\b${COUNTED})\\s+(?:exists?|are known|is known|are on record|is on record|on record|recorded)\\b`, "gi"), (m, a, n, w) => cap(`we found ${n} comparable ${w}`, a))
    // "Only three suede sales, $16,000 to ..." / "just two asks"
    .replace(new RegExp(`\\b(only|just)\\s+(${NUM})\\s+([^.;:,]{0,40}?\\b${COUNTED})\\b`, "gi"), (m, a, n, w) => cap(`${n} comparable ${w} we found`, a))
    // "There are no suede sales" / "no suede sales exist"
    .replace(new RegExp(`\\bthere (?:are|is) no\\s+([^.;:,]{0,40}?\\b${COUNTED})\\b`, "gi"), (m, w) => cap(`we found no comparable ${w} in the sites we track`, m))
    .replace(new RegExp(`\\bno\\s+([^.;:,]{0,40}?\\b${COUNTED})\\s+exists?\\b`, "gi"), (m, w) => cap(`we found no comparable ${w} in the sites we track`, m))
    // "no photos exist", "none exist"
    .replace(/\bno\s+((?:\w+\s+){0,3}?\w+)\s+exists?\b/gi, (m, w) => cap(`we found no ${w}`, m))
    .replace(/\bnone exists?\b/gi, (m) => cap("we found none", m))
    .replace(/\bthere (?:is|are) no\b/gi, (m) => cap("we found no", m))
    // "dealer" is banned wording (Katie): secondhand sourcer
    .replace(/\bdealers\b/g, "sourcers").replace(/\bDealers\b/g, "Sourcers").replace(/\bdealer\b/g, "sourcer").replace(/\bDealer\b/g, "Sourcer")
    // "secondhand" is "pre-loved" (Katie, 2026-10-24)
    .replace(/\bsecondhand sourcers?\b/g, (m) => (m.endsWith("s") ? "sourcers" : "sourcer")).replace(/\bSecondhand sourcers?\b/g, (m) => (m.endsWith("s") ? "Sourcers" : "Sourcer"))
    .replace(/\bsecond-?hand\b/g, "pre-loved").replace(/\bSecond-?hand\b/g, "Pre-loved")
    // "no sales found" (banned wording), "we found found"
    .replace(/\bno (\w+ )?sales (were )?found\b/gi, (m, w) => cap(`we found no comparable ${w ?? ""}sales`.replace(/\s+/g, " "), m))
    .replace(/\b([a-z]{4,}) \1\b/gi, "$1") // "comparable comparable" (Sam, round 21)
    .replace(/\b(?:a |the )?range of (\$[0-9,]+) to \1\b/gi, (m, v) => `the one price we found, ${v}`) // a single price is never written as a range
    .replace(/\b(we found\b[^.;:]*?)\s+we found\b/gi, "$1")
    // a forecast is never a certainty: "only moves up" / "will only go up" (Katie's no-hallucination rule; round 19 Maxi Flap)
    .replace(/\b(only|always) (moves?|goes|go|keeps? going|rises?) up\b/gi, (m) => cap("has gone up so far", m)).replace(/\bkeeps? (climbing|rising|going up)\b/gi, (m) => cap("has risen so far", m)).replace(/\bwill only (rise|go up|increase)\b/gi, (m) => cap("has risen so far", m))
    // "the only" claims a census; we say what we found (Katie: "we found N", never "only N exist"; Sam, round 16)
    .replace(/\b(T|t)he only\b/g, (m, t) => `${t}he`)
    // working-note wording ("the page's best selling moment") and "average" for what is a middle figure (Sam, round 13)
    .replace(/\b(the|The) page'?s\s+/g, (m, a) => `${a} `)
    .replace(/\bon average\b/gi, (m) => cap("typically", m)).replace(/\ban average of\b/gi, (m) => cap("a middle figure of", m))
    .replace(/\b(the|an?) average\b/gi, (m, a) => cap("the middle", a)).replace(/\baverages?\b/gi, (m) => cap("middle", m))
    // "one asking price only"
    .replace(new RegExp(`\\b(${NUM})\\s+(${COUNTED})\\s+only\\b`, "gi"), (m, n, w) => `${n} ${w} we found`);
}
/** Working notes the client must never read ("Cohort not stated, so no generational adjustment applied"). */
const WORKING_NOTE = /\b(panel verdict|page's range|headline numbers|cohort|generational (adjustment|tilt)|no (\w+ )?adjustment (was )?applied|the dossier|the tracker|not stated)\b/i;
function dropNotes(t: string): string {
  return t.split(/(?<=[.!?;])\s+/).filter((x) => !WORKING_NOTE.test(x)).join(" ").trim();
}
function scopeClaims<T>(v: T): T {
  if (typeof v === "string") return dropNotes(scopeClaim(v)) as T;
  if (Array.isArray(v)) return v.map((x) => scopeClaims(x)).filter((x) => x !== "") as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, k === "source" || k === "url" ? x : scopeClaims(x)])) as T;
  return v;
}
