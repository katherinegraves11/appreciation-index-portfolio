#!/usr/bin/env python3
"""Ingest house handbag category reads saved from Katie's Chrome (raw/retail-reads/<date>/*.jsonl, one JSON per page:
{house, page, items:[{href,name,price,oos,tx,img}]}) into retail_availability_reads and catalog_page_reads, then print
what changed against each house's previous read: new references, references no longer listed, price changes, sold out.
Our own words and numbers only; image_url is a link, never a saved file. Usage: ingest_category.py <date> [house ...]"""
import sys, json, re, glob, sqlite3, datetime, os
DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
ROOT = "/Users/katiegraves/Desktop/Fashion Data Lab/raw/retail-reads"
# product URL pattern and the house's product reference within it (same references as the 2026-10-24 read)
PAT = {
 "Louis Vuitton": r"louisvuitton\.com/eng-us/products/.+/([A-Z0-9]+)$",
 "Dior": r"dior\.com/en_us/fashion/products/([A-Z0-9_]+)$",
 "Gucci": r"gucci\.com/us/en/pr/.+-p-([A-Z0-9]+)$",
 "Prada": r"prada\.com/us/en/p/[^/]+/([A-Z0-9_]+)$",
 "Miu Miu": r"miumiu\.com/us/en/p/[^/]+/([A-Z0-9_]+)$",
 "Fendi": r"fendi\.com/us-en/.+-([a-z0-9]{12,})$",
 "Celine": r"celine\.com/en-us/.+-([0-9A-Z]{6,}\.[0-9A-Z]{2,6})\.html$",
 "Saint Laurent": r"ysl\.com/en-us/pr/.+-([0-9A-Z]{12,})\.html$",
 "Bottega Veneta": r"bottegaveneta\.com/en-us/.+-([0-9A-Z]{12,})\.html$",
 "Loewe": r"loewe\.com/usa/en/.+/([A-Z0-9]+-[0-9]+)\.html$",
 "Balenciaga": r"balenciaga\.com/en-us/.+-([0-9A-Z]{12,})\.html$",
 "The Row": r"therow\.com/products/([a-z0-9-]+)$",
 "Alaïa": r"maison-alaia\.com/en-us/product/.+-([A-Z0-9]{12,})\.html$",
 "Ferragamo": r"ferragamo\.com/shop/us/en/.+-(\d{6,})$",
 "Chanel": r"chanel\.com/us/fashion/p/([A-Z0-9]+)/",
}
date = sys.argv[1]; only = set(sys.argv[2:])
db = sqlite3.connect(DB); db.execute("pragma busy_timeout=10000")
pages = {}
for f in sorted(glob.glob(f"{ROOT}/{date}/*.jsonl")):
    d = json.load(open(f)); d["_f"] = os.path.basename(f)
    if only and d["house"] not in only: continue
    pages.setdefault(d["house"], []).append(d)
now = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
for house, ds in pages.items():
    have = {r[0] for r in db.execute("select reference from retail_availability_reads where house=? and read_date=?", (house, date))}
    rx = re.compile(PAT[house]); seen = {}
    for d in ds:
        for it in d["items"]:
            m = rx.search(it["href"])
            if not m: continue
            ref = m.group(1).upper() if house == "Fendi" else m.group(1)
            if ref in seen: continue
            price = float(it["price"].replace(",", "")) if it.get("price") else None
            seen[ref] = (it, price, d["page"])
    # the last full read (a date holding at least half as many bags as today), not a one-off product check
    prev_date = db.execute("select max(read_date) from (select read_date, count(*) n from retail_availability_reads where house=? and read_date<? and reference is not null group by read_date) where n >= ?", (house, date, len(seen) // 2)).fetchone()[0]
    prev = {r[0]: (r[1], r[2]) for r in db.execute("select reference, price, availability from retail_availability_reads where house=? and read_date=?", (house, prev_date))} if prev_date else {}
    for ref, (it, price, page) in seen.items():
        if ref in have: continue  # a second, fuller read the same day adds only what the first missed
        name = re.sub(r"^(Add the item |New\s+)", "", it["name"] or "").strip() or re.split(r"\$", it["tx"])[0].strip()[:120]
        name = re.sub(r"^(NOTIFY ME|NEW|ONLINE EXCLUSIVE|POP-UP EXCLUSIVE)\s+", "", re.split(r"\s*\$", name)[0]).strip()
        avail = "out of stock" if it["oos"] else "listed"
        db.execute("""insert into retail_availability_reads(house,country,url,read_date,products_listed,model,price,currency,availability,notes,retrieved_at,reference,image_url)
                      values(?,?,?,?,?,?,?,?,?,?,?,?,?)""", (house, "US", it["href"], date, len(seen), name, price, "USD", avail,
                   f"{name}; from {page}, read in Katie's Chrome (category tile: name, price, stock wording only)", now, ref, it.get("img")))
    for d in ds:
        if db.execute("select 1 from catalog_page_reads where house=? and url=? and read_date=? and note like ?", (house, d["page"], date, f"%{d['_f']}%")).fetchone(): continue
        d["note"] = (d.get("note") or "") + f" [raw {d['_f']}]"
        db.execute("insert into catalog_page_reads(house,url,read_date,stated_total,items_read,bags_saved,pages_followed,note,retrieved_at) values(?,?,?,?,?,?,?,?,?)",
                   (house, d["page"], date, d.get("stated"), len(seen), len(seen), d.get("pages_followed"), d.get("note", ""), now))
    seen.update({r: ({"name": m, "oos": a == "out of stock"}, pr, None) for r, pr, a, m in db.execute(
        "select reference, price, availability, model from retail_availability_reads where house=? and read_date=?", (house, date)) if r not in seen})
    new = [r for r in seen if r not in prev]; gone = [r for r in prev if r not in seen]
    moved = [(r, prev[r][0], seen[r][1]) for r in seen if r in prev and prev[r][0] and seen[r][1] and abs(prev[r][0] - seen[r][1]) >= 1]
    oos = [r for r in seen if seen[r][0]["oos"]]
    print(f"{house}: {len(seen)} bags (prev {len(prev)} on {prev_date}); new {len(new)}, no longer listed {len(gone)}, price changes {len(moved)}, out of stock {len(oos)}")
    for r, a, b in sorted(moved, key=lambda x: -abs(x[2] - x[1]))[:8]:
        print(f"   price {seen[r][0]['name'][:50]} ({r}): ${a:,.0f} -> ${b:,.0f} ({100*(b-a)/a:+.1f}%)")
    for r in oos[:8]: print(f"   OOS {seen[r][0]['name'][:60]} ({r})")
db.commit()
