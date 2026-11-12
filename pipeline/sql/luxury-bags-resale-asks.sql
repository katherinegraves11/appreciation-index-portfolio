-- luxury-bags-resale-asks.sql — Bag Index asking-price aggregates
-- DB: db/luxury_bags.db  (tables resale_listings, resale_snapshots; built by scrapers/resale_asks.py)
-- Run:  sqlite3 -header -column "db/luxury_bags.db" < sql/luxury-bags-resale-asks.sql
-- All queries return AGGREGATES only. SQLite has no median(); we use the
-- window-function pattern (row_number vs count) and take the middle row(s).
-- Prices are current ASKS (not sold prices) in USD; price = cheapest variant.

.headers on
.mode column

-- Bag-only view: Rebag's bare-brand collections include jewelry/apparel/shoes, and a
-- "Kelly" bracelet or "Constance" belt would otherwise pollute the bag medians.
create temp view bags as
select * from resale_listings
where price is not null
  and not (
    lower(coalesce(product_type,'')) like '%apparel%'  or lower(product_type) like '%shoe%'
    or lower(product_type) like '%earring%'  or lower(product_type) like '%bracelet%'
    or lower(product_type) like '%necklace%' or lower(product_type) like 'ring%'
    or lower(product_type) like '%brooch%'   or lower(product_type) like '%pendant%'
    or lower(product_type) like '%accessor%' or lower(product_type) like '%dress%'
    or lower(product_type) like '%wallet%'   or lower(product_type) = 'belts'
    or lower(product_type) like '%cufflink%' or lower(product_type) like '%hat%'
    or lower(product_type) like '%skirt%'    or lower(product_type) like '%leather goods%'
    or lower(product_type) like '%sunglass%' or lower(product_type) like '%jacket%'
    or lower(product_type) = 'cuff'          or lower(product_type) like '%tops%'
    or lower(product_type) like '%pants%'    or lower(product_type) like '%jumpsuit%'
    or lower(product_type) = 'watch'         or lower(product_type) like '%matching%'
    or lower(product_type) like '%cosmetic%' or lower(product_type) like '%garment%'
  );

------------------------------------------------------------------------------
-- 0. Listing counts per source (and how many resolved to a model family)
------------------------------------------------------------------------------
select source,
       count(*)                                        as listings,
       sum(price is not null)                          as priced,
       sum(model_guess is not null)                    as with_model,
       round(100.0*sum(model_guess is not null)/count(*),1) as pct_with_model,
       min(last_seen)                                  as last_seen
from resale_listings
group by source order by listings desc;

------------------------------------------------------------------------------
-- 1. Median / min / max ask per brand per source (bags only)
------------------------------------------------------------------------------
with ranked as (
  select source, brand, price,
         row_number() over (partition by source, brand order by price) as rn,
         count(*)    over (partition by source, brand)                as n
  from bags
  where brand is not null
)
select source, brand, n as listings,
       round(avg(case when rn in ((n+1)/2, (n+2)/2) then price end)) as median_ask,
       min(price) as min_ask, max(price) as max_ask
from ranked
group by source, brand
having n >= 5
order by brand, source;

------------------------------------------------------------------------------
-- 2. Median ask per model_guess per source (bags only: exclude obvious non-bag types)
------------------------------------------------------------------------------
with ranked as (
  select source, brand, model_guess, price,
         row_number() over (partition by source, brand, model_guess order by price) as rn,
         count(*)    over (partition by source, brand, model_guess)         as n
  from bags
  where model_guess is not null
)
select brand, model_guess, source, n as listings,
       round(avg(case when rn in ((n+1)/2, (n+2)/2) then price end)) as median_ask,
       min(price) as min_ask, max(price) as max_ask
from ranked
group by source, brand, model_guess
having n >= 3
order by brand, model_guess, source;

------------------------------------------------------------------------------
-- 3. Cross-source spread per model: max(median) - min(median) across sources
--    (only models priced on >= 2 sources with >= 3 listings each)
------------------------------------------------------------------------------
with ranked as (
  select source, brand, model_guess, price,
         row_number() over (partition by source, brand, model_guess order by price) as rn,
         count(*)    over (partition by source, brand, model_guess)         as n
  from bags
  where model_guess is not null
), med as (
  select source, brand, model_guess, n,
         avg(case when rn in ((n+1)/2, (n+2)/2) then price end) as median_ask
  from ranked group by source, brand, model_guess having n >= 3
)
select brand, model_guess,
       count(*)                          as sources,
       sum(n)                            as listings,
       round(min(median_ask))            as low_median,
       round(max(median_ask))            as high_median,
       round(max(median_ask)-min(median_ask)) as spread_usd,
       round(100.0*(max(median_ask)-min(median_ask))/min(median_ask),1) as spread_pct,
       group_concat(source || '=' || round(median_ask), ' | ') as by_source
from med
group by brand, model_guess
having count(*) >= 2
order by spread_pct desc;

------------------------------------------------------------------------------
-- 4. Top 15 models by listing count, median ask per source side by side
------------------------------------------------------------------------------
with ranked as (
  select source, brand, model_guess, price,
         row_number() over (partition by source, brand, model_guess order by price) as rn,
         count(*)    over (partition by source, brand, model_guess)         as n
  from bags
  where model_guess is not null
), med as (
  select source, brand, model_guess, n,
         avg(case when rn in ((n+1)/2, (n+2)/2) then price end) as median_ask
  from ranked group by source, brand, model_guess
)
select brand, model_guess, sum(n) as listings,
       round(max(case when source='fashionphile'         then median_ask end)) as fashionphile,
       round(max(case when source='rebag'                then median_ask end)) as rebag,
       round(max(case when source='madisonavenuecouture' then median_ask end)) as madison_ave,
       round(max(case when source='priveporter'          then median_ask end)) as prive_porter,
       round(max(case when source='tabvintage'           then median_ask end)) as tab_vintage
from med
group by brand, model_guess
order by listings desc
limit 15;

------------------------------------------------------------------------------
-- 5. Time series (grows with each run): median ask per model per snapshot_date
------------------------------------------------------------------------------
with s as (
  select l.brand, l.model_guess, sn.source, sn.snapshot_date, sn.price,
         row_number() over (partition by l.brand, l.model_guess, sn.source, sn.snapshot_date order by sn.price) as rn,
         count(*)    over (partition by l.brand, l.model_guess, sn.source, sn.snapshot_date) as n
  from resale_snapshots sn
  join bags l on l.source=sn.source and l.source_product_id=sn.source_product_id
  where sn.price is not null and l.model_guess is not null
)
select snapshot_date, source, brand, model_guess, n as listings,
       round(avg(case when rn in ((n+1)/2, (n+2)/2) then price end)) as median_ask
from s
group by snapshot_date, source, brand, model_guess
having n >= 5
order by model_guess, source, snapshot_date;
