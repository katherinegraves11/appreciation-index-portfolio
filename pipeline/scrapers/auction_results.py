#!/usr/bin/env python3
"""
auction_results.py — compliant auction-RESULTS collector for Katie's Bag Index.

Status of each source (checked 2026-09-07; details in SOURCES.md):
  bonhams    GREEN  robots.txt allows /auction/*; "Conditions of Website use" has no
                    automated-access clause (only "may not reproduce material" -> we store
                    DERIVED fields only). Lot results (status SOLD/BI, estimates, hammer,
                    hammer+premium, currency) are server-rendered in the page's own
                    __NEXT_DATA__ JSON (48 lots per auction page). No login, no API keys.
  artcurial  GREEN* robots.txt allows /en/sales/*; Terms forbid "copying ... the catalogue"
                    and the website -> we keep prices/status + regex-derived attributes,
                    never titles/descriptions/images. Lot results are server-rendered in
                    __NUXT_DATA__ (first 20 lots of each sale). The client-side endpoint for
                    lots 21+ was not identified in the page's JS, so depth = 1 page per sale.
  sothebys   RED    robots allows (Crawl-delay 15) BUT Terms & Conditions of Use §4 forbid
                    "data mining, spidering, 'screen scraping' ... harvesting of catalogue
                    information ... or any other automatic means". Not automated. Manual
                    Chrome path: Katie saves a results page -> `--ingest-html` parses it.
  christies  RED    www.christies.com timed out on the single permitted probe (robots.txt,
                    25 s). onlineonly.christies.com robots reachable, but no results path
                    probed. Re-check next quarter.
  heritage   RED    www.ha.com robots Crawl-delay 15, but the archive page answered with a
                    DataDome captcha (403) and Heritage's own press release says prices
                    realized are members-only (free account). Login-gated -> out of scope.

Doctrine: honest UA, >=5 s between live requests per host (15 s if a host declares it),
cache every raw page under raw/auction-results/<source>/<date>/ so nothing is fetched
twice, cap pages per house (default 3), upsert on (auction_house, lot_url).

Usage
  python3 auction_results.py --source all --dry-run
  python3 auction_results.py --source bonhams,artcurial --max-pages 3
  python3 auction_results.py --source sothebys --ingest-html /path/saved_results_page.html
  python3 auction_results.py --list-sources
"""
import argparse
import datetime as dt
import html as htmlmod
import json
import os
import re
import sqlite3
import sys
import time
import warnings

warnings.filterwarnings("ignore")
import requests

LAB = "/Users/katiegraves/Desktop/Fashion Data Lab"
DB = os.path.join(LAB, "db", "luxury_bags.db")
RAW = os.path.join(LAB, "raw", "auction-results")
UA = "BagIndexResearch/0.1 (personal research; contact via github.com/katherinegraves11)"
TODAY = dt.date.today().isoformat()
NOW = dt.datetime.now().isoformat(timespec="seconds")

# Same regex families as the resale collector (single source of truth).
sys.path.insert(0, os.path.join(LAB, "scrapers"))
from resale_asks import (guess_brand, guess_model, guess_size, guess_material,  # noqa: E402
                         guess_condition, norm)

# ----------------------------------------------------------------------------- derived attrs
# Colour vocabulary: longest phrases first so "gris perle" beats "gris", "rouge h" beats "rouge".
COLOURS = sorted([
    "gris perle", "gris tourterelle", "gris asphalte", "gris mouette", "gris meyer", "gris pale",
    "gris etain", "gris agate", "bleu jean", "blue jean", "bleu nuit", "bleu saphir", "bleu electrique",
    "bleu indigo", "bleu paon", "bleu zanzibar", "bleu atoll", "bleu izmir", "bleu de prusse",
    "bleu encre", "bleu brighton", "bleu hydra", "bleu glacier", "bleu lin", "bleu pale", "bleu du nord",
    "rouge casaque", "rouge h", "rouge grenat", "rouge vif", "rouge garance", "rouge tomate",
    "rouge piment", "rouge sellier", "rouge de coeur", "rose sakura", "rose confetti", "rose azalee",
    "rose extreme", "rose pourpre", "rose jaipur", "rose lipstick", "rose tyrien", "rose shocking",
    "rose mexico", "rose eglantine", "rose texas", "rose dragee", "bubblegum pink", "baby pink",
    "vert cypres", "vert fonce", "vert bosphore", "vert criquet", "vert vertigo", "vert amande",
    "vert jade", "vert de gris", "vert titien", "vert moyen", "vert anglais", "vert olive",
    "vert bronze", "vert rousseau", "terre battue", "mauve pale", "mauve sylvestre", "blue paon",
    "brushed gold", "so black", "black", "noir", "gold", "etoupe", "étoupe", "craie", "nata", "chai",
    "trench", "sable", "vanille", "biscuit", "beton", "argile", "gris", "grey", "gray", "etain",
    "orange", "feu", "capucine", "poppy", "terre", "alezan", "fauve", "havane", "chocolat", "ebene",
    "cacao", "cuivre", "bronze", "ambre", "sesame", "bordeaux", "burgundy", "prune", "cassis",
    "raisin", "rubis", "framboise", "anemone", "ultraviolet", "iris", "cyclamen", "magnolia",
    "geranium", "vermillon", "tosca", "sanguine", "bambou", "malachite", "menthe", "mykonos",
    "celeste", "turquoise", "lagon", "colvert", "jaune", "lime", "kiwi", "soufre", "ambre", "curry",
    "mimosa", "rose", "pink", "red", "blue", "bleu", "navy", "green", "vert", "purple", "violet",
    "yellow", "white", "blanc", "ivory", "ivoire", "cream", "beige", "tan", "brown", "marron",
    "camel", "taupe", "khaki", "khakis", "silver", "argent", "himalaya", "multicolor", "multicolour",
    "tricolor", "tricolour", "verso",
], key=len, reverse=True)
COLOUR_RX = re.compile(r"\b(" + "|".join(re.escape(c) for c in COLOURS) + r")\b")

HARDWARE = [
    ("Palladium", r"palladium|\bphw\b"), ("Brushed Gold", r"brushed\s*gold|\bbghw\b"),
    ("Rose Gold", r"rose\s*gold|\brghw\b"), ("Permabrass", r"permabrass"),
    ("Ruthenium", r"ruthenium"), ("Guilloche", r"guilloch[eé]"), ("So Black", r"so\s*black"),
    ("Gold", r"gold[- ]?(?:plated|toned|tone)?\s*(?:metal\s*)?hardware|\bghw\b|gold-plated"),
    ("Silver", r"silver[- ]?(?:toned|tone)?\s*hardware|\bshw\b"),
    ("Antique Gold", r"antique\s*gold"), ("Aged Gold", r"aged\s*gold"),
]
# Auction titles put words/roman numerals between model and size ("MINI KELLY II 20",
# "Kelly sellier 32", "Birkin retourné 35"); allow up to 3 tokens before the number.
SIZE_LOOSE = re.compile(
    r"(?:birkin|kelly|constance|picotin|lindy|evelyne?|bolide|halzan|hac|speedy|keepall|alma|"
    r"neverfull|lady\s*dior|jodie|cassette|puzzle|le\s*teckel|margaux|capucines|garden\s*party|"
    r"plume|jypsiere|herbag|roulis|toolbox|verrou|cinhetic|della\s*cavalleria)"
    r"(?:\s+[a-zéè]+|\s+i{1,3}){0,3}\s+(\d{2})\b")


def strip_html(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", htmlmod.unescape(s)).strip()


HARDWARE_PHRASE_RX = re.compile(
    r"(?:with\s+)?(?:brushed|rose|antique|aged|palladium|permabrass|ruthenium|guilloch[eé]|"
    r"gold|silver|so\s*black)[- ]?(?:plated|toned|tone)?(?:\s*metal)?\s*hardware|\b[bgprs]?[gsp]hw\b|gold-plated",
    re.I)


def guess_colour(text):
    # drop hardware phrases first so "GOLD TONED HARDWARE" cannot become colour=Gold
    m = COLOUR_RX.search(norm(HARDWARE_PHRASE_RX.sub(" ", text or "")))
    return m.group(1).title() if m else None


def guess_hardware(text):
    hay = norm(text)
    for label, rx in HARDWARE:
        if re.search(rx, hay):
            return label
    return None


def guess_size_auction(brand, title):
    m = SIZE_LOOSE.search(norm(title))
    if m:
        return m.group(1)
    return guess_size(brand, title, "")


def derive(title, extra_text=""):
    """All regex-derived attributes from a lot title (+ optional description text).
    The text itself is NOT stored."""
    brand = guess_brand(title, None, "", None)
    hay = title + " " + extra_text
    return {
        "house": brand,
        "model_guess": guess_model(brand, title, extra_text),
        "size_guess": guess_size_auction(brand, title),
        "material": guess_material(title, extra_text),
        "colour": guess_colour(hay),
        "hardware": guess_hardware(hay),
    }


def log(msg):
    print(f"[{dt.datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ----------------------------------------------------------------------------- fetcher
class PoliteFetcher:
    def __init__(self, source, delay, max_pages, dry_run):
        self.source, self.delay, self.max_pages, self.dry_run = source, delay, max_pages, dry_run
        self.live = 0
        self.cached = 0
        self.pages_used = 0
        self.cache_dir = os.path.join(RAW, source, TODAY)
        self.sess = requests.Session()
        self.sess.headers.update({"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"})
        self.last = 0.0

    def _path(self, name):
        return os.path.join(self.cache_dir, re.sub(r"[^A-Za-z0-9_.-]+", "_", name) + ".html")

    def find_cached(self, name):
        """Look for today's cache first, then any earlier probe/cache of the same page."""
        p = self._path(name)
        if os.path.exists(p):
            return p
        probes = os.path.join(RAW, TODAY, "probes")  # this session's manual probes
        for root in (probes, os.path.join(RAW, self.source)):
            if os.path.isdir(root):
                for dp, _, files in os.walk(root):
                    for f in files:
                        if f == os.path.basename(p) or f == f"{self.source}_{os.path.basename(p)}":
                            return os.path.join(dp, f)
        return None

    def get_html(self, url, name):
        if self.pages_used >= self.max_pages:
            log(f"  page cap ({self.max_pages}) reached — skipping {url}")
            return None
        c = self.find_cached(name)
        if c:
            self.cached += 1
            self.pages_used += 1
            log(f"  cache hit {os.path.relpath(c, LAB)}")
            with open(c, encoding="utf-8", errors="ignore") as f:
                return f.read()
        if self.dry_run:
            log(f"  DRY-RUN would GET {url}")
            self.pages_used += 1
            return None
        wait = self.delay - (time.time() - self.last)
        if self.live and wait > 0:
            time.sleep(wait)
        self.live += 1
        self.pages_used += 1
        self.last = time.time()
        try:
            r = self.sess.get(url, timeout=40)
        except requests.RequestException as e:
            log(f"  ERROR {url}: {e}")
            return None
        if r.status_code != 200:
            log(f"  HTTP {r.status_code} on {url} — not retrying")
            return None
        os.makedirs(self.cache_dir, exist_ok=True)
        with open(self._path(name), "w", encoding="utf-8") as f:
            f.write(r.text)
        log(f"  GET {url} -> {len(r.text)} bytes (cached)")
        return r.text


# ----------------------------------------------------------------------------- adapters
class BaseAdapter:
    name = "base"
    status = "red"
    delay = 5.0
    note = ""
    pages = []          # (url, cache_name)

    def run(self, fetcher):
        raise NotImplementedError


class Bonhams(BaseAdapter):
    """Finished Designer Handbags & Fashion auctions. Lot results are in the page's
    __NEXT_DATA__ (pageProps.lotData.auctionLots, 48 per page; nbHits = total)."""
    name = "bonhams"
    status = "green"
    delay = 5.0        # robots.txt declares no crawl-delay; 5 s is our floor
    # Finished HBS sales (IDs from the department page, 2026-09-07). 31192 was probed
    # this session (cached); the other two are the newest finished sale IDs seen.
    pages = [
        ("https://www.bonhams.com/auction/31192/", "bonhams_auction_31192"),
        ("https://www.bonhams.com/auction/32439/", "bonhams_auction_32439"),
        ("https://www.bonhams.com/auction/32071/", "bonhams_auction_32071"),
        # more finished HBS sale ids seen on the department page, for future runs:
        # 32166, 31035, 27776, 29199, 32169, 31787, 32327
    ]

    def run(self, fetcher):
        rows = []
        for url, name in self.pages:
            h = fetcher.get_html(url, name)
            if not h:
                continue
            m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', h, re.S)
            if not m:
                log("  no __NEXT_DATA__ — page layout changed?")
                continue
            d = json.loads(m.group(1))
            pp = d["props"]["pageProps"]
            a = pp.get("auction") or {}
            lots = (pp.get("lotData") or {}).get("auctionLots") or []
            sale_name = a.get("sSaleName")
            sale_status = a.get("sSaleStatus")
            nb = (pp.get("lotData") or {}).get("nbHits")
            log(f"  {sale_name!r} status={sale_status} lots_in_page={len(lots)} total={nb}")
            if sale_status and sale_status != "FINISHED":
                log("  sale not finished — no results yet, skipping")
                continue
            for l in lots:
                flags = l.get("flags") or {}
                if not flags.get("isResultPublished", True):
                    continue
                price = l.get("price") or {}
                title = l.get("title") or ""
                lot_no = (l.get("lotNo") or {}).get("full") or l.get("lotId")
                status = l.get("status")
                sold = 1 if status == "SOLD" else 0 if status in ("BI", "UNSOLD", "WD", "PASSED") else None
                hammer = price.get("hammerPrice")
                hammer = float(hammer) if hammer not in (None, "", 0) else None
                sale_date = ((l.get("hammerTime") or l.get("auctionEndDate") or {}).get("datetime") or "")[:10]
                att = derive(title)
                rows.append({
                    "auction_house": "Bonhams",
                    "sale_name": sale_name,
                    "sale_date": sale_date or None,
                    "lot_number": str(lot_no),
                    **att,
                    "condition": None,   # not in list data; only in lot-page condition reports
                    "estimate_low": float(price["estimateLow"]) if price.get("estimateLow") else None,
                    "estimate_high": float(price["estimateHigh"]) if price.get("estimateHigh") else None,
                    "hammer_price": hammer if sold else None,
                    "currency": (l.get("currency") or {}).get("iso_code"),
                    "sold": sold,
                    "lot_url": f"https://www.bonhams.com/auction/{l.get('auctionId')}/lot/{lot_no}/{l.get('slug') or ''}/",
                })
        return rows


def decode_devalue(data):
    """Nuxt 3 __NUXT_DATA__ is devalue-encoded: a flat list where every nested value is an
    index into the list (tagged forms carry raw strings)."""
    TAGS = {"Reactive", "ShallowReactive", "Ref", "ShallowRef", "EmptyRef", "EmptyShallowRef"}
    memo = {}

    def dec(i):
        if isinstance(i, str):
            return i
        if i in memo:
            return memo[i]
        if i < 0:
            return None
        v = data[i]
        if isinstance(v, list):
            if v and isinstance(v[0], str) and v[0] in TAGS:
                memo[i] = dec(v[1]) if len(v) > 1 else None
                return memo[i]
            if v and isinstance(v[0], str) and v[0] in ("Date", "RegExp", "BigInt"):
                memo[i] = v[1]
                return v[1]
            if v and isinstance(v[0], str) and v[0] in ("Set", "Map", "Object"):
                memo[i] = [dec(x) for x in v[1:]]
                return memo[i]
            if v and isinstance(v[0], str) and v[0] == "null":
                memo[i] = None
                return None
            out = []
            memo[i] = out
            for x in v:
                out.append(dec(x))
            return out
        if isinstance(v, dict):
            out = {}
            memo[i] = out
            for k, x in v.items():
                out[k] = dec(x)
            return out
        memo[i] = v
        return v
    return dec(0)


class Artcurial(BaseAdapter):
    """Artcurial 'Hermès & Luxury Bags' sales (Monaco / Paris). Server-rendered sale page
    carries the sale record + first 20 lots (status, low/high, adjudicationPrice = hammer,
    finalPrice = with premium, currency, year). Lots 21+ come from a client call that was
    not identified in the page's JS (10 of 173 chunks inspected) — so 1 page per sale."""
    name = "artcurial"
    status = "green"
    delay = 5.0
    # Sale refs from /en/results-auctions-sales?search=Hermès (2026-09-07). MC-6028 was
    # probed this session (cached).
    pages = [
        ("https://www.artcurial.com/en/sales/MC-6028", "artcurial_sale_MC-6028"),
        ("https://www.artcurial.com/en/sales/MC6011", "artcurial_sale_MC6011"),
        ("https://www.artcurial.com/en/sales/M1118", "artcurial_sale_M1118"),
        # also Hermès & Luxury Bags: M1113; online 'Hermès & Luxury Items': IT4453, IT6078,
        # IT6169, IT6269, IT6366, IT6548 — for future runs
    ]

    def run(self, fetcher):
        rows = []
        for url, name in self.pages:
            h = fetcher.get_html(url, name)
            if not h:
                continue
            m = re.search(r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>', h, re.S)
            if not m:
                log("  no __NUXT_DATA__ — page layout changed?")
                continue
            root = decode_devalue(json.loads(m.group(1)))
            sale = (root.get("data") or {}).get("sale") or {}
            ref = sale.get("ref") or url.rsplit("/", 1)[-1]
            sale_name = sale.get("name")
            vac = (sale.get("vacations") or [{}])[0]
            sale_date = ((vac.get("validity") or {}).get("beginDate") or "")[:10]
            queries = ((root.get("state") or {}).get("$svue-query") or {}).get("queries") or []
            lots = []
            total = None
            for q in queries:
                key = q.get("queryKey") or []
                if key and key[0] == "saleLots":
                    for pg in (q.get("state", {}).get("data") or {}).get("pages") or []:
                        lots.extend(pg.get("content") or [])
                        total = pg.get("totalElements")
            log(f"  {sale_name!r} ref={ref} status={sale.get('status')} lots_in_page={len(lots)} total={total}")
            if sale.get("hideLotResult") or sale.get("hideAdjudicationResult"):
                log("  results hidden by the house — skipping")
                continue
            for l in lots:
                desc = (l.get("descriptions") or {}).get("ENGLISH") or (l.get("descriptions") or {}).get("FRENCH") or {}
                title = strip_html(desc.get("titleWithHtml") or "")
                body = strip_html(desc.get("descriptionWithHtml") or "")
                state = strip_html(desc.get("state") or "")
                status = l.get("status")
                sold = 1 if status == "SOLD" else 0 if status in ("UNSOLD", "WITHDRAWN", "NOT_SOLD", "RETIRED") else None
                lot_no = f"{l.get('index')}{l.get('subIndex') or ''}"
                att = derive(title, body)
                hammer = l.get("adjudicationPrice")
                rows.append({
                    "auction_house": "Artcurial",
                    "sale_name": sale_name,
                    "sale_date": (l.get("adjudicationDate") or sale_date or "")[:10] or None,
                    "lot_number": lot_no,
                    **att,
                    "condition": guess_condition(state, ""),
                    "estimate_low": float(l["low"]) if l.get("low") else None,
                    "estimate_high": float(l["high"]) if l.get("high") else None,
                    "hammer_price": float(hammer) if (sold and hammer) else None,
                    "currency": l.get("currency"),
                    "sold": sold,
                    "lot_url": f"https://www.artcurial.com/en/sales/{ref}/lots/{l.get('index')}-{l.get('subIndex') or ''}".rstrip("-"),
                })
        return rows


class Sothebys(BaseAdapter):
    """RED for automation (Terms §4). Manual path: Katie opens a Sotheby's handbag sale
    results page in Chrome, File > Save Page As (Webpage, Complete), then
      python3 auction_results.py --source sothebys --ingest-html <saved.html>
    The parser looks for JSON-LD / embedded state and lot cards; it is UNTESTED until a
    saved page exists (no automated fetch was made)."""
    name = "sothebys"
    status = "red"
    delay = 15.0
    note = ("Terms & Conditions of Use §4 prohibit screen scraping / harvesting catalogue "
            "information / any automatic means. robots.txt Crawl-delay 15. Manual Chrome ingest only.")

    def run(self, fetcher):
        log(f"  {self.name}: {self.note}")
        return []

    def ingest_html(self, path):
        h = open(path, encoding="utf-8", errors="ignore").read()
        rows = []
        sale_name = None
        t = re.search(r"<title>([^<]+)</title>", h)
        if t:
            sale_name = htmlmod.unescape(t.group(1)).strip()
        # 1) JSON-LD product/offer blocks
        for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', h, re.S):
            try:
                j = json.loads(m.group(1))
            except ValueError:
                continue
            items = j if isinstance(j, list) else [j]
            for it in items:
                if not isinstance(it, dict):
                    continue
                name = it.get("name")
                offers = it.get("offers") or {}
                if name and offers:
                    att = derive(name, it.get("description") or "")
                    rows.append({
                        "auction_house": "Sotheby's", "sale_name": sale_name, "sale_date": None,
                        "lot_number": str(it.get("sku") or it.get("position") or ""), **att,
                        "condition": None, "estimate_low": None, "estimate_high": None,
                        "hammer_price": float(offers.get("price")) if offers.get("price") else None,
                        "currency": offers.get("priceCurrency"), "sold": 1 if offers.get("price") else None,
                        "lot_url": it.get("url") or offers.get("url"),
                    })
        # 2) fallback: visible text pattern "Lot N ... Estimate X – Y ... Sold for Z"
        if not rows:
            txt = strip_html(re.sub(r"<script.*?</script>|<style.*?</style>", " ", h, flags=re.S))
            for m in re.finditer(r"Lot\s+(\d+[A-Z]?)\s+(.{5,160}?)\s+(?:Estimate\s+([\d,]+)\s*[–-]\s*([\d,]+)\s*([A-Z]{3}))?.{0,80}?(Sold for|Lot Sold)\s*([\d,]+)\s*([A-Z]{3})", txt):
                title = m.group(2)
                att = derive(title)
                rows.append({
                    "auction_house": "Sotheby's", "sale_name": sale_name, "sale_date": None,
                    "lot_number": m.group(1), **att, "condition": None,
                    "estimate_low": float(m.group(3).replace(",", "")) if m.group(3) else None,
                    "estimate_high": float(m.group(4).replace(",", "")) if m.group(4) else None,
                    "hammer_price": float(m.group(7).replace(",", "")), "currency": m.group(8), "sold": 1,
                    "lot_url": f"file://{os.path.abspath(path)}#lot-{m.group(1)}",
                })
        log(f"  parsed {len(rows)} lots from saved page (manual ingest; verify a few by eye)")
        return rows


class Christies(BaseAdapter):
    name = "christies"
    status = "red"
    note = "www.christies.com timed out on the single permitted probe (robots.txt, 2026-09-07). Re-check later."

    def run(self, fetcher):
        log(f"  {self.name}: {self.note}")
        return []


class Heritage(BaseAdapter):
    name = "heritage"
    status = "red"
    note = ("Prices realized are members-only (free account) per Heritage's own archive notice; "
            "archive page returned a DataDome captcha 403 to our UA. Login-gated -> out of scope.")

    def run(self, fetcher):
        log(f"  {self.name}: {self.note}")
        return []


ADAPTERS = {a.name: a for a in [Bonhams, Artcurial, Sothebys, Christies, Heritage]}

# ----------------------------------------------------------------------------- storage
DDL = """
CREATE TABLE IF NOT EXISTS auction_results(
  id integer primary key, auction_house text, sale_name text, sale_date text, lot_number text,
  house text, model_guess text, size_guess text, material text, colour text, hardware text,
  condition text, estimate_low real, estimate_high real, hammer_price real, currency text,
  sold int, lot_url text, retrieved_at text, unique(auction_house, lot_url));
CREATE INDEX IF NOT EXISTS ix_auction_results_house_model ON auction_results(house, model_guess);
CREATE INDEX IF NOT EXISTS ix_auction_results_sale_date ON auction_results(sale_date);
"""
COLS = ["auction_house", "sale_name", "sale_date", "lot_number", "house", "model_guess", "size_guess",
        "material", "colour", "hardware", "condition", "estimate_low", "estimate_high", "hammer_price",
        "currency", "sold", "lot_url", "retrieved_at"]


def store(rows):
    con = sqlite3.connect(DB)
    con.executescript(DDL)
    before = con.execute("select count(*) from auction_results").fetchone()[0]
    sql = (f"INSERT INTO auction_results({','.join(COLS)}) VALUES({','.join('?' * len(COLS))}) "
           "ON CONFLICT(auction_house, lot_url) DO UPDATE SET "
           + ", ".join(f"{c}=excluded.{c}" for c in COLS if c not in ("auction_house", "lot_url")))
    for r in rows:
        r["retrieved_at"] = NOW
        con.execute(sql, [r.get(c) for c in COLS])
    con.commit()
    after = con.execute("select count(*) from auction_results").fetchone()[0]
    con.close()
    return before, after


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", default="all", help="comma list or 'all' (= GREEN sources)")
    ap.add_argument("--dry-run", action="store_true", help="no network, no DB writes")
    ap.add_argument("--max-pages", type=int, default=3, help="results pages per house (default 3)")
    ap.add_argument("--ingest-html", help="(sothebys) parse a page Katie saved from Chrome")
    ap.add_argument("--list-sources", action="store_true")
    args = ap.parse_args()

    if args.list_sources:
        for n, a in ADAPTERS.items():
            print(f"{n:10s} {a.status.upper():6s} {a.note or 'server-rendered results pages'}")
        return
    names = [n for n, a in ADAPTERS.items() if a.status == "green"] if args.source == "all" \
        else [s.strip() for s in args.source.split(",")]
    all_rows = []
    per_source = {}
    for n in names:
        if n not in ADAPTERS:
            log(f"unknown source {n}; use --list-sources")
            continue
        A = ADAPTERS[n]()
        log(f"== {n} [{A.status.upper()}]")
        if args.ingest_html and hasattr(A, "ingest_html"):
            rows = A.ingest_html(args.ingest_html)
        elif A.status != "green":
            A.run(None)
            rows = []
        else:
            f = PoliteFetcher(n, A.delay, args.max_pages, args.dry_run)
            rows = A.run(f)
            log(f"  live requests {f.live}, cache hits {f.cached}, pages used {f.pages_used}/{args.max_pages}")
        per_source[n] = len(rows)
        all_rows.extend(rows)
    if args.dry_run:
        log(f"DRY-RUN complete; would upsert {len(all_rows)} rows: {per_source}")
        return
    if all_rows:
        before, after = store(all_rows)
        log(f"auction_results: {before} -> {after} rows (+{after - before} new, {len(all_rows) - (after - before)} updated) {per_source}")
    else:
        log("nothing to store")


if __name__ == "__main__":
    main()
