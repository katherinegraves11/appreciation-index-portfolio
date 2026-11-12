import { getBrief } from "@/lib/db";
import { quickNumbers } from "@/lib/tracker";
import { apiAllowed, denied, publicNumbers } from "@/lib/apikey";
export const runtime = "nodejs";

/** GET /api/v1/answer?id=<brief id> → a saved answer: the bag, the result, and today's numbers (public data only). */
export async function GET(req: Request) {
  if (!apiAllowed(req)) return denied();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const b = await getBrief(id).catch(() => null);
  if (!b) return Response.json({ error: "No such answer." }, { status: 404 });
  return Response.json({ id: b.id, created_at: b.created_at, house: b.house, bag: b.bag, spec: b.spec, result: b.result, numbers: publicNumbers(quickNumbers(b.house, b.bag, b.spec || undefined, b.notes)) });
}
