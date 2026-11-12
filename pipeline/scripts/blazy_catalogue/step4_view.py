import sqlite3, re, statistics, sys
sys.path.insert(0, "/private/tmp/claude-501/-Users-katiegraves-Desktop/0f6f52ed-9ba2-4f42-99c7-e0d4a6a50618/scratchpad")
DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
con = sqlite3.connect(DB); cur = con.cursor()

# family -> (retail model, size_or_spec LIKE pattern, basis note)
MAP = {
 "Souplissimo flap": ("Souplissimo", "Large/Maxi (Maxi flap bag AS6233%", "large/maxi grained calfskin reference; resale mixes mini/small/large"),
 "Urban Essentials shopping bag": ("Urban Essentials", "Large (Large shopping bag AS6289%", "large reference; resale mixes small/medium/large/XXL"),
 "Kelly Shopper": ("Kelly Shopper", "Mini, fringed raffia-effect%", "mini raffia SS26 edition (attributable rows are raffia/fringe, mini and nano)"),
 "Neo Cabas": ("Neo Cabas", "Small (Shopping bag AS6475%", "small suede FW26 pre-collection (low-confidence search-result price)"),
 "31 Shopping Bag": ("31 Shopping Bag", "Mini, pony hair cheetah%", "mini cheetah MdA 2026"),
 "Chic Lady Shopping Bag": ("Chic Lady Shopping Bag", "Small, black/white pony hair%", "small MdA 2026"),
 "Chanel 25 hobo (incl. pony hair)": ("Chanel 25", "medium", "medium reference (Viard base model); resale mixes sizes"),
 "Chanel 25 pony-hair mini (MdA 2026)": ("Chanel 25", "Mini, pony hair cheetah%", "mini cheetah MdA 2026; black/khaki pony-hair minis on resale may carry a different retail"),
 "Beaded Chainmail Clutch": ("Beaded Chainmail Clutch", "%", "TRR est. retail only (low)"),
 "Preppy Coco flap": ("Preppy Coco", "Small Flap Bag (AS6130)%", "small flap 26P, last sourced Feb 2026 (low as current)"),
}
cur.execute("drop table if exists bag_family_retail_map")
cur.execute("create table bag_family_retail_map(family text primary key, model text, size_pattern text, retail_now real, retail_basis text, source_url text)")
for fam, (model, pat, basis) in MAP.items():
    r = cur.execute("""select price, source_url from retail_reference where house='Chanel' and model=? and size_or_spec like ? and price_type='current' and region='US'
                       order by effective_date desc limit 1""", (model, pat)).fetchone()
    assert r, fam
    cur.execute("insert into bag_family_retail_map values (?,?,?,?,?,?)", (fam, model, pat, r[0], basis, r[1]))

con.commit()
