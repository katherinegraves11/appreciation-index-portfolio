#!/usr/bin/env python3
"""Keep a small copy of each RealReal listing photo privately, for cross-checking dropped-in photos (Katie, 2026-10-25).
Reads trr_item_reads.image_sku (captured by the daily sweep from the tile image), saves
photos/listings/<sku>.jpg from product-images.therealreal.com/<sku>_1_product.jpg (about 13 KB each), one every 2-3 s.
Never shown on the front end; source link kept. Usage: fetch_images.py [max]"""
import sys, os, sqlite3, time, random, urllib.request
DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
OUT = "/Users/katiegraves/Desktop/Fashion Data Lab/photos/listings"
UA = "BagIndexResearch/0.1 (personal research; contact via github.com/katherinegraves11)"
os.makedirs(OUT, exist_ok=True)
mx = int(sys.argv[1]) if len(sys.argv) > 1 else 500
db = sqlite3.connect(DB); db.execute("pragma busy_timeout=10000")
skus = [r[0] for r in db.execute("select distinct image_sku from trr_item_reads where image_sku is not null and image_sku <> ''")]
todo = [s for s in skus if not os.path.exists(f"{OUT}/{s}.jpg")][:mx]
ok = 0
for s in todo:
    try:
        req = urllib.request.Request(f"https://product-images.therealreal.com/{s}_1_product.jpg", headers={"user-agent": UA})
        with urllib.request.urlopen(req, timeout=15) as r: open(f"{OUT}/{s}.jpg", "wb").write(r.read()); ok += 1
    except Exception as e:
        print("skip", s, e)
    time.sleep(2 + random.random())
print(f"saved {ok} of {len(todo)} (of {len(skus)} known)")
