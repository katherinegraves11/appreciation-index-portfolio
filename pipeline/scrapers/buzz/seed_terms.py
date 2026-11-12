#!/usr/bin/env python3
"""Seed buzz_terms: one hashtag + one search phrase per house and per tracked bag family.
Idempotent. Edit TERMS to add a bag; families not listed get an auto term from their name."""
import re, sqlite3
DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
# house -> (hashtags, search phrases)
HOUSES = {
 "Hermès": (["hermes","hermesbirkin","hermeskelly","birkin","kellybag"], ["hermes birkin","hermes kelly"]),
 "Chanel": (["chanel","chanelbag","chanelclassicflap","chanel25","souplissimo","chanelsouplissimo"], ["chanel bag","chanel souplissimo","chanel 25 bag"]),
 "Louis Vuitton": (["louisvuitton","lvbag","louisvuittonbag"], ["louis vuitton bag"]),
 "Dior": (["dior","ladydior","diorsaddle","diorbag"], ["lady dior","dior saddle bag"]),
 "Gucci": (["gucci","guccibag","guccijackie"], ["gucci jackie bag"]),
 "Prada": (["prada","pradabag","pradagalleria"], ["prada galleria"]),
 "Miu Miu": (["miumiu","miumiubag","wanderbag"], ["miu miu wander bag"]),
 "Fendi": (["fendi","fendibaguette","fendipeekaboo"], ["fendi baguette"]),
 "Celine": (["celine","celinebag","celinetriomphe"], ["celine triomphe bag"]),
 "Saint Laurent": (["saintlaurent","yslbag","ysl"], ["saint laurent bag"]),
 "Bottega Veneta": (["bottegaveneta","bottegabag","bottegaandiamo"], ["bottega veneta andiamo"]),
 "Loewe": (["loewe","loewepuzzle","loewebag"], ["loewe puzzle bag"]),
 "Balenciaga": (["balenciaga","balenciagabag","lecitybag"], ["balenciaga le city"]),
 "The Row": (["therow","therowmargaux","margauxbag"], ["the row margaux"]),
 "Alaïa": (["alaia","alaiateckel","leteckel"], ["alaia le teckel"]),
 "Ferragamo": (["ferragamo","ferragamobag","hugbag"], ["ferragamo hug bag"]),
}
# family -> (house, hashtags, search phrases); priority 1 = daily
FAMILIES = {
 "Souplissimo flap": ("Chanel", ["souplissimo","chanelsouplissimo"], ["chanel souplissimo"], 1),
 "Chanel 25 hobo (incl. pony hair)": ("Chanel", ["chanel25","chanel25bag"], ["chanel 25 bag"], 1),
 "Chanel 25 pony-hair mini (MdA 2026)": ("Chanel", ["chanelponyhair","chanelcheetah"], ["chanel pony hair bag","chanel cheetah bag"], 1),
 "Classic Flap re-editions": ("Chanel", ["chanelclassicflap","classicflap"], ["chanel classic flap"], 2),
 "Oversized CC flap (SS27)": ("Chanel", ["chanelss27","chanelspring2027"], ["chanel spring 2027 bags","chanel oversized cc bag"], 1),
 "CC Box Bag (SS27)": ("Chanel", ["chanelboxbag"], ["chanel cc box bag"], 2),
 "Double-pocket flap (SS27)": ("Chanel", ["chaneldoublepocket"], ["chanel double pocket flap"], 2),
 "Lady Dior": ("Dior", ["ladydior"], ["lady dior"], 2),
 "Saddle": ("Dior", ["diorsaddle"], ["dior saddle bag"], 2),
}
con = sqlite3.connect(DB)
def add(house, family, platform, term, kind, pr):
    con.execute("insert or ignore into buzz_terms(house,family,platform,term,kind,priority) values(?,?,?,?,?,?)", (house, family, platform, term, kind, pr))
for h,(tags,phr) in HOUSES.items():
    for t in tags:
        for p in ("tiktok-cc","instagram"): add(h,None,p,t,"hashtag",2)
    for s in phr:
        for p in ("google","youtube","tiktok","pinterest"): add(h,None,p,s,"search",2)
for fam,(h,tags,phr,pr) in FAMILIES.items():
    for t in tags:
        for p in ("tiktok-cc","instagram"): add(h,fam,p,t,"hashtag",pr)
    for s in phr:
        for p in ("google","youtube","tiktok","pinterest"): add(h,fam,p,s,"search",pr)
# auto terms for every other Chanel/Dior/LV family in bag_families (weekly rotation)
for house, fam in con.execute("select house, family from bag_families"):
    if fam in FAMILIES: continue
    base = re.sub(r"\(.*?\)", "", fam).strip()
    base = re.split(r"[/,]", base)[0].strip()
    if len(base) < 4 or base.lower().startswith(("unidentified","evening","flat clutch","fur")): continue
    add(house, fam, "google", f"{house} {base}".lower(), "search", 3)
    add(house, fam, "tiktok", f"{house} {base}".lower(), "search", 3)
con.commit()
print("buzz_terms:", con.execute("select count(*), sum(priority=1), sum(priority=2), sum(priority=3) from buzz_terms").fetchone())
