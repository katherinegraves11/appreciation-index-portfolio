# Fashion Week Protocol — The Appreciation Index

Every show season is a data event. The same three streams run every time, on a fixed clock, and end in one ranked list: **the hottest bags out of the shows**.

## When it fires
| Season | Shows | Capture window | Heat reads |
|---|---|---|---|
| Spring/Summer RTW | NY → London → Milan → Paris, mid Sep – early Oct | during + 14 days | +7, +14, +30, +90 days |
| Pre-Fall / Métiers d'Art | Dec (Chanel MdA), Jan | during + 14 days | same |
| Couture | late Jan, early Jul | during + 7 days | +30 only (bags rare) |
| Fall/Winter RTW | mid Feb – early Mar | during + 14 days | same |
| Cruise / Resort | May – Jun | during + 14 days | same |

Next windows: Métiers d'Art Dec 2026 · Couture 25–29 Jan 2027 · Fall 2027 RTW 11 Feb – 10 Mar 2027 · Cruise May 2027.
The daily scan (`appreciation-index-daily`) switches into **fashion-week mode** inside these windows: runway capture jumps from 2 houses/day to all houses that showed the day before.

## Stream 1 · Images (Chrome, human pace)
Vogue Runway "Details" galleries per show → `runway_pipeline`: one row per look that carries a bag (look number, shape, size, material, hardware, novelty = new shape / re-edition / archive code, source_url). Resume from the last look recorded. 16 houses: Chanel, Hermès, Louis Vuitton, Dior, Gucci, Prada, Miu Miu, Fendi, Celine, Saint Laurent, Bottega Veneta, Loewe, Balenciaga, The Row, Alaïa, Ferragamo.

## Stream 2 · Writing (web, no login needed; Vogue Business via Chrome)
Vogue Runway review, Vogue Business show analysis and "best bags" pieces, BoF, WWD, PurseBlog/PurseBop bag roundups → `show_notes`: new bag families named, icons that re-walked, novelty count, archive eras referenced, one-line press read, expected in-store window. Named families are added to `bag_families` so resale matching starts on day one.

## Stream 3 · Heat (the measurement)
For every family named in Streams 1–2, at +7/+14/+30/+90 days: RealReal listings and saves, Instagram tag post counts, TikTok Creative Center rank, Google Trends, WGSN catwalk analytics, first resale asks vs retail once the bag lands in store → `momentum` rows tagged `season`.

## The rating · Runway Heat (0–10) per bag family
- Press (0–3): named in 1 / 2–3 / 4+ independent write-ups.
- Social lift (0–3): tag posts and TikTok rank at +14 vs the house baseline.
- Continuity (0–2): re-edition of an icon or archive code = 2; evolution of an existing line = 1; brand-new shape = 0 (new shapes get their chance in Stream 3 later).
- Resale speed (0–2): appears on resale within 30 days of store delivery = 1; asks above retail = 2.
Score lives in view `v_runway_heat`. In the tool it surfaces as the **Runway** card in the Why, and sets the **timing** line ("in stores Jan–Mar; wait for sold prices").

## Output each season
`findings/fashion-week/<season>.md`: the ranked list (top 10 bags out of the shows), per-house two lines, the icons that returned, and three watch-next items. Plus the "runway race" board in the app.
