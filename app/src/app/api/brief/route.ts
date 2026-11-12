import { checkSpend } from "@/lib/limits";
import { BriefInput } from "@/lib/schema";
import { runResearch } from "@/lib/research";
import { scoreAndSave } from "@/lib/jobs";

// Research with web search can take a few minutes. Vercel: Fluid Compute allows up to 300s.
export const maxDuration = 300;
export const runtime = "nodejs";

/**
 * POST /api/brief
 * Streams newline-delimited JSON progress events, ending with {"done":true,"id":"..."}.
 * Streaming keeps the connection alive through a long research turn.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = BriefInput.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Check the form: " + parsed.error.issues.map((i) => i.message).join("; ") }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const input = parsed.data;
  const refused = checkSpend(req, "ask");
  if (refused) return Response.json({ error: refused }, { status: 429 });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        send({ status: "Researching resale, house, social, and supply-chain evidence…" });
        const research = await runResearch(input, (line) => send({ status: line }));
        send({ status: "Scoring the five layers…" });
        // the classic form ends in the same code-written answer as the page (Katie, 2026-10-25); its notes are the client's words
        const { id } = await scoreAndSave(input, research, input.notes || "");
        send({ done: true, id });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong.";
        send({ error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
