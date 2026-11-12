/**
 * BagPlate: an engraved line drawing of the bag's silhouette, in the paper style.
 * We never store or hot-link product photos (they belong to the houses and the resale sites),
 * so the picture on the page is ours: one plate per silhouette family, chosen from the model name.
 * Links beside it take the reader to the real photos and listings.
 */

import type { ReactElement } from "react";

export type Silhouette = "trapeze" | "flap" | "eastwest" | "saddle" | "hobo" | "tote" | "bucket" | "box" | "longstrap" | "puzzle";

const RULES: [RegExp, Silhouette][] = [
  [/birkin|kelly|margaux|sac de jour|bolide|capucines|peekaboo|alma|speedy|keepall|andiamo|lindy|hug/i, "trapeze"],
  [/baguette|cassette|teckel|pochette|clutch|first|east-west|elongated/i, "eastwest"],
  [/saddle|half-moon|bobby/i, "saddle"],
  [/hobo|jodie|25|wander|arcadie|loulou|niki|souplissimo mini|rênes|saut|pouch/i, "hobo"],
  [/tote|neverfull|onthego|cabas|galleria|book|garden party|shopping|shopper|cleo|urban essentials/i, "tote"],
  [/picotin|bucket|lucky/i, "bucket"],
  [/box|constance|classic box|cc box|minaudi|vanity|petite malle/i, "box"],
  [/puzzle|hammock|flamenco|evelyne/i, "puzzle"],
  [/flap|boy|19|22|triomphe|lady dior|30 montaigne|caro|marmont|dionysus|jackie|horsebit|bamboo|re-edition|le city|city|le cagole|rodeo|coeur|click|bouledogue|papa|mina|souplissimo|2\.55|double-pocket|oversized cc|trapezoid|strass/i, "flap"],
];

export function silhouetteFor(name: string): Silhouette {
  for (const [re, s] of RULES) if (re.test(name)) return s;
  return "trapeze";
}

const PATHS: Record<Silhouette, ReactElement> = {
  trapeze: (
    <>
      <path d="M30 52 L130 52 L142 110 Q144 118 136 118 L24 118 Q16 118 18 110 Z" />
      <path d="M58 52 Q58 28 80 28 Q102 28 102 52" />
      <path d="M38 64 L122 64" />
      <path d="M72 52 L72 118 M88 52 L88 118" opacity=".55" />
      <path d="M80 64 L80 74 M74 74 L86 74" />
      <path d="M26 58 Q28 56 32 56 M128 56 Q132 56 134 58" opacity=".6" />
    </>
  ),
  flap: (
    <>
      <path d="M22 40 L138 40 Q146 40 146 48 L146 112 Q146 120 138 120 L22 120 Q14 120 14 112 L14 48 Q14 40 22 40 Z" />
      <path d="M14 76 L146 76" />
      <path d="M22 76 L22 100 Q22 106 28 106 L132 106 Q138 106 138 100 L138 76" opacity=".7" />
      <circle cx="80" cy="90" r="7" />
      <path d="M73 90 L87 90" />
      <path d="M26 40 Q26 22 40 16 Q60 8 80 12 Q100 8 120 16 Q134 22 134 40" opacity=".6" strokeDasharray="2 3" />
      <path d="M34 52 L34 68 M54 52 L54 68 M74 52 L74 68 M94 52 L94 68 M114 52 L114 68" opacity=".35" />
    </>
  ),
  eastwest: (
    <>
      <path d="M12 64 L148 64 Q154 64 154 70 L154 102 Q154 110 146 110 L14 110 Q6 110 6 102 L6 70 Q6 64 12 64 Z" />
      <path d="M6 84 L154 84" opacity=".7" />
      <rect x="72" y="80" width="16" height="9" rx="1.5" />
      <path d="M36 64 Q36 44 50 44 Q58 44 60 54 M100 54 Q102 44 110 44 Q124 44 124 64" />
      <path d="M20 72 L140 72" opacity=".35" />
    </>
  ),
  saddle: (
    <>
      <path d="M22 60 Q22 36 46 40 Q70 46 80 50 Q90 46 114 40 Q138 36 138 60 L146 100 Q148 112 136 114 L24 114 Q12 112 14 100 Z" />
      <path d="M80 50 L80 114" opacity=".55" />
      <path d="M46 40 Q42 24 56 20 Q70 18 76 30" opacity=".7" />
      <path d="M48 96 Q80 104 112 96" opacity=".6" />
      <path d="M72 70 L88 70 M80 62 L80 78" />
    </>
  ),
  hobo: (
    <>
      <path d="M36 48 Q28 92 36 108 Q46 122 80 122 Q114 122 124 108 Q132 92 124 48 Z" />
      <path d="M36 48 Q80 60 124 48" />
      <path d="M52 48 Q50 18 80 14 Q110 18 108 48" />
      <path d="M80 60 L80 122" opacity=".4" />
      <path d="M46 100 Q80 110 114 100" opacity=".5" />
    </>
  ),
  tote: (
    <>
      <path d="M28 46 L132 46 L140 118 L20 118 Z" />
      <path d="M50 46 Q50 22 66 22 Q78 22 78 40 M82 40 Q82 22 94 22 Q110 22 110 46" />
      <path d="M28 46 L132 46" />
      <path d="M44 60 L116 60 M46 72 L114 72" opacity=".45" />
      <path d="M80 46 L80 118" opacity=".25" />
    </>
  ),
  bucket: (
    <>
      <path d="M38 56 L122 56 L128 116 Q128 120 124 120 L36 120 Q32 120 32 116 Z" />
      <ellipse cx="80" cy="56" rx="42" ry="7" />
      <path d="M50 54 Q50 24 80 22 Q110 24 110 54" />
      <path d="M62 56 Q80 70 98 56" opacity=".5" />
      <path d="M64 84 L96 84 M72 92 L88 92" opacity=".6" />
    </>
  ),
  box: (
    <>
      <path d="M26 54 L134 54 L134 116 L26 116 Z" />
      <path d="M26 54 L40 42 L148 42 L134 54 M148 42 L148 104 L134 116" opacity=".7" />
      <path d="M26 80 L134 80" />
      <path d="M58 54 Q58 30 80 30 Q102 30 102 54" />
      <rect x="72" y="86" width="16" height="10" rx="2" />
    </>
  ),
  longstrap: (
    <>
      <path d="M30 70 L130 70 L136 116 L24 116 Z" />
      <path d="M44 70 Q20 40 60 18 Q80 8 100 18 Q140 40 116 70" opacity=".7" />
      <path d="M30 86 L130 86" />
      <circle cx="80" cy="100" r="5" />
    </>
  ),
  puzzle: (
    <>
      <path d="M24 58 L136 58 L144 114 Q144 120 138 120 L22 120 Q16 120 16 114 Z" />
      <path d="M24 58 L70 76 L144 72 M70 76 L62 120 M100 58 L112 120 M24 58 L60 36 L124 42 L136 58 M60 36 L70 76" opacity=".7" />
      <path d="M54 36 Q54 20 72 18 Q86 18 90 30" opacity=".6" />
    </>
  ),
};

export default function BagPlate({ name, size = 120, className = "" }: { name: string; size?: number; className?: string }) {
  const s = silhouetteFor(name);
  return (
    <svg className={`plate ${className}`} viewBox="0 0 160 140" width={size} height={Math.round(size * 0.875)} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={`${name} silhouette`}>
      <rect x="4" y="4" width="152" height="132" rx="3" strokeWidth=".6" opacity=".7" />
      <rect x="8" y="8" width="144" height="124" rx="2" strokeWidth=".3" opacity=".5" />
      {PATHS[s]}
    </svg>
  );
}

/** Where to see the real thing. Plain links; nothing is embedded or copied. */
export function seeItLinks(house: string, bag: string, extra?: { house_url?: string | null; runway_url?: string | null }) {
  const q = encodeURIComponent(`${house} ${bag}`);
  const links: { label: string; href: string }[] = [
    { label: "The RealReal · sold", href: `https://www.therealreal.com/products?keywords=${q}&taxons[]=493&sort=sold` },
    { label: "The RealReal · for sale", href: `https://www.therealreal.com/products?keywords=${q}&taxons[]=493` },
    { label: "Fashionphile", href: `https://www.fashionphile.com/shop?search=${q}` },
    // FWRD's site search does not index Renew stock, so the link goes to the Renew shelf itself.
    { label: "FWRD Renew", href: "https://www.fwrd.com/brand-fwrd-renew/e90c01/?sr=true" },
  ];
  if (extra?.house_url) links.push({ label: `${house}.com`, href: extra.house_url });
  if (extra?.runway_url) links.push({ label: "Runway look · Vogue", href: extra.runway_url });
  return links;
}
