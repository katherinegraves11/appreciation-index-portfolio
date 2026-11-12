#!/usr/bin/env python3
"""FWRD Renew (fwrd.com pre-owned) → luxury_bags.db.

Katie trusts FWRD Renew's pricing for high-quality second hand (2026-10-22), so its asks sit beside
The RealReal's in the tool. FWRD serves pages to browsers only (curl gets nothing), so the read is a
human-pace page read in Katie's own Chrome, pasted or saved as text, and this script turns it into rows.

Input: a text file holding either
  * the raw page text of https://www.fwrd.com/brand-fwrd-renew/e90c01/?sr=true
    (blocks of: "favorite <Title>", "FWRD RENEW", "<Title>", "$<price>", "PRE-OWNED"), or
  * tab-separated lines "<Title>\t<price>" (lines starting with # are ignored).
Output: rows in fwrd_renew_reads (title + price + read_date + source_url + retrieved_at; derived data only,
no images, no product ids, no seller details) and the view v_fwrd_latest.

Usage: python3 scrapers/fwrd/ingest.py findings/fwrd/2026-10-22.txt [--date 2026-10-22] [--url <page url>]
"""
import argparse, re, sqlite3, sys, datetime, pathlib

DB = pathlib.Path(__file__).resolve().parents[2] / "db" / "luxury_bags.db"
URL = "https://www.fwrd.com/brand-fwrd-renew/e90c01/?sr=true"

HOUSES = [("louis vuitton", "Louis Vuitton"), ("saint laurent", "Saint Laurent"), ("bottega veneta", "Bottega Veneta"),
          ("the row", "The Row"), ("miu miu", "Miu Miu"), ("hermes", "Hermès"), ("hermès", "Hermès"), ("chanel", "Chanel"),
          ("dior", "Dior"), ("gucci", "Gucci"), ("prada", "Prada"), ("fendi", "Fendi"), ("fendu", "Fendi"), ("celine", "Celine"),
          ("céline", "Celine"), ("loewe", "Loewe"), ("balenciaga", "Balenciaga"), ("goyard", "Goyard"), ("alaia", "Alaïa"),
          ("alaïa", "Alaïa"), ("ferragamo", "Ferragamo"), ("valentino", "Valentino"), ("givenchy", "Givenchy")]
FINISH = set("""togo epsom swift clemence taurillon box chevre mysore evergrain fjord courchevel ardennes veau caviar lambskin
calfskin tweed denim patent raffia nylon tessuto saffiano re-nylon canapa monogram vernis epi zucca zucchino wicker vintage
retourne sellier verso toile leather nappa satin fur wool knit python lizard ostrich neoprene iridescent sequin paillettes
embossed embroidered perforated studded braided crochet crocheted pony hair rabbit mink shearling reverse giant graffiti
miroir cerises dots infinity floral flower applique crystal spalmati microguccissima eco lapin faux two tone elan foile
& x in brown blue black""".split())
SIZES = {"micro", "mini", "small", "medium", "large", "maxi", "jumbo", "teen", "pm", "mm", "gm", "nano"}
TYPE_TAIL = set("handbag bag bags shoulder tote crossbody messenger belt waist clutch pouch backpack case holder".split())


def house_of(title: str):
    t = title.lower()
    for key, name in HOUSES:
        if t.startswith(key):
            return name, title[len(key):].strip()
    return None, title


def guess(title: str):
    house, rest = house_of(title)
    words = [w for w in re.split(r"\s+", rest) if w]
    # a two-digit number is a size ("Birkin 30", "Speedy 30") except at Chanel, where 19 / 22 / 25 are model names
    num_is_size = house != "Chanel"
    size = [w for w in words if w.lower() in SIZES or (num_is_size and re.fullmatch(r"\d{2}", w))]
    keep = []
    for w in words:
        lw = w.lower().strip("'")
        if lw in FINISH or lw in SIZES or re.fullmatch(r"(19|20)\d{2}", lw):
            continue
        keep.append(w)
    while keep and keep[-1].lower() in TYPE_TAIL:
        keep.pop()
    model = " ".join(w for w in keep if not (num_is_size and re.fullmatch(r"\d{2}", w))).strip() or rest
    return house, model, " ".join(size) if size else None


def parse(text: str):
    rows = []
    lines = [l.rstrip("\n") for l in text.splitlines()]
    if any("\t" in l and not l.startswith("#") for l in lines):
        for l in lines:
            if not l or l.startswith("#") or "\t" not in l:
                continue
            title, price = l.split("\t")[:2]
            p = re.sub(r"[^\d.]", "", price)
            if title.strip() and p:
                rows.append((title.strip(), float(p)))
        return rows
    i = 0
    while i < len(lines):
        if lines[i].startswith("favorite "):
            title = lines[i][len("favorite "):].strip()
            price = None
            for j in range(i + 1, min(i + 6, len(lines))):
                m = re.fullmatch(r"\$([\d,]+(?:\.\d+)?)", lines[j].strip())
                if m:
                    price = float(m.group(1).replace(",", ""))
                    i = j
                    break
            if price is not None:
                rows.append((title, price))
        i += 1
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    ap.add_argument("--url", default=URL)
    a = ap.parse_args()
    rows = parse(pathlib.Path(a.file).read_text())
    if not rows:
        sys.exit("no rows parsed")
    con = sqlite3.connect(DB)
    con.executescript("""
    create table if not exists fwrd_renew_reads(
      id integer primary key, read_date text not null, pos int not null, house text, title text not null,
      model_guess text, size_guess text, price real not null, source text default 'fwrd-renew',
      source_url text, retrieved_at text, unique(read_date, pos));
    create index if not exists ix_fwrd_house_date on fwrd_renew_reads(house, read_date);
    create view if not exists v_fwrd_latest as
      select * from fwrd_renew_reads where read_date = (select max(read_date) from fwrd_renew_reads);
    """)
    now = datetime.datetime.now().isoformat(timespec="seconds")
    n = 0
    for pos, (title, price) in enumerate(rows, 1):
        house, model, size = guess(title)
        cur = con.execute("insert or ignore into fwrd_renew_reads(read_date,pos,house,title,model_guess,size_guess,price,source_url,retrieved_at) values(?,?,?,?,?,?,?,?,?)",
                          (a.date, pos, house, title, model, size, price, a.url, now))
        n += cur.rowcount
    con.commit()
    print(f"parsed {len(rows)} tiles, inserted {n} rows for {a.date}")
    for h, c, med in con.execute("select house, count(*), round(avg(price)) from fwrd_renew_reads where read_date=? group by 1 order by 2 desc", (a.date,)):
        print(f"  {h or '?':<14} {c:>4}  avg ${med:,.0f}")
    con.close()


if __name__ == "__main__":
    main()
