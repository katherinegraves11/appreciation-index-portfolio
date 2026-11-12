#!/usr/bin/env python3
"""Read new texts from Katie's luxury sourcer (Messages; her number is set in SOURCER_HANDLE) since the last run, for the Appreciation Index.
Katie, 2026-10-24: "have an agent always tapped into my text messages with [my sourcer]... she'll send me bags and their prices...
everything she's sending me is pristine... that's a really good source for us to be using."
Prints each message (date, who, text) with the paths of any image attachments, so the reader can look at each image once to name
the bag. Read-only on Messages. Keeps its place in ~/.local/appreciation-index/sourcer_texts_last_rowid. Pass --since-days N to
re-read a window instead (the first run backfills 400 days). Never writes message text anywhere; the caller stores derived data only.
"""
import sqlite3, datetime, os, sys, argparse
HANDLE = os.environ.get("SOURCER_HANDLE", "")  # digits only; set privately
STATE = os.path.expanduser("~/.local/appreciation-index/sourcer_texts_last_rowid")
ap = argparse.ArgumentParser(); ap.add_argument("--since-days", type=int); ap.add_argument("--no-advance", action="store_true"); a = ap.parse_args()
db = sqlite3.connect("file:" + os.path.expanduser("~/Library/Messages/chat.db") + "?mode=ro", uri=True)

def body(text, ab):
    if text: return text
    if not ab: return ""
    b = bytes(ab); i = b.find(b"NSString")
    if i < 0: return ""
    seg = b[i + 8:i + 8 + 4000]; j = seg.find(b"+")
    if j < 0: return ""
    n = seg[j + 1]; start = j + 2
    if n == 0x81: n = int.from_bytes(seg[j + 2:j + 4], "little"); start = j + 4
    return seg[start:start + n].decode("utf-8", "ignore")

last = 0
if a.since_days is None and os.path.exists(STATE):
    last = int(open(STATE).read().strip() or 0)
days = a.since_days if a.since_days is not None else (400 if last == 0 else 3650)
epoch = datetime.datetime(2001, 1, 1)
rows = db.execute("""select m.rowid, m.date, m.is_from_me, m.text, m.attributedBody from message m join handle h on h.rowid = m.handle_id
                     where h.id like ? and m.rowid > ? order by m.rowid""", (f"%{HANDLE}%", last)).fetchall()
maxid = last
for rid, d, me, t, ab in rows:
    when = epoch + datetime.timedelta(seconds=d / 1e9 if d > 1e12 else d)
    maxid = max(maxid, rid)
    if (datetime.datetime.now() - when).days > days: continue
    atts = [os.path.expanduser(p) for (p,) in db.execute("""select a.filename from attachment a join message_attachment_join j on j.attachment_id = a.rowid
                                                            where j.message_id = ? and a.mime_type like 'image/%'""", (rid,)) if p]
    s = body(t, ab).replace("￼", "").strip().replace("\n", " / ")
    print(f"{rid}\t{when:%Y-%m-%d %H:%M}\t{'KATIE' if me else 'SOURCER'}\t{s[:400]}" + (f"\tIMAGES: {' | '.join(atts)}" if atts else ""))
if not a.no_advance and maxid > last:
    os.makedirs(os.path.dirname(STATE), exist_ok=True); open(STATE, "w").write(str(maxid))
print(f"# {len(rows)} new messages since rowid {last}; now at {maxid}", file=sys.stderr)
