import sqlite3
DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
S = {"SS26": "spring-2026-ready-to-wear", "MdA26": "pre-fall-2026", "SS26C": "spring-2026-couture",
     "FW26": "fall-2026-ready-to-wear", "R27": "resort-2027", "FW26C": "fall-2026-couture"}
ORDER = ["SS26", "MdA26", "SS26C", "FW26", "R27", "FW26C"]  # chronological show order

def L(code, nums):
    return [f"{code}#{n}" for n in nums]

# (family, looks, description, notes)
F = [
 ("Souplissimo flap", L("SS26", [2, 14, 17]) + L("MdA26", [47]) + L("FW26", [8, 9]),
  "Soft, unstructured Maxi flap with flattened/crinkled quilting and CC turn-lock on chain; sizes mini / small / large(maxi); grained calfskin, suede, denim, shearling, leopard tweed.",
  "Blazy-original (SS26 debut, boutiques Mar 2026). Look mapping MEDIUM-LOW: SS26 crinkled-leather soft chain bags and FW26 flattened-quilt soft flap read as Souplissimo; MdA26#47 shearling flap = AS6281 shearling (retail row 343). Leopard-tweed Souplissimo (AS6234) may be MdA26#44 (assigned to Classic Flap re-editions)."),
 ("Soft envelope flap FW26 (unnamed)", L("FW26", [32, 33, 55, 57, 83, 84, 95, 96]),
  "Soft-structured envelope flap, small gold turn-lock at flap tip, flat leather strap; croc-embossed (olive, red), grained and smooth black calfskin.",
  "Fall 2026 RTW; in stores Aug-Oct 2026. May be a Souplissimo evolution or a new commercial name - unverified. Detail-gallery rows (several are two views of one bag)."),
 ("Chain-mesh band flap FW26 (unnamed)", L("FW26", [29, 30, 74]),
  "Classic-quilted lambskin flap with a vertical gold chain-mesh band replacing the CC turn-lock; east-west medium and small.",
  "Fall 2026 RTW new shape; commercial name unverified. Distinct from the 2026 Beaded Chainmail Clutch."),
 ("Classic Flap re-editions", L("SS26", [47, 63]) + L("SS26C", [3, 6]) + L("MdA26", [2, 19, 24, 27, 42, 44, 45, 64, 67, 74]) + L("FW26", [80, 86, 87, 106, 107, 108, 113]) + L("R27", [3, 5, 15, 20, 53, 57, 59, 67]),
  "Classic Flap / 11.12 shape re-edited: mini and small sizes dominate; tweed, organza, sequin, printed silk, embroidered, smooth calf with contrast piping; MdA26#44 leopard pony-hair large flap.",
  "Archive code (Lagerfeld 1983). Blazy shows mostly MINI/SMALL. MdA26#44 = cheetah/leopard flap (could instead be the leopard-tweed Souplissimo AS6234 - unverified). Raffia flaps R27#2,#30 sit under Raffia pieces."),
 ("2.55 Reissue", L("FW26", [35, 36]),
  "Small black classic-quilted lambskin flap with rectangular Mademoiselle lock.",
  "Archive code (1955). One bag, two detail views."),
 ("Chanel 25 hobo (incl. pony hair)", L("MdA26", [29]) + L("FW26", [20, 47, 48]),
  "Soft quilted shoulder bag with chain-threaded strap and CC stud; MdA 2026 cheetah pony-hair mini edition.",
  "Base model is VIARD-era (launched early 2025); Blazy-era pieces are new editions (pony hair, metallic). Look mapping LOW: FW26 soft quilted shoulder bags with chain/CC stud resemble the 25; MdA26#29 'spotted ponyhair small bag on a chain' tentatively the pony-hair 25 mini."),
 ("Half-moon hobo (Blazy new shape)", L("SS26", [7, 57]) + L("MdA26", [1, 4, 15, 16, 55, 56, 72, 73]) + L("FW26", [103, 105]) + L("R27", [8, 17, 27, 48, 50]),
  "Unquilted slouchy half-moon / crescent shoulder hobo on a single flat strap or chain, open top; calfskin and suede; small to large.",
  "Most-shown leather day-bag shape across Blazy shows (17 rows). No commercial name verified; resale listings for it are not identifiable by title."),
 ("Chanel 22 / large soft quilted shoulder", L("FW26", [45]),
  "Large black soft calfskin slouchy shoulder bag with flattened diamond quilting.",
  "Chanel 22 is a VIARD model (2022); runway guess only."),
 ("Urban Essentials shopping bag", L("SS26", [111]) + L("MdA26", [3, 37, 50]) + L("R27", [11, 62]),
  "Soft unstructured shopping tote, grained calfskin / suede; small (east-west), medium, large, XXL; MdA 2026 leopard-tweed small edition.",
  "Blazy-era (SS26 boutiques Mar 2026). Mapping MEDIUM: SS26#111 camel suede tote matches resale 'XXL Urban Essential dark beige suede/camel calf'; MdA soft shoppers match MdA suede & leopard-tweed editions; R27 open-top calf totes LOW."),
 ("Kelly Shopper", [],
  "Top-handle shopper with Kelly-style strap closure; nano / mini / small; shiny aged calfskin, metallic, denim, SS26 fringed raffia-effect & wood.",
  "Base model VIARD-era (2024). Blazy-era = SS26 raffia-fringe and 2026 colourways (commercial release, not identified on the runways in runway_pipeline). MdA26#36 'Kelly-like' top-handle is a structured bag, not the Kelly Shopper."),
 ("Neo Cabas", [],
  "Quilted soft shopping tote; mini (lambskin) and small (suede, FW26 pre-collection).",
  "Commercial FW26 pre-collection piece; no runway look identified in runway_pipeline descriptions."),
 ("31 Shopping Bag", [],
  "31 Bag mini in cheetah-print pony hair with black calfskin (MdA Paris-New York 2026, AS4133).",
  "Base model is LAGERFELD-era (Cruise 2018/19 '31 Bag'); MdA 2026 pony-hair edition is Blazy-era. Not identified in runway descriptions."),
 ("Chic Lady Shopping Bag", L("MdA26", [49]),
  "Small shopping bag in black/white pony-hair-effect lambskin with V cut-out (MdA 2026).",
  "Mapping LOW: MdA26#49 'grey-and-white spotted ponyhair small top-handle bag'."),
 ("Bucket Bag", L("MdA26", [10, 20, 26, 52, 53]) + L("R27", [6, 68]),
  "Drawstring / open-top bucket with single top handle or long strap; smooth calf, croc-embossed, metallic quilted; MdA 2026 cheetah pony-hair edition sold on TRR.",
  "Cheetah pony-hair bucket (TRR sold $8,500) not identified in runway descriptions; raffia buckets sit under Raffia pieces."),
 ("Pony Hair Clutch", L("MdA26", [31]),
  "Pony-hair clutch with straps (cheetah) / with leather strap (black-white), MdA 2026.",
  "Mapping LOW: MdA26#31 'gold leopard-print small clutch'."),
 ("Beaded Chainmail Clutch", [],
  "2026 beaded chainmail clutch with chain (TRR est. retail $18,900).",
  "No runway look matched in runway_pipeline descriptions; known from TRR tile only."),
 ("Vanity cases", L("R27", [10, 69]),
  "Small rigid squared vanity/box with short top handle; smooth or woven-textured black leather.",
  "Resort 2027 (in stores Nov 2026-Jan 2027)."),
 ("Coco Beach", [],
  "Chanel's seasonal beach capsule (Coco Beach).",
  "No runway look identified; Resort 27 striped canvas shoppers (R27#25,#47) logged separately as 'Striped canvas shopper' because the capsule name is unverified for them."),
 ("Striped canvas shopper (Resort 27)", L("R27", [25, 47]),
  "Large striped canvas shopper/shoulder tote with leather handles (red/navy/cream; cream/navy).",
  "Resort 2027; possibly Coco Beach-adjacent - unverified."),
 ("Preppy Coco flap", [],
  "Preppy Coco flap (name from Katie's list).",
  "No runway look identified and no description in DB; existence/spec unverified this session."),
 ("Raffia pieces", L("R27", [2, 16, 22, 26, 29, 30, 38, 42, 44, 51, 52, 60, 70]),
  "Woven raffia (often striped) mini flaps, basket, drawstring buckets, totes, pouch clutches, hobo.",
  "Resort 2027 dominant material story (13 rows). SS26 fringed raffia-effect Kelly Shopper is a commercial cousin (see Kelly Shopper)."),
 ("Minaudieres (hard-shell novelty)", L("SS26", [22, 40, 53, 73]) + L("MdA26", [61]) + L("FW26", [54, 59, 111]) + L("R27", [4, 34, 37, 65, 66]) + L("FW26C", [46]),
  "Hard-shell objet minaudieres: apple, pomegranate, egg, berry, planet/sphere, flower, cage, hammered metal.",
  "Blazy signature across every show (14 rows); runway/limited pieces."),
 ("Half-moon frame clutch", L("FW26", [22, 24]),
  "Half-moon tan suede clutch with slim gold frame and tiny CC stud.", "One bag, two views."),
 ("Flat clutches & pochettes", L("SS26", [51, 60, 78, 90, 107]) + L("MdA26", [11, 57, 63, 76]) + L("FW26", [51, 69, 71, 89]) + L("R27", [1, 24, 75]) + L("FW26C", [2]),
  "Flat rectangular / elongated clutches and pochettes in croc(-embossed), smooth calf, satin (bow), printed silk.", ""),
 ("Couture petal pouches", L("SS26C", [9, 11, 23, 34, 41, 53]),
  "Pleated chiffon / organza / tulle / satin petal pouches on braided gold chain with crystal charm.", "Couture - not a retail product."),
 ("Evening & micro pouches", L("SS26", [2, 83]) + L("MdA26", [13, 25, 48, 54, 70, 71, 80]) + L("R27", [7, 12, 35, 40, 61, 63, 72, 78]),
  "Soft pouches: ostrich feather, beaded/fringed, sequinned, metallic micro pouches on cords/chains, small leather day pouches.",
  "SS26#2 also listed under Souplissimo (crinkled mini on chain) - counted in both."),
 ("Bowling bag", L("SS26", [110]) + L("MdA26", [5, 43]) + L("R27", [55, 58]),
  "Rounded bowling/duffle with twin rolled handles; camel suede, black and taupe calf.", ""),
 ("Structured top-handle & box bags", L("MdA26", [6, 28, 33, 36, 38]) + L("FW26", [93, 117]) + L("R27", [21, 39]),
  "Small structured top-handle/flap and rigid box bags (olive, sky-blue, dark green, black croc).", "MdA26#36 described as Kelly-like."),
 ("Portfolio & briefcase", L("MdA26", [32, 35]), "Oversized soft portfolio clutch; structured black briefcase.", ""),
 ("Fur muffs", L("MdA26", [58, 62]), "Fur muff-style bags with chain.", ""),
 ("Unidentified partial views", L("SS26", [25, 31, 34, 65, 68]) + L("R27", [18]), "Bags only partly in frame.", "Excluded from analysis."),
]

con = sqlite3.connect(DB)
cur = con.cursor()
have = {(s, n) for s, n in cur.execute("select season, look_number from runway_pipeline where house='Chanel'")}
used = set()
cur.execute("drop table if exists bag_families")
cur.execute("""create table bag_families(id integer primary key, house text, family text unique, first_season text,
  look_numbers text, n_looks int, description text, designer text, notes text)""")
for fam, looks, desc, notes in F:
    seasons = []
    for ref in looks:
        code, n = ref.split("#")
        key = (S[code], int(n))
        assert key in have, ref
        used.add(key)
        seasons.append(code)
    first = S[min(seasons, key=ORDER.index)] if seasons else None
    cur.execute("insert into bag_families(house,family,first_season,look_numbers,n_looks,description,designer,notes) values (?,?,?,?,?,?,?,?)",
                ("Chanel", fam, first, ", ".join(looks), len(looks), desc, "Matthieu Blazy",
                 (notes + " | look_numbers use show codes SS26=spring-2026-ready-to-wear, MdA26=pre-fall-2026 (Metiers d'Art Paris-New York, Dec 2025), SS26C=spring-2026-couture, FW26=fall-2026-ready-to-wear, R27=resort-2027, FW26C=fall-2026-couture; FW26/SS26 numbers are detail-gallery image numbers. Grouping is analyst inference from runway_pipeline descriptions, 2026-10-03.").strip(" |")))
con.commit()
missing = have - used
print("unassigned runway rows:", sorted(missing))
print("total rows", len(have), "assigned", len(used))
