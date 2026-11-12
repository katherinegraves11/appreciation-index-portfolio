#!/usr/bin/env python3
"""Check each "gone at last ask" listing on its own product page before we count it as a likely sale (2026-10-24: the Oct 2 and
Oct 24 Madison Avenue Couture reads covered different numbers of Hermès pages, so absence from a read is not proof). For each
gone listing: GET <handle_url>.json (Shopify's public product JSON) 4-6 s apart. 404 or every variant unavailable -> confirmed gone
(kept, tag "confirmed gone <date>"); still for sale -> available=1 again, tag "still listed <date>, not a sale". Nothing is deleted.
Run: python3 scrapers/verify_gone.py --source madisonavenuecouture
"""
import argparse, sqlite3, urllib.request, urllib.error, json, time, random, datetime
DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
UA = "AppreciationIndexResearch/1.0 (Katie Graves, Cornell Tech; low-rate public product JSON)"
ap = argparse.ArgumentParser(); ap.add_argument("--source", required=True); a = ap.parse_args()
db = sqlite3.connect(DB); today = datetime.date.today().isoformat()
rows = db.execute("select id, handle_url from resale_listings where source=? and tags like '%gone at last ask%' and tags not like '%confirmed gone%' and tags not like '%still listed%'", (a.source,)).fetchall()
gone = still = err = 0
for rid, url in rows:
    status = None
    try:
        with urllib.request.urlopen(urllib.request.Request(url.rstrip("/") + ".json", headers={"User-Agent": UA}), timeout=30) as r:
            p = json.load(r).get("product", {})
            status = "available" if any(v.get("available") for v in p.get("variants", [])) else "unavailable"
    except urllib.error.HTTPError as e:
        status = "404" if e.code == 404 else f"http {e.code}"
    except Exception as e:
        status = f"error {type(e).__name__}"
    if status in ("404", "unavailable"):
        db.execute("update resale_listings set available=0, tags=tags||? where id=?", (f"; confirmed gone {today} ({status})", rid)); gone += 1
    elif status == "available":
        db.execute("update resale_listings set available=1, tags=tags||? where id=?", (f"; still listed {today}, not a sale", rid)); still += 1
    else:
        err += 1
    db.commit()
    if status and status.startswith("http 429"):
        time.sleep(60)
    time.sleep(random.uniform(4, 6))
print(f"{a.source}: checked {len(rows)}; confirmed gone {gone}; still listed {still}; could not check {err}")
