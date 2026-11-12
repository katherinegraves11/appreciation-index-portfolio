/**
 * Feature switches for experiments (Theo's loop). Customers always see variant A.
 * Katie and the review agents see a variant B by visiting /?ab=<flag> (several: /?ab=a,b); /?ab=off clears it.
 * The choice is kept in an "ab" cookie on that browser only. A flag is removed when its experiment ships or is rolled back.
 */
export const FLAGS: Record<string, string> = {
  // "<flag>": "<one line: what variant B changes>",
};

export function flagsFromCookie(cookie: string | undefined | null): Set<string> {
  return new Set((cookie ?? "").split(",").map((s) => s.trim()).filter((f) => f in FLAGS));
}

/** In the browser: read ?ab= once, store it, and say whether a flag is on. */
export function clientFlag(name: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const ab = new URLSearchParams(window.location.search).get("ab");
    if (ab != null) document.cookie = ab === "off" ? "ab=; path=/; max-age=0" : `ab=${ab}; path=/; max-age=2592000; samesite=lax`;
    const cur = ab != null ? (ab === "off" ? "" : ab) : (document.cookie.match(/(?:^|; )ab=([^;]*)/)?.[1] ?? "");
    return flagsFromCookie(cur).has(name);
  } catch { return false; }
}
