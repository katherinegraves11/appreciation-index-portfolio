-- Supply-chain facts: per-house profile (aggregates only; never dump raw rows into context)
select house, parent_group, count(*) n,
  sum(category='tannery_ownership') tanneries, sum(category='workshop_capacity') workshops,
  sum(category='labor_probe') labor, sum(category='tariff_exposure') tariff,
  sum(category='price_increase') prices, sum(category='quality_signal') quality,
  max(fact_date) latest_fact, sum(confidence='high') high_conf
from supply_chain_facts group by house, parent_group order by n desc;

-- Open labor items (anything not marked RESOLVED in description)
select house, fact_date, substr(description,1,120) from supply_chain_facts
where category='labor_probe' and description not like '%RESOLVED%' order by fact_date desc;

-- Retail anchors moved in last 12 months
select house, fact_date, substr(description,1,160) from supply_chain_facts
where category='price_increase' and fact_date >= date('now','-12 months') order by fact_date desc;
