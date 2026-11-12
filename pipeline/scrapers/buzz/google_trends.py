#!/usr/bin/env python3
"""Google Trends → buzz_reads (pytrends; sanctioned earlier for trends.db).
Interest is relative WITHIN a 5-term batch, so we never compare levels across batches. What we store per term:
  interest_0_100  = last full week's value inside its batch (batches are stable: same priority tier, same order)
  growth_pct_7d   = last week vs the mean of the prior four weeks, from the same series (comparable across all terms)
Niche bag terms often read 0 in Google; that is a finding (no search demand yet), not an error."""
import datetime as dt, sqlite3, sys, time
from pytrends.request import TrendReq
DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
SRC = "https://trends.google.com/trends/explore"
con = sqlite3.connect(DB)
pri = sys.argv[1] if len(sys.argv) > 1 else "1,2"
terms = [r[0] for r in con.execute(f"select term from buzz_terms where platform='google' and active=1 and priority in ({pri}) order by priority, id")]
terms = list(dict.fromkeys(terms))
today = dt.date.today().isoformat(); now = dt.datetime.now().isoformat(timespec="seconds")
pt = TrendReq(hl="en-US", tz=300)
written = 0
for i in range(0, len(terms), 5):
    batch = terms[i:i+5]
    try:
        pt.build_payload(batch, timeframe="today 3-m", geo="US"); df = pt.interest_over_time()
    except Exception as e:
        print("batch failed:", batch, e); time.sleep(20); continue
    if df.empty: continue
    df = df.drop(columns=[c for c in df.columns if c == "isPartial"])
    last = df.iloc[-1]; base = df.iloc[-5:-1].mean() if len(df) >= 5 else df.iloc[:-1].mean()
    wk = df.index[-1].date()
    for t in batch:
        lv = float(last[t]); bv = float(base[t]) if base[t] == base[t] else 0.0
        g = None if bv == 0 and lv == 0 else (100.0 if bv == 0 else round(100.0*(lv-bv)/bv, 1))
        for metric, val, note in (("interest_0_100", lv, f"within batch {i//5+1}; week of {wk}"),
                                  ("growth_pct_7d", g, f"last week {lv:.0f} vs prior-4-week mean {bv:.1f}")):
            if val is None: continue
            con.execute("""insert into buzz_reads(read_date,platform,term,metric,value,window_days,region,method,source_url,retrieved_at,note)
              values(?,?,?,?,?,?,?,?,?,?,?) on conflict(read_date,platform,term,metric,window_days,region) do update set value=excluded.value, retrieved_at=excluded.retrieved_at, note=excluded.note""",
              (today, "google", t, metric, val, 7, "US", "pytrends", SRC, now, note))
            written += 1
    con.commit(); print("ok", batch); time.sleep(12)
print("wrote", written)
