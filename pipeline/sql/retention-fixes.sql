-- 2026-10-21 fixes from the pressure test (advisor + sourcer):
--  * v_sold_vs_retail: plain-spec, wearable-condition sales only; Cassette compares padded to padded; model must be a whole word in the title
--  * v_disappearance: drop priveporter (its snapshots never remove items, so every house read "0% cleared")
drop view if exists v_sold_vs_retail;
create view v_sold_vs_retail as
with rc as (select house, model, retail_now, size_key, size_or_spec from v_retail_current_sized),
s as (
  select t.house, t.model_guess model, t.price, t.read_date, t.condition,
         rc.retail_now, rc.size_key,
         case when rc.size_key='' then 1
              when rc.size_key glob '[0-9]*' then (t.title like '% '||rc.size_key||' %' or t.title like '% '||rc.size_key||',%' or t.title like '%'||rc.size_key||'cm%' or t.title like '% '||rc.size_key)
              else lower(t.title) like '%'||lower(rc.size_key)||'%' end as sized
  from trr_item_reads t join rc on rc.house=t.house and lower(rc.model)=lower(t.model_guess)
  where t.sold=1 and t.price is not null
    -- every word of the model (ignoring the house name) must appear in the title: 'Classic Flap' matches 'Classic Medium Double Flap Bag'
    and (lower(substr(rc.model,1,instr(rc.model||' ',' ')-1)) = lower(rc.house) or lower(t.title) like '%'||lower(substr(rc.model,1,instr(rc.model||' ',' ')-1))||'%')
    and (instr(rc.model,' ')=0 or lower(t.title) like '%'||lower(trim(substr(rc.model, instr(rc.model,' ')+1)))||'%')
    and coalesce(t.condition,'') not in ('As Is','Fair')
    and lower(t.title) not like '%crocodile%' and lower(t.title) not like '%alligator%' and lower(t.title) not like '%ostrich%' and lower(t.title) not like '%lizard%' and lower(t.title) not like '%porosus%' and lower(t.title) not like '%niloticus%'
    and lower(t.title) not like '%métiers%' and lower(t.title) not like '%metiers%' and lower(t.title) not like '%cheetah%' and lower(t.title) not like '%pony%'
    and lower(t.title) not like '%sequin%' and lower(t.title) not like '%strass%' and lower(t.title) not like '%velvet%' and lower(t.title) not like '%tweed%' and lower(t.title) not like '%denim%' and lower(t.title) not like '%raffia%' and lower(t.title) not like '%shearling%' and lower(t.title) not like '%vintage%' and lower(t.title) not like '%limited%'
    and (lower(rc.model) <> 'cassette' or lower(t.title) like '%padded%')
),
ranked as (select *, row_number() over (partition by house, model order by price) rn, count(*) over (partition by house, model) n from s where sized=1)
select r.house, r.model, r.size_key as matched_size, r.retail_now, r.n as n_sold_same_size,
       round(avg(r.price)) as median_sold, round(100.0*avg(r.price)/r.retail_now,1) as sold_pct_of_retail,
       max(r.read_date) as last_read
from ranked r where r.rn in ((r.n+1)/2,(r.n+2)/2) group by r.house, r.model having n_sold_same_size>=3 order by sold_pct_of_retail desc;

drop view if exists v_disappearance;
create view v_disappearance as
with dates as (select source, snapshot_date, lag(snapshot_date) over (partition by source order by snapshot_date) prev
               from (select distinct source, snapshot_date from resale_snapshots where source <> 'priveporter')),
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
where l.model_guess<>'' and p.source <> 'priveporter'
group by p.source, l.brand, l.model_guess, p.prev, p.snapshot_date
having listed_before>=15;

-- 2026-10-22 (Dee's pressure test): price floor so small leather goods never count as a sale of the bag
drop view if exists v_sold_vs_retail;
CREATE VIEW v_sold_vs_retail as
with rc as (select house, model, retail_now, size_key, size_or_spec from v_retail_current_sized),
s as (
  select t.house, t.model_guess model, t.price, t.read_date, t.condition,
         rc.retail_now, rc.size_key,
         case when rc.size_key='' then 1
              when rc.size_key glob '[0-9]*' then (t.title like '% '||rc.size_key||' %' or t.title like '% '||rc.size_key||',%' or t.title like '%'||rc.size_key||'cm%' or t.title like '% '||rc.size_key)
              else lower(t.title) like '%'||lower(rc.size_key)||'%' end as sized
  from trr_item_reads t join rc on rc.house=t.house and lower(rc.model)=lower(t.model_guess)
  where t.sold=1 and t.price is not null
    -- every word of the model (ignoring the house name) must appear in the title: 'Classic Flap' matches 'Classic Medium Double Flap Bag'
    and (lower(substr(rc.model,1,instr(rc.model||' ',' ')-1)) = lower(rc.house) or lower(t.title) like '%'||lower(substr(rc.model,1,instr(rc.model||' ',' ')-1))||'%')
    and (instr(rc.model,' ')=0 or lower(t.title) like '%'||lower(trim(substr(rc.model, instr(rc.model,' ')+1)))||'%')
    and coalesce(t.condition,'') not in ('As Is','Fair')
    and lower(t.title) not like '%crocodile%' and lower(t.title) not like '%alligator%' and lower(t.title) not like '%ostrich%' and lower(t.title) not like '%lizard%' and lower(t.title) not like '%porosus%' and lower(t.title) not like '%niloticus%'
    and lower(t.title) not like '%métiers%' and lower(t.title) not like '%metiers%' and lower(t.title) not like '%cheetah%' and lower(t.title) not like '%pony%'
    and lower(t.title) not like '%sequin%' and lower(t.title) not like '%strass%' and lower(t.title) not like '%velvet%' and lower(t.title) not like '%tweed%' and lower(t.title) not like '%denim%' and lower(t.title) not like '%raffia%' and lower(t.title) not like '%shearling%' and lower(t.title) not like '%vintage%' and lower(t.title) not like '%limited%'
    and (lower(rc.model) <> 'cassette' or lower(t.title) like '%padded%')
    -- small leather goods misfiled under a bag model (card cases, coin purses at a tenth of the bag's price) never count as a sale of the bag
    and t.price >= 0.15 * rc.retail_now
),
ranked as (select *, row_number() over (partition by house, model order by price) rn, count(*) over (partition by house, model) n from s where sized=1)
select r.house, r.model, r.size_key as matched_size, r.retail_now, r.n as n_sold_same_size,
       round(avg(r.price)) as median_sold, round(100.0*avg(r.price)/r.retail_now,1) as sold_pct_of_retail,
       max(r.read_date) as last_read
from ranked r where r.rn in ((r.n+1)/2,(r.n+2)/2) group by r.house, r.model having n_sold_same_size>=3 order by sold_pct_of_retail desc;
