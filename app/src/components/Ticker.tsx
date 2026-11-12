import { tickerLines } from "@/lib/tracker";

/** The masthead ticker: market news (sales, houses, shows, the economy), never our workings. Loops slowly; pauses on hover; sits still under reduced motion. */
export default function Ticker() {
  const lines = tickerLines();
  if (!lines.length) return null;
  const reel = [...lines, ...lines];
  // Katie, 2026-10-25: "moving too fast, you can't read it": a steady reading pace (about 30px a second) however many lines there are
  const secs = Math.max(90, Math.round(lines.join("   ").length * 0.3));
  return (
    <div className="ticker" aria-label="In the market">
      <span className="lab tlab">in the market</span>
      <div className="track">
        <div className="reel" style={{ animationDuration: `${secs}s` }}>{reel.map((l, i) => <span key={i} aria-hidden={i >= lines.length}>{l}<i>·</i></span>)}</div>
      </div>
    </div>
  );
}
