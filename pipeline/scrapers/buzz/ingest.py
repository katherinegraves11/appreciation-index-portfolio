#!/usr/bin/env python3
"""Write one derived buzz read (used by the daily task after a human-pace browser read).
  python3 scrapers/buzz/ingest.py --platform tiktok-cc --term souplissimo --metric posts_7d --value 1280 --window 7 \
      --url https://ads.tiktok.com/creative/creativeCenter/trends/hashtag --method chrome-human --note "rank 412 in Apparel US"
  python3 scrapers/buzz/ingest.py --csv raw/buzz/2026-10-18.csv      # header: platform,term,metric,value,window_days,region,method,source_url,note
  python3 scrapers/buzz/ingest.py --event --house Chanel --family "Souplissimo flap" --type celebrity_carry \
      --note "Carried front row at the SS27 show by a pop star with >10m reach" --reach ">10m" --url https://...
Values like 12.3K / 1.2M / 3,400 are expanded. Never pass usernames, captions or image links."""
import argparse, csv, datetime as dt, re, sqlite3
DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
def num(v):
    if v is None or v == "": return None
    s = str(v).strip().replace(",", "").upper()
    m = re.match(r"^(-?\d+(\.\d+)?)\s*([KMB])?%?$", s)
    if not m: return float(s)
    x = float(m.group(1)); return x * {"K":1e3,"M":1e6,"B":1e9,None:1}[m.group(3)]
def write(con, r, today, now):
    if re.search(r"@\w+", r.get("note") or ""): raise SystemExit("note contains a handle; remove it")
    con.execute("""insert into buzz_reads(read_date,platform,term,metric,value,window_days,region,method,source_url,retrieved_at,note)
        values(?,?,?,?,?,?,?,?,?,?,?) on conflict(read_date,platform,term,metric,window_days,region)
        do update set value=excluded.value, note=excluded.note, retrieved_at=excluded.retrieved_at, source_url=excluded.source_url""",
        (today, r["platform"], r["term"].strip().lstrip("#").lower(), r["metric"], num(r.get("value")),
         int(r["window_days"]) if r.get("window_days") not in (None, "") else None, r.get("region") or "US",
         r.get("method") or "chrome-human", r["source_url"], now, r.get("note")))
ap = argparse.ArgumentParser()
ap.add_argument("--platform"); ap.add_argument("--term"); ap.add_argument("--metric"); ap.add_argument("--value")
ap.add_argument("--window", dest="window_days"); ap.add_argument("--region", default="US"); ap.add_argument("--method", default="chrome-human")
ap.add_argument("--url", dest="source_url"); ap.add_argument("--note"); ap.add_argument("--csv"); ap.add_argument("--date")
ap.add_argument("--event", action="store_true"); ap.add_argument("--house"); ap.add_argument("--family"); ap.add_argument("--type"); ap.add_argument("--reach")
a = ap.parse_args()
today = a.date or dt.date.today().isoformat(); now = dt.datetime.now().isoformat(timespec="seconds")
con = sqlite3.connect(DB)
if a.event:
    if re.search(r"@\w+", a.note or ""): raise SystemExit("note contains a handle; remove it")
    con.execute("insert into buzz_events(event_date,house,family,event_type,derived_note,reach_band,source_url,retrieved_at) values(?,?,?,?,?,?,?,?)",
                (today, a.house, a.family, a.type, a.note, a.reach, a.source_url, now)); n = 1
elif a.csv:
    rows = list(csv.DictReader(open(a.csv))); [write(con, r, today, now) for r in rows]; n = len(rows)
else:
    write(con, vars(a), today, now); n = 1
con.commit(); print(f"wrote {n} row(s) for {today}")
