# THE BUZZ — cultural-moment layer

**What it answers:** is this bag (or house) having a moment right now, is the moment rising or fading, and what kind of moment is it (outfit, unboxing, dupe wave, resale flip, backlash)?
**Where it shows up:** the social layer of every brief (25% of the composite), the "Buzz" line under the numbers strip, the race board's heat axis (planned), and the pre-order / collection-timing answer.

## Architecture

```
buzz_terms  (what we watch)      332 terms: 16 houses + tracked bag families × platform × hashtag/search phrase, priority 1 daily / 2 rotate / 3 weekly
     │
     ├─ automated, no login ──► scrapers/buzz/google_trends.py   (pytrends; interest_0_100 within batch + growth_pct_7d)      ✅ running
     │                          scrapers/buzz/youtube.py         (official Data API; videos_7d, views_top10)  needs YOUTUBE_API_KEY
     │                          scrapers/buzz/reddit.py          (official Data API; mentions/upvotes/comments 7d)  needs Reddit app creds
     │
     ├─ human-pace browser ───► TikTok tag pages  (public, logged out: top posts visible, counts hidden)  → theme shares, posts_visible
     │   (Claude in Katie's      TikTok Creative Center (needs a TikTok for Business login)  → posts_7d, views_7d, rank_7d, growth_pct_7d
     │    Chrome or built-in     Instagram tag pages (Katie's Chrome)  → posts_total + themes of top 9
     │    browser, one page      Instagram data accounts (7)  → buzz_events / daily_signals, chart numbers only
     │    at a time)             Pinterest Trends (public)  → interest_0_100, growth
     │
     └─ press / editorial ────► buzz_events  (celebrity carry, viral video, dupe wave, backlash, campaign) with reach band and source
     │
buzz_reads  (one derived number per read; unique per day/platform/term/metric/window/region)
     │
v_buzz_latest → v_buzz_trend (week-over-week) → v_buzz_score (0–100 per house / family, direction rising|steady|fading)
     │
bag-index app: tracker.buzzNumbers() → Buzz line + "Tracker: buzz" evidence in the social layer
```

**Score (0–100):** per platform `50 + 0.35 × growth% (capped ±100) + up to 15 points for volume (log scale)`; the composite is the mean across the platforms we have. Above ~65 with "rising" = a moment; below 40 = fading. One platform alone is a weak read; the app says how many platforms are behind the number.

## Rules (non-negotiable)
- Derived numbers only. Never store captions, images, image links, usernames or handles. `ingest.py` refuses a note containing `@`.
- Every row: `source_url`, `retrieved_at`, `method` (chrome-human | api-official | pytrends | manual).
- Human pace: one tab, one page at a time, read it, write the row, move on. No scrolling loops, no saved HTML dumps.
- Never log in for Katie, never create accounts, never bypass a login wall, CAPTCHA or rate limit. If a page asks to log in, record `note='login wall'` and stop.
- No X/Twitter for now (paid API; Katie does not use it).

## Daily routine (inside `appreciation-index-daily`, ~15 minutes)
1. `python3 scrapers/buzz/google_trends.py 1,2` (≈3 min, unattended). If a batch fails with 429, wait 60 s and rerun once.
2. `python3 scrapers/buzz/youtube.py 1,2` and `python3 scrapers/buzz/reddit.py` — they skip themselves until credentials exist.
3. TikTok, human pace, priority-1 hashtags (`select term from buzz_terms where platform='tiktok-cc' and priority=1`):
   - If Katie's Chrome is signed in to TikTok for Business: open `https://ads.tiktok.com/creative/creativeCenter/trends/hashtag?period=7&region=US`, search the hashtag, record posts, views, rank, growth → `ingest.py --platform tiktok-cc --metric posts_7d|views_7d|rank_7d|growth_pct_7d --window 7`.
   - Otherwise: open `https://www.tiktok.com/tag/<term>` (public). Count the visible top posts by theme (reseller | unboxing | outfit | dupe | is-it-worth-it | quality-complaint | runway/press) → `theme_share_<theme>` rows and `posts_visible`.
4. Instagram, in Katie's Chrome, priority-1 hashtags: `instagram.com/explore/tags/<term>/` → `posts_total` (the count under the tag) + theme shares of the top 9. Then the 7 data accounts (style.analytics, databutmakeitfashion, secondsenseco, puckdotnews, pursebop, purseblog, allthingsfashiontech), posts newer than the last scan only → `buzz_events` or `daily_signals` with the chart's numbers, never the caption.
5. Rotate: priority-2 terms every third day (day-of-month mod 3), priority-3 on Mondays. Pinterest Trends on Mondays.
6. Any bag asked about in yesterday's briefs (`ls ~/Desktop/bag-index/.data/briefs`) gets its terms read that day even if not priority 1.
7. Finish: `sqlite3 db/luxury_bags.db < sql/buzz.sql` (refreshes views), and put the top three movers from `v_buzz_score` in the daily digest.

## Gen Z specificity (Katie, 2026-10-19)
The buzz board shows three strips: **hashtags people are posting** (counts, and week-over-week change once two reads exist), **events people are talking about** (`buzz_events`), and **going viral** (`daily_signals` rows from the Vogue Business TikTok Trend Tracker, the Instagram data accounts, and TikTok tag reads with signal `tiktok_trend`). Culture-wide tags (house = 'Culture', priority 1): bagtok, whatsinmybag, luxurytok, luxuryresale, pursecollector, dupe, designerdupe, quietluxury, oldmoneyaesthetic, unboxing, chanelunboxing, birkinunboxing, vintagebags. Daily: read these on TikTok and Instagram; when a trend format names a bag or house (a sound, a challenge, a dupe wave, an unboxing run), log one `daily_signals` row with signal `tiktok_trend`, house = the house or 'Culture', and the view or post count in the note. No handles.

## Fashion-week mode
During and 30 days after a fashion month, add the show's own hashtags (`chanelss27`, `#parisfashionweek` + house) to priority 1, and log each editor pick, celebrity carry and viral runway clip as a `buzz_events` row with a reach band. This is how a collection gets a buzz read before any bag has sold.

## What Katie can set up to make this stronger (all free, all official, all hers)
1. **TikTok for Business account** (ads.tiktok.com, free, no ad spend) → unlocks the full Creative Center hashtag table, hashtag search, 7/30/120-day views and growth, by country. Sign in once in Chrome; the daily task reads it at human pace.
2. **A dedicated Instagram Professional account** ("Appreciation Index", Creator or Business type) linked to a Facebook Page → the official Instagram Graph API Hashtag Search: 30 hashtags per week, post counts and top/recent media for each. Then `scrapers/buzz/instagram_graph.py` can run unattended. Until then Instagram is read in Chrome.
3. **YouTube Data API key** (console.cloud.google.com → new project → enable YouTube Data API v3 → create API key → `export YOUTUBE_API_KEY=...` in ~/.zshrc). Ten minutes; unlocks `youtube.py` immediately.
4. **Reddit script app** (reddit.com/prefs/apps → create app, type "script") → four env vars → `reddit.py`. r/handbags, r/Hermes, r/chanel, r/TheRealReal are the most candid "is it worth it" conversations online.
5. **TikTok Research API** (developers.tiktok.com/products/research-api): academic access through Cornell; takes weeks, but gives hashtag-level video counts and views officially. Worth applying.

Value-retention analysis based on public market data, not investment advice.
