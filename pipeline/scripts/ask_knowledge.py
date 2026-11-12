"""Search db/knowledge.db (ARCHITECTURE.md, Storage & knowledge). Words with their source, date and status; never a price.
Run: python3 -I scripts/ask_knowledge.py "balenciaga designer" [--public] [--house Chanel] [-k 8]
--public returns only chunks a customer page may cite.
"""
import argparse, re, sqlite3

OUT = "/Users/katiegraves/Desktop/Fashion Data Lab/db/knowledge.db"

ap = argparse.ArgumentParser()
ap.add_argument("query"); ap.add_argument("--public", action="store_true"); ap.add_argument("--house"); ap.add_argument("-k", type=int, default=8)
a = ap.parse_args()

# plain words only, each quoted, so punctuation in a question never breaks the search; any word may match, best first
words = [w for w in re.findall(r"[\w'-]+", a.query.lower()) if len(w) > 1]
match = " OR ".join(f'"{w}"' for w in words)
sql = """select c.kind, c.title, c.doc_date, c.status, c.visibility, coalesce(nullif(c.source_url,''), c.source_path), snippet(chunks_fts, 1, '[', ']', ' … ', 24)
         from chunks_fts join chunks c on c.id = chunks_fts.rowid where chunks_fts match ?"""
args = [match]
if a.public: sql += " and c.visibility = 'public'"
if a.house: sql += " and c.house like ?"; args.append(f"%{a.house}%")
sql += " order by bm25(chunks_fts, 2.0, 1.0, 1.0) limit ?"; args.append(a.k)
for kind, title, d, st, vis, src, snip in sqlite3.connect(f"file:{OUT}?mode=ro", uri=True).execute(sql, args):
    print(f"· {d or 'undated'} · {kind} · {vis}{' · ' + st if st else ''}\n  {title}\n  {snip}\n  {src}\n")
