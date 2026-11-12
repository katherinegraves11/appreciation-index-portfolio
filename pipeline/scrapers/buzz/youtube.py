#!/usr/bin/env python3
"""YouTube Data API v3 (official, free quota) → buzz_reads. Needs YOUTUBE_API_KEY in the environment
(Katie creates it at console.cloud.google.com → APIs & Services → Credentials; restrict to YouTube Data API).
Per search term: videos published in the last 7 days (videos_7d) and summed views of the top 10 by relevance (views_top10).
Stores counts only. ~3 quota units per term per day; 100 terms = 300 of the 10,000 daily units."""
import datetime as dt, json, os, sqlite3, sys, time, urllib.parse, urllib.request
DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
KEY = os.environ.get("YOUTUBE_API_KEY")
if not KEY: raise SystemExit("YOUTUBE_API_KEY not set; skipping (see BUZZ_PROTOCOL.md)")
con = sqlite3.connect(DB)
pri = sys.argv[1] if len(sys.argv) > 1 else "1,2"
terms = [r[0] for r in con.execute(f"select term from buzz_terms where platform='youtube' and active=1 and priority in ({pri})")]
today = dt.date.today().isoformat(); now = dt.datetime.now().isoformat(timespec="seconds")
since = (dt.datetime.utcnow() - dt.timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
def get(path, **q):
    q["key"] = KEY; u = f"https://www.googleapis.com/youtube/v3/{path}?{urllib.parse.urlencode(q)}"
    with urllib.request.urlopen(u, timeout=20) as r: return json.load(r)
def put(term, metric, value, note):
    con.execute("""insert into buzz_reads(read_date,platform,term,metric,value,window_days,region,method,source_url,retrieved_at,note)
      values(?,?,?,?,?,?,?,?,?,?,?) on conflict(read_date,platform,term,metric,window_days,region) do update set value=excluded.value, retrieved_at=excluded.retrieved_at, note=excluded.note""",
      (today, "youtube", term, metric, value, 7, "US", "api-official", "https://www.googleapis.com/youtube/v3/search?q=" + urllib.parse.quote(term), now, note))
for t in terms:
    try:
        s = get("search", part="id", q=t, type="video", publishedAfter=since, maxResults=50, regionCode="US")
        n7 = s.get("pageInfo", {}).get("totalResults", len(s.get("items", [])))
        ids = ",".join(i["id"]["videoId"] for i in s.get("items", [])[:10])
        views = 0
        if ids:
            v = get("videos", part="statistics", id=ids)
            views = sum(int(x["statistics"].get("viewCount", 0)) for x in v.get("items", []))
        put(t, "videos_7d", n7, "videos published in the last 7 days matching the term"); put(t, "views_top10", views, "summed views of the 10 most relevant videos from the last 7 days")
        print(t, n7, views); time.sleep(1)
    except Exception as e:
        print("fail", t, e)
con.commit()
