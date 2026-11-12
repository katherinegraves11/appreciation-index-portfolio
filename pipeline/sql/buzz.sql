-- THE BUZZ: cultural-moment layer (TikTok / Instagram / Pinterest / Google / YouTube / Reddit / press).
-- Derived numbers only. No images, captions, usernames or handles are ever stored.
-- Every row carries source_url + retrieved_at + method (how it was read).

create table if not exists buzz_terms(
  id integer primary key,
  house text not null,
  family text,                 -- bag_families.family or NULL for a house-level term
  platform text not null,      -- tiktok-cc | tiktok | instagram | pinterest | google | youtube | reddit | press
  term text not null,          -- hashtag without '#', or search phrase
  kind text not null,          -- hashtag | search
  priority int default 2,      -- 1 = read daily, 2 = rotate (every 3 days), 3 = weekly
  active int default 1,
  added_on text default (date('now','localtime')),
  unique(platform, term)
);

create table if not exists buzz_reads(
  id integer primary key,
  read_date text not null,     -- local date of the read
  platform text not null,
  term text not null,
  metric text not null,        -- posts_total | posts_7d | views_7d | views_30d | rank_7d | growth_pct_7d | interest_0_100 | videos_7d | views_top10 | mentions_7d | theme_share_<theme>
  value real,
  window_days int,             -- 7 / 30 / 120 / null for a point-in-time total
  region text default 'US',
  method text not null,        -- chrome-human | api-official | pytrends | manual
  source_url text not null,
  retrieved_at text not null,
  note text,                   -- one-line mood, derived (e.g. 'top 9: 5 outfit, 3 unboxing, 1 dupe')
  unique(read_date, platform, term, metric, window_days, region)
);

create table if not exists buzz_events(
  id integer primary key,
  event_date text not null,
  house text not null,
  family text,
  event_type text not null,    -- celebrity_carry | viral_video | press_cycle | backlash | dupe_wave | museum | met_gala | documentary | collab | campaign
  derived_note text not null,  -- what happened, in our words; no handles
  reach_band text,             -- '<100k' | '100k-1m' | '1m-10m' | '>10m' (creator or outlet reach, banded)
  source_url text not null,
  retrieved_at text not null
);

create index if not exists ix_buzz_reads_term on buzz_reads(platform, term, read_date);
create index if not exists ix_buzz_events_house on buzz_events(house, event_date);

-- Latest value per platform/term/metric
drop view if exists v_buzz_latest;
create view v_buzz_latest as
select r.* from buzz_reads r
join (select platform, term, metric, coalesce(window_days,0) w, coalesce(region,'') g, max(read_date) d
      from buzz_reads group by 1,2,3,4,5) m
  on m.platform=r.platform and m.term=r.term and m.metric=r.metric
 and coalesce(r.window_days,0)=m.w and coalesce(r.region,'')=m.g and r.read_date=m.d;

-- Week-over-week change per platform/term/metric (latest vs the read closest to 7 days earlier)
drop view if exists v_buzz_trend;
create view v_buzz_trend as
with l as (select * from v_buzz_latest),
p as (select r.platform, r.term, r.metric, coalesce(r.window_days,0) w, coalesce(r.region,'') g, r.value, r.read_date,
             row_number() over (partition by r.platform, r.term, r.metric, coalesce(r.window_days,0), coalesce(r.region,'')
                                order by abs(julianday(r.read_date) - (julianday((select max(read_date) from buzz_reads x where x.platform=r.platform and x.term=r.term and x.metric=r.metric)) - 7))) rn
      from buzz_reads r)
select l.platform, l.term, l.metric, l.window_days, l.region, l.read_date, l.value as latest,
       p.read_date as prior_date, p.value as prior,
       case when p.value is not null and p.value<>0 and p.read_date<>l.read_date then round(100.0*(l.value-p.value)/p.value,1) end as pct_change
from l left join p on p.platform=l.platform and p.term=l.term and p.metric=l.metric
  and p.w=coalesce(l.window_days,0) and p.g=coalesce(l.region,'') and p.rn=1;

-- Buzz score 0-100 per (house, family): direction-weighted, platform-balanced.
-- Each platform contributes a sub-score from its best available metric; the composite is the mean of the platforms we have.
drop view if exists v_buzz_score;
create view v_buzz_score as
with t as (
  select bt.house, bt.family, bt.platform, bt.term, v.metric, v.latest, v.pct_change
  from buzz_terms bt join v_buzz_trend v on v.platform=bt.platform and v.term=bt.term
  where bt.active=1
),
plat as (
  select house, family, platform,
    -- level: log scale of volume where we have it; growth: capped +/-100%
    max(case when metric in ('views_7d','posts_7d','videos_7d','mentions_7d','interest_0_100','posts_total','views_top10') then latest end) as level,
    -- growth: a platform's own growth metric when it has one (Google week-over-week), else change between our reads
    coalesce(avg(case when metric='growth_pct_7d' then max(-100, min(100, latest)) end),
             avg(case when metric in ('views_7d','posts_7d','videos_7d','mentions_7d','interest_0_100','posts_total','views_top10','rank_7d')
                      then max(-100, min(100, case when metric='rank_7d' then -1*pct_change else pct_change end)) end)) as growth
  from t group by 1,2,3
),
sub as (
  select house, family, platform,
    round(min(100, max(0,
      50 + coalesce(growth,0)*0.35                       -- rising = above 50, falling = below
        + case when level is null then 0 else min(15, 3*log10(max(level,1))) end)) ) as sub_score,
    growth, level
  from plat
)
select house, family,
       round(avg(sub_score)) as buzz_0_100,
       count(*) as platforms,
       group_concat(platform||':'||cast(sub_score as int)||case when growth is null then '' else '('||(case when growth>0 then '+' else '' end)||cast(round(growth) as int)||'%)' end, ' ') as detail,
       case when avg(growth) > 15 then 'rising' when avg(growth) < -15 then 'fading' else 'steady' end as direction
from sub group by 1,2;
