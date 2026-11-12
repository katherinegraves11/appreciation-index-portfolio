# resale_asks.py — Bag Index asking-price collector

Collects current **asking prices** for luxury bags from resale storefronts that expose
Shopify's public, unauthenticated JSON endpoints, and stores derived fields in
`db/luxury_bags.db` (`resale_listings`, `resale_snapshots`). Every run appends a
snapshot row per listing, so repeated runs build a price time series.

## Run

```bash
cd "/Users/katiegraves/Desktop/Fashion Data Lab/scrapers"
python3 resale_asks.py --list-sources                 # green / amber / red status of every adapter
python3 resale_asks.py --source all --dry-run         # plan only: no network, no DB writes
python3 resale_asks.py --source all                   # real run, all GREEN sources (≤40 live requests/host)
python3 resale_asks.py --source rebag,fashionphile    # subset
python3 resale_asks.py --source rebag --max-requests 20
```

Behaviour baked in (do not remove):
- User-Agent `BagIndexResearch/0.1 (personal research; contact via github.com/katherinegraves11)`
- 4–6 s random sleep between live requests; one 30 s back-off + retry on 429/5xx, then stop.
- Hard cap of `--max-requests` live requests per host per run (default 40).
- Raw JSON cached to `raw/resale-asks/<source>/<YYYY-MM-DD>/`; same-day re-runs read cache, hit network 0 times.
- Only public Shopify endpoints: `/collections.json` (discovery) and `/collections/<handle>/products.json?limit=250&page=N`
  or `/products.json` for small whole-store shops. Stop at first empty page or 3 pages per collection.
- Stored: source, product id, product URL, brand, title, product_type, model/size/material/condition
  guesses (regex), price (cheapest variant), compare_at_price, availability, tags, created_at, first/last seen.
  NOT stored: images, descriptions, seller or customer data.

Then run the aggregates: `sqlite3 -header -column "../db/luxury_bags.db" < ../sql/luxury-bags-resale-asks.sql`

## Add a Shopify store (3 lines)

1. Check `https://<host>/robots.txt` allows `/collections/` and `/products.json` (log it in SOURCES.md).
2. Add an adapter and register it:

```python
class NewStore(ShopifyAdapter):
    name, base = "newstore", "https://newstore.com"      # + `whole_store = True` if it is a small single-brand shop
# ...and append NewStore to the ADAPTERS list.
```

Discovery picks, per priority brand, `<brand>-bags` / `<brand>-handbags` → bare `<brand>` → best other match.
Override with `handle_overrides = {"Hermès": "hermes-handbags"}` if a store's handles are unusual.

## Guessing rules (approximate — sanity-check before publishing)
- `brand`: vendor field → brand regex on title/tags → the collection's brand.
- `model_guess`: brand-scoped regex families (Birkin, Kelly, Classic Flap, Speedy, …). Numeric Chanel
  families (19/22/25) and generic words (City, First, Pouch, Boy, Luggage) only fire inside their own brand.
- `size_guess`: number right after a model name (Birkin **25**), else Mini/Small/Medium/Large/Jumbo/PM/MM/GM/BB,
  else a standalone Hermès-style number in the title.
- `condition_guess`: New / Pristine / Excellent / Very Good / Good / Fair from tags or title. Many stores
  keep condition in the description (not collected), so this is often NULL — that is a known limit.

## Source status (checked 2026-09-06)

| Status | Host | Why |
|---|---|---|
| GREEN | madisonavenuecouture.com | Shopify; robots allows; public JSON |
| GREEN | fashionphile.com | Shopify; robots disallows only multi-filter URLs |
| GREEN | shop.rebag.com | Shopify; same pattern |
| GREEN | tabvintage.com | Shopify; small whole-store pull |
| GREEN | priveporter.com | Shopify; Hermès specialist, whole-store pull |
| AMBER | whatgoesaroundnyc.com | Salesforce Commerce (no JSON); robots allows category pages but forbids search/refinement URLs → would need an HTML crawl of category pages only; confirm volume with Katie first |
| AMBER | sothebys.com | Crawl-delay 15, HTML only; realised prices (different signal) — tiny targeted crawl or hand-recorded results |
| AMBER | treasuresofnyc.com | Platform unknown; probe for Shopify JSON before writing anything |
| AMBER | eBay | Official **Browse API only** (needs free dev keys; stub explains setup). Never scrape ebay.com |
| RED | therealreal.com | Bot-protected; use their published Resale Reports (cited) only |
| RED | vestiairecollective.com | robots.txt returned 403 → no permission; reports only |

Stubs for AMBER/RED live in the script and refuse to run with the reason printed.
