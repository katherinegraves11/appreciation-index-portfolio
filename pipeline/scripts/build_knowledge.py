"""Build db/knowledge.db: every written thing the tool knows, chunked, searchable (ARCHITECTURE.md, Storage & knowledge).

Words only, never prices: numbers come from SQL on the tracker. Rebuilt from its sources every run, so it is never the
only copy of anything. Each chunk carries its source, date, status and visibility (public / licensed / private).
Run: python3 -I scripts/build_knowledge.py
"""
import hashlib, os, re, sqlite3, subprocess, sys, datetime

LAB = "/Users/katiegraves/Desktop/Fashion Data Lab"
TRACKER = f"{LAB}/db/luxury_bags.db"
OUT = f"{LAB}/db/knowledge.db"
WGSN_DIRS = [f"/Users/katiegraves/Desktop/WGSN Reports"] + [f"/Users/katiegraves/Desktop/WGSN Reports {n}" for n in range(2, 7)]
MAX = 1200  # characters per chunk

# findings folders and who may see them
FINDINGS = {"news": "public", "moments": "public", "fashion-week": "public", "trends": "public",
            "wgsn-daily": "licensed", "panel": "private", "daily": "private", "experiments": "private",
            "resale": "private", "web-sweep": "private", "ask-trr": "private", "fwrd": "private"}


def status_of(text):
    t = text.upper()
    if "UNCONFIRMED" in t: return "UNCONFIRMED"
    if "SINGLE SOURCE" in t: return "SINGLE SOURCE"
    if "VERIFIED" in t: return "VERIFIED"
    return ""


def chunks(text):
    """Split on blank lines and headings, then pack paragraphs up to MAX characters."""
    paras = [p.strip() for p in re.split(r"\n\s*\n|\n(?=#)|\n(?=- )", text) if p.strip()]
    out, cur = [], ""
    for p in paras:
        while len(p) > MAX:
            out.append(p[:MAX]); p = p[MAX:]
        if cur and len(cur) + len(p) + 1 > MAX:
            out.append(cur); cur = p
        else:
            cur = f"{cur}\n{p}" if cur else p
    if cur: out.append(cur)
    return out


def date_in(s):
    m = re.search(r"20\d\d-\d\d-\d\d", s or "")
    return m.group(0) if m else ""


def main():
    if os.path.exists(OUT + ".new"): os.remove(OUT + ".new")
    k = sqlite3.connect(OUT + ".new")
    k.executescript("""
      create table chunks(id integer primary key, kind text, title text, body text, doc_date text, status text,
                          visibility text, source_path text, source_url text, house text);
      create virtual table chunks_fts using fts5(title, body, house, content='chunks', content_rowid='id',
                                                 tokenize='porter unicode61');
      create table build(built_at text, n_chunks int, by_kind text);""")
    rows, seen = [], set()

    def add(kind, title, body, doc_date, visibility, path="", url="", house="", status=None):
        for c in chunks(body):
            h = hashlib.sha1((kind + c).encode()).hexdigest()
            if h in seen: continue
            seen.add(h)
            # any public chunk that names Katie or her sourcer is private, whatever file it came from
            vis = "private" if visibility == "public" and re.search(os.environ.get("PRIVATE_NAMES", "Katie"), c) else visibility
            rows.append((kind, title, c, doc_date, status if status is not None else status_of(c), vis, path, url, house))

    # 1. findings: our own written reads
    for sub, vis in FINDINGS.items():
        d = f"{LAB}/findings/{sub}"
        if not os.path.isdir(d): continue
        for root, _, files in os.walk(d):
            for f in sorted(files):
                if not f.endswith(".md"): continue
                p = os.path.join(root, f)
                text = open(p, encoding="utf-8", errors="ignore").read()
                title = (text.splitlines() or [f])[0].lstrip("# ").strip()
                add(f"findings/{sub}", title, text, date_in(f) or date_in(title), vis, path=p)

    # 2. tracker tables that hold words with a cited source
    t = sqlite3.connect(f"file:{TRACKER}?mode=ro", uri=True)
    t.row_factory = sqlite3.Row
    def q(sql):
        try: return t.execute(sql).fetchall()
        except sqlite3.Error as e: print("skip:", e, file=sys.stderr); return []
    for r in q("select * from people_moves"):
        add("people_moves", r["headline"], f"{r['headline']}. {r['summary'] or ''} (effective {r['effective'] or 'n/a'}; {r['source']})",
            r["effective"] or r["retrieved_at"][:10], "public", url=r["source_url"] or "")
    for r in q("select * from macro_events"):
        add("macro_events", r["category"], f"{r['description']} Houses: {r['houses_affected'] or 'n/a'}.", r["date"], "public", url=r["source_url"] or "")
    for r in q("select * from pestel_watch where active=1"):
        add("pestel", f"{r['dimension']}: {r['item']}", f"{r['item']} ({r['region']}, {r['status']}). Why it matters: {r['why_it_matters']} Houses: {r['houses']}. Direction: {r['direction']}.",
            (r["updated_at"] or r["added_on"] or "")[:10], "public", url=r["source_url"] or "", house=r["houses"] or "")
    for r in q("select * from supply_chain_facts"):
        # Katie's sourcer, boutique advisors and her own reports stay private (never shown or cited to customers)
        priv = r["source_url"] == "private" or re.search(r"private|sourcer|advisor|Katie", r["source_name"] or "")
        add("supply_chain", f"{r['house']}: {r['category']}", f"{r['description']} For value: {r['implication_for_value'] or ''}",
            r["fact_date"], "private" if priv else "public", url="" if priv else (r["source_url"] or ""), house=r["house"] or "", status=(r["confidence"] or "").upper())
    for r in q("select * from history_events"):
        add("history", f"{r['house']}: {r['category']}", f"{r['description']} Market effect: {r['market_effect_notes'] or ''} Still matters: {r['still_matters'] or ''}",
            r["event_date"], "public", url=r["source_url"] or "", house=r["house"] or "")
    for r in q("select * from show_notes"):
        add("shows", f"{r['house']} {r['season']} ({r['designer']})", f"New bags: {r['new_bag_families']}. Returning: {r['returning_icons']}. Press: {r['press_read']}. In store: {r['in_store_window']}.",
            r["show_date"], "public", url=r["source_urls"] or "", house=r["house"] or "")
    for r in q("select * from stakeholder_decisions"):
        add("stakeholder", f"{r['house']}: {r['actor']}", f"{r['decision']} For bags: {r['implication_for_bags'] or ''}",
            r["decision_date"], "public", url=r["source_url"] or "", house=r["house"] or "")
    for r in q("select * from buzz_events where public_line is not null and public_line<>''"):
        add("moments", f"{r['house']} {r['family']} {r['event_type']}", r["public_line"], r["event_date"], "public", url=r["source_url"] or "", house=r["house"] or "")
    for r in q("select * from web_findings"):
        add("web_findings", f"{r['house']} {r['bag']} {r['finish'] or ''}".strip(), r["text"] or "", (r["found_at"] or "")[:10], "public", url=r["sources"] or "", house=r["house"] or "")
    for r in q("select * from wgsn_signals"):
        add("wgsn_signals", r["report_title"], f"{r['signal']} {r['derived_note'] or ''}", r["published"] or (r["retrieved_at"] or "")[:10], "licensed", url=r["wgsn_url"] or "")
    # Katie's sourcer offers, quotes and buys: words only (prices stay in SQL, so dollar amounts are stripped), private
    for r in q("select * from resale_listings where source='private-sourcer-offer'"):
        add("sourcer_offers", f"{r['brand']} {r['model_guess'] or ''}".strip(), re.sub(r"\$\s?[\d,.]+(\s?(k|K|thousand))?", "[price in tracker]", r["title"] or ""),
            r["first_seen"], "private", house=r["brand"] or "")
    # private collection boards and decks (Katie's reference only)
    for r in q("select * from preview_items"):
        add("preview_items", f"{r['house']} {r['season']} {r['model_guess'] or ''}".strip(),
            f"{r['description'] or ''} Colours: {r['colours'] or ''}. Materials: {r['materials'] or ''}. Hardware: {r['hardware'] or ''}. Expected in store: {r['expected_in_store'] or ''}. ({r['deck'] or r['source'] or ''})",
            "", "private", house=r["house"] or "")
    # Muse daily social listening (Meta's Muse, Katie's Drive): what people posted, as Muse summarised it; unverified rows say so
    for r in q("select * from muse_mentions"):
        add("muse", f"{r['house'] or ''} {r['bag'] or ''} on {r['platform'] or ''}".strip(), re.sub(r"\$\s?[\d,.]+", "[price]", r["summary"] or ""),
            r["post_date"] or r["brief_date"], "private", url=r["url"] or "", house=r["house"] or "", status=None if r["verified"] else "UNVERIFIED")
    for r in q("select * from muse_sentiment"):
        add("muse", f"{r['house'] or ''} {r['bag'] or ''} sentiment", f"Muse brief {r['brief_date']}: {r['house']} {r['bag']} sentiment themes: {r['themes_json'] or ''}",
            r["brief_date"], "private", house=r["house"] or "")
    for r in q("select * from muse_needs_response"):
        add("muse", "needs a response", f"{r['what']}. Why: {r['why'] or ''}", r["brief_date"], "private", url=r["url"] or "", status=None if r["verified"] else "UNVERIFIED")
    for r in q("select * from sourcer_judgments"):
        add("sourcer_judgments", f"{r['house']} {r['model']}", f"{r['spec']}: {r['decision']}. {r['reason']} Instead: {r['instead'] or ''}",
            r["judged_on"], "private", house=r["house"] or "")

    # 3. WGSN reports on the Desktop (licensed: inform the read, never quoted or named to customers)
    for d in WGSN_DIRS:
        if not os.path.isdir(d): continue
        for f in sorted(os.listdir(d)):
            if not f.endswith(".docx") or f.startswith("~$"): continue
            p = os.path.join(d, f)
            try:
                text = subprocess.run(["/usr/bin/textutil", "-convert", "txt", "-stdout", p], capture_output=True, text=True, timeout=60).stdout
            except Exception as e:
                print("skip:", f, e, file=sys.stderr); continue
            add("wgsn_report", f[:-5], text, date_in(text[:400]), "licensed", path=p)

    k.executemany("insert into chunks(kind,title,body,doc_date,status,visibility,source_path,source_url,house) values (?,?,?,?,?,?,?,?,?)", rows)
    k.execute("insert into chunks_fts(chunks_fts) values('rebuild')")
    by = k.execute("select group_concat(kind||'='||n, ', ') from (select kind, count(*) n from chunks group by kind order by n desc)").fetchone()[0]
    k.execute("insert into build values (?,?,?)", (datetime.datetime.now().isoformat(timespec="seconds"), len(rows), by))
    k.commit(); k.close()
    os.replace(OUT + ".new", OUT)
    print(f"knowledge.db: {len(rows)} chunks · {by}")


if __name__ == "__main__":
    main()
