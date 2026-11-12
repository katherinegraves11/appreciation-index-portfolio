#!/usr/bin/env python3
"""
resale_asks.py — compliant resale ASKING-PRICE collector for Katie's Bag Index.

What it does
  * Pulls product listings from Shopify storefronts via the PUBLIC, unauthenticated
    /products.json and /collections.json endpoints (Shopify's own storefront JSON —
    no HTML scraping, no login, no bot-evasion). robots.txt for each GREEN host was
    checked 2026-09-06 and allows these paths (see scrapers/README-resale-asks.md).
  * Sleeps 4-6 s between live requests, identifies honestly via User-Agent, caps
    requests per host per run (default 40), caches every raw response to
      raw/resale-asks/<source>/<YYYY-MM-DD>/<name>.json
    so a re-run on the same day never re-fetches.
  * Stores DERIVED fields only in db/luxury_bags.db (shared with the
    luxury-bag-investment-analyst agent; existing tables are never touched):
      resale_listings  — one row per (source, product id); upserted (last_seen, price)
      resale_snapshots — one row per (source, product id, snapshot_date) → time series
    No images, no descriptions, no seller / personal data.

Usage
  python3 resale_asks.py --source all                 # real run, all GREEN sources
  python3 resale_asks.py --source fashionphile        # one source
  python3 resale_asks.py --source all --dry-run       # plan only: no network, no DB writes
  python3 resale_asks.py --source rebag --max-requests 20
  python3 resale_asks.py --list-sources

Adding a Shopify store = 3 lines: subclass ShopifyAdapter with `name` and `base`
(and optionally `whole_store = True` for small single-brand shops), then register
it in ADAPTERS. See README-resale-asks.md.

AMBER / RED sources are represented by stub adapters that refuse to run and
explain why — so the status is documented in code, not silently worked around.
"""
import argparse
import datetime as dt
import json
import os
import random
import re
import sqlite3
import sys
import time
import warnings

warnings.filterwarnings("ignore")  # LibreSSL/urllib3 noise on this Mac
import requests

LAB = "/Users/katiegraves/Desktop/Fashion Data Lab"
DB = os.path.join(LAB, "db", "luxury_bags.db")
RAW = os.path.join(LAB, "raw", "resale-asks")
UA = "BagIndexResearch/0.1 (personal research; contact via github.com/katherinegraves11)"
TODAY = dt.date.today().isoformat()
SLEEP_MIN, SLEEP_MAX = 4.0, 6.0
PAGE_LIMIT = 250          # Shopify max for products.json
MAX_PAGES_PER_COLLECTION = 12  # 3,000 items/brand: big enough to paginate each brand collection to its END.
                               # (2026-10-02: at 3 pages every capped brand showed gone==new, i.e. pagination
                               #  displacement, so the disappearance proxy was invalid for Chanel/Hermès/LV/Dior/Gucci/YSL/Celine.)

# Brand priority (Katie's list, in order) → canonical name, collection-handle slugs,
# and title regex. Order matters: it is the order in which budget is spent.
BRANDS = [
    ("Hermès",         ["hermes"],                       r"herm[eè]s"),
    ("Chanel",         ["chanel"],                       r"\bchanel\b"),
    ("Louis Vuitton",  ["louis-vuitton"],                r"louis\s*vuitton|\bl\.?v\.?\b"),
    ("Dior",           ["dior", "christian-dior"],       r"\bdior\b"),
    ("Gucci",          ["gucci"],                        r"\bgucci\b"),
    ("Prada",          ["prada"],                        r"\bprada\b"),
    ("Miu Miu",        ["miu-miu"],                      r"miu\s*miu"),
    ("Fendi",          ["fendi"],                        r"\bfendi\b"),
    ("Celine",         ["celine"],                       r"c[eé]line"),
    ("Bottega Veneta", ["bottega-veneta", "bottega"],    r"bottega"),
    ("Saint Laurent",  ["saint-laurent", "ysl", "yves-saint-laurent"], r"saint\s*laurent|\bysl\b"),
    ("Loewe",          ["loewe"],                        r"\bloewe\b"),
    ("Balenciaga",     ["balenciaga"],                   r"balenciaga"),
    ("The Row",        ["the-row"],                      r"\bthe\s+row\b"),
    ("Alaïa",          ["alaia", "azzedine-alaia"],      r"ala[iï]a"),
]
BRAND_BY_NAME = {b[0]: b for b in BRANDS}

# Model families, brand-scoped so "25", "City", "First", "Pouch" etc. can't
# fire on the wrong house. Ordered: more specific patterns first.
MODEL_FAMILIES = {
    "Hermès": [
        ("Birkin", r"\bbirkin\b"), ("Kelly", r"\bkelly\b"), ("Constance", r"\bconstance\b"),
        ("Picotin", r"\bpicotin\b"), ("Lindy", r"\blindy\b"), ("Evelyne", r"\bevelyne?\b"),
        ("Garden Party", r"garden\s*party"), ("Bolide", r"\bbolide\b"),
    ],
    "Chanel": [
        # Blazy-era lines first (2026-10-03): their titles contain "flap"/"25" and would otherwise be mis-tagged
        ("Souplissimo", r"\bsouplissimo\b"), ("Urban Essentials", r"urban\s*essentials?"),
        ("Kelly Shopper", r"kelly\s*shopper"), ("Neo Cabas", r"neo\s*cabas"), ("Pony Hair Clutch", r"pony\s*hair\s*clutch"),
        ("2.55 / Reissue", r"2\.55|\breissue\b"),
        ("Classic Flap", r"classic\s+(?:single|double)?\s*flap|\btimeless\b|11\.12|classic\s+(?:\w+\s+){0,3}flap|"
                         r"(?:single|double)\s+flap|mini\s+(?:rectangular|square)\s+flap"),  # Fashionphile drops "Classic"
        ("Boy", r"\bboy\b"), ("Coco Handle", r"coco\s*handle"), ("Deauville", r"\bdeauville\b"),
        ("Gabrielle", r"\bgabrielle\b"), ("Cerf", r"\bcerf\b"),
        ("Chanel 19", r"\b19\b"), ("Chanel 22", r"\b22\b"), ("Chanel 25", r"\b25\b"),
    ],
    "Dior": [
        ("Lady Dior", r"lady\s*dior|lady\s*d-?lite|abcdior|\blady\b"), ("Saddle", r"\bsaddle\b"),
        ("Book Tote", r"book\s*tote"), ("Bobby", r"\bbobby\b"), ("Caro", r"\bcaro\b"),
        ("30 Montaigne", r"30\s*montaigne|\bmontaigne\b"),
    ],
    "Louis Vuitton": [
        ("Speedy", r"\bspeedy\b"), ("Neverfull", r"\bneverfull\b"), ("Alma", r"\balma\b"),
        ("Capucines", r"\bcapucines\b"), ("Pochette", r"\bpochette\b"),
        ("OnTheGo", r"on\s*the\s*go"), ("Keepall", r"\bkeepall\b"),
    ],
    "Gucci": [
        ("Jackie", r"\bjackie\b"), ("Marmont", r"\bmarmont\b"), ("Dionysus", r"\bdionysus\b"),
        ("Horsebit", r"\bhorsebit\b"), ("Bamboo", r"\bbamboo\b"),
    ],
    "Prada": [
        ("Galleria", r"\bgalleria\b"), ("Re-Edition", r"re-?\s?edition"), ("Cleo", r"\bcleo\b"),
    ],
    "Miu Miu": [("Wander", r"\bwander\b"), ("Arcadie", r"\barcadie\b")],
    "Fendi": [("Baguette", r"\bbaguette\b"), ("Peekaboo", r"\bpeekaboo\b"), ("First", r"\bfirst\b")],
    "Celine": [("Luggage", r"\bluggage\b"), ("Triomphe", r"\btriomphe\b"), ("Classic Box", r"classic\s*box|\bbox\s+bag\b")],
    "Bottega Veneta": [
        ("Cassette", r"\bcassette\b"), ("Jodie", r"\bjodie\b"), ("Andiamo", r"\bandiamo\b"), ("Pouch", r"\bpouch\b"),
    ],
    "Saint Laurent": [("Loulou", r"\blou\s*lou\b"), ("Sac de Jour", r"sac\s*de\s*jour"), ("Niki", r"\bniki\b")],
    "Loewe": [("Puzzle", r"\bpuzzle\b"), ("Hammock", r"\bhammock\b"), ("Flamenco", r"\bflamenco\b")],
    "Balenciaga": [("Le Cagole", r"le\s*cagole|\bcagole\b"), ("Rodeo", r"\brodeo\b"), ("City", r"\bcity\b"), ("First", r"\bfirst\b")],
    "The Row": [("Margaux", r"\bmargaux\b"), ("Terrasse", r"\bterrasse\b")],
    "Alaïa": [("Le Teckel", r"le\s*teckel|\bteckel\b")],
}
# Unambiguous families usable when brand is unknown (skip generic words/numbers).
GENERIC_FAMILIES = [
    (m, rx) for fams in MODEL_FAMILIES.values() for (m, rx) in fams
    if m not in {"Chanel 19", "Chanel 22", "Chanel 25", "First", "City", "Pouch", "Boy",
                 "Luggage", "Cerf", "Lady Dior", "Caro", "Bobby", "Pochette", "Alma",
                 "Cleo", "Wander", "Jackie", "Bamboo", "Classic Box"}
]

SIZE_WORDS = r"\b(nano|micro|mini|small|medium|large|jumbo|maxi|tpm|pm|mm|gm|bb)\b"
SIZE_AFTER_MODEL = (r"(?:birkin|kelly|constance|picotin|lindy|evelyne?|bolide|hac|halzan|speedy|keepall|alma|"
                    r"neverfull|lady\s*dior|jodie|cassette|puzzle|le\s*teckel|margaux)\s*(?:bag\s*)?(\d{2})\b")
SIZE_HERMES_LOOSE = r"\b(18|20|22|24|25|26|27|28|29|30|31|32|33|35|40)\b"
CONDITIONS = [  # ordered so "Very Good" wins over "Good", "Brand New" over "New"
    ("New", r"brand\s*new|new\s*with\s*tags|\bnwt\b|store\s*fresh|never\s*(?:worn|used|carried)|condition[:_\-\s]*new\b|\bunused\b"),
    ("Pristine", r"\bpristine\b"),
    ("Excellent", r"\bexcellent\b"),
    ("Very Good", r"very\s*good"),
    ("Good", r"\bgood\b"),
    ("Fair", r"\bfair\b"),
]


# ----------------------------------------------------------------------------- helpers
def log(msg):
    print(f"[{dt.datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def norm(s):
    return (s or "").lower()


def guess_brand(title, vendor, tags, fallback):
    hay_vendor = norm(vendor)
    for name, slugs, rx in BRANDS:
        if re.search(rx, hay_vendor):
            return name
    hay = norm(title) + " " + norm(tags)
    for name, slugs, rx in BRANDS:
        if re.search(rx, hay):
            return name
    return fallback or (vendor or None)


def guess_model(brand, title, tags):
    hay = norm(title) + " " + norm(tags)
    fams = MODEL_FAMILIES.get(brand, GENERIC_FAMILIES)
    for model, rx in fams:
        if re.search(rx, hay):
            return model
    return None


def guess_size(brand, title, tags):
    hay = norm(title) + " " + norm(tags)
    m = re.search(SIZE_AFTER_MODEL, hay)
    if m:
        return m.group(1)
    m = re.search(SIZE_WORDS, hay)
    if m:
        return m.group(1).upper() if len(m.group(1)) <= 3 else m.group(1).title()
    if brand == "Hermès":
        m = re.search(SIZE_HERMES_LOOSE, norm(title))
        if m:
            return m.group(1)
    return None


def guess_material(title, tags):
    hay = norm(title) + " " + norm(tags)
    for mat in ["togo", "epsom", "clemence", "swift", "chevre", "box calf", "barenia", "ostrich",
                "crocodile", "alligator", "lizard", "python", "exotic", "caviar", "lambskin", "calfskin",
                "canvas", "denim", "tweed", "patent", "suede", "nylon", "saffiano", "monogram", "damier",
                "epi", "intrecciato", "nappa", "raffia", "velvet", "satin", "leather"]:
        if re.search(r"\b" + re.escape(mat) + r"\b", hay):
            return mat.title()
    return None


def guess_condition(title, tags):
    hay = norm(title) + " " + norm(tags)
    for label, rx in CONDITIONS:
        if re.search(rx, hay):
            return label
    return None


def to_float(x):
    try:
        return float(x) if x not in (None, "") else None
    except (TypeError, ValueError):
        return None


# ----------------------------------------------------------------------------- fetcher
class PoliteFetcher:
    """One per host. Caches to raw/resale-asks/<source>/<date>/, enforces the
    request cap, sleeps 4–6 s between LIVE requests, backs off once on 429/5xx."""

    def __init__(self, source, max_requests, dry_run):
        self.source, self.max_requests, self.dry_run = source, max_requests, dry_run
        self.live = 0
        self.cached_hits = 0
        self.cache_dir = os.path.join(RAW, source, TODAY)
        self.sess = requests.Session()
        self.sess.headers.update({"User-Agent": UA, "Accept": "application/json"})
        self.exhausted = False

    def _cache_path(self, name):
        return os.path.join(self.cache_dir, re.sub(r"[^A-Za-z0-9_.-]+", "_", name) + ".json")

    def get_json(self, url, name):
        p = self._cache_path(name)
        if os.path.exists(p):
            self.cached_hits += 1
            with open(p) as f:
                return json.load(f)
        if self.dry_run:
            log(f"  DRY-RUN would GET {url}")
            return None
        if self.live >= self.max_requests:
            self.exhausted = True
            return None
        if self.live > 0:
            time.sleep(random.uniform(SLEEP_MIN, SLEEP_MAX))
        for attempt in (1, 2):
            self.live += 1
            try:
                r = self.sess.get(url, timeout=30)
            except requests.RequestException as e:
                log(f"  ERROR {url}: {e}")
                return None
            if r.status_code == 200:
                try:
                    data = r.json()
                except ValueError:
                    log(f"  non-JSON response from {url} (len {len(r.text)})")
                    return None
                os.makedirs(self.cache_dir, exist_ok=True)
                with open(p, "w") as f:
                    json.dump(data, f)
                return data
            if r.status_code in (429, 500, 502, 503) and attempt == 1 and self.live < self.max_requests:
                log(f"  HTTP {r.status_code} on {url} — backing off 30 s, one retry")
                time.sleep(30)
                continue
            log(f"  HTTP {r.status_code} on {url} — giving up on this URL")
            return None
        return None


# ----------------------------------------------------------------------------- adapters
class BaseAdapter:
    name = "base"
    base = ""
    status = "green"      # green | amber | red
    note = ""

    def run(self, fetcher, dry_run):
        raise NotImplementedError


class ShopifyAdapter(BaseAdapter):
    """Generic Shopify storefront. Discovers brand collections from
    /collections.json, then pages /collections/<handle>/products.json.
    Set whole_store=True for small shops (uses /products.json only)."""
    whole_store = False
    whole_store_brand = None          # e.g. "Hermès" for a single-brand shop
    prefer_bag_collections = True     # prefer handles containing bag/handbag
    max_collection_pages = 3          # pages of collections.json for discovery
    handle_overrides = {}             # brand -> handle, when discovery is noisy

    def products_url(self, handle, page):
        if handle is None:
            return f"{self.base}/products.json?limit={PAGE_LIMIT}&page={page}"
        return f"{self.base}/collections/{handle}/products.json?limit={PAGE_LIMIT}&page={page}"

    # -- discovery ----------------------------------------------------------
    def discover_handles(self, fetcher):
        """Return ordered list of (brand, handle) using Katie's brand priority."""
        cols = []
        for pg in range(1, self.max_collection_pages + 1):
            data = fetcher.get_json(f"{self.base}/collections.json?limit=250&page={pg}", f"collections_p{pg}")
            if not data or not data.get("collections"):
                break
            cols.extend(data["collections"])
            if len(data["collections"]) < 250:
                break
        log(f"  discovered {len(cols)} collections")
        out = []
        for brand, slugs, rx in BRANDS:
            if brand in self.handle_overrides:
                out.append((brand, self.handle_overrides[brand]))
                continue
            cands = []
            for c in cols:
                h = norm(c.get("handle"))
                t = norm(c.get("title"))
                if any(h == s or h.startswith(s + "-") or h.endswith("-" + s) or f"-{s}-" in h for s in slugs) \
                        or re.search(rx, t):
                    cands.append(c)
            if not cands:
                continue
            def score(c):
                h = norm(c.get("handle"))
                # tier 0: brand-level BAG collection (hermes-bags / hermes-handbags)
                # tier 1: bare brand handle (hermes) — all categories
                # tier 2: anything else (model / colour / material sub-collections) — last resort
                if self.prefer_bag_collections and any(h in (s + "-bags", s + "-handbags") for s in slugs):
                    tier = 0
                elif any(h == s for s in slugs):
                    tier = 1
                else:
                    tier = 2
                bad = bool(re.search(r"shoe|jewel|watch|scarf|scarves|belt|rtw|ready|cloth|access|sale|wallet|sunglass|men", h))
                return (tier, bad, len(h))
            best = sorted(cands, key=score)[0]
            out.append((brand, best["handle"]))
        return out

    # -- parse --------------------------------------------------------------
    def parse_product(self, p, brand_hint):
        title = p.get("title") or ""
        tags = p.get("tags")
        if isinstance(tags, list):
            tags = ", ".join(tags)
        tags = tags or ""
        variants = p.get("variants") or []
        prices = [to_float(v.get("price")) for v in variants if to_float(v.get("price"))]
        cmp = [to_float(v.get("compare_at_price")) for v in variants if to_float(v.get("compare_at_price"))]
        avail = int(any(v.get("available") for v in variants)) if variants else None
        brand = guess_brand(title, p.get("vendor"), tags, brand_hint)
        return {
            "source": self.name,
            "source_product_id": str(p.get("id")),
            "handle_url": f"{self.base}/products/{p.get('handle')}",
            "brand": brand,
            "title": title[:200],
            "product_type": p.get("product_type") or None,
            "model_guess": guess_model(brand, title, tags),
            "size_guess": guess_size(brand, title, tags),
            "material_guess": guess_material(title, tags),
            "condition_guess": guess_condition(title, tags),
            "price": min(prices) if prices else None,
            "compare_at_price": max(cmp) if cmp else None,
            "currency": "USD",
            "available": avail,
            "tags": tags[:500] or None,
            "created_at_source": p.get("created_at"),
        }

    # -- run ----------------------------------------------------------------
    def run(self, fetcher, dry_run):
        rows = []
        plan = [(self.whole_store_brand, None)] if self.whole_store else self.discover_handles(fetcher)
        plan += [bh for bh in getattr(self, "extra_handles", []) if bh not in plan]
        if dry_run and not self.whole_store and not plan:
            log("  DRY-RUN: discovery needs one live request; plan = collections.json then "
                "/collections/<brand-handle>/products.json for the 15 priority brands")
            return rows
        log(f"  plan: {[(b, h) for b, h in plan]}")
        for brand, handle in plan:
            page = 1
            items_here = 0
            complete = 0
            while True:
                if fetcher.exhausted:
                    break
                if handle is not None and page > MAX_PAGES_PER_COLLECTION:
                    break
                data = fetcher.get_json(self.products_url(handle, page), f"{handle or 'all'}_p{page}")
                if not data:
                    break
                prods = data.get("products") or []
                if not prods:
                    break
                for p in prods:
                    rows.append(self.parse_product(p, brand))
                items_here += len(prods)
                if len(prods) < PAGE_LIMIT:
                    complete = 1
                    break
                page += 1
            RUNS.append({"source": self.name, "brand": brand or self.whole_store_brand or "all", "today": TODAY,
                         "pages": page, "items": items_here, "complete": complete})
            if fetcher.exhausted:
                log(f"  request cap ({fetcher.max_requests}) reached; stopped before/within {brand}")
                break
        return rows


# ---- GREEN Shopify storefronts (robots.txt checked 2026-09-06; public JSON endpoints)
class MadisonAvenueCouture(ShopifyAdapter):
    name, base = "madisonavenuecouture", "https://madisonavenuecouture.com"
    note = "Shopify. robots allows; /collections/<brand>-handbags pattern."
    # Special orders sit in their own collection and are missing from hermes-handbags (Katie, 2026-10-24: custom-order pickups)
    extra_handles = [("Hermès", "hermes-special-order-hss")]

class Fashionphile(ShopifyAdapter):
    name, base = "fashionphile", "https://www.fashionphile.com"
    note = "Shopify. robots disallows only multi-filter URLs; plain collection JSON is fine."

class Rebag(ShopifyAdapter):
    name, base = "rebag", "https://shop.rebag.com"
    note = "Shopify. Same robots pattern as Fashionphile."

class TabVintage(ShopifyAdapter):
    name, base = "tabvintage", "https://tabvintage.com"
    whole_store = True
    note = "Shopify. Small vintage RTW + accessories shop; whole-store /products.json."

class PrivePorter(ShopifyAdapter):
    name, base = "priveporter", "https://priveporter.com"
    whole_store, whole_store_brand = True, "Hermès"
    note = "Shopify. Hermès specialist; whole-store /products.json."


# ---- AMBER stubs: NOT collected this run. Each explains the blocker + the sanctioned path.
class StubAdapter(BaseAdapter):
    def run(self, fetcher, dry_run):
        raise SystemExit(f"{self.name} is {self.status.upper()} — not collected. {self.note}")

class WhatGoesAroundComesAround(StubAdapter):
    name, base, status = "wgaca", "https://whatgoesaroundnyc.com", "amber"
    note = ("Salesforce Commerce Cloud (no Shopify JSON). robots.txt allows category pages but forbids "
            "search/refinement URLs. Would need HTML parsing of category pages only (bs4), crawl-delay "
            "respected, no faceted URLs. Build only after Katie confirms the HTML crawl volume.")

class Sothebys(StubAdapter):
    name, base, status = "sothebys", "https://www.sothebys.com", "amber"
    note = ("robots.txt Crawl-delay: 15 and HTML only (no product JSON). Handbag sale results are the "
            "useful signal (REALISED prices, not asks). ~15 s/request makes this a tiny, targeted crawl "
            "of a few sale pages — or record published results by hand with citation.")

class TreasuresOfNYC(StubAdapter):
    name, base, status = "treasuresofnyc", "https://www.treasuresofnyc.com", "amber"
    note = "Platform not yet identified. Check for Shopify (/products.json) before writing anything."

class EbayBrowseAPI(StubAdapter):
    name, base, status = "ebay", "https://api.ebay.com/buy/browse/v1", "amber"
    note = ("Use ONLY the official eBay Browse API (item_summary/search, category 169291 Women's Bags & "
            "Handbags, filter by brand aspect). Needs a free developer account → App ID/Cert ID → OAuth "
            "client-credentials token; store keys in ~/.config/bagindex/ebay.json (never in this repo). "
            "5,000 calls/day on the free tier. Do NOT scrape ebay.com HTML.")

# ---- RED: never collect.
class TheRealReal(StubAdapter):
    name, base, status = "therealreal", "https://www.therealreal.com", "red"
    note = "Bot-protected (403 to non-browser clients). Use their published Resale Reports only (cited)."

class VestiaireCollective(StubAdapter):
    name, base, status = "vestiaire", "https://www.vestiairecollective.com", "red"
    note = "robots.txt itself returned 403 on 2026-09-06 — treat as no permission. Reports only."


ADAPTERS = {a.name: a for a in [
    MadisonAvenueCouture, Fashionphile, Rebag, TabVintage, PrivePorter,
    WhatGoesAroundComesAround, Sothebys, TreasuresOfNYC, EbayBrowseAPI,
    TheRealReal, VestiaireCollective,
]}
GREEN = [n for n, a in ADAPTERS.items() if a.status == "green"]


# ----------------------------------------------------------------------------- storage
DDL = """
create table if not exists resale_listings(
  id integer primary key, source text, source_product_id text, handle_url text, brand text, title text,
  product_type text, model_guess text, size_guess text, material_guess text, condition_guess text,
  price real, compare_at_price real, currency text default 'USD', available int, tags text,
  created_at_source text, first_seen text, last_seen text,
  unique(source, source_product_id));
create table if not exists resale_snapshots(
  id integer primary key, source text, source_product_id text, snapshot_date text, price real, available int,
  unique(source, source_product_id, snapshot_date));
create index if not exists ix_rl_brand_source on resale_listings(brand, source);
create index if not exists ix_rl_model on resale_listings(model_guess);
create index if not exists ix_rs_date on resale_snapshots(snapshot_date);
"""

RUNS = []   # per-brand pagination completeness for this run → collector_runs

RUNS_DDL = """
create table if not exists collector_runs(
  id integer primary key, source text, brand text, snapshot_date text, pages int, items int, complete int,
  unique(source, brand, snapshot_date));
"""
RUNS_SQL = """insert or replace into collector_runs(source, brand, snapshot_date, pages, items, complete)
              values(:source, :brand, :today, :pages, :items, :complete);"""

UPSERT = """
insert into resale_listings(source, source_product_id, handle_url, brand, title, product_type, model_guess,
  size_guess, material_guess, condition_guess, price, compare_at_price, currency, available, tags,
  created_at_source, first_seen, last_seen)
values(:source, :source_product_id, :handle_url, :brand, :title, :product_type, :model_guess, :size_guess,
  :material_guess, :condition_guess, :price, :compare_at_price, :currency, :available, :tags,
  :created_at_source, :today, :today)
on conflict(source, source_product_id) do update set
  price=excluded.price, compare_at_price=excluded.compare_at_price, available=excluded.available,
  title=excluded.title, tags=excluded.tags, product_type=excluded.product_type,
  model_guess=excluded.model_guess, size_guess=excluded.size_guess, material_guess=excluded.material_guess,
  condition_guess=excluded.condition_guess, brand=excluded.brand, last_seen=excluded.last_seen;
"""
SNAP = """insert or replace into resale_snapshots(source, source_product_id, snapshot_date, price, available)
          values(:source, :source_product_id, :today, :price, :available);"""


def store(rows):
    con = sqlite3.connect(DB, timeout=60)
    con.execute("pragma busy_timeout=60000")
    con.executescript(DDL)
    seen = set()
    dedup = []
    for r in rows:                          # a product can appear in two collections
        k = (r["source"], r["source_product_id"])
        if k in seen:
            continue
        seen.add(k)
        r["today"] = TODAY
        dedup.append(r)
    con.executescript(RUNS_DDL)
    with con:
        con.executemany(UPSERT, dedup)
        con.executemany(SNAP, dedup)
        if RUNS:
            con.executemany(RUNS_SQL, RUNS)
            RUNS.clear()
    n = con.execute("select count(*) from resale_listings where source=?", (dedup[0]["source"],)).fetchone()[0] if dedup else 0
    con.close()
    return len(dedup), n


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", default="all", help="adapter name, comma list, or 'all' (= all GREEN)")
    ap.add_argument("--dry-run", action="store_true", help="no network, no DB writes; print plan + cache state")
    ap.add_argument("--max-requests", type=int, default=160, help="live-request cap per host per run (160 ≈ 15 brands × ~10 pages; 4–6 s apart ≈ 13 min)")
    ap.add_argument("--list-sources", action="store_true")
    args = ap.parse_args()

    if args.list_sources:
        for n, a in ADAPTERS.items():
            print(f"{a.status.upper():6} {n:22} {a.base}\n       {a.note}")
        return

    names = GREEN if args.source == "all" else [s.strip() for s in args.source.split(",")]
    summary = []
    for n in names:
        if n not in ADAPTERS:
            sys.exit(f"unknown source {n}; try --list-sources")
        A = ADAPTERS[n]()
        log(f"== {n} ({A.status}) {A.base}")
        f = PoliteFetcher(n, args.max_requests, args.dry_run)
        try:
            rows = A.run(f, args.dry_run)
        except SystemExit as e:
            log(f"  {e}")
            continue
        if args.dry_run:
            log(f"  DRY-RUN: parsed {len(rows)} rows from cache ({f.cached_hits} cached files); nothing written")
            summary.append((n, len(rows), f.live, f.cached_hits, "dry-run"))
            continue
        stored, total = store(rows) if rows else (0, 0)
        log(f"  live requests={f.live} cached={f.cached_hits} rows parsed={len(rows)} upserted={stored} "
            f"total listings for source={total}")
        summary.append((n, stored, f.live, f.cached_hits, "ok" if rows else "EMPTY"))

    print("\nsource                 rows  live  cached  status")
    for s in summary:
        print(f"{s[0]:22} {s[1]:5} {s[2]:5} {s[3]:7}  {s[4]}")


if __name__ == "__main__":
    main()
