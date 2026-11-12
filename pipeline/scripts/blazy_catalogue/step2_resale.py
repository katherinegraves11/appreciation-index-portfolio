import sqlite3, re, statistics
DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
con = sqlite3.connect(DB)
cur = con.cursor()

# --- refine families (split three MdA editions out) ---
def move(ref, src, dst, dst_desc, dst_notes, first="pre-fall-2026"):
    row = cur.execute("select look_numbers from bag_families where family=?", (src,)).fetchone()
    looks = [x for x in row[0].split(", ") if x != ref]
    cur.execute("update bag_families set look_numbers=?, n_looks=? where family=?", (", ".join(looks), len(looks), src))
    cur.execute("insert or ignore into bag_families(house,family,first_season,look_numbers,n_looks,description,designer,notes) values ('Chanel',?,?,?,1,?,'Matthieu Blazy',?)",
                (dst, first, ref, dst_desc, dst_notes))
move("MdA26#29", "Chanel 25 hobo (incl. pony hair)", "Chanel 25 pony-hair mini (MdA 2026)",
     "Mini Chanel 25 in cheetah-print pony hair (also black and dark-khaki pony hair on resale), Metiers d'Art Paris-New York 2026.",
     "Blazy-era edition of a Viard base model. Mapping LOW: MdA26#29 'spotted ponyhair small bag on a chain'.")
move("MdA26#44", "Classic Flap re-editions", "Cheetah pony-hair flap (MdA 2026)",
     "Medium/large flap in cheetah-print calf hair with black lambskin, MdA Paris-New York 2026.",
     "Mapping MEDIUM-LOW: MdA26#44 'leopard ponyhair large flap bag on a chain'; could alternatively be the leopard-tweed Souplissimo.")
move("MdA26#48", "Evening & micro pouches", "Sequin leopard mini flap (MdA 2026)",
     "Mini rectangular flap in orange/black leopard (tiger-stripe) sequins and mixed fibres.",
     "Mapping MEDIUM: MdA26#48 'orange-and-black tiger-stripe sequined small pouch' matches resale 'Mini Cheetah Print Flap Bag Orange, Black Sequin'.")
if not cur.execute("select 1 from bag_families where family='Preppy Coco flap' and notes like '%%Cruise 2025/26%%'").fetchone(): cur.execute("update bag_families set notes=notes||' | Blazy-era attribution of the 2026 Preppy Coco line (Small Flap, Mini Clutch, Bowling, Long Vanity, shiny caviar) is unverified: it is 2026-dated on resale but could be the post-Viard studio Cruise 2025/26.' where family='Preppy Coco flap'")
cur.execute("update bag_families set description='Preppy Coco line in shiny caviar: small flap, mini clutch with straps, bowling bag, long vanity (2026-dated on resale).' where family='Preppy Coco flap'")
con.commit()

has = lambda t, *ks: any(k in t for k in ks)
PONY = ("pony", "calf hair", "cheetah")
# family -> (attributable predicate, context predicate or None, rule text)
R = {
 "Souplissimo flap": (lambda t, m: "souplissimo" in t or m == "Souplissimo", None, "title~souplissimo / model_guess"),
 "Urban Essentials shopping bag": (lambda t, m: has(t, "urban essential", "urbena essential") or m == "Urban Essentials", None, "title~urban essential"),
 "Kelly Shopper": (lambda t, m: ("kelly shopper" in t or m == "Kelly Shopper") and has(t, "raffia", "fringe"),
                   lambda t, m: "kelly shopper" in t or m == "Kelly Shopper", "attributable = raffia/fringe SS26 edition; context = all Kelly Shopper (Viard base)"),
 "Neo Cabas": (lambda t, m: "neo cabas" in t or m == "Neo Cabas", None, "title~neo cabas"),
 "31 Shopping Bag": (lambda t, m: has(t, "31 shop", " 31 ") and has(t, *PONY), lambda t, m: has(t, "31 shop", " 31 ", "31 clutch") , "attributable = 31 + pony/cheetah; context = all 31"),
 "Chic Lady Shopping Bag": (lambda t, m: "chic lady" in t or m == "Chic Lady Shopping Bag", None, "title~chic lady"),
 "Bucket Bag": (lambda t, m: "bucket" in t and has(t, *PONY), lambda t, m: "bucket" in t, "attributable = bucket + pony/cheetah (MdA); context = all bucket"),
 "Pony Hair Clutch": (lambda t, m: m == "Pony Hair Clutch" or ("clutch" in t and has(t, *PONY) and "vanity" not in t), None, "clutch + pony/calf hair/cheetah"),
 "Chanel 25 pony-hair mini (MdA 2026)": (lambda t, m: (has(t, "25 hob", "chanel 25", "mini 25") or m in ("Chanel 25", "Mini 25 Hobo")) and has(t, *PONY), None, "Chanel 25 + pony/cheetah"),
 "Chanel 25 hobo (incl. pony hair)": (lambda t, m: (has(t, "25 hob", "chanel 25", "mini 25", " 25 handbag") or m in ("Chanel 25", "Mini 25 Hobo")) and not has(t, *PONY), None, "Chanel 25 excluding pony hair (VIARD base model; mostly Viard-era stock)"),
 "Cheetah pony-hair flap (MdA 2026)": (lambda t, m: "flap" in t and has(t, *PONY) and not has(t, "25", "31", "bucket", "clutch", "vanity", "souplissimo", "sequin"), None, "flap + pony/calf hair/cheetah"),
 "Sequin leopard mini flap (MdA 2026)": (lambda t, m: "sequin" in t and has(t, "leopard", "cheetah"), None, "sequin + leopard/cheetah"),
 "Beaded Chainmail Clutch": (lambda t, m: has(t, "chainmail", "chain mail"), None, "title~chainmail"),
 "Preppy Coco flap": (lambda t, m: "preppy" in t and "flap" in t, lambda t, m: "preppy" in t, "attributable = Preppy Coco flap; context = whole Preppy Coco line"),
 "Coco Beach": (lambda t, m: False, lambda t, m: "coco beach" in t, "context only: Coco Beach capsule runs every year, era not separable from titles"),
 "Vanity cases": (lambda t, m: False, lambda t, m: "vanity" in t, "context only: vanity shape spans all eras; Resort 27 vanities not yet in stores"),
 "Raffia pieces": (lambda t, m: False, lambda t, m: "raffia" in t, "context only: Resort 27 raffia not yet in stores; existing raffia = Coco Beach/Kelly Shopper/older"),
 "Bowling bag": (lambda t, m: False, lambda t, m: "bowling" in t, "context only"),
 "Minaudieres (hard-shell novelty)": (lambda t, m: False, lambda t, m: "minaudi" in t, "context only"),
 "Classic Flap re-editions": (lambda t, m: False, None, "TRR year_tag=2026 Classic Flap only (resale titles carry no season)"),
}

cur.execute("drop table if exists bag_family_resale")
cur.execute("""create table bag_family_resale(family text, source text, snapshot_date text, n int, min_ask real, median_ask real,
  max_ask real, n_sold int, sold_prices text, median_saves real, match_scope text, match_rule text, computed_at text)""")

listings = cur.execute("select source, lower(title), coalesce(model_guess,''), price, last_seen from v_bag_listings where brand='Chanel' and last_seen=(select max(last_seen) from v_bag_listings where brand='Chanel') and price>0").fetchall()
# TRR: latest read per slug
trr = cur.execute("""select t.slug, lower(t.title), coalesce(t.model_guess,''), t.price, t.sold, t.read_date, t.year_tag from trr_item_reads t
  join (select slug, max(read_date) d from trr_item_reads where house='Chanel' group by slug) x on x.slug=t.slug and x.d=t.read_date
  where t.house='Chanel' and t.price>0""").fetchall()

def summarize(fam, source, snap, rows, scope, rule):
    if not rows:
        return
    asks = [r["price"] for r in rows if not r["sold"]]
    sold = [r["price"] for r in rows if r["sold"]]
    saves = [r["saves"] for r in rows if r["saves"] is not None]
    cur.execute("insert into bag_family_resale values (?,?,?,?,?,?,?,?,?,?,?,?,date('now'))",
        (fam, source, snap, len(rows), min(asks) if asks else None, statistics.median(asks) if asks else None,
         max(asks) if asks else None, len(sold), ", ".join(f"{p:.0f}" for p in sorted(sold)) or None,
         statistics.median(saves) if saves else None, scope, rule))

zero = []
for fam, (attr, ctx, rule) in R.items():
    total_attr = 0
    for scope, pred in (("attributable", attr), ("context (all eras)", ctx)):
        if pred is None:
            continue
        by_src = {}
        for s, t, m, p, ls in listings:
            if pred(t, m):
                by_src.setdefault((s, ls), []).append({"price": p, "sold": 0, "saves": None})
        for slug, t, m, p, sold, rd, yt in trr:
            ok = pred(t, m)
            if fam == "Classic Flap re-editions" and scope == "attributable":
                ok = (m == "Classic Flap" and yt == 2026 and "preppy" not in t and not has(t, *PONY))
            if ok:
                sv = re.search(r"saves=(\d+)", t)
                by_src.setdefault(("therealreal", rd), []).append({"price": p, "sold": sold, "saves": int(sv.group(1)) if sv else None})
        # TRR rows across read dates are combined into one source row
        merged = {}
        for (s, d), rows in by_src.items():
            k = s
            merged.setdefault(k, {"d": d, "rows": []})
            merged[k]["rows"] += rows
            merged[k]["d"] = max(merged[k]["d"], d)
        if scope == "attributable" and merged:
            allrows = [r for v in merged.values() for r in v["rows"]]
            summarize(fam, "ALL (pooled)", max(v["d"] for v in merged.values()), allrows, scope, rule)
        for s, v in merged.items():
            summarize(fam, s, v["d"], v["rows"], scope, rule)
            if scope == "attributable":
                total_attr += len(v["rows"])
    if total_attr == 0:
        zero.append(fam)
con.commit()
allfams = [r[0] for r in cur.execute("select family from bag_families")]
nores = [f for f in allfams if f not in R or f in zero]
print("families with ZERO attributable resale matches:", nores)
