#!/usr/bin/env python3
"""Vogue collector via SANCTIONED RSS feed (intended for consumption; not
scraping paywalled pages). Stores DERIVED metadata only — never downloads the
images, just keeps the thumbnail URL for provenance. Idempotent on guid.
Runway items (/fashion-shows/<season>/<designer>) are parsed into season +
designer so runway coverage becomes a time-series."""
import sqlite3, datetime, urllib.request
import xml.etree.ElementTree as ET

DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/trends.db"
FEED = "https://www.vogue.com/feed/rss"
TODAY = datetime.date.today().isoformat()
NS = {"media": "http://search.yahoo.com/mrss/", "dc": "http://purl.org/dc/elements/1.1/"}

req = urllib.request.Request(FEED, headers={"User-Agent": "FashionDataLab/1.0 (personal research)"})
xml = urllib.request.urlopen(req, timeout=30).read()
root = ET.fromstring(xml)

con = sqlite3.connect(DB)
con.execute("""CREATE TABLE IF NOT EXISTS vogue_feed(
    guid TEXT PRIMARY KEY, title TEXT, link TEXT, pubdate TEXT,
    category TEXT, is_runway INTEGER, season TEXT, designer TEXT,
    creator TEXT, keywords TEXT, thumbnail_url TEXT, collected_date TEXT)""")

def txt(el, tag, ns=None):
    e = el.find(tag, ns) if ns else el.find(tag)
    return e.text if e is not None and e.text else None

n = 0
for item in root.iter("item"):
    guid = txt(item, "guid")
    link = txt(item, "link") or ""
    season = designer = None
    is_runway = int("/fashion-shows/" in link)
    if is_runway:
        parts = link.rstrip("/").split("/fashion-shows/")[-1].split("/")
        if len(parts) >= 2:
            season, designer = parts[0], parts[1]
    cats = [c.text for c in item.findall("category") if c.text]
    thumb = item.find("media:thumbnail", NS)
    con.execute("INSERT OR IGNORE INTO vogue_feed VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (
        guid, txt(item, "title"), link, txt(item, "pubDate"),
        cats[0] if cats else None, is_runway, season, designer,
        txt(item, "dc:creator", NS), txt(item, "media:keywords", NS),
        thumb.get("url") if thumb is not None else None, TODAY))
    n += 1
con.commit()
print(f"items seen this fetch: {n}")
print("runway items this fetch:", con.execute(
    "SELECT COUNT(*) FROM vogue_feed WHERE is_runway=1 AND collected_date=?", (TODAY,)).fetchone()[0])
con.close()
