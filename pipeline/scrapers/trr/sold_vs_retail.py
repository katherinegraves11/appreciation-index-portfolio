#!/usr/bin/env python3
"""Sold-vs-retail table for the 2026-10-17 TRR sold-first sweep. Writes exports/trr_sold_vs_retail_<date>.csv."""
import sqlite3, re, statistics, csv, datetime, sys
DB="/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"; D=sys.argv[1] if len(sys.argv)>1 else '2026-10-17'
con=sqlite3.connect(DB)
# (house, model_guess) -> (retail model, size regex on title, note)
SPEC={
 ('Hermès','Birkin'):('Birkin',r'Birkin[^0-9]{0,25}\b30\b','retail = Birkin 30 Togo'),
 ('Hermès','Kelly'):('Kelly',r'Kelly[^0-9]{0,25}\b28\b','retail = Kelly 28'),
 ('Hermès','Constance'):('Constance',r'Constance[^0-9]{0,25}\b24\b','retail = Constance 24 Epsom'),
 ('Hermès','Picotin'):('Picotin',r'Picotin[^0-9]{0,25}\b18\b','retail = Picotin 18'),
 ('Hermès','Evelyne'):('Evelyne',r'Evelyne[^0-9]{0,25}\b29\b','retail = Evelyne 29 (PM)'),
 ('Hermès','Lindy'):('Lindy',r'Lindy[^0-9]{0,25}\b26\b','retail = Lindy 26'),
 ('Chanel','Classic Flap'):('Classic Flap',r'Medium','retail = medium 11.12'),
 ('Chanel','Chanel 22'):('Chanel 22',r'Medium','retail = medium'),
 ('Chanel','Boy'):('Boy',r'Old Medium|\bMedium\b','retail = old medium 25cm'),
 ('Chanel','Reissue 2.55'):('Reissue 2.55',r'226',None),  # no retail ref row for Reissue
 ('Chanel','Chanel 19'):('Chanel 19',r'\bSmall\b|Handbag','retail = small 26cm'),
 ('The Row','Margaux'):('Margaux',r'\b15\b','retail = Soft Margaux 15'),
 ('Bottega Veneta','Andiamo'):('Andiamo',r'\bSmall\b','retail = Small Andiamo'),
 ('Bottega Veneta','Jodie'):('Jodie',r'\bSmall\b|\bTeen\b','retail = Small Jodie (ex-Teen)'),
 ('Bottega Veneta','Cassette'):('Cassette',r'Padded','retail = Padded Cassette'),
 ('Loewe','Puzzle'):('Puzzle',r'\bSmall\b','retail = Small Puzzle'),
 ('Loewe','Flamenco'):('Flamenco',r'\bMedium\b','retail = Medium Flamenco clutch'),
 ('Dior','Lady Dior'):('Lady Dior',r'\bMedium\b','retail = Medium Lady Dior'),
 ('Dior','Saddle'):('Saddle',r'Saddle(?! Belt| Pouch| Wallet)','retail = Saddle bag w/ strap'),
 ('Dior','Book Tote'):('Book Tote',r'\bMedium\b','retail = Medium Book Tote'),
 ('Celine','Triomphe'):('Triomphe',r'\bMedium\b','retail = Medium Triomphe'),
 ('Celine','Classic Box'):('Classic Box',r'\bMedium\b','retail = Medium Classic'),
 ('Celine','Luggage'):('Luggage',r'\bMicro\b','retail = Micro Luggage'),
 ('Fendi','Baguette'):('Baguette',r'^(?!.*(Mini|Micro|Nano|Large|Maxi|Phone|Chain Wallet|Charm|Pico))','retail = standard/medium Baguette'),
 ('Fendi','Peekaboo'):('Peekaboo',r'\bMedium\b|ISeeU','retail = Peekaboo ISeeU Medium'),
 ('Louis Vuitton','Capucines'):('Capucines',r'\bBB\b','retail = Capucines BB'),
 ('Louis Vuitton','Neverfull'):('Neverfull',r'\bMM\b','retail = Neverfull MM Monogram'),
 ('Louis Vuitton','Pochette Métis'):('Pochette',r'M[eé]tis','retail reference row is named "Pochette" (Pochette Métis Monogram)'),
 ('Prada','Galleria'):('Galleria',r'\bMedium\b','retail = Medium Galleria Saffiano'),
 ('Prada','Re-Edition'):('Re-Edition',r'2005','retail = Re-Edition 2005 Re-Nylon'),
 ('Gucci','Jackie'):('Jackie',r'1961|\bSmall\b','retail = Jackie 1961 small'),
 ('Gucci','Dionysus'):('Dionysus',r'\bSmall\b','retail = Dionysus small GG Supreme'),
 ('Saint Laurent','Loulou'):('Loulou',r'\bMedium\b','retail = Loulou medium'),
 ('Miu Miu','Wander'):('Wander',r'^(?!.*(Mini|Micro|Small))','retail = Wander regular hobo'),
 ('Balenciaga','City'):('City',r'\bSmall\b','retail = Le City small'),
 ('Balenciaga','Rodeo'):('Rodeo',r'\bSmall\b','retail = Rodeo small'),
 ('Alaïa','Le Teckel'):('Le Teckel',r'\bMedium\b','retail = Le Teckel Medium'),
 ('Alaïa','Le Papa'):('Le Papa',r'\bMini\b','retail = Le Papa Mini'),
 ('Ferragamo','Hug'):(None,r'.','no retail reference row for Ferragamo Hug'),
}
retail={ (h,m):(r,spec) for h,m,r,spec in con.execute("select house,model,retail_now,size_or_spec from v_retail_current_sized")}
rows=con.execute("select house,model_guess,title,price,est_retail,pct_of_retail,sold,condition,slug from trr_item_reads where read_date=? and price is not null",(D,)).fetchall()
def med(x): return round(statistics.median(x)) if x else None
out=[]
for (h,m),(rm,size_rx,note) in SPEC.items():
    g=[r for r in rows if r[0]==h and r[1]==m]
    sold=[r for r in g if r[6]==1]; unsold=[r for r in g if r[6]==0]
    if len(sold)<2: continue
    sp=[r[3] for r in sold]
    sized=[r[3] for r in sold if re.search(size_rx,r[2],re.I)]
    rr=retail.get((h,rm)) if rm else None
    rn=rr[0] if rr else None
    out.append(dict(house=h,model=m,n_sold=len(sold),min_sold=min(sp),median_sold=med(sp),max_sold=max(sp),
        n_unsold=len(unsold),median_ask_unsold=med([r[3] for r in unsold]),
        n_sold_size_matched=len(sized),median_sold_size_matched=med(sized),
        retail_now=rn,retail_spec=(rr[1] if rr else None),
        pct_all_sizes=(round(100*med(sp)/rn,1) if rn else None),
        pct_size_matched=(round(100*med(sized)/rn,1) if (rn and sized) else None),
        n_with_trr_est_retail=sum(1 for r in sold if r[4]),
        median_trr_pct_of_est_retail=(round(statistics.median([r[5] for r in sold if r[5] is not None]),1) if any(r[5] is not None for r in sold) else None),
        note=(note or '') + ('' if (rm is None or rm==m) else f'; model_guess "{m}" != retail reference "{rm}"')))
out.sort(key=lambda d:(-(d['pct_size_matched'] or d['pct_all_sizes'] or 0)))
fn=f"/Users/katiegraves/Desktop/Fashion Data Lab/exports/trr_sold_vs_retail_{D}.csv"
with open(fn,'w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)
print("wrote",fn,len(out),"rows")
for d in out:
    print(f"{d['house']:15}|{d['model']:14}|n={d['n_sold']:3}|min {d['min_sold']:>7.0f}|med {d['median_sold']:>7}|max {d['max_sold']:>7.0f}|ask {str(d['median_ask_unsold']):>6}(n={d['n_unsold']})|sized n={d['n_sold_size_matched']:3} med {str(d['median_sold_size_matched']):>6}|retail {str(d['retail_now']):>7}|%all {str(d['pct_all_sizes']):>5}|%sized {str(d['pct_size_matched']):>5}|TRRest med% {d['median_trr_pct_of_est_retail']} (n={d['n_with_trr_est_retail']})")
# top 15 sold
print("\nTOP 15 SOLD")
for r in con.execute("select house,title,price,condition from trr_item_reads where read_date=? and sold=1 order by price desc limit 15",(D,)): print(r)
# below 50% of TRR est retail
b=con.execute("select house,model_guess,title,price,est_retail,pct_of_retail from trr_item_reads where read_date=? and sold=1 and est_retail is not null and price<0.5*est_retail order by pct_of_retail",(D,)).fetchall()
print("\nBELOW 50% of TRR est. retail:",len(b),"of",con.execute("select count(*) from trr_item_reads where read_date=? and sold=1 and est_retail is not null",(D,)).fetchone()[0],"sold tiles with an Est. Retail")
with open(f"/Users/katiegraves/Desktop/Fashion Data Lab/exports/trr_sold_below_50pct_retail_{D}.csv",'w',newline='') as f:
    w=csv.writer(f); w.writerow(['house','model_guess','title','sold_price','trr_est_retail','pct_of_retail']); w.writerows(b)
for r in b[:25]: print(r)
print("\nby house (below-50% share):")
for r in con.execute("select house, sum(price<0.5*est_retail), count(*) from trr_item_reads where read_date=? and sold=1 and est_retail is not null group by house order by 2 desc",(D,)): print(r)
