#!/usr/bin/env python3
"""Appreciation Index ledger v1: one row per house×model with retail (then/now), resale asks by source, retention, 26-day
disappearance (complete collections only), RealReal sold reads, auction medians. Derived data only; every retail
number traces to retail_reference.source_url (see exports/retail_reference_sources.csv)."""
import csv, sqlite3, datetime as dt
DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
OUT = "/Users/katiegraves/Desktop/Fashion Data Lab/exports/bag_ledger_v1.csv"
SRC = "/Users/katiegraves/Desktop/Fashion Data Lab/exports/retail_reference_sources.csv"
con = sqlite3.connect(DB); con.row_factory = sqlite3.Row
latest = con.execute("select max(snapshot_date) from resale_snapshots").fetchone()[0]
models = [dict(r) for r in con.execute("""
  select brand as house, model_guess as model from resale_listings
  where model_guess<>'' group by 1,2 having count(*)>=20
  union select house, model from retail_reference
  order by 1,2""")]
def one(sql, *p):
    r = con.execute(sql, p).fetchone(); return dict(r) if r else {}
rows = []
for m in models:
    h, mo = m["house"], m["model"]
    cur = one("select retail_now, size_or_spec, effective_date from v_retail_current where house=? and model=?", h, mo)
    hist = {r["year"]: r["retail_that_year"] for r in con.execute(
        "select year, retail_that_year from v_retail_history where house=? and model=?", (h, mo))}
    launch = one("select price, effective_date from retail_reference where house=? and model=? and price_type='launch' and is_reference_size=1 order by effective_date limit 1", h, mo)
    row = {"house": h, "model": mo, "reference_size": cur.get("size_or_spec"),
           "retail_now_usd": cur.get("retail_now"), "retail_now_as_of": cur.get("effective_date"),
           "retail_launch_usd": launch.get("price"), "retail_launch_date": launch.get("effective_date")}
    for y in range(2021, 2027):
        row[f"retail_{y}_usd"] = hist.get(str(y))
    for src in ("fashionphile", "rebag", "madisonavenuecouture", "priveporter", "tabvintage"):
        a = one("select n_listings, median_ask, retention_vs_current_retail_pct from v_retail_vs_resale_asks where house=? and model=? and source=? order by snapshot_date desc limit 1", h, mo, src)
        row[f"ask_n_{src}"] = a.get("n_listings"); row[f"ask_median_{src}"] = a.get("median_ask")
        row[f"retention_vs_retail_now_{src}_pct"] = a.get("retention_vs_current_retail_pct")
    sb = one("select wtd_median_ask, retention_pct from v_retention_scoreboard where house=? and model=?", h, mo)
    row["pooled_median_ask_usd"] = sb.get("wtd_median_ask"); row["pooled_retention_vs_retail_now_pct"] = sb.get("retention_pct")
    r21 = hist.get("2021") or launch.get("price")
    row["pooled_retention_vs_retail_2021_or_launch_pct"] = round(100*sb["wtd_median_ask"]/r21, 1) if sb.get("wtd_median_ask") and r21 else None
    sz = one("select matched_size, n_listings_same_size, median_ask_same_size, retention_pct_same_size from v_retention_scoreboard_sized where house=? and model=?", h, mo)
    row["same_size_matched"] = sz.get("matched_size"); row["same_size_n"] = sz.get("n_listings_same_size")
    row["same_size_median_ask_usd"] = sz.get("median_ask_same_size"); row["same_size_retention_vs_retail_now_pct"] = sz.get("retention_pct_same_size")
    row["same_size_retention_vs_retail_2021_or_launch_pct"] = round(100*sz["median_ask_same_size"]/r21, 1) if sz.get("median_ask_same_size") and r21 else None
    d = one("select sum(listed_before) lb, sum(gone) g from v_disappearance where brand=? and model=? and to_date=?", h, mo, latest)
    row["listed_prev_snapshot_complete_collections"] = d.get("lb")
    row["pct_delisted_between_snapshots"] = round(100*d["g"]/d["lb"], 1) if d.get("lb") else None
    t = one("select count(*) n, sum(sold) sold, round(avg(pct_of_retail),1) pct, round(avg(price)) avg_price from trr_item_reads where house=? and model_guess=?", h, mo)
    row["trr_tiles_read"] = t.get("n"); row["trr_sold_seen"] = t.get("sold"); row["trr_avg_pct_of_est_retail"] = t.get("pct"); row["trr_avg_price_usd"] = t.get("avg_price")
    au = one("select count(*) n, round(avg(hammer_price)) med, max(currency) cur from auction_results where sold=1 and lower(house) like ? and lower(model_guess) like ?", f"%{h.lower()}%", f"%{mo.lower()}%")
    row["auction_lots"] = au.get("n"); row["auction_avg_hammer"] = au.get("med"); row["auction_currency"] = au.get("cur")
    rows.append(row)
cols = list(rows[0].keys())
with open(OUT, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(rows)
with open(SRC, "w", newline="") as f:
    w = csv.writer(f); w.writerow(["house","model","size_or_spec","price_type","effective_date","price_usd","confidence","source_name","source_url","retrieved_at"])
    for r in con.execute("select house, model, size_or_spec, price_type, effective_date, price, confidence, source_name, source_url, retrieved_at from retail_reference order by 1,2,5"):
        w.writerow(list(r))
filled = sum(1 for r in rows if r["retail_now_usd"])
print(f"{OUT}: {len(rows)} models, {filled} with current retail, snapshot {latest}, generated {dt.datetime.now().isoformat(timespec='minutes')}")

# keep the launchd health-check copy fresh whenever the ledger is rebuilt
try:
    import shutil; shutil.copy(DB, "/Users/katiegraves/.local/appreciation-index/luxury_bags.db")
except Exception as _e:
    print("heartbeat copy skipped:", _e)
