#!/usr/bin/env python3
"""Ingest a RealReal sweep saved from Chrome (JSON {slug: {tx, q}}) into trr_item_reads.
Usage: ingest_fetch.py <file.json>. Derived fields only: title, condition, price, est. retail, sold, on hold, saves, badges."""
import sys, json, re, sqlite3, datetime
DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
HOUSES = ["Hermès","Chanel","Christian Dior","Dior","Fendi","Louis Vuitton","Gucci","Prada","Miu Miu","Celine","Saint Laurent","Bottega Veneta","Loewe","Balenciaga","The Row","Alaïa","Ferragamo","Salvatore Ferragamo","Goyard","Chloé","Valentino","Givenchy","Jacquemus","Coach","Burberry","Mulberry","Loro Piana","Khaite","Polène","Tom Ford","Marc Jacobs","Stella McCartney","Alexander McQueen","Jimmy Choo","Judith Leiber","Moynat","Delvaux","Bulgari","Cartier","Ralph Lauren","Off-White","Dolce & Gabbana","Versace","Proenza Schouler","Ulla Johnson","Mansur Gavriel","Simon Miller","JW Anderson"]
d = json.load(open(sys.argv[1])); today = datetime.date.today().isoformat()
db = sqlite3.connect(DB); db.execute("pragma busy_timeout=10000")
n = 0; skipped = 0
for slug, v in d.items():
    tx = v["tx"]
    sold = tx.startswith("SOLD") or "SOLDSee Similar" in tx
    hold = "ON HOLD" in tx.upper()
    badges = [b for b in ["Editors' Pick","TRENDING","New Arrival"] if b.lower() in tx.lower()]
    body = re.sub(r"^(SOLD|ON HOLD)?(See Similar)?(Add to My Waitlist)?", "", tx)
    for b in ["Editors' Pick","EDITORS' PICK","TRENDING","New Arrival","NEW ARRIVAL","ON HOLD"]: body = body.replace(b, "")
    house = next((h for h in sorted(HOUSES, key=len, reverse=True) if body.startswith(h)), None)
    if not house: skipped += 1; continue
    rest = body[len(house):]
    m = re.match(r"(.*?)(?:Size [^C]*)?Condition:\s*(Pristine|Excellent|Very Good|Good|Fair)(.*)$", rest)
    if not m: skipped += 1; continue
    title, cond, tail = m.group(1).strip(), m.group(2), m.group(3)
    est = re.search(r"Est\. Retail \$([\d,]+)", tail)
    prices = [float(p.replace(",", "")) for p in re.findall(r"\$([\d,]+\.\d\d)", tail)]
    if not prices: skipped += 1; continue
    price = prices[-1]; was = prices[0] if len(prices) > 1 else None
    sv = re.search(r"\.\d\d(\d{1,5})$", tail)
    tags = ([f"saves={sv.group(1)}"] if sv else []) + (["SOLD"] if sold else []) + (["ON HOLD"] if hold else []) + badges + ([f"was ${int(was):,}"] if was and was != price else []) + [f"sweep {today}"]
    h = "Dior" if house == "Christian Dior" else "Ferragamo" if house == "Salvatore Ferragamo" else house
    if db.execute("select 1 from trr_item_reads where slug=? and read_date=?", (slug, today)).fetchone(): continue
    yr = re.search(r"\b(19|20)\d\d\b", title)
    sku = (re.search(r"/([A-Z0-9]+)_\d+_", v.get("img") or "") or [None, None])[1]  # the listing photo's id, for the private photo store
    db.execute("insert into trr_item_reads(read_date,house,title,year_tag,condition,est_retail,price,sold,slug,image_sku) values(?,?,?,?,?,?,?,?,?,?)",
               (today, h, f"{title} [{'; '.join(tags)}]", yr.group(0) if yr else None, cond, float(est.group(1).replace(',', '')) if est else None, price, 1 if sold else 0, slug, sku)); n += 1
db.commit(); print(f"ingested {n}, skipped {skipped}")
