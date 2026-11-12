-- Retail vs resale: the integral comparison (Katie, 2026-10-02).
-- retention_pct = resale ask (or sold price) / retail. Two denominators matter:
--   * current retail  -> "what you'd pay new today"  (buy-new-or-used decision)
--   * retail at purchase (historical/launch) -> "what the original owner paid" (did it hold value?)


-- Bags only: resale collectors also return jewellery, wallets, RTW and shoes that share a model name (Kelly bracelet,
-- Classic Flap card case). Exclude by product_type and by title keywords. (2026-10-02 fix: Rebag "Kelly" median was 29% of
-- retail because 60% of its Kelly rows were bracelets/rings.)
drop view if exists v_bag_listings;
create view v_bag_listings as
select * from resale_listings
where coalesce(product_type,'') not in ('Apparel','Earrings','Shoes','Bracelet','Bracelets','Necklace','Necklaces','Accessories','Ring','Rings',
      'Pendant & Charms','Dresses','Brooch','Wallets','Belts','Bag Accessories','Cufflinks','Cosmetic cases','Matching Sets',
      'Hats & Hair Accessories','Small Leather Goods','Skirts','Sunglasses','Jackets','cuff','Tops','watch','Shirts & Tops',
      'Pants','Jumpsuit','Gloves','Garment bags','Dresess','Scarves','Jewelry','Watches','Keychains','Key Holders')
  and lower(title) not glob '*wallet*' and lower(title) not glob '*card case*' and lower(title) not glob '*card holder*'
  and lower(title) not glob '*bracelet*' and lower(title) not glob '*necklace*' and lower(title) not glob '*earring*'
  and lower(title) not glob '*ring sterling*' and lower(title) not glob '*charm*' and lower(title) not glob '*keychain*'
  and lower(title) not glob '*key holder*' and lower(title) not glob '*coin purse*' and lower(title) not glob '*scarf*'
  and lower(title) not glob '*belt *' and lower(title) not glob '*twilly*' and lower(title) not glob '*sandal*'
  and lower(title) not glob '*sneaker*' and lower(title) not glob '*pump*' and lower(title) not glob '*boot*';

drop view if exists v_retail_current;
create view v_retail_current as
select house, model, size_or_spec, price as retail_now, effective_date, source_url
from retail_reference r
where price_type='current' and is_reference_size=1 and region='US'
  and effective_date = (select max(effective_date) from retail_reference x
                        where x.house=r.house and x.model=r.model and x.is_reference_size=1 and x.price_type='current' and x.region='US');

drop view if exists v_retail_history;
create view v_retail_history as
select house, model, size_or_spec, substr(effective_date,1,4) as year, min(price) as retail_that_year, price_type, source_url
from retail_reference where is_reference_size=1 and region='US'
group by house, model, substr(effective_date,1,4);

-- Asking-price retention per source, per snapshot date (median via window)
drop view if exists v_retail_vs_resale_asks;
create view v_retail_vs_resale_asks as
with snap as (
  select l.brand as house, l.model_guess as model, l.source, s.snapshot_date, s.price,
         row_number() over (partition by l.brand, l.model_guess, l.source, s.snapshot_date order by s.price) as rn,
         count(*)     over (partition by l.brand, l.model_guess, l.source, s.snapshot_date) as n
  from resale_snapshots s join v_bag_listings l on l.source=s.source and l.source_product_id=s.source_product_id
  where s.price is not null and l.model_guess is not null and l.model_guess<>''
), med as (
  select house, model, source, snapshot_date, n, avg(price) as median_ask
  from snap where rn in ((n+1)/2, (n+2)/2) group by house, model, source, snapshot_date
)
select m.house, m.model, m.source, m.snapshot_date, m.n as n_listings, round(m.median_ask) as median_ask,
       rc.retail_now, round(100.0*m.median_ask/rc.retail_now,1) as retention_vs_current_retail_pct,
       rc.size_or_spec as reference_size
from med m left join v_retail_current rc on rc.house=m.house and rc.model=m.model
where m.n>=5;

-- Realised (sold) retention from RealReal item reads: price paid vs est. retail + vs our current retail
drop view if exists v_retail_vs_resale_sold;
create view v_retail_vs_resale_sold as
select t.read_date, t.house, t.model_guess as model, t.era_guess, t.condition, t.price as sold_or_ask, t.sold,
       t.est_retail as trr_est_retail, round(100.0*t.price/nullif(t.est_retail,0),1) as pct_of_trr_est_retail,
       rc.retail_now, round(100.0*t.price/nullif(rc.retail_now,0),1) as pct_of_current_retail
from trr_item_reads t left join v_retail_current rc on rc.house=t.house and rc.model=t.model_guess;

-- Held-value scoreboard: latest snapshot, all sources pooled
drop view if exists v_retention_scoreboard;
create view v_retention_scoreboard as
select house, model, reference_size, retail_now,
       sum(n_listings) as n_listings,
       round(sum(median_ask*n_listings)/sum(n_listings)) as wtd_median_ask,
       round(100.0*sum(median_ask*n_listings)/sum(n_listings)/retail_now,1) as retention_pct,
       group_concat(source||':'||retention_vs_current_retail_pct||'%', ' ') as by_source
from v_retail_vs_resale_asks
where snapshot_date=(select max(snapshot_date) from resale_snapshots) and retail_now is not null
group by house, model order by retention_pct desc;

-- Disappearance proxy (delisted between consecutive snapshots), ONLY for brand collections that paginated to the end.
drop view if exists v_disappearance;
create view v_disappearance as
with dates as (select source, snapshot_date, lag(snapshot_date) over (partition by source order by snapshot_date) prev
               from (select distinct source, snapshot_date from resale_snapshots)),
pairs as (select * from dates where prev is not null),
ok as (select source, brand, snapshot_date from collector_runs where complete=1)
select p.source, l.brand, l.model_guess as model, p.prev as from_date, p.snapshot_date as to_date,
       count(*) as listed_before,
       sum(b.id is null) as gone,
       round(100.0*sum(b.id is null)/count(*),1) as pct_gone,
       julianday(p.snapshot_date)-julianday(p.prev) as days
from pairs p
join resale_snapshots a on a.source=p.source and a.snapshot_date=p.prev
join v_bag_listings l on l.source=a.source and l.source_product_id=a.source_product_id
join ok on ok.source=p.source and ok.brand=l.brand and ok.snapshot_date=p.snapshot_date
left join resale_snapshots b on b.source=a.source and b.source_product_id=a.source_product_id and b.snapshot_date=p.snapshot_date
where l.model_guess<>''
group by p.source, l.brand, l.model_guess, p.prev, p.snapshot_date
having listed_before>=15;

-- SIZE-MATCHED retention: compare the reference size's retail only with listings whose size_guess matches it.
-- size key = first number in the spec (Birkin "30 Togo" → 30, Speedy "Bandoulière 25" → 25) else the first size word.
drop view if exists v_retail_current_sized;
create view v_retail_current_sized as
select rc.house, rc.model, rc.retail_now, rc.size_or_spec, coalesce(rr.size_key,'') as size_key
from v_retail_current rc
join retail_reference rr on rr.house=rc.house and rr.model=rc.model and rr.size_or_spec=rc.size_or_spec and rr.price_type='current' and rr.is_reference_size=1
group by rc.house, rc.model;

drop view if exists v_retention_scoreboard_sized;
create view v_retention_scoreboard_sized as
with latest as (select source, max(snapshot_date) d from resale_snapshots group by source),
snap as (
  select l.brand house, l.model_guess model, l.source, s.price,
         row_number() over (partition by l.brand, l.model_guess order by s.price) rn,
         count(*) over (partition by l.brand, l.model_guess) n
  from resale_snapshots s join latest on latest.source=s.source and latest.d=s.snapshot_date
  join v_bag_listings l on l.source=s.source and l.source_product_id=s.source_product_id
  join v_retail_current_sized rc on rc.house=l.brand and rc.model=l.model_guess
  where s.price is not null and rc.size_key<>'' and (lower(l.size_guess)=lower(rc.size_key) or l.size_guess=rc.size_key)
)
select sn.house, sn.model, rc.size_key as matched_size, rc.retail_now, sn.n as n_listings_same_size,
       round(avg(sn.price)) as median_ask_same_size,
       round(100.0*avg(sn.price)/rc.retail_now,1) as retention_pct_same_size
from snap sn join v_retail_current_sized rc on rc.house=sn.house and rc.model=sn.model
where sn.rn in ((sn.n+1)/2, (sn.n+2)/2)
group by sn.house, sn.model having n_listings_same_size>=5
order by retention_pct_same_size desc;
