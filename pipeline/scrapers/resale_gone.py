#!/usr/bin/env python3
"""Mark secondhand sourcer listings that vanished between two daily reads as "gone at last ask" (Katie, 2026-10-24: Madison Avenue
Couture "even maybe a little bit more accurate than the Real Real"; read it daily). A listing in the previous snapshot but missing from
today's (or now unavailable) most likely sold near its last ask, though it may have been withdrawn; the rubric treats "gone at last
ask" as a sale at about the listed price and says so. Only compares two FULL reads: pass --min-coverage so a partial read (request cap
hit) does not mark half the store as sold. Writes resale_listings.available=0 and appends a tag. Run after resale_asks.py:
python3 scrapers/resale_gone.py --source madisonavenuecouture
"""
import argparse, sqlite3, datetime
DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
ap = argparse.ArgumentParser(); ap.add_argument("--source", required=True); ap.add_argument("--min-coverage", type=float, default=0.9)
a = ap.parse_args()
db = sqlite3.connect(DB)
dates = [r[0] for r in db.execute("select distinct snapshot_date from resale_snapshots where source=? order by snapshot_date desc limit 2", (a.source,))]
if len(dates) < 2:
    print("need two snapshot dates; have", dates); raise SystemExit(0)
today, prev = dates
seen = lambda d: {r[0]: r[1] for r in db.execute("select source_product_id, available from resale_snapshots where source=? and snapshot_date=?", (a.source, d))}
t, p = seen(today), seen(prev)
coverage = len(t) / max(1, len(p))
if coverage < a.min_coverage:
    print(f"today's read has {len(t)} listings vs {len(p)} on {prev} ({coverage:.0%}): partial read, nothing marked"); raise SystemExit(0)
gone = [pid for pid, av in p.items() if av and (pid not in t or not t[pid])]
for pid in gone:
    db.execute("update resale_listings set available=0, tags=coalesce(tags,'')||? where source=? and source_product_id=? and available<>0",
               (f"; gone at last ask between {prev} and {today}", a.source, pid))
db.commit()
print(f"{a.source}: {len(p)} listings on {prev}, {len(t)} on {today}; {len(gone)} gone at last ask")
