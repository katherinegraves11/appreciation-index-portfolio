import { coveredHouse, NOT_COVERED } from "@/lib/houses";
import { track } from "@/lib/limits";
import { parseQuestion } from "./parse";
import { runResearch } from "./research";
import { runScoring } from "./score";
import { comingToStores } from "./tracker";
import { enforceFigures, decideHeadline, codeExplain } from "./figures";
import { saveBrief, listBriefs, CACHE_EPOCH, publicResult } from "./db";
import { MODEL } from "./anthropic";
import { quickNumbers, type QuickNumbers } from "./tracker";
import type { BriefInput, BriefResult } from "./schema";
import { goldenReading, knownReading, recordQuestion, sameQuestionToday } from "./questions";
import { getBrief } from "./db";

/**
 * A question runs as a server-side job, not inside the page's request. The page starts it, gets an id,
 * and polls; it can be closed, navigated away from, or reopened on another device and the work carries on.
 * Jobs live in process memory (plus the saved brief at the end), which is right for one laptop or one server.
 */
export type JobEvent = Record<string, unknown>;
export type Job = { id: string; question: string; horizon: number; created: number; done: boolean; events: JobEvent[] };

const store: Map<string, Job> = ((globalThis as unknown as { __aiJobs?: Map<string, Job> }).__aiJobs ??= new Map());

const friendly = (raw: string) =>
  /credit balance|billing/i.test(raw) ? "The research service is out of credit. Top up at console.anthropic.com and ask again."
  : /too_big|ZodError|Invalid|expected string|parse/i.test(raw) ? "I read your question but tripped on the details. Ask again in a slightly shorter form."
  : /overloaded|529|rate/i.test(raw) ? "The research service is busy. Try again in a minute."
  : "Something went wrong on our side. Ask again; if it repeats, tell Katie.";

export function getJob(id: string): Job | undefined { return store.get(id); }

export type Ident = { house: string; model: string; spec: string; era: string } | null;
export function startJob(question: string, horizon: number, fresh: boolean, ident: Ident = null): Job {
  const id = crypto.randomUUID();
  const job: Job = { id, question, horizon, created: Date.now(), done: false, events: [] };
  store.set(id, job);
  // tidy: drop finished jobs older than a day
  for (const [k, j] of store) if (j.done && Date.now() - j.created > 86400000) store.delete(k);
  void track(() => run(job, fresh, ident));
  return job;
}

/** Code writes the headline, timing, cards and case for and against from the page's numbers (figures.ts). */
function codeWrite(result: BriefResult, nums: QuickNumbers | null, question: string, bag: { house: string; bag: string; spec?: string | null }) {
  return codeExplain(decideHeadline(enforceFigures(result, nums, question), nums, question), nums, question, comingToStores(bag.house, bag.bag, bag.spec || undefined));
}

/** Every answer path ends here (page, ?stream=1, partner API, classic form), so code writes every visible line the same way
 *  (Katie, 2026-10-25): the code's verdict goes to the writer first, then enforceFigures → decideHeadline → codeExplain, then save. */
export async function scoreAndSave(input: BriefInput, research: Awaited<ReturnType<typeof runResearch>>, question: string) {
  // Katie, 2026-10-24: code sets every dollar figure; a figure the page did not compute never reaches the client
  const nums = quickNumbers(input.house, input.bag, input.spec || undefined, question);
  // the writer is told the code's verdict first, so the timing and the reasons explain it rather than argue with it (Sam, round 14)
  const codeHead = decideHeadline({ plain_answer: "" }, nums, question).plain_answer;
  const scored = await runScoring(input, codeHead ? `${research.dossier}\n\nTHE PAGE'S VERDICT (decided by code from the numbers; it is the headline the client reads): "${codeHead}" timing and every reason must agree with this verdict and explain it; never recommend the opposite, never quote a figure it does not use.` : research.dossier);
  const result = codeWrite(scored.result, nums, question, input);
  const id = await saveBrief({
    input, dossier: research.dossier, sources: research.sources, result, model: MODEL,
    usage: { input_tokens: research.usage.input_tokens + scored.usage.input_tokens, output_tokens: research.usage.output_tokens + scored.usage.output_tokens },
  });
  return { id, result: publicResult(result), numbers: nums }; // the answer on screen never names Katie or her sourcer
}

async function run(job: Job, fresh: boolean, ident: Ident = null) {
  const send = (e: JobEvent) => { job.events.push(e); };
  try {
    send({ status: "Reading your question…" });
    // the question library: a question asked before word for word is read the same way again, without the AI read (Katie, 2026-10-26)
    // then the golden set: a verified reading Katie approved, matched strictly (Katie, 2026-10-31)
    const known = ident ? null : (knownReading(job.question) ?? goldenReading(job.question));
    const parsed: Awaited<ReturnType<typeof parseQuestion>> = known ? { ok: true as const, input: known.input, interpretation: known.interpretation } : await parseQuestion(job.question);
    // Katie, 2026-10-24: a bag read from a photo is a fact, not a guess to re-read. The photo's house, model and finish win; the typed
    // question adds only what the photo cannot know (price, where it is listed, condition, size, what is being asked).
    if (!parsed.ok && !ident) { send({ clarification: parsed.clarification }); return; }
    const base = parsed.ok ? parsed.input : { house: ident!.house, bag: ident!.model, spec: "", horizonYears: 5 as const, clientType: "collector" as const, cohort: "unknown" as const, budget: "", notes: `Client's own words: ${job.question.slice(0, 420)}`, questionType: "bag" as const, season: "" };
    const input = ident ? (() => {
      const typed = `${job.question}`.split(/\.\s/).slice(1).join(". "); // the client's own words after the photo's description
      const extras = (typed.match(/\b(pristine|excellent|very good|good|fair|pre-?loved|new|brand new|with tags|mini|small|medium|large|nano|\d{2}\s?cm|size \d{2})\b( condition)?/gi) ?? []).join(", ");
      return { ...base, house: ident.house, bag: ident.model, spec: [ident.spec, extras].filter(Boolean).join("; ").slice(0, 600), notes: `${base.notes ?? ""}${ident.era ? ` | Photo read: ${ident.era}` : ""}`.slice(0, 600) };
    })() : base;
    if (!coveredHouse(input.house)) { send({ clarification: NOT_COVERED(input.house || "that house") }); return; }
    send({ parsed: { house: input.house, bag: input.bag, spec: input.spec || "" }, interpretation: parsed.interpretation, status: parsed.interpretation ? `${parsed.interpretation} Looking it up…` : `Looking up the ${input.house} ${input.bag}…` });
    if (!fresh) {
      // Katie, 2026-10-24: an answer is reused for the same bag the same day (New York time); prices move, so never across days.
      // A question with a quoted price or a listing's condition is personal and always runs fresh.
      const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const bagKey = (h: string, b: string, sp: string) => `${norm(h)}|${[...new Set(norm(`${b} ${sp}`).split(" ").filter((w) => w.length > 1 && !["the", "and", "with", "bag", "new", "from"].includes(w)))].sort().join(" ")}`;
      const buyer = (t: string) => /\b(bought|buying|in store|in-store|boutique|offered)\b/i.test(t) ? "boutique" : "general";
      const personal = /\$\s?\d|\b\d{1,3},\d{3}\b|\bquote|\bsourcer|\b(pristine|excellent|very good|good condition|fair|scuff|stain|wear|worn)\b/i.test(job.question);
      const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      const today = day(new Date()), key = bagKey(input.house, input.bag, input.spec || ""), who = buyer(job.question);
      const sameId = personal ? sameQuestionToday(job.question, job.horizon) : null;
      const same = sameId ? await getBrief(sameId) : null;
      const recent = personal ? (same ?? undefined) : (await listBriefs(120)).find((b) => bagKey(b.house, b.bag, b.spec || "") === key && buyer(String((b as { notes?: string | null }).notes ?? "")) === who && day(new Date(b.created_at)) === today && new Date(b.created_at).getTime() >= CACHE_EPOCH);
      if (recent) {
        send({ status: "We answered this bag earlier today. Showing that read, with today's numbers…" });
        // a read saved earlier (including by the old script path, which skipped the code) is re-written by code from today's numbers
        const nums = quickNumbers(recent.house, recent.bag, recent.spec || undefined, job.question);
        recordQuestion({ question: job.question, horizon: job.horizon, fromPhoto: !!ident, input, interpretation: parsed.ok ? parsed.interpretation : "", briefId: recent.id, cached: true });
        send({ done: true, id: recent.id, result: codeWrite(recent.result, nums, job.question, recent), input: { house: recent.house, bag: recent.bag, spec: recent.spec || "" }, numbers: nums, cached: true, answered_at: recent.created_at });
        return;
      }
    }
    // the scorer must see the client's own words ("I just bought this in store", a quoted price), not only the parsed bag
    if (!/Client's own words/.test(input.notes ?? "")) input.notes = `${input.notes ? `${input.notes} | ` : ""}Client's own words: ${job.question}`.slice(0, 600);
    const t1 = Date.now();
    const research = await runResearch(input, (line) => send({ status: line }));
    const t2 = Date.now();
    send({ status: "Weighing it up…" });
    const { id, result, numbers } = await scoreAndSave(input, research, job.question);
    console.log(`[ask] ${input.house} ${input.bag}: research ${Math.round((t2 - t1) / 1000)}s, scoring ${Math.round((Date.now() - t2) / 1000)}s`);
    recordQuestion({ question: job.question, horizon: job.horizon, fromPhoto: !!ident, input, interpretation: parsed.ok ? parsed.interpretation : "", briefId: id });
    send({ done: true, id, result, input: { house: input.house, bag: input.bag, spec: input.spec || "" }, numbers });
  } catch (err) {
    const raw = err instanceof Error ? err.message : "";
    console.error("[ask]", raw);
    send({ error: friendly(raw) });
  } finally {
    job.done = true;
  }
}
