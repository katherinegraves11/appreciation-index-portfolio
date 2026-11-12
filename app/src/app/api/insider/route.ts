import { headers } from "next/headers";
import { addJudgment, isPrivateRequest, CALLS } from "@/lib/insider";

/** POST /api/insider: log one private call (Katie's laptop or home Wi-Fi only; never through a public tunnel). */
export async function POST(req: Request) {
  if (!isPrivateRequest(await headers())) return Response.json({ error: "Not found." }, { status: 404 });
  const b = (await req.json().catch(() => null)) as Record<string, string> | null;
  if (!b?.house?.trim() || !b?.model?.trim() || !(CALLS as readonly string[]).includes(b?.decision ?? "")) return Response.json({ error: "Add the house, the bag and the call." }, { status: 400 });
  const id = addJudgment({ judged_on: b.judged_on || new Date().toLocaleDateString("en-CA"), house: b.house, model: b.model, spec: b.spec ?? "", decision: b.decision, reason_type: b.reason_type ?? "", reason: b.reason ?? "", instead: b.instead ?? "" });
  return Response.json({ id });
}
