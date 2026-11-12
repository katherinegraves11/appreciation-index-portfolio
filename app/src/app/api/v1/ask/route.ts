import { getJob, startJob } from "@/lib/jobs";
import { checkSpend } from "@/lib/limits";
import { linkQuestion } from "@/lib/listing";
import { apiAllowed, denied, publicNumbers } from "@/lib/apikey";
export const runtime = "nodejs";
export const maxDuration = 300;

/** POST /api/v1/ask {question, horizon?} → {job}. The answer takes about three minutes; poll GET. */
export async function POST(req: Request) {
  if (!apiAllowed(req)) return denied();
  const body = (await req.json().catch(() => null)) as { question?: string; horizon?: number; fresh?: boolean } | null;
  const linked = await linkQuestion((body?.question ?? "").trim());
  if ("need_price" in linked) return Response.json(linked);
  const question = linked.question;
  if (question.length < 3) return Response.json({ error: "Ask about a bag." }, { status: 400 });
  if (question.length > 1200) return Response.json({ error: "That's a long question. Ask it in a few sentences." }, { status: 413 });
  const refused = checkSpend(req, "ask");
  if (refused) return Response.json({ error: refused }, { status: 429 });
  const job = startJob(question, [1, 5, 10].includes(Number(body?.horizon)) ? Number(body?.horizon) : 1, body?.fresh === true);
  return Response.json({ job: job.id });
}

/** GET /api/v1/ask?job=<id>&since=<n> → {done, events}. The last event carries {done, id, result, input, numbers}. */
export async function GET(req: Request) {
  if (!apiAllowed(req)) return denied();
  const u = new URL(req.url);
  const job = getJob(u.searchParams.get("job") ?? "");
  if (!job) return Response.json({ error: "No such question running." }, { status: 404 });
  const since = Number(u.searchParams.get("since") ?? 0) || 0;
  const events = job.events.slice(since).map((e) => ("numbers" in e ? { ...e, numbers: publicNumbers((e as { numbers?: never }).numbers ?? null) } : e));
  return Response.json({ done: job.done, events, total: job.events.length });
}
