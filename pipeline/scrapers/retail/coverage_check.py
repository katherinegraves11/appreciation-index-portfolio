#!/usr/bin/env python3
"""Is every covered house's US handbag catalogue complete and fresh? (Katie, 2026-10-24: "how can I make sure that mistake doesn't
happen again ... I want this to be running in a self-sustaining way". The mistake: Chanel's handbag page has 5 pages and only page 1
was read.) Reads catalog_page_reads (one row per category or collection page read: stated total, items read, pages followed) and
v_house_catalog. Prints one line per house: OK, GAP (fewer items read than the page states), UNVERIFIED (the page states no total,
so the reader must say it reached the end), STALE (no read in 8 days) or MISSING (never read). Exit code 1 when any house is not OK,
so the watchdog flags it. Read-only. Run: python3 scrapers/retail/coverage_check.py
"""
import sqlite3, sys, datetime

DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
HOUSES = ["Hermès", "Chanel", "Louis Vuitton", "Dior", "Gucci", "Prada", "Miu Miu", "Fendi", "Celine", "Saint Laurent",
          "Bottega Veneta", "Loewe", "Balenciaga", "The Row", "Alaïa", "Ferragamo"]  # bag-index/src/lib/houses.ts COVERED_HOUSES

db = sqlite3.connect(DB)
today = datetime.date.today()
bad = 0
for h in HOUSES:
    pages = db.execute("""select url, read_date, stated_total, items_read, note from catalog_page_reads p
                          where house=? and read_date=(select max(read_date) from catalog_page_reads q where q.house=p.house and q.url=p.url)""", (h,)).fetchall()
    bags, priced = db.execute("select count(*), count(price_now) from v_house_catalog where house=?", (h,)).fetchone()
    if not pages:
        print(f"MISSING     {h}: no category page read on record ({bags} bags held)"); bad += 1; continue
    last = max(p[1] for p in pages)
    age = (today - datetime.date.fromisoformat(last)).days
    status, why = "OK", []
    for url, date, stated, read, note in pages:
        if stated and (read or 0) < stated:
            status = "GAP"; why.append(f"{url} read {read} of {stated}")
        elif not stated and status == "OK":
            status = "UNVERIFIED"; why.append(f"{url} states no total; reader must confirm it reached the end")
    if age > 8:
        status = "STALE"; why.append(f"last read {last}")
    if status != "OK":
        bad += 1
    print(f"{status:<11} {h}: {bags} bags, {priced} priced, last read {last}" + (f" | {'; '.join(why)}" if why else ""))
sys.exit(1 if bad else 0)
