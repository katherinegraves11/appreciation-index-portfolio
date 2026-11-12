-- Item trajectories on The RealReal (from trr_item_reads; one row per listing slug)
-- Items seen more than once, or sold, or sold-then-relisted:
select house, model_guess, condition, times_seen, first_seen, first_price, last_seen, last_price,
       pct_change_since_first, sold_price, relisted_date, relist_price, trajectory
from item_trajectories
where times_seen >= 2 or trajectory != 'unchanged'
order by house, model_guess, first_seen;

-- Per model: how often listings end in a markdown, a sale, or a relist
select house, model_guess, count(*) as items,
       sum(trajectory='marked down') as marked_down, sum(trajectory='sold') as sold,
       sum(trajectory like 'sold →%') as relisted, round(avg(pct_change_since_first),1) as avg_pct_change
from item_trajectories group by house, model_guess having items >= 3 order by items desc;

-- Sold above estimated retail, then what happened next
select slug, house, model_guess, est_retail, sold_price, round(100.0*sold_price/nullif(est_retail,0)) as sold_pct_of_retail,
       relisted_date, relist_price, trajectory
from item_trajectories where sold_price is not null and est_retail is not null and sold_price > est_retail
order by sold_pct_of_retail desc;
