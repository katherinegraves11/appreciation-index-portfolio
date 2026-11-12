"""Ingest one Muse daily social-listening brief (Katie, 2026-10-25) into the tracker.

Usage: python3 -I ingest_muse.py <brief.json or brief.md> <drive_file_id> <file_name>
The JSON is the source of truth; a .md is read only for its closing ```json block.
Rules: never invent a number; 0 likes/comments/views means "not returned" and is stored as NULL;
anything the brief marks unverified or snippet-only is stored with verified=0; creator handles are
never stored (derived data only); each brief date is ingested once (muse_briefs).
Prices are tied afterwards by bag-index/scripts/muse-prices.mts, which uses the app's version-safe matcher."""
import json, re, sqlite3, sys, datetime

DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
path, file_id, file_name = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, encoding="utf-8").read()
if path.endswith(".md"):
    m = re.search(r"```json\s*(\{.*?\})\s*```", text, re.S)
    if not m: sys.exit(f"MISSING: no JSON block in {file_name}")
    text = m.group(1)
d = json.loads(text)
day = d["date"]
src = f"https://drive.google.com/file/d/{file_id}/view"
now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
UNVER = re.compile(r"unverified|snippet-only|not independently verified|could not be (located|confirmed)", re.I)
nz = lambda v: v if isinstance(v, (int, float)) and v > 0 else None

db = sqlite3.connect(DB)
db.executescript("""
create table if not exists muse_briefs(brief_date text primary key, file_name text, drive_url text, ingested_at text, n_mentions int, n_needs int);
create table if not exists muse_mentions(id integer primary key, brief_date text, platform text, post_date text, house text, bag text, summary text, likes int, comments int, views int, url text, verified int, source text, unique(brief_date, url, bag));
create table if not exists muse_sentiment(id integer primary key, brief_date text, house text, bag text, positive_pct real, neutral_pct real, negative_pct real, themes_json text, source text, unique(brief_date, house, bag));
create table if not exists muse_trends(id integer primary key, brief_date text, term text, platform text, count_today int, count_7d_brief int, prev_brief_date text, prev_count int, source text, unique(brief_date, term, platform));
create table if not exists muse_creators(id integer primary key, brief_date text, followers_band text, about text, source text);
create table if not exists muse_needs_response(id integer primary key, brief_date text, what text, why text, url text, verified int, flagged_at text, source text, unique(brief_date, what));
""")
if db.execute("select 1 from muse_briefs where brief_date=?", (day,)).fetchone():
    print(f"SKIP: {day} already ingested"); sys.exit(0)

for x in d.get("mentions", []):
    db.execute("insert or ignore into muse_mentions(brief_date,platform,post_date,house,bag,summary,likes,comments,views,url,verified,source) values(?,?,?,?,?,?,?,?,?,?,?,?)",
               (day, x.get("platform"), x.get("date"), x.get("house"), x.get("bag"), x.get("summary"), nz(x.get("likes")), nz(x.get("comments")), nz(x.get("views")), x.get("url"), 0 if UNVER.search(x.get("summary", "")) else 1, src))
for x in d.get("sentiment", []):
    db.execute("insert or ignore into muse_sentiment(brief_date,house,bag,positive_pct,neutral_pct,negative_pct,themes_json,source) values(?,?,?,?,?,?,?,?)",
               (day, x.get("house"), x.get("bag"), x.get("positive_pct"), x.get("neutral_pct"), x.get("negative_pct"), json.dumps(x.get("themes", [])), src))
for x in d.get("trends", []):
    # compare only against a brief we actually hold; no baseline means NULL, never a made-up delta
    prev = db.execute("select brief_date, count_today from muse_trends where term=? and platform=? and brief_date<? order by brief_date desc limit 1", (x.get("term"), x.get("platform"), day)).fetchone()
    db.execute("insert or ignore into muse_trends(brief_date,term,platform,count_today,count_7d_brief,prev_brief_date,prev_count,source) values(?,?,?,?,?,?,?,?)",
               (day, x.get("term"), x.get("platform"), x.get("count_today"), nz(x.get("count_7d")), prev[0] if prev else None, prev[1] if prev else None, src))
for x in d.get("creators", []):  # handles and urls are not stored
    db.execute("insert into muse_creators(brief_date,followers_band,about,source) values(?,?,?,?)", (day, x.get("followers_band"), x.get("about"), src))
for x in d.get("needs_response", []):
    db.execute("insert or ignore into muse_needs_response(brief_date,what,why,url,verified,source) values(?,?,?,?,?,?)",
               (day, x.get("what"), x.get("why"), x.get("url"), 0 if UNVER.search(f"{x.get('what','')} {x.get('why','')}") else 1, src))
db.execute("insert into muse_briefs values(?,?,?,?,?,?)", (day, file_name, src, now, len(d.get("mentions", [])), len(d.get("needs_response", []))))
db.commit()
print(f"OK {day}: {len(d.get('mentions', []))} mentions, {len(d.get('sentiment', []))} sentiment, {len(d.get('trends', []))} trends, {len(d.get('needs_response', []))} needs-response")
for x in d.get("needs_response", []):
    print("NEEDS RESPONSE:", x.get("what"))
