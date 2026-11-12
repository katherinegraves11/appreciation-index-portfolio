#!/usr/bin/env python3
"""
tiktok_creative_center.py — TikTok Creative Center hashtag trends -> luxury_bags.db:momentum

STATUS: AMBER (2026-09-07). Details:
  * robots.txt (https://ads.tiktok.com/robots.txt): "User-agent: * / Allow: /" — crawling is
    not forbidden by robots.
  * The hashtag page is a login-free React SPA. The old URL
      /business/creativecenter/inspiration/popular/hashtag/pc/en
    now 302s to /creative/creativeCenter/trends -> /creativeCenter/trends/hashtag. The
    server returns only an app shell; the hashtag table is filled client-side. The
    endpoint it calls was NOT observable from the static bundles we are allowed to read
    (main, route manifest, trends/page and top-hashtag/layout chunks contain only routing),
    and we do not borrow endpoints from third-party scrapers.
  * TikTok Terms of Service (Section 5, US) prohibit "us[ing] automated scripts to collect
    information from or otherwise interact with the Services"; the TikTok Ads Program Terms
    (login-gated page) are reported to prohibit scraping of advertising-related information
    without TikTok's consent. -> No unattended collector. Katie reads the page herself in
    Chrome; this script only INGESTS what she saved and stores derived numbers.

Chrome-assisted manual procedure (about 10 minutes for 5 regions):
  1. In Chrome open https://ads.tiktok.com/creative/creativeCenter/trends/hashtag
     (no login needed). Set Region = US, Period = Last 7 days (or 30/120).
  2. Type each hashtag from TERMS in the page search box, or scroll the ranked list.
  3. File > Save Page As... > "Webpage, Complete" into
       raw/tiktok-creative-center/<YYYY-MM-DD>/<REGION>_<PERIOD>d.html
     (e.g. US_7d.html). Repeat for GB, FR, JP, KR.
     Alternatively paste rows into a CSV with header
       term,region,period_days,rank,posts,growth_pct
     and save it as raw/tiktok-creative-center/<date>/manual.csv
  4. Run:  python3 tiktok_creative_center.py --source tiktok --ingest raw/tiktok-creative-center/<date>
     (or --dry-run to see what would be written).

What gets stored (momentum table, existing schema, never altered):
  term          = hashtag without '#', lowercase (e.g. hermesbirkin)
  source        = 'TikTok Creative Center'
  metric        = post_count_<REGION> | rank_<REGION> | growth_pct_<REGION>
  value         = number (posts expanded from 12.3K / 1.2M)
  period_start/period_end = window the page showed (end = save date, start = end - period_days)
  retrieved_at  = save date
Idempotent: rows for the same (term, source, metric, period_start, period_end) are replaced.
"""
import argparse
import csv
import datetime as dt
import glob
import html as htmlmod
import os
import re
import sqlite3

LAB = "/Users/katiegraves/Desktop/Fashion Data Lab"
DB = os.path.join(LAB, "db", "luxury_bags.db")
RAW = os.path.join(LAB, "raw", "tiktok-creative-center")
SOURCE = "TikTok Creative Center"
UA = "BagIndexResearch/0.1 (personal research; contact via github.com/katherinegraves11)"  # for the robots check only
TERMS = ["hermes", "hermesbirkin", "hermeskelly", "chanel", "chanelbag", "classicflap", "dior", "ladydior",
         "diorsaddle", "louisvuitton", "gucci", "guccijackie", "prada", "miumiu", "fendi", "fendibaguette",
         "celine", "saintlaurent", "bottegaveneta", "loewe", "balenciaga", "therow", "alaia", "vintagebags",
         "luxuryresale", "bagtok"]
REGIONS = ["US", "GB", "FR", "JP", "KR"]
PAGE_URL = "https://ads.tiktok.com/creative/creativeCenter/trends/hashtag"


def log(msg):
    print(f"[{dt.datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def num(s):
    """'12.3K' -> 12300, '1.2M' -> 1200000, '+45%' -> 45.0"""
    s = (s or "").strip().replace(",", "").replace("%", "").replace("+", "")
    m = re.fullmatch(r"(-?\d+(?:\.\d+)?)\s*([KkMmBb])?", s)
    if not m:
        return None
    v = float(m.group(1))
    mult = {"k": 1e3, "m": 1e6, "b": 1e9}.get((m.group(2) or "").lower(), 1)
    return v * mult


def parse_saved_html(path, region, period_days, save_date):
    """Best-effort parse of a 'Webpage, Complete' save of the hashtag list. The rendered
    DOM shows, per row: rank, '# hashtag', posts, growth. We find each '#term' we care
    about and read the nearest numbers after it. Verify a few rows by eye the first time."""
    h = open(path, encoding="utf-8", errors="ignore").read()
    txt = re.sub(r"<script.*?</script>|<style.*?</style>", " ", h, flags=re.S)
    txt = htmlmod.unescape(re.sub(r"<[^>]+>", " | ", txt))
    txt = re.sub(r"\s+", " ", txt)
    out = []
    for term in TERMS:
        for m in re.finditer(r"(?:\|\s*(\d{1,4})\s*\|\s*)?#\s*" + re.escape(term) + r"\b(.{0,160})", txt, re.I):
            tail = m.group(2)
            nums = re.findall(r"([+-]?\d[\d.,]*\s*[KkMmBb]?)\s*(Posts?|%|\|)", tail)
            posts = growth = None
            for val, unit in nums:
                if unit.lower().startswith("post") and posts is None:
                    posts = num(val)
                elif unit == "%" and growth is None:
                    growth = num(val)
            rank = int(m.group(1)) if m.group(1) else None
            if posts is None and growth is None and rank is None:
                continue
            out.append((term, region, period_days, rank, posts, growth))
            break
    return rows_from_tuples(out, save_date)


def parse_manual_csv(path, save_date):
    out = []
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out.append((r["term"].strip().lstrip("#").lower(), r["region"].strip().upper(),
                        int(r.get("period_days") or 7),
                        int(r["rank"]) if r.get("rank") else None,
                        num(r.get("posts")), num(r.get("growth_pct"))))
    return rows_from_tuples(out, save_date)


def rows_from_tuples(tuples, save_date):
    rows = []
    for term, region, period_days, rank, posts, growth in tuples:
        end = save_date
        start = (dt.date.fromisoformat(save_date) - dt.timedelta(days=int(period_days))).isoformat()
        for metric, val in (("post_count", posts), ("rank", rank), ("growth_pct", growth)):
            if val is None:
                continue
            rows.append((term, SOURCE, f"{metric}_{region}", float(val), start, end, save_date))
    return rows


def store(rows):
    con = sqlite3.connect(DB)
    assert con.execute("select count(*) from sqlite_master where name='momentum'").fetchone()[0], "momentum table missing"
    for r in rows:
        con.execute("DELETE FROM momentum WHERE term=? AND source=? AND metric=? AND period_start=? AND period_end=?",
                    (r[0], r[1], r[2], r[4], r[5]))
        con.execute("INSERT INTO momentum(term,source,metric,value,period_start,period_end,retrieved_at) VALUES(?,?,?,?,?,?,?)", r)
    con.commit()
    n = con.execute("select count(*) from momentum where source=?", (SOURCE,)).fetchone()[0]
    con.close()
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", default="tiktok", help="only 'tiktok' exists; kept for symmetry with other collectors")
    ap.add_argument("--dry-run", action="store_true", help="parse but do not write")
    ap.add_argument("--ingest", help="folder (or single .html/.csv) saved from Chrome; default = today's raw folder")
    ap.add_argument("--print-procedure", action="store_true", help="print the manual Chrome steps + URLs to open")
    args = ap.parse_args()
    if args.source != "tiktok":
        log(f"unknown source {args.source}")
        return
    if args.print_procedure or not (args.ingest or os.path.isdir(os.path.join(RAW, dt.date.today().isoformat()))):
        print(__doc__)
        print("Pages to open in Chrome (one per region; set Period on the page):")
        for r in REGIONS:
            print(f"  {PAGE_URL}   -> Region {r}")
        print("Hashtags to look up:", ", ".join("#" + t for t in TERMS))
        if not args.ingest:
            log("AMBER: no automated fetch is performed. Save pages as described, then re-run with --ingest <folder>.")
            return
    target = args.ingest or os.path.join(RAW, dt.date.today().isoformat())
    files = [target] if os.path.isfile(target) else sorted(glob.glob(os.path.join(target, "*.html")) + glob.glob(os.path.join(target, "*.csv")))
    if not files:
        log(f"no saved .html/.csv under {target}")
        return
    rows = []
    for f in files:
        save_date = dt.date.fromtimestamp(os.path.getmtime(f)).isoformat()
        base = os.path.basename(f)
        if base.endswith(".csv"):
            r = parse_manual_csv(f, save_date)
        else:
            m = re.match(r"([A-Z]{2})_(\d+)d", base)
            if not m:
                log(f"  skip {base}: name it <REGION>_<PERIOD>d.html (e.g. US_7d.html)")
                continue
            r = parse_saved_html(f, m.group(1), int(m.group(2)), save_date)
        log(f"  {base}: {len(r)} metric rows")
        rows.extend(r)
    if args.dry_run:
        for r in rows[:15]:
            print("  ", r)
        log(f"DRY-RUN: would write {len(rows)} rows to momentum (source={SOURCE!r})")
        return
    n = store(rows)
    log(f"momentum: wrote {len(rows)} rows; {n} total rows from {SOURCE!r}")


if __name__ == "__main__":
    main()
