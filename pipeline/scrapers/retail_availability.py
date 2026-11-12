#!/usr/bin/env python3
"""
retail_availability.py — first-party RETAIL price + availability collector for Katie's Bag Index.

Feasibility audit 2026-09-07 (full table in SOURCES.md, section "Retail availability audit").
RESULT: NO house is GREEN. The Row is the only technically open host (Shopify storefront;
robots.txt allows /collections/*; public /collections/<handle>/products.json; market
subfolders /en-gb/ etc. return localised prices) — but its visible Terms
(therow.com/pages/terms-and-conditions, last updated 2023-02-10, §2) say you shall not
"use a robot, spider or data mining or extraction tool or process to monitor, extract or
copy Website Content". Under the compliance doctrine that is RED, so the TheRow adapter below
is a working SKELETON that refuses to run unless --acknowledge-tos is passed (Katie's call,
e.g. after written permission from The Row). Every other house is AMBER or RED and is
represented by a stub adapter that states why. For all houses use the Chrome-assisted manual
procedure at the bottom (Katie's own browser, human-scale, derived data only).

Compliance
  * robots.txt checked per host on 2026-09-07 (cached in raw/retail-availability/2026-09-07/robots/).
  * Visible Terms checked: The Row /pages/terms-and-conditions (robots-allowed path).
  * UA "BagIndexResearch/0.1 (personal research; contact via github.com/katherinegraves11)", 5–7 s sleep,
    hard cap of --max-requests live requests per host per run (default 2 = "2 pages"), every
    response cached to raw/retail-availability/<source>/<YYYY-MM-DD>/ so same-day re-runs
    never re-fetch.
  * Never bypasses bot protection: a 403 / challenge page is recorded as a status and the
    adapter stops. No proxies, no headless browser, no cookie replay.
  * Stores DERIVED fields only: (source, house, model, product_id, country, currency, price,
    available, retrieved_at). No images, no descriptions, no HTML.

Storage: db/luxury_bags.db, NEW table `retail_availability` (existing tables untouched).
  Natural key (source, product_id, country, retrieved_date) → idempotent upsert.
  One row per product per country per run date = the time series.

Usage
  python3 retail_availability.py --list
  python3 retail_availability.py --source therow --dry-run
  python3 retail_availability.py --source therow                 # 2 live requests (US + GB page 1)
  python3 retail_availability.py --source therow --markets us,gb,fr,jp,hk --max-requests 5
"""
import argparse, datetime as dt, json, os, random, re, sqlite3, sys, time, warnings
warnings.filterwarnings("ignore")
import requests

LAB = "/Users/katiegraves/Desktop/Fashion Data Lab"
DB = os.path.join(LAB, "db", "luxury_bags.db")
RAW = os.path.join(LAB, "raw", "retail-availability")
UA = "BagIndexResearch/0.1 (personal research; contact via github.com/katherinegraves11)"
TODAY = dt.date.today().isoformat()
NOW = dt.datetime.now().astimezone().isoformat(timespec="seconds")
SLEEP = (5.0, 7.0)

DDL = """
CREATE TABLE IF NOT EXISTS retail_availability(
  id integer primary key,
  source text not null,          -- host / adapter name
  house text not null,           -- brand
  model text,                    -- product title as shown at retail (derived family in model_family)
  model_family text,             -- regex-derived icon family, NULL if unknown
  product_id text not null,      -- retailer's own product id
  variant_sku text,              -- style/colour code if exposed (derived)
  country text not null,         -- ISO-2 storefront country
  currency text,                 -- ISO-4217
  price real,
  available integer,             -- 1 = at least one variant purchasable online, 0 = shown but sold out
  published_at text,             -- retailer's own first-published timestamp if exposed
  retrieved_date text not null,  -- YYYY-MM-DD (part of natural key)
  retrieved_at text not null,    -- ISO timestamp
  source_url text,
  unique(source, product_id, country, retrieved_date)
);
CREATE INDEX IF NOT EXISTS ix_ra_house_country_date ON retail_availability(house, country, retrieved_date);
CREATE INDEX IF NOT EXISTS ix_ra_family ON retail_availability(model_family);
"""

# ----------------------------------------------------------------------------- helpers
class Budget:
    def __init__(self, n): self.left = n
    def take(self):
        if self.left <= 0: raise RuntimeError("request budget for this host exhausted")
        self.left -= 1

def polite_get(url, budget, cache_path, dry_run=False):
    """Cached GET. Returns (status, text, from_cache). Never retries a 403."""
    if os.path.exists(cache_path):
        return 200, open(cache_path).read(), True
    if dry_run:
        print(f"  [dry-run] would GET {url}"); return None, None, False
    budget.take()
    r = requests.get(url, headers={"User-Agent": UA, "Accept": "application/json,text/html;q=0.8"}, timeout=40)
    time.sleep(random.uniform(*SLEEP))
    if r.status_code == 200 and r.text.strip():
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        open(cache_path, "w").write(r.text)
    return r.status_code, r.text, False

def upsert(rows):
    con = sqlite3.connect(DB); con.executescript(DDL)
    con.executemany("""INSERT INTO retail_availability
        (source,house,model,model_family,product_id,variant_sku,country,currency,price,available,published_at,retrieved_date,retrieved_at,source_url)
        VALUES (:source,:house,:model,:model_family,:product_id,:variant_sku,:country,:currency,:price,:available,:published_at,:retrieved_date,:retrieved_at,:source_url)
        ON CONFLICT(source,product_id,country,retrieved_date) DO UPDATE SET
          price=excluded.price, available=excluded.available, retrieved_at=excluded.retrieved_at""", rows)
    con.commit()
    n = con.execute("select count(*) from retail_availability").fetchone()[0]
    con.close(); return n

# ----------------------------------------------------------------------------- adapters
class Adapter:
    name = "base"; house = ""; status = "RED"; reason = ""
    def run(self, args): raise NotImplementedError

class Stub(Adapter):
    """AMBER / RED house: documents the blocker instead of working around it."""
    def __init__(self, name, house, status, reason): self.name, self.house, self.status, self.reason = name, house, status, reason
    def run(self, args):
        print(f"[{self.name}] {self.status} — not collected. {self.reason}"); return []

class TheRow(Adapter):
    """Shopify storefront. Markets are URL subfolders (/en-gb/ …); the base path is the US store.
    products.json exposes price per market but no currency code, so currency is mapped from the market."""
    name = "therow.com"; house = "The Row"; status = "RED"
    reason = "Technically open (robots OK, Shopify products.json works per market) but Terms §2 (2023-02-10) forbid robots/spiders/extraction tools. Skeleton only; needs --acknowledge-tos."
    MARKETS = {"us": ("", "USD"), "gb": ("/en-gb", "GBP"), "fr": ("/en-fr", "EUR"), "de": ("/en-de", "EUR"),
               "jp": ("/en-jp", "JPY"), "hk": ("/en-hk", "HKD"), "kr": ("/en-kr", "KRW")}
    COLLECTION = "women-handbags"   # 1,301 products per collections.json probe 2026-09-07
    FAMILIES = [("Margaux", r"\bmargaux\b"), ("Park", r"\bpark\b"), ("Half Moon", r"half\s*moon"), ("Bindle", r"\bbindle\b"),
                ("Everyday", r"\beveryday\b"), ("Sofia", r"\bsofia\b"), ("Agnes", r"\bagnes\b"), ("Terrasse", r"\bterrasse\b"),
                ("N/S Park", r"n/s\s+park"), ("Camdem", r"\bcamdem\b"), ("Idaho", r"\bidaho\b"), ("Nolan", r"\bnolan\b")]
    def family(self, title):
        for fam, rx in self.FAMILIES:
            if re.search(rx, title, re.I): return fam
        return None
    def run(self, args):
        if not args.acknowledge_tos:
            print(f"  RED (ToS) — refusing to run. {self.reason}\n  Re-run with --acknowledge-tos only if Katie has decided/obtained permission."); return []
        budget = Budget(args.max_requests); rows = []
        markets = [m.strip().lower() for m in args.markets.split(",") if m.strip()]
        for mk in markets:
            if mk not in self.MARKETS: print(f"  unknown market {mk}; known: {list(self.MARKETS)}"); continue
            prefix, cur = self.MARKETS[mk]
            for page in range(1, args.pages + 1):
                url = f"https://www.therow.com{prefix}/collections/{self.COLLECTION}/products.json?limit=250&page={page}"
                cache = os.path.join(RAW, "therow", TODAY, f"{mk}_{self.COLLECTION}_p{page}.json")
                try: status, text, cached = polite_get(url, budget, cache, args.dry_run)
                except RuntimeError as e: print(f"  stop: {e}"); return rows
                if status is None: continue
                print(f"  {mk} page {page}: HTTP {status}{' (cache)' if cached else ''}")
                if status != 200: print("  non-200 → stop this market (no retry, no evasion)."); break
                prods = json.loads(text).get("products", [])
                if not prods: break
                for p in prods:
                    if "HANDBAG" not in " ".join(p.get("tags", [])).upper() and "BAG" not in (p.get("product_type") or "").upper(): continue
                    vs = p.get("variants", [])
                    prices = [float(v["price"]) for v in vs if v.get("price")]
                    rows.append(dict(source=self.name, house=self.house, model=p["title"], model_family=self.family(p["title"]),
                        product_id=str(p["id"]), variant_sku=(vs[0].get("sku") if vs else None), country=mk.upper(), currency=cur,
                        price=min(prices) if prices else None, available=int(any(v.get("available") for v in vs)),
                        published_at=p.get("published_at"), retrieved_date=TODAY, retrieved_at=NOW,
                        source_url=f"https://www.therow.com{prefix}/products/{p['handle']}"))
                if len(prods) < 250: break
        return rows

ADAPTERS = [
    TheRow(),
    Stub("hermes.com", "Hermès", "RED", "robots.txt allows category pages, but www + bck.hermes.com return DataDome captcha 403 to a plain client, and Hermès General T&C expressly prohibit scraping/automated access. Also: Birkin/Kelly are never listed online."),
    Stub("chanel.com", "Chanel", "RED", "Akamai 403 'Access Denied' even on /robots.txt. Chanel shows prices per country in-browser only."),
    Stub("dior.com", "Dior", "RED", "Akamai 403 'Page unavailable' on /robots.txt and listing page."),
    Stub("louisvuitton.com", "Louis Vuitton", "AMBER", "robots.txt allows listings + publishes per-country product sitemaps (jp sitemap: 6,414 product URLs, HTTP 200), but listing/product pages return Akamai 403. Sitemap diff = availability-by-country signal with NO prices; legal notice not readable by us (403). Ask Katie before using sitemaps."),
    Stub("gucci.com", "Gucci", "RED", "Connection timed out twice on /robots.txt (edge dropped our client). Not probed further."),
    Stub("prada.com", "Prada", "RED", "Connection timed out twice on /robots.txt."),
    Stub("miumiu.com", "Miu Miu", "RED", "Connection timed out twice on /robots.txt."),
    Stub("fendi.com", "Fendi", "RED", "Connection timed out / aborted twice on /robots.txt."),
    Stub("celine.com", "Celine", "RED", "Akamai 403 'Access Denied' on /robots.txt and listing page."),
    Stub("ysl.com", "Saint Laurent", "RED", "robots.txt OK but listing page 403 (Akamai) and robots disallows the pagination/grid params (start=, sz=, cgid=) and */api/*."),
    Stub("bottegaveneta.com", "Bottega Veneta", "AMBER", "Listing page 1 HTTP 200 (16 tiles; JSON-LD ItemList carries no prices); grid JSON (Search-UpdateGrid, cgid=) is robots-disallowed; Terms URL guess 404'd so ToU unverified. Page-1-only HTML parse of ~16 bags/country would need Katie's OK + ToU read in Chrome."),
    Stub("balenciaga.com", "Balenciaga", "AMBER", "Page 1 HTTP 200 (34 tiles); grid JSON robots-disallowed; ToU fetched (22.9k chars) has NO explicit anti-automation clause but asserts IP over Website Content. Page-1-only HTML parse would need Katie's OK."),
    Stub("loewe.com", "Loewe", "AMBER", "Page 1 HTTP 200 with 14 product URLs + USD prices in HTML; robots disallows *pid*, *search*, demandware grid; Terms page is JS-rendered (unreadable to us) and a search snippet says LOEWE terms prohibit 'automatic means of accessing… obtaining information' → Katie to confirm in Chrome; assume manual only."),
    Stub("maison-alaia.com", "Alaïa", "RED", "Listing page 1 HTTP 200 (24 tiles) but Terms (Nov 2025) prohibit 'any automated means to access, copy or distribute any content… without our prior written approval'. Manual read only."),
    Stub("ferragamo.com", "Ferragamo", "RED", "Akamai 403 'Access Denied' on /robots.txt and listing page."),
]

MANUAL_PROCEDURE = """
Chrome-assisted manual procedure (AMBER/RED houses) — human-scale, once per price-change event or monthly:
  1. In Katie's own Chrome, open the house's handbag listing for each storefront (US, FR, GB, JP, HK, KR)
     e.g. chanel.com/us/fashion/handbags/… , chanel.com/fr/… ; dior.com/en_us/… ; us./fr./jp./hk.louisvuitton.com.
  2. For each icon model (Classic Flap M, Lady Dior M, Speedy 25/B25, Baguette, Jackie 1961, Puzzle, Andiamo, Margaux 15…)
     read: product id/reference (URL tail), displayed price, currency, and whether 'Add to bag' / 'Notify me' / 'Contact us' is shown.
  3. Enter as one row per model per country into retail_availability (source='<house> (Chrome read)',
     available = 1 if add-to-bag, 0 if notify-me/contact-only), plus the boutique price into the existing `retail_prices` table.
  4. Convert with the ECB reference rate for the same date (api.frankfurter.dev, no key) and store the rate date.
  Never save page HTML or images; never use the Chrome session in a loop or scheduler.
"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="therow"); ap.add_argument("--markets", default="us,gb")
    ap.add_argument("--pages", type=int, default=1); ap.add_argument("--max-requests", type=int, default=2)
    ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--list", action="store_true")
    ap.add_argument("--manual", action="store_true", help="print the Chrome-assisted procedure")
    ap.add_argument("--acknowledge-tos", action="store_true", help="The Row only: run despite Terms §2 (Katie's explicit decision)")
    a = ap.parse_args()
    if a.list:
        for ad in ADAPTERS: print(f"{ad.status:5} {ad.name:22} {ad.house:15} {ad.reason[:110]}")
        return
    if a.manual: print(MANUAL_PROCEDURE); return
    sel = [ad for ad in ADAPTERS if a.source == "all" or a.source in ad.name or a.source.lower() in ad.house.lower()]
    if not sel: sys.exit(f"no adapter matches {a.source!r}; use --list")
    for ad in sel:
        print(f"== {ad.name} [{ad.status}]")
        rows = ad.run(a)
        if rows and not a.dry_run:
            total = upsert(rows); print(f"  {len(rows)} rows upserted → retail_availability now {total} rows")
        elif rows: print(f"  [dry-run] {len(rows)} rows would be written")

if __name__ == "__main__":
    main()
