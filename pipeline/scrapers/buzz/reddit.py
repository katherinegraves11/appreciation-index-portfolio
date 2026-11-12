#!/usr/bin/env python3
"""Reddit official Data API (OAuth, free for non-commercial research; 100 requests/min) → buzz_reads.
Reddit's robots.txt disallows unauthenticated crawling and the public .json endpoints return 403, so this
runs ONLY with app credentials Katie creates herself at reddit.com/prefs/apps (type: script) and exports as
REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET / REDDIT_USERNAME / REDDIT_PASSWORD. Stores counts only (mentions_7d,
upvotes_7d, comments_7d) — never post text, titles or usernames."""
import base64, datetime as dt, json, os, sqlite3, sys, time, urllib.parse, urllib.request
DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
need = ["REDDIT_CLIENT_ID","REDDIT_CLIENT_SECRET","REDDIT_USERNAME","REDDIT_PASSWORD"]
if any(not os.environ.get(k) for k in need): raise SystemExit("Reddit credentials not set; skipping (see BUZZ_PROTOCOL.md)")
UA = "macos:appreciation-index:0.1 (personal research by u/" + os.environ["REDDIT_USERNAME"] + ")"
def token():
    req = urllib.request.Request("https://www.reddit.com/api/v1/access_token",
        data=urllib.parse.urlencode({"grant_type":"password","username":os.environ["REDDIT_USERNAME"],"password":os.environ["REDDIT_PASSWORD"]}).encode(),
        headers={"User-Agent":UA,"Authorization":"Basic "+base64.b64encode((os.environ["REDDIT_CLIENT_ID"]+":"+os.environ["REDDIT_CLIENT_SECRET"]).encode()).decode()})
    with urllib.request.urlopen(req, timeout=20) as r: return json.load(r)["access_token"]
tok = token(); con = sqlite3.connect(DB)
terms = [r[0] for r in con.execute("select term from buzz_terms where platform='google' and active=1 and priority in (1,2)")]  # reuse search phrases
today = dt.date.today().isoformat(); now = dt.datetime.now().isoformat(timespec="seconds")
SUBS = "handbags+Hermes+chanel+Louisvuitton+Luxury+TheRealReal+FashionReps".replace("+FashionReps","")
for t in terms:
    u = f"https://oauth.reddit.com/r/{SUBS}/search?{urllib.parse.urlencode({'q':t,'restrict_sr':1,'sort':'new','t':'week','limit':100})}"
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent":UA,"Authorization":"bearer "+tok}), timeout=20) as r: d = json.load(r)
        posts = d["data"]["children"]; ups = sum(p["data"].get("ups",0) for p in posts); com = sum(p["data"].get("num_comments",0) for p in posts)
        for m,v in (("mentions_7d",len(posts)),("upvotes_7d",ups),("comments_7d",com)):
            con.execute("""insert into buzz_reads(read_date,platform,term,metric,value,window_days,region,method,source_url,retrieved_at,note) values(?,?,?,?,?,?,?,?,?,?,?)
              on conflict(read_date,platform,term,metric,window_days,region) do update set value=excluded.value, retrieved_at=excluded.retrieved_at""",
              (today,"reddit",t,m,v,7,"ALL","api-official","https://www.reddit.com/r/"+SUBS+"/search?q="+urllib.parse.quote(t),now,"official Data API; counts only"))
        print(t, len(posts), ups, com); time.sleep(1.2)
    except Exception as e: print("fail", t, e)
con.commit()
