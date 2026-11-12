import { COVERED_HOUSES } from "@/lib/houses";
import { apiAllowed, denied } from "@/lib/apikey";
export const runtime = "nodejs";
/** GET /api/v1/houses → the houses the tool covers. */
export async function GET(req: Request) {
  if (!apiAllowed(req)) return denied();
  return Response.json({ houses: COVERED_HOUSES });
}
