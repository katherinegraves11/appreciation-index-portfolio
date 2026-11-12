/**
 * Spend guard for the paid routes. Everyone shares one access code, so the caps are per visitor (IP) and site-wide,
 * per UTC day, in process memory (they reset on restart; the Anthropic console spend limit is the hard backstop).
 * Tune with env: ASK_DAILY_PER_VISITOR, ASK_DAILY_TOTAL, ASK_MAX_RUNNING, IDENTIFY_DAILY_PER_VISITOR.
 */
type Counter = { day: string; n: number };
const g = globalThis as unknown as { __bagLimits?: Map<string, Counter>; __bagRunning?: { n: number } };
const counts = (g.__bagLimits ??= new Map());
const running = (g.__bagRunning ??= { n: 0 });
const today = () => new Date().toISOString().slice(0, 10);
const num = (v: string | undefined, d: number) => (v && Number(v) > 0 ? Number(v) : d);

export function visitor(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  // The proxy (Railway) appends the real client address last; earlier entries can be typed by the visitor, so never trust the first.
  const parts = fwd.split(",").map((x) => x.trim()).filter(Boolean);
  return parts[parts.length - 1] || req.headers.get("x-real-ip") || "local";
}

function bump(key: string, cap: number): boolean {
  const d = today(); const c = counts.get(key);
  if (!c || c.day !== d) { counts.set(key, { day: d, n: 1 }); return true; }
  if (c.n >= cap) return false;
  c.n += 1; return true;
}

/** Returns an error message when the call should be refused, or null to go ahead (and counts it). */
export function checkSpend(req: Request, kind: "ask" | "identify"): string | null {
  const who = visitor(req);
  if (kind === "identify") {
    return bump(`identify:${who}`, num(process.env.IDENTIFY_DAILY_PER_VISITOR, 40)) ? null : "That's the photo limit for today. Type the bag's name instead, or come back tomorrow.";
  }
  if (running.n >= num(process.env.ASK_MAX_RUNNING, 3)) return "A few questions are already being researched. Try again in a couple of minutes.";
  if (!bump("ask:total", num(process.env.ASK_DAILY_TOTAL, 60))) return "The tool has answered its full quota of new questions today. Please come back tomorrow.";
  if (!bump(`ask:${who}`, num(process.env.ASK_DAILY_PER_VISITOR, 12))) return "That's today's limit of new questions from you. Earlier answers are still under My bags.";
  return null;
}

/** Wrap a paid run so the running count stays right even when it throws. */
export async function track<T>(fn: () => Promise<T>): Promise<T> {
  running.n += 1;
  try { return await fn(); } finally { running.n = Math.max(0, running.n - 1); }
}
