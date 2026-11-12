import { timingSafeEqual } from "crypto";
/** The partner API key check: "Authorization: Bearer <PUBLIC_API_KEY>". No key set means the API is off. */
export function apiAllowed(req: Request): boolean {
  const key = process.env.PUBLIC_API_KEY;
  if (!key) return false;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const denied = () => Response.json({ error: "API key required." }, { status: 401 });
/** Public view of an answer's numbers. Katie, 2026-10-24: sourcer quotes she received may be shown; set HIDE_PRIVATE=1 to withhold them. */
export function publicNumbers<T extends { tiers?: { private_quotes?: unknown } | null } | null>(n: T): T {
  if (!n || !n.tiers || process.env.HIDE_PRIVATE !== "1") return n;
  return { ...n, tiers: { ...n.tiers, private_quotes: null } };
}
