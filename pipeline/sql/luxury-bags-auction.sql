-- luxury-bags-auction.sql — saved queries over luxury_bags.db:auction_results
-- (built by scrapers/auction_results.py; Bonhams + Artcurial, derived fields only).
-- Run: sqlite3 -header -column "db/luxury_bags.db" < sql/luxury-bags-auction.sql
-- NOTE: currencies are mixed (HKD, EUR, GBP, USD). Every price query groups by currency;
-- convert with api.frankfurter.dev rates before comparing across houses.

.headers on
.mode column

-- 1. Coverage: rows, sell-through and date range per auction house
SELECT auction_house, currency, count(*) AS lots,
       sum(sold=1) AS sold, sum(sold=0) AS unsold,
       round(100.0*sum(sold=1)/count(*),1) AS sell_through_pct,
       min(sale_date) AS first_sale, max(sale_date) AS last_sale
FROM auction_results
GROUP BY 1,2 ORDER BY 1,2;

-- 2. Median hammer by house / model / size / sale year (SQLite has no MEDIAN: use row_number
--    over the ordered partition and pick the middle row(s)).
WITH s AS (
  SELECT house, model_guess, size_guess, substr(sale_date,1,4) AS yr, currency, hammer_price,
         row_number() OVER (PARTITION BY house, model_guess, size_guess, substr(sale_date,1,4), currency ORDER BY hammer_price) AS rn,
         count(*)     OVER (PARTITION BY house, model_guess, size_guess, substr(sale_date,1,4), currency) AS n
  FROM auction_results WHERE sold=1 AND hammer_price IS NOT NULL AND model_guess IS NOT NULL
)
SELECT house, model_guess, size_guess, yr, currency, n AS sold_lots,
       round(avg(hammer_price)) AS median_hammer
FROM s WHERE rn IN ((n+1)/2, (n+2)/2)
GROUP BY 1,2,3,4,5 HAVING n >= 2
ORDER BY sold_lots DESC, house, model_guess, yr;

-- 3. Sell-through rate by sale (house x sale_name x date)
SELECT auction_house, sale_name, sale_date, count(*) AS lots, sum(sold=1) AS sold,
       round(100.0*sum(sold=1)/count(*),1) AS sell_through_pct
FROM auction_results GROUP BY 1,2,3 ORDER BY sale_date DESC;

-- 4. Hammer vs estimate midpoint (ratio > 1 = beat the midpoint), by house and model
SELECT house, model_guess, currency, count(*) AS sold_lots,
       round(avg(hammer_price / ((estimate_low+estimate_high)/2.0)),2) AS avg_hammer_to_mid,
       round(100.0*sum(hammer_price > estimate_high)/count(*),1) AS pct_above_high_est,
       round(100.0*sum(hammer_price < estimate_low)/count(*),1)  AS pct_below_low_est
FROM auction_results
WHERE sold=1 AND hammer_price IS NOT NULL AND estimate_low > 0 AND estimate_high > 0
GROUP BY 1,2,3 HAVING sold_lots >= 3 ORDER BY sold_lots DESC;

-- 5. Top models by auction count with median hammer and year range (report table)
WITH s AS (
  SELECT house, model_guess, currency, hammer_price, substr(sale_date,1,4) AS yr,
         row_number() OVER (PARTITION BY house, model_guess, currency ORDER BY hammer_price) AS rn,
         count(*)     OVER (PARTITION BY house, model_guess, currency) AS n
  FROM auction_results WHERE sold=1 AND hammer_price IS NOT NULL AND model_guess IS NOT NULL
), med AS (
  SELECT house, model_guess, currency, round(avg(hammer_price)) AS median_hammer
  FROM s WHERE rn IN ((n+1)/2, (n+2)/2) GROUP BY 1,2,3
)
SELECT a.house, a.model_guess, count(*) AS lots_offered, sum(a.sold=1) AS sold, a.currency,
       m.median_hammer, min(substr(a.sale_date,1,4)) || '-' || max(substr(a.sale_date,1,4)) AS years
FROM auction_results a LEFT JOIN med m ON m.house=a.house AND m.model_guess=a.model_guess AND m.currency=a.currency
WHERE a.model_guess IS NOT NULL
GROUP BY 1,2,5 ORDER BY lots_offered DESC LIMIT 15;

-- 6. Colour / hardware mix of SOLD Hermès lots (derived tags; approximate)
SELECT colour, count(*) AS sold_lots FROM auction_results
WHERE sold=1 AND house='Hermès' AND colour IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 15;
