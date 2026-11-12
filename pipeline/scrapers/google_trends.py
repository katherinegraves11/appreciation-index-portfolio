#!/usr/bin/env python3
"""Google Trends collector (SANCTIONED via pytrends).
Pulls weekly interest-over-time for a term list and upserts into trends.db.
Cross-term values are comparable only WITHIN a batch of <=5 (Google normalizes
per request), so we tag each row with its batch. Idempotent on (term, week)."""
import sys, time, sqlite3, datetime
from pytrends.request import TrendReq

DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/trends.db"
SRC = "https://trends.google.com/trends (pytrends)"
TODAY = datetime.date.today().isoformat()

# starter fashion term list (edit freely); Google caps a batch at 5 terms
TERMS = sys.argv[1:] or [
    "quiet luxury", "mob wife aesthetic", "ballet flats", "leopard print", "cargo pants",
    "burgundy", "boho", "suede jacket", "kitten heels", "the row",
]
TIMEFRAME = "today 5-y"

con = sqlite3.connect(DB)
con.execute("""CREATE TABLE IF NOT EXISTS search_interest(
    term TEXT, week TEXT, interest INTEGER, batch INTEGER,
    source_url TEXT, collected_date TEXT,
    UNIQUE(term, week))""")

pytrends = TrendReq(hl="en-US", tz=300)
batches = [TERMS[i:i+5] for i in range(0, len(TERMS), 5)]
rows = 0
for b, batch in enumerate(batches):
    try:
        pytrends.build_payload(batch, timeframe=TIMEFRAME, geo="US")
        df = pytrends.interest_over_time()
        if df.empty:
            print(f"batch {b}: empty"); continue
        for date, r in df.iterrows():
            for term in batch:
                con.execute(
                    "INSERT OR REPLACE INTO search_interest VALUES (?,?,?,?,?,?)",
                    (term, date.date().isoformat(), int(r[term]), b, SRC, TODAY))
                rows += 1
        con.commit()
        print(f"batch {b} ({', '.join(batch)}): {len(df)} weeks stored")
        time.sleep(5)  # polite rate-limit between requests
    except Exception as e:
        print(f"batch {b} FAILED: {type(e).__name__}: {str(e)[:120]}")
        time.sleep(10)

print(f"TOTAL rows upserted: {rows}")
con.close()
