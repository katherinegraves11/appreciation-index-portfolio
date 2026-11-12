import Anthropic from "@anthropic-ai/sdk";
import { anthropic, RESEARCH_MODEL, FAST } from "./anthropic";
import { ANALYST_SYSTEM, researchPrompt } from "./rubric";
import { buildTrackerDossier, buzzDossier, collectionDossier, headlineNumbers, ownershipDossier, pestelDossier, evidenceCheck, saveWebFinding, webFindings, macLookup, bagStanding, saveMoment } from "./tracker";
import type { BriefInput } from "./schema";

export type Source = { title: string; url: string };

export type ResearchOutput = {
  dossier: string;
  sources: Source[];
  usage: { input_tokens: number; output_tokens: number };
  trackerRows: number;
};

/**
 * Step 1: build the evidence dossier with Claude's server-side web search.
 * Streams so long research turns don't hit HTTP timeouts, and resumes on pause_turn.
 */
export async function runResearch(
  input: BriefInput,
  onProgress?: (line: string) => void,
): Promise<ResearchOutput> {
  // Guardrail: does the tracker hold prices for this exact version (its finish), not just the model?
  let check = evidenceCheck(input.house, input.bag, input.spec || undefined);
  if (check.gap) { // first look where these bags are listed, then re-check
    onProgress?.(`Checking Madison Avenue Couture for this exact version…`);
    if (await macLookup(input.house, input.bag, input.spec || undefined)) check = evidenceCheck(input.house, input.bag, input.spec || undefined);
  }
  const guard = check.gap && !check.finish ? `\n\nEVIDENCE CHECK (guardrail): GAP: ${check.why}. Use the web research below for this exact bag and size; say where each price came from.` : check.finish ? `\n\nEVIDENCE CHECK (guardrail): the question is about a ${input.bag} in ${check.finish}. ${check.gap ? `GAP: ${check.why}. ` : ""}Prices for the plain version (other leathers, no ${check.finish}) are a different bag: never use them as this bag's value, its boutique price or its comparable, and never call a buyer of this version an overpayer on their evidence; a different embellishment (beads, crystals, sequins against fringe) or a different size (a Mini against a full size) is a different bag too, never the comparable; the FORWARD READ, boutique price rises and projected boutique prices are for the plain version too, so leave them out of this answer. Use only ${check.finish} prices from the tracker and the web search below; if there are too few, say so plainly and keep confidence low.` : "";
  const base = buildTrackerDossier(input.house, input.bag, input.spec || undefined);
  const isCollection = input.questionType === "collection" || /runway|pre-?order|collection|fashion week|just walked|spring 2027|ss27|resort 27/i.test(`${input.bag} ${input.spec ?? ""} ${input.notes ?? ""}`);
  const extras = [buzzDossier(input.house, input.bag), isCollection ? collectionDossier(input.house, input.season || undefined) : "", pestelDossier(input.house), ownershipDossier(input.house)].filter(Boolean).join("\n\n");
  const head = headlineNumbers(input.house, input.bag, input.spec || undefined, input.notes || null);
  // a two-bag question: the second bag's numbers too, so the answer compares like with like (Sam, 2026-10-24: the second bag was dropped)
  const cmp = (input.notes ?? "").match(/COMPARE WITH: (.*?) ;; (.*?) ;; (.*)$/);
  const head2 = cmp ? headlineNumbers(cmp[1].trim(), cmp[2].trim(), cmp[3].trim() || undefined, null) : "";
  const second = cmp ? `\n\nSECOND BAG THE CLIENT IS COMPARING: ${cmp[1]} ${cmp[2]}${cmp[3] ? ` (${cmp[3]})` : ""}. Answer both, side by side, each from its own numbers below; say which holds value better and why.\n${head2 || "No tracker numbers for the second bag; use the web research for it and say so."}` : "";
  const tracker = { ...base, text: [head, second, base.text, extras].filter(Boolean).join("\n\n"), available: base.available || !!extras || !!head };
  onProgress?.(tracker.available ? `Read ${tracker.rowCount} rows from the tracker…` : "Tracker not available; researching from the web…");
  const basePrompt = researchPrompt({
    ...input,
    spec: input.spec || undefined,
    budget: input.budget || undefined,
    notes: input.notes || undefined,
    trackerDossier: tracker.available ? tracker.text : undefined,
  });
  const sources = new Map<string, Source>();
  const usage = { input_tokens: 0, output_tokens: 0 };
  const kept = check.finish || check.gap ? webFindings(input.house, input.bag, check.finish ?? "") : "";
  tracker.text += guard + (kept ? `\n\nEARLIER WEB FINDINGS FOR THIS EXACT VERSION (kept from past answers; cite their dates and sources):\n${kept}` : "");
  if (kept && check.gap) { check.gap = false; check.why = "covered by earlier web findings"; }
  // Katie, 2026-10-24: cultural standing is evidence too ("this is cultural knowledge I'm trying to imbue in the tool").
  // Every bag (and finish) asked about gets a social-listening read of the press and search, kept for 7 days and reused:
  // its standing (rarity, desire, who can get one) and its dated cultural moments (celebrity carries, records, viral posts).
  const finishKey = check.finish ?? "";
  let standing = bagStanding(input.house, input.bag, finishKey);
  if (!standing) {
    try {
      onProgress?.("Listening to what the press and social say about this bag…");
      const sm = await anthropic.messages.create({
        model: RESEARCH_MODEL, max_tokens: 3000, output_config: { effort: "low" },
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
        messages: [{ role: "user", content: `Social listening for the ${input.house} ${input.bag}${finishKey ? ` in ${finishKey}` : ""}${input.spec ? ` (${input.spec})` : ""}. Search Google, Vogue, Vogue Business, Harper's Bazaar, WWD, PurseBop, PurseBlog, Business of Fashion, Sotheby's and Christie's. Return ONLY JSON, no prose: {"standing": [3 to 5 lines, each under 22 words, your own words (no quotes over five words), each ending with the source name and year in brackets: how rare and coveted it is, who can get one, nicknames, whether its standing is rising or fading], "moments": [up to 5 dated cultural moments for THIS exact bag and finish only (celebrity carries, auction records, viral posts, runway or campaign appearances): {"date": "YYYY-MM-DD or YYYY-MM", "who": "...", "what": "one sentence, under 25 words", "sources": [{"name": "...", "url": "..."}]}]}. Only moments a source you found states; never guess a date or a person. No prices in standing.` }],
      }, { timeout: 35000 });
      const raw = sm.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
      const srcs: { title: string; url: string }[] = [];
      for (const b of sm.content) if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.type === "web_search_result" && r.url) srcs.push({ title: r.title || r.url, url: r.url });
      usage.input_tokens += sm.usage.input_tokens; usage.output_tokens += sm.usage.output_tokens;
      const js = (() => { try { return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { standing?: string[]; moments?: { date?: string; who?: string; what?: string; sources?: { name?: string; url?: string }[] }[] }; } catch { return null; } })();
      // a reply that is not the JSON we asked for is kept only when it reads as findings, never a refusal or a request to resend (Sam, round 21)
      const st = (js?.standing ?? []).filter(Boolean).join("\n") || (js || /\b(please|resend|could you|i cannot|i can'?t|unable|sorry|limit|don'?t have verified|not able)\b/i.test(raw) ? "" : raw);
      if (st) { saveWebFinding(input.house, input.bag, `standing:${finishKey}`, st, srcs, true); standing = bagStanding(input.house, input.bag, finishKey) || st; }
      for (const m of js?.moments ?? []) saveMoment(input.house, input.bag, finishKey, m);
    } catch { /* the answer still runs on the numbers */ }
  }
  if (standing) tracker.text += `\n\nCULTURAL STANDING (how the fashion press and search describe this bag; cultural evidence, weigh it with the numbers and cite it):\n${standing}`;
  // Fast path: our own scans already hold this bag's prices, sales, trends and house news, so skip the web passes,
  // unless the guardrail found a gap for the exact version asked about: then search the web for that version while the answer runs.
  if (check.gap) onProgress?.(`We hold few prices for this exact version (${check.finish}); searching the web for it…`);
  if (FAST && tracker.available && head && tracker.rowCount >= 20 && !check.gap) {
    onProgress?.("Weighing it up…");
    return { dossier: `${tracker.text}

## WEB RESEARCH DOSSIER

(Skipped: the tracker covers this bag. Use only the tracker sections above, and cite them as the tracker with their dates.)`, sources: [], usage, trackerRows: tracker.rowCount };
  }
  let searches = 0;

  // Two passes run at the same time: A = the money and the house (headings 1–5), B = the designer, the culture, the world (6–9).
  const pass = async (label: string, focus: string, maxUses: number): Promise<string> => {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: `${basePrompt}\n\nTHIS PASS (${label}): ${focus} Write only those headings; another pass covers the rest. Budget: at most ${maxUses} searches.` }];
    const stream = anthropic.messages.stream({
      model: RESEARCH_MODEL,
      max_tokens: 12000,
      system: [{ type: "text", text: ANALYST_SYSTEM, cache_control: { type: "ephemeral" } }],
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: maxUses }],
      messages,
    });
    stream.on("streamEvent", (event) => {
      if (event.type === "content_block_start" && event.content_block.type === "server_tool_use") {
        searches += 1;
        onProgress?.(`Searching (${searches})…`);
      }
    });
    const message = await Promise.race([stream.finalMessage(), new Promise<never>((_, rej) => setTimeout(() => { try { stream.abort(); } catch {} rej(new Error("research pass timed out")); }, 75000))]); // Sam, round 10; 75 s (Katie, 2026-10-25: "this search was taking a very long time"): one answer took 5 minutes
    usage.input_tokens += message.usage.input_tokens;
    usage.output_tokens += message.usage.output_tokens;
    let text = "";
    for (const block of message.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) {
          if (r.type === "web_search_result" && r.url && !sources.has(r.url)) sources.set(r.url, { title: r.title || r.url, url: r.url });
        }
      }
      if (block.type === "text") {
        text += block.text;
        for (const c of block.citations ?? []) {
          if (c.type === "web_search_result_location" && c.url && !sources.has(c.url)) sources.set(c.url, { title: c.title || c.url, url: c.url });
        }
      }
    }
    if (message.stop_reason === "refusal") throw new Error("The model declined this request.");
    return text;
  };

  const gapOnly = FAST && check.gap && tracker.available && tracker.rowCount >= 20;
  const safe = (pr: Promise<string>) => pr.catch(() => "(This web pass took too long and was skipped; answer from the tracker sections above.)");
  const [a, b] = await Promise.all([
    safe(pass("A", gapOnly
      ? `ONLY this: prices for a ${input.house} ${input.bag}${check.finish ? ` in ${check.finish}` : ""}${input.spec ? ` (${input.spec})` : ""}. Find (1) the house's boutique price for that exact version (US first; else the price abroad, in its currency, with the country), (2) recent sold prices and auction results for that exact version, with dates, sizes and conditions: search Sotheby's, Christie's, Heritage Auctions and Phillips results, eBay sold listings, and The RealReal, (3) current and past asking prices for it on The RealReal, Madison Avenue Couture, Fashionphile, Privé Porter, Jane Finds and 1stDibs. Name each source and date. Write it under heading 1.`
      : "headings 1 to 5: retail vs resale, retention and auctions, the house's results, ownership and stakeholders, supply chain and materials.", gapOnly ? 4 : 3)),
    gapOnly ? Promise.resolve("(Pass B skipped: the tracker covers designer, culture and the house; this run searched only for the missing prices.)") : safe(pass("B", "headings 6 to 9: the creative director, social momentum and buzz, macro and PESTEL, fashion history.", 3)),
  ]);
  onProgress?.("Weighing it up…");
  const dossier = `${a}\n\n${b}`;

  if (!dossier.trim()) throw new Error("Research produced no dossier.");
  // Katie, 2026-10-24: what a gap search finds is kept, so the next question about this exact version reads it from our own records
  if (gapOnly && a.trim()) { try { saveWebFinding(input.house, input.bag, check.finish ?? "", a, [...sources.values()]); } catch { /* the answer still runs */ } }
  const full = tracker.available ? `${tracker.text}\n\n## WEB RESEARCH DOSSIER\n\n${dossier}` : dossier;
  return { dossier: full, sources: [...sources.values()], usage, trackerRows: tracker.rowCount };
}
