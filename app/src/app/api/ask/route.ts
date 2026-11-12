import { linkQuestion } from "@/lib/listing";
import { checkSpend } from "@/lib/limits";
import { getJob, startJob } from "@/lib/jobs";

export const maxDuration = 300;
export const runtime = "nodejs";

/** GET /api/ask?job=<id>&since=<n> → { done, events: [...after n] } so the page can leave and come back. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const job = getJob(u.searchParams.get("job") ?? "");
  if (!job) return Response.json({ error: "That question is no longer running. If it finished, it is under My bags." }, { status: 404 });
  const since = Number(u.searchParams.get("since") ?? 0) || 0;
  return Response.json({ done: job.done, question: job.question, horizon: job.horizon, events: job.events.slice(since), total: job.events.length });
}

/** POST /api/ask {question} → { job } (the work runs server-side; poll with GET). With ?stream=1: the same job's events as an NDJSON stream, for scripts. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { question?: string; horizon?: number; fresh?: boolean; ident?: { house?: string; model?: string; spec?: string; era?: string } | null } | null;
  const fresh = !!body?.fresh || /\b(fresh|again|update|latest|re-?run|refresh)\b/i.test(body?.question ?? "");
  let question = (body?.question ?? "").trim();
  // a listing link in the question: read the listing, then ask about exactly that bag at that price (Katie, 2026-10-24)
  const linked = await linkQuestion(question);
  if ("need_price" in linked) return Response.json(linked);
  question = linked.question;
  if (question.length < 3) return new Response(JSON.stringify({ error: "Ask about a bag." }), { status: 400, headers: { "content-type": "application/json" } });
  if (question.length > 1200) return Response.json({ error: "That's a long question. Ask it in a few sentences." }, { status: 413 });
  const refused = checkSpend(req, "ask");
  if (refused) return Response.json({ error: refused }, { status: 429 });
  const id = body?.ident && body.ident.house && body.ident.model ? { house: String(body.ident.house).slice(0, 80), model: String(body.ident.model).slice(0, 160), spec: String(body.ident.spec ?? "").slice(0, 400), era: String(body.ident.era ?? "").slice(0, 120) } : null;
  const job = startJob(question, Number(body?.horizon ?? 1) || 1, fresh, id); // a photo's bag reuses a same-day answer for that exact bag too (Katie, 2026-10-26)
  if (new URL(req.url).searchParams.get("stream") !== "1") return Response.json({ job: job.id });
  // ?stream=1 runs the very same job as the page (Katie, 2026-10-25: code writes every visible line, on every path) and relays its
  // events as NDJSON as they arrive; if the script hangs up, the job still finishes and saves, as it does for the page.
  const encoder = new TextEncoder();
  let stopped = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sent = 0;
      try {
        while (!stopped) {
          while (sent < job.events.length) controller.enqueue(encoder.encode(JSON.stringify(job.events[sent++]) + "\n"));
          if (job.done) break;
          await new Promise((r) => setTimeout(r, 250));
        }
      } finally {
        if (!stopped) controller.close();
      }
    },
    cancel() { stopped = true; },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
