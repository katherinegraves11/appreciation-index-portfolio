import sqlite3, statistics, re, datetime, sys
DB="/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
con=sqlite3.connect(DB); today=datetime.date.today().isoformat()
page_scope = sys.argv[1] if len(sys.argv)>1 else 'newest p1'
rows=con.execute("select house, model_guess, title, price, est_retail, pct_of_retail, sold, era_guess from trr_item_reads where read_date=date('now')").fetchall()
def saves(t):
    m=re.search(r'saves=(\d+)',t); return int(m.group(1)) if m else None
def md(t): return 1 if re.search(r'-\d+% vs est\. retail|was \$',t) else 0
# resale_aggregates
groups={}
for h,m,t,p,e,pct,s,era in rows: groups.setdefault((h,m),[]).append((t,p,e,pct,s,era))
n_agg=0
for (h,m),g in groups.items():
    if len(g)<3: continue
    prices=[x[1] for x in g if x[1]]; rets=[x[3] for x in g if x[3] is not None]
    sv=[saves(x[0]) for x in g if saves(x[0]) is not None]
    eras={}
    for x in g: eras[x[5]]=eras.get(x[5],0)+1
    notes=f"sold={sum(x[4] for x in g)}; marked_down={sum(md(x[0]) for x in g)}; median_saves={statistics.median(sv) if sv else None}; eras={eras}"
    con.execute("insert or replace into resale_aggregates(source,house,model,snapshot_date,n_listings,median_ask,n_with_retail,median_retention_pct,page_scope,notes) values(?,?,?,?,?,?,?,?,?,?)",
        ('therealreal',h,m,today,len(g),statistics.median(prices) if prices else None,len(rets),round(statistics.median(rets),1) if rets else None,page_scope,notes))
    n_agg+=1
# momentum per house
n_mom=0
for h in sorted({r[0] for r in rows}):
    g=[r for r in rows if r[0]==h]
    sv=[saves(r[2]) for r in g if saves(r[2]) is not None]
    rets=[r[5] for r in g if r[5] is not None]
    metrics={'pct_tiles_marked_down':round(100*sum(md(r[2]) for r in g)/len(g),1),
             'median_saves':statistics.median(sv) if sv else None,
             'pct_tiles_sold':round(100*sum(r[6] for r in g)/len(g),1),
             'median_pct_of_est_retail':round(statistics.median(rets),1) if rets else None,
             'n_tiles':len(g)}
    con.execute("delete from momentum where term=? and source='therealreal' and period_end=?",(f"{h} handbags TRR",today))
    for k,v in metrics.items():
        con.execute("insert into momentum(term,source,metric,value,period_start,period_end,retrieved_at) values(?,?,?,?,?,?,?)",
                    (f"{h} handbags TRR",'therealreal',k,v,today,today,datetime.datetime.now().isoformat(timespec='seconds')))
        n_mom+=1
    print("MOMENTUM",h,metrics)
con.commit()
print("resale_aggregates rows written:",n_agg,"| momentum rows:",n_mom)
