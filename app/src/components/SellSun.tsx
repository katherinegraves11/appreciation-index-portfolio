/** The sell sun (Katie, 2026-10-23): a little sun that moves from sunrise to sunset as an owned bag gets closer to a good time to sell.
 *  Worked out from the daily reads: today's secondhand value against what you paid, and which way the bag's trends point. */
export type SunPhase = "sunrise" | "midday" | "golden" | "sunset";
export const SUN: Record<SunPhase, { word: string; line: string; c1: string; c2: string; x: number; y: number }> = {
  sunrise: { word: "Sunrise", line: "Hold. It is still climbing.", c1: "#f7b2c4", c2: "#ffd8a8", x: 22, y: 34 },
  midday: { word: "Midday", line: "Steady. Keep wearing it.", c1: "#ffe08a", c2: "#ffc95c", x: 50, y: 14 },
  golden: { word: "Golden hour", line: "Worth watching. You are up, and its trends are levelling off.", c1: "#ffb057", c2: "#f2774a", x: 74, y: 28 },
  sunset: { word: "Sunset", line: "Time to consider selling.", c1: "#e0607e", c2: "#7a4a9e", x: 88, y: 42 },
};

export function sunPhase(gainPct: number | null, lean: string | null): SunPhase {
  // a huge payday: if you would keep double what you paid after fees, consider selling, whatever the trends say (Katie, 2026-10-23)
  if (gainPct != null && gainPct >= 100) return "sunset";
  if (lean === "cooling" && (gainPct ?? 0) >= 0) return "sunset";
  if (gainPct != null && gainPct >= 50 && lean !== "rising") return "sunset";
  if (gainPct != null && gainPct >= 20 && lean !== "rising") return "golden";
  if (lean === "rising") return "sunrise";
  return "midday";
}

export default function SellSun({ phase, id }: { phase: SunPhase; id: string }) {
  const s = SUN[phase];
  return (
    <svg className="sellsun" viewBox="0 0 100 56" role="img" aria-label={`${s.word}: ${s.line}`}>
      <defs>
        <radialGradient id={`g-${id}`} cx="50%" cy="45%" r="60%"><stop offset="0%" stopColor={s.c2} /><stop offset="100%" stopColor={s.c1} /></radialGradient>
        <linearGradient id={`sky-${id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={s.c1} stopOpacity=".18" /><stop offset="100%" stopColor={s.c2} stopOpacity=".05" /></linearGradient>
      </defs>
      <rect x="0" y="0" width="100" height="46" fill={`url(#sky-${id})`} />
      <path d="M8 46 Q50 -8 92 46" fill="none" stroke="currentColor" strokeOpacity=".25" strokeDasharray="1.5 2.5" />
      <circle cx={s.x} cy={s.y} r="7.5" fill={`url(#g-${id})`} />
      <line x1="0" y1="46" x2="100" y2="46" stroke="currentColor" strokeOpacity=".5" />
    </svg>
  );
}
