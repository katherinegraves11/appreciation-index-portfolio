# Scan map — The Appreciation Index

The one schedule every scan follows and Ruth (appreciation-ops-manager) checks against. Each job lists when it runs, what it triggers, and the proof it leaves. Rules for every job: human pace (about 4 s per page), never sign in or bypass a paywall or CAPTCHA, derived data only (names, prices, counts, paraphrases; no images, captions or handles), every row keeps its source URL and date.

## 1. Every day

| Time (ET) | Job | What it does | Proof it leaves |
|---|---|---|---|
| 9:45 | Sourcer texts (`appreciation-sourcer-texts`) | New texts from Katie's luxury sourcer: bag photos paired with prices, boutique-via-sourcer vs sourcer price, purchases | resale_listings / retail_reference private rows, a SOURCES.md line |
| 10:40 | Daily scan (`appreciation-index-daily`) | The RealReal sold and new tiles; Ask TRR; FWRD (Mondays); buzz: Google, Instagram, TikTok, data accounts; Vogue Business trackers; news (step 3b below); WGSN; Vogue Runway in fashion-week mode; house and supply news; retail checks | findings/daily/<date>.md, a "## <date> — daily scan" line in SOURCES.md, .local/appreciation-index/last_run.txt |
| after each read | Social listening waterfall (step 7e) | Every moment a read surfaces (celebrity carry, designer move, viral video, dupe wave, WGSN colour or material call, price rise, collection drop) goes to Lena (appreciation-social-listener): fact-check with two sources, consumer talk on Google, Instagram, TikTok and the data accounts (style.analytics, databutmakeitfashion, secondsenseco, pursebop, purseblog), and asks, saves and sales before vs after | buzz_events and buzz_reads rows, findings/moments/<date>-<slug>.md |
| after the reads | Resale → boutique price match (step 3d) | Matches each recent resale listing to today's boutique price in our own catalogue (strict), else The RealReal's est. retail | resale_retail_match rows dated today; one digest line |
| after the reads | Connective tissue (step 7b) | Lines up willingness to pay and sales against culture for every tracked bag | findings/trends/<date>.md and .json |
| after the reads | Sourcer quotes (7c) | Logs every sourcer quote asked about in the tool | resale_listings rows, source private-sourcer-offer |
| 12:15, 3:15, 6:15, 9:15 | Watchdog (`appreciation-index-watchdog`) with Ruth | Checks every job on this map, restarts a stalled or missing scan, lists what needs Katie | findings/daily/watchdog.log, findings/ops/<date>.md |
| 17:00 | Panel (`appreciation-index-daily-panel`) | Customer and expert agents read the live tool; reading and design check | findings/panel/<date>.md, findings/panel/LOG.md |

## 2. Every week

| When | Job | Proof |
|---|---|---|
| Monday, in the daily scan | FWRD Renew shelf | fwrd_renew_reads rows |
| Monday, in the daily scan | Secondhand sourcer sales sweep (7d): Jane Finds, Privé Porter, Madison Avenue Couture sold or placed pages; auction results pages | resale_listings rows, available=0 |
| Monday, in the daily scan | Google search history refresh (7b a) | search_interest rows with this week's date |
| Monday, in the daily scan | Retail sweep: each tracked house's US handbag category page, then any product page not read in 30 days (step 3c) | retail_availability_reads rows |
| Monday, 17:00 panel | Theo (appreciation-product-manager): one experiment at most | findings/experiments/LOG.md |
| Monday, in the daily scan | Madison Avenue Couture full read (7h): asks kept apart as new, pre-owned, vintage; listings gone since last Monday marked "gone at last ask" | resale_snapshots dated that Monday |
| Monday 08:08 | Weekly fashion brief email (`fashion-luxury-ai-weekly-brief`) | email sent, calendar holds |

## 3. Triggered scans

### A. A new collection drop
Trigger: the news step, a Vogue Business tracker item, WWD or Business of Fashion, Lena's social listening, or a house "new collection" page names a drop (for example "CHANEL COCO NEIGE 2026 is in boutiques").
Then, the same day:
1. Retail read (step 3c): the house's US handbag page and the collection page; open each bag's product page one at a time; record name, reference, price, availability. No images.
2. Social listening on the drop (Lena): what consumers and the fashion accounts say.
3. Press read: Vogue Business, WWD and Business of Fashion articles on the drop.
Proof: retail_availability_reads rows for that house dated that day, a moments file, daily_signals rows.

### B. Fashion weeks
Calendar (from FASHION_WEEK_PROTOCOL.md; confirm exact days on the CFDA, BFC, CNMI and FHCM calendars when published):
- Métiers d'Art: December 2026 (Chanel)
- Haute Couture, Paris: 25–29 January 2027; again early July 2027
- Fall/Winter 2027 ready-to-wear: 11 February – 10 March 2027, New York → London → Milan → Paris (Paris last, late February to early March)
- Cruise / Resort: May – June 2027
- Spring/Summer 2028 ready-to-wear: mid September – early October 2027, ending with Paris
During each window the daily scan switches to fashion-week mode:
1. Vogue Runway capture of every house that showed the day before (runway_pipeline).
2. Vogue Business, WWD and Business of Fashion reviews and "best bags" pieces (show_notes).
3. Lena's social listening on each house's show.
4. Heat reads at +7, +14, +30 and +90 days (v_runway_heat).
5. When the season lands in store (runway_pipeline.expected_in_store), trigger A for that house.
Proof: runway_pipeline and show_notes rows dated in the window, findings/fashion-week/<season>.md.

### C. Earnings and people moves
Earnings dates (earnings_calendar) → the house's results page; a creative director or CEO change (people_moves) → Lena's waterfall and the ownership map. Proof: house_financials, people_moves and stakeholder_decisions rows.

## 4. What only Katie can do
- Approve each scheduled task once (Scheduled tasks → the task → Run now), so it can run unattended.
- Keep Chrome open with the extension connected, signed in to Vogue Business, WGSN and Instagram.
- Say yes or no to anything that changes what customers see.
