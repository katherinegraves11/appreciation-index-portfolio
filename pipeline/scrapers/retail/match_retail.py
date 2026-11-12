#!/usr/bin/env python3
"""Match resale listings to the house's current boutique price (Katie, 2026-10-24: "when you look at bags that are on the
RealReal and secondhand sites, you should be able to also do a check to see if you can find what the original retail prices
were (unless they're vintage bags from years ago)").

For each recent resale listing (The RealReal reads, secondhand sourcer and platform listings, FWRD Renew), find the same bag in
v_house_catalog: same house, every catalogue model word in the listing title, and most of the catalogue's material and colour
words too. Writes resale_retail_match (one row per listing, best match only). Listings with no current match keep The RealReal's
own "Est. Retail" when it shows one (likely older or vintage pieces). Read-only on everything except resale_retail_match.
Run: python3 scrapers/retail/match_retail.py
"""
import re, sqlite3, unicodedata, datetime, statistics

DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
STOP = {"bag", "bags", "the", "and", "with", "handbag", "a", "of", "in", "&"}
GENERIC_FINISH = {"gold", "silver", "tone", "metal", "hardware", "gold-tone", "silver-tone"}
SIZES = {"small", "medium", "large", "mini", "nano", "micro", "maxi", "toy", "baby", "teen", "jumbo", "xl", "xxl", "pm", "mm", "gm", "bb"}
# Resale names for house references whose boutique names are generic (SOURCES.md, 2026-10 Chanel mapping): the resale sites call
# Chanel's "Small shopping bag" AS6288 the Small Urban Essentials, and so on. (house, reference prefix) -> (resale words, size).
ALIASES = {("chanel", "AS6288"): (["urban", "essentials"], {"small"}, {"crocodile"}),
           ("chanel", "AS6428"): (["urban", "essentials"], set(), {"crocodile"}),
           ("chanel", "AS6289"): (["urban", "essentials"], {"large"}, {"crocodile"}),
           # Matthieu Blazy's 2026 shopping bag: Chanel "Small/Large Shopping Bag", sold on resale as the Archetype (TRR and Fashionphile
           # describe crocodile-embossed and plain calfskin versions with the CC turn-lock); matched by description, not by a reference
           ("chanel", "AS6492"): (["archetype"], {"small"}, set()), ("chanel", "AS6239"): (["archetype"], {"large"}, set()),
           ("chanel", "AS6233"): (["souplissimo"], {"large"}, set()), ("chanel", "AS6231"): (["souplissimo"], {"small"}, set()),
           ("chanel", "AS6281"): (["souplissimo"], {"small"}, set()), ("chanel", "AS6573"): (["souplissimo"], {"mini"}, set())}
# A different kind of object under the same model name: a Saddle pouch is not a Saddle bag, a Kate satchel is not a Kate clutch.
TYPES = {"clutch", "tote", "pouch", "belt", "satchel", "hobo", "charm", "wallet", "backpack", "bucket", "vanity", "phone", "card", "wristlet", "envelope", "bum"}
# Words that name a family, not a bag: a catalogue model made only of these ("Maxi Flap Bag", "Hobo Handbag") cannot tell a Classic
# from a Souplissimo, so it is not used.
# Leathers and cloths: a vernis Alma or a shearling Nino costs a different sum from the canvas or calfskin one on the boutique page.
MATERIALS = {"canvas", "lambskin", "calfskin", "leather", "suede", "denim", "satin", "raffia", "nylon", "crocodile", "alligator", "python",
             "ostrich", "lizard", "shearling", "tweed", "velvet", "patent", "vernis", "empreinte", "epi", "taurillon", "goatskin", "jacquard",
             "toile", "sequin", "crystal", "organza", "bead", "mirror", "fur", "mink", "straw", "wicker", "metallic", "pvc", "plexiglass"}
PLAIN_LEATHER = {"leather", "calfskin"}
# Finishes that change the boutique price: a plain calfskin listing must not take a crocodile-embossed price
PRICED_FINISH = {"crocodile", "alligator", "python", "ostrich", "lizard", "shearling", "tweed", "suede", "denim", "raffia", "sequin",
                 "crystal", "organza", "bead", "mirror", "fur", "mink", "straw", "wicker", "patent", "vernis", "velvet", "satin", "nylon",
                 "jacquard", "toile", "pvc", "plexiglass", "metallic"}
FAMILY = {"flap", "classic", "shopping", "chain", "quilted", "monogram", "logo", "evening", "trunk", "double", "single", "east", "west",
          "hobo", "bucket", "bowling", "backpack", "camera", "case", "clutch", "vanity", "minaudiere"}

def fold(s):
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()

# One spelling per finish, so "Sequins Baguette" and Fendi's "purple sequined bag" agree
STEM = {"sequins": "sequin", "sequined": "sequin", "sequinned": "sequin", "paillettes": "sequin", "paillette": "sequin",
        "crystals": "crystal", "crystal-embellished": "crystal", "beads": "bead", "beaded": "bead", "embroidered": "embroidery",
        "croc": "crocodile", "mirrors": "mirror", "mirrored": "mirror", "fringes": "fringe", "fringed": "fringe"}

def words(s):
    return [STEM.get(w, w) for w in fold(s).split() if w not in STOP and len(w) > 1]

def main():
    db = sqlite3.connect(DB)
    db.execute("""create table if not exists resale_retail_match(
        id integer primary key, listing_source text, listing_id integer, house text, title text, listing_price real, sold integer,
        listing_date text, catalog_reference text, catalog_model text, catalog_price real, catalog_url text, catalog_read_date text,
        match_score real, method text, created_at text)""")
    GENERIC = {"small", "medium", "large", "mini", "nano", "micro", "maxi", "leather", "bag", "bags", "tote", "handbag", "shoulder",
               "crossbody", "cross", "body", "clutch", "pouch", "women", "womens", "top", "handle", "strap", "with", "new"}
    cat = {}
    for house, ref, model, mat, col, price, url, seen, notes in db.execute(
            "select c.house, c.reference, c.model, c.material, c.colour, c.price_now, c.source_url, c.last_seen, "
            "(select notes from retail_availability_reads r where r.house=c.house and r.reference=c.reference order by read_date desc limit 1) "
            "from v_house_catalog c where c.price_now is not null"):
        name = (notes or model or "").split(";")[0]
        mwords = words(model)
        hw = set(words(house))
        named = bool(mwords) and mwords[0] in hw  # "CHANEL 25": the number is the model name
        ident = [w for w in mwords if w not in GENERIC and w not in SIZES and w not in hw and (named or not w.isdigit())]
        size = {w for w in mwords if w in SIZES}
        types = {w for w in words(name) if w in TYPES}
        cmat = {w for w in words(f"{name} {mat or ''} {col or ''}") if w in MATERIALS}
        if {"monogram", "damier"} & set(words(f"{name} {mat or ''} {col or ''}")) and not cmat - {"canvas"}:
            cmat.add("canvas")
        finish = [w for w in words(f"{name} {mat or ''} {col or ''}") if w not in GENERIC and w not in GENERIC_FINISH and w not in ident and w not in words(house) and not w.isdigit()]
        alias = next((v for (h, pre), v in ALIASES.items() if fold(house).startswith(h) and (ref or "").startswith(pre)), None)
        if alias:
            if not alias[2] <= cmat:
                continue  # the resale name only covers one leather (Urban Essentials is crocodile-embossed)
            ident, size = alias[0], alias[1]
        elif not [w for w in ident if w not in FAMILY] or not finish:
            continue  # nothing distinctive to match on ("Small leather bag"), or no finish to tell versions apart
        cat.setdefault(fold(house).split()[0], []).append(dict(ref=ref, model=model, mw=ident, size=size, types=types, mat=cmat, alias=bool(alias), fw=sorted(set(finish)), price=price, url=url, seen=seen))
    listings = []
    for rid, house, title, price, sold, date, est in db.execute(
            "select id, house, title, price, sold, read_date, est_retail from trr_item_reads where read_date >= date('now','-60 days') and price > 0"):
        listings.append(("therealreal", rid, house, title, price, sold, date, est))
    for rid, src, brand, title, price, avail, seen in db.execute(
            "select id, source, brand, title, price, available, last_seen from resale_listings where price > 0 and source <> 'private-sourcer-offer' and last_seen >= date('now','-90 days')"):
        listings.append((src, rid, brand, title, price, 0 if avail else 1, seen, None))
    for rid, house, title, price, date in db.execute("select id, house, title, price, read_date from fwrd_renew_reads where price > 0"):
        listings.append(("fwrd", rid, house, title, price, 0, date, None))
    db.execute("delete from resale_retail_match")
    now = datetime.datetime.now().isoformat(timespec="seconds"); n_cat = n_est = 0
    for src, rid, house, title, price, sold, date, est in listings:
        key = fold(house).split()[0] if house else ""
        tw = set(words(re.sub(r"\[.*$", "", title or "")))
        if "x" in fold(title).split():
            tw = set()  # a collaboration ("Dior x Sacai") is its own bag; no current boutique price
        yrs = [int(y) for y in re.findall(r"\b(19[5-9]\d|20[0-2]\d)\b", title or "")]
        if "vintage" in tw or (yrs and max(yrs) < 2020):
            tw = set()  # Katie: no original retail check for vintage bags; today's boutique price is a different bag
        tsize, ttypes = tw & SIZES, tw & TYPES
        best = None; cands = []
        for c in cat.get(key, []):
            if not tw or not all(w in tw for w in c["mw"]) or (tsize - ({"maxi"} if c["alias"] else set())) != c["size"] or (not c["alias"] and (not ttypes <= c["types"] or not c["types"] <= tw)):
                continue
            tmat = tw & MATERIALS
            if tmat and not tmat <= (c["mat"] | PLAIN_LEATHER if c["mat"] - {"canvas"} else c["mat"]):
                continue  # the listing names a leather or cloth the boutique version is not made in
            if tmat and (c["mat"] & PRICED_FINISH) - tmat:
                continue  # the boutique version has a finish (crocodile embossing, suede, sequins) the listing does not name
            fin = c["fw"]
            score = sum(w in tw for w in fin) / len(fin) if fin else 0.0
            if c["alias"] or (c["mat"] & PRICED_FINISH and c["mat"] & PRICED_FINISH <= tmat):
                score = max(score, 0.6)  # a resale name, or the boutique version's own finish named in the title, plus agreeing size; colour does not move the price
            if score < 0.6:  # an alias name is specific enough when the title names no leather
                continue
            cands.append((score, c))
            if best is None or score > best[0] or (score == best[0] and len(c["mw"]) > len(best[1]["mw"])):
                best = (score, c)
        if best and best[1]["alias"] and not (tw & MATERIALS) and (len({c["price"] for _, c in cands if c["alias"]}) > 1 or best[1]["mat"] & PRICED_FINISH):
            best = None
        if best and len({c["price"] for sc, c in cands if sc == best[0]}) > 1:
            best = None  # equally good matches at different boutique prices: no single answer
        if best:
            c = best[1]; n_cat += 1
            db.execute("insert into resale_retail_match(listing_source, listing_id, house, title, listing_price, sold, listing_date, catalog_reference, catalog_model, catalog_price, catalog_url, catalog_read_date, match_score, method, created_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                       (src, rid, house, title, price, sold, date, c["ref"], c["model"], c["price"], c["url"], c["seen"], round(best[0], 2), "house catalogue", now))
        elif est:
            n_est += 1
            db.execute("insert into resale_retail_match(listing_source, listing_id, house, title, listing_price, sold, listing_date, catalog_price, match_score, method, created_at) values(?,?,?,?,?,?,?,?,?,?,?)",
                       (src, rid, house, title, price, sold, date, est, None, "The RealReal est. retail (no current match; may be older)", now))
    db.commit()
    print(f"listings checked {len(listings)}; matched to the house catalogue {n_cat}; RealReal est. retail only {n_est}")
    for house, n, med in db.execute("select house, count(*), avg(listing_price*1.0/catalog_price) from resale_retail_match where method='house catalogue' group by house order by 2 desc limit 10"):
        print(f"  {house}: {n} matched, average {round(med*100)}% of today's boutique price")

if __name__ == "__main__":
    main()
