#!/usr/bin/env python3
"""One-page architecture of The Appreciation Index: sources to collectors (with run times) to database to analysis to outputs."""
import matplotlib; matplotlib.use("Agg"); matplotlib.rcParams["text.parse_math"] = False
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
OUT = "/Users/katiegraves/Desktop/Fashion Data Lab/exports/bag_index_architecture.png"
PAPER, INK, INK2, INK3, RULE, PANEL = "#fbfaf7", "#141311", "#55524c", "#8a867e", "#d9d5cc", "#f1eee7"
CHROME, SCRIPT, ONDEMAND, DB, OUTC = "#1f4e9c", "#0f7a5a", "#c2451e", "#141311", "#8a5a1e"
SERIF, SANS = "Didot", "Helvetica Neue"
fig = plt.figure(figsize=(14, 15), dpi=180); fig.patch.set_facecolor(PAPER)
ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, 100); ax.set_ylim(0, 100); ax.axis("off")

def box(x, y, w, h, title, lines, color, fill=PANEL, title_size=10.5, body_size=8.6, lw=1.2):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=0.6", fc=fill, ec=color, lw=lw))
    ax.add_patch(plt.Rectangle((x, y + h - 0.35), w, 0.35, fc=color, ec="none"))
    ax.text(x + 1, y + h - 1.1, title, fontname=SANS, fontsize=title_size, weight="bold", color=INK, va="top")
    ax.text(x + 1, y + h - 2.6, "\n".join(lines), fontname=SANS, fontsize=body_size, color=INK2, va="top", linespacing=1.35)
def arrow(x1, y1, x2, y2, color=INK3):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>", mutation_scale=12, color=color, lw=1.1, shrinkA=2, shrinkB=2))
def band(y, label):
    ax.text(2, y, label, fontname=SANS, fontsize=8.5, weight="bold", color=INK3, va="center")
    ax.plot([2, 98], [y - 0.9, y - 0.9], color=RULE, lw=0.8)

# masthead
ax.text(2, 97.6, "THE APPRECIATION INDEX  ·  HOW IT RUNS", fontname=SANS, fontsize=9.5, weight="bold", color=INK2, va="center")
ax.text(98, 97.6, "KATIE'S FASHION DATA LAB  ·  OCTOBER 2026", fontname=SANS, fontsize=9.5, weight="bold", color=INK2, va="center", ha="right")
ax.plot([2, 98], [96.6, 96.6], color=INK, lw=1)
ax.text(2, 94.6, "Five layers, one database, four clocks.", fontname=SERIF, fontsize=24, color=INK, va="top")
ax.text(2, 91.4, "Sources at the top feed collectors in the middle. Everything lands in one SQLite file. Analysis views and the app read from it; nothing writes to it except the collectors.\n"
        "Blue boxes read through your Chrome and only run while the laptop is open. Green boxes are plain scripts. Orange boxes run when you ask.",
        fontname=SANS, fontsize=9.3, color=INK2, va="top", linespacing=1.4)

# LAYER 1 sources
band(87.2, "1 · SOURCES")
box(2, 76.5, 30, 9.5, "Behind your logins (read via Chrome)", ["Vogue Runway details galleries", "Vogue Business People Moves + Funding trackers", "Puck Line Sheet · WGSN reports", "The RealReal (your account) · TikTok Creative Center", "Instagram data accounts · brand sites (price checks)"], CHROME)
box(34, 76.5, 30, 9.5, "Open web (scripts, no login)", ["Fashionphile · Rebag · Madison Avenue Couture", "Privé Porter · Tab Vintage (storefront JSON)", "Bonhams · Artcurial auction results", "Google Trends · fashion RSS headlines", "PurseBop / PurseBlog / press for retail prices"], SCRIPT)
box(66, 76.5, 32, 9.5, "You", ["Screenshots of sold items (logged as sales)", "Private Dior Cruise 27 decks (incoming inventory)", "Watchlist asks (Alaïa Teckel, long vs short strap)", "Questions that become briefs and charts"], ONDEMAND)

# LAYER 2 collectors with clocks
band(73.8, "2 · COLLECTORS  (local time; the scheduler adds a few minutes of jitter)")
box(2, 58.5, 23, 13.5, "10:15 am · daily", ["RUNWAY PIPELINE CAPTURE  (Chrome)", "", "New Vogue Runway 'Details' galleries for the", "16 tracked houses to every look with a bag,", "look number, shape, material, novelty.", "Resumes where it stopped (e.g. Prada look 28).", "writes: runway_pipeline"], CHROME)
box(26.5, 58.5, 23, 13.5, "11:30 am · daily", ["DAILY FASHION SIGNAL SCAN  (Chrome)", "", "Vogue Business trackers · Puck · 7 Instagram data", "accounts · TikTok Creative Center · The RealReal:", "4 designer pages/day, every tile, saves, badges,", "markdowns, sold · verify 3 retail prices on brand", "sites · watchlist · headlines · trajectories · digest", "writes: people_moves, funding_rounds, momentum,", "   trr_item_reads, retail_reference, daily_signals"], CHROME, body_size=8.2)
box(51, 58.5, 23, 13.5, "1:30 pm · daily", ["WGSN DAILY SCAN  (Chrome)", "", "A handful of new or backlog WGSN reports a day", "(consumer, TikTok/Instagram analytics, trend", "forecasts by age cohort) to derived signals only,", "no article text, cited as 'WGSN, report, date'.", "writes: wgsn_signals"], CHROME)
box(75.5, 58.5, 22.5, 13.5, "2:30 pm · 1st and 15th", ["RESALE REFRESH  (scripts + Chrome)", "", "Full-pagination asks from 5 resale sites,", "auction lots, 'listed then gone' sell-through,", "The RealReal 11 designers incl. sold, Hermès", "inventory in 5 countries, Teckel watchlist,", "retention scoreboard.", "writes: resale_listings, resale_snapshots,", "   collector_runs, auction_results"], SCRIPT, body_size=8.2)
box(2, 50.5, 96, 6.5, "On demand (when you ask, or when a brief needs them)", [
    "luxury-bag-investment-analyst: the research + scoring engine behind every brief; also writes sourced rows (retail price paths, supply-chain facts, creative-director history, scandals).",
    "Retail researchers fill retail_reference from brand sites and price guides (three ran Oct 2–3: 349 rows).   Chrome jobs on general-purpose agents: deep RealReal reads, Puck, runway backfill.",
    "Rules: one Chrome job at a time · every row carries source_url + retrieved_at · derived data only."], ONDEMAND, body_size=8.2)

# LAYER 3 database
band(47.5, "3 · ONE DATABASE")
box(2, 36.5, 96, 9.5, "luxury_bags.db  ·  ~/Desktop/Fashion Data Lab/db  ·  SQLite, open it in SQLiteStudio or Terminal", [
    "RETAIL  retail_reference (349 sourced US prices, 2021–2026 paths)   ·   RESALE  resale_listings + resale_snapshots (26k listings, 2 snapshots), trr_item_reads (610 RealReal tiles, incl. sold), resale_aggregates, auction_results (179)",
    "RUNWAY  runway_pipeline (742 looks), bag_families (34 Blazy families)   ·   CULTURE  momentum, wgsn_signals, daily_signals, people_moves, funding_rounds   ·   HOUSE  creative_directors, supply_chain_facts, history_events, macro_events",
    "PROVENANCE  bags, incoming_inventory (private Dior decks), watchlist   ·   HYGIENE  collector_runs (was each brand collection paginated to the end?), SOURCES.md (every host, its terms, request counts)"], DB, body_size=8.1)

# LAYER 4 analysis
band(33.5, "4 · ANALYSIS  (SQL views, re-computed on read; scripts re-run any time)")
box(2, 22.5, 31, 9.5, "Retail vs resale", ["v_retention_scoreboard_sized: median ask ÷ current", "retail, same size, bags only (jewellery filtered out)", "v_retail_history: what the bag cost each year since 2021", "v_retail_vs_resale_sold: RealReal sold ÷ retail", "v_blazy_catalogue: runway family to resale to retail"], SCRIPT)
box(34.5, 22.5, 31, 9.5, "Demand and liquidity", ["v_disappearance: listed then gone between snapshots,", "complete collections only (the sell-through proxy)", "item_trajectories: first ask, markdown, sold, relisted", "momentum: saves, searches, TikTok, Lyst, WGSN signals", "RealReal saves per tile = willingness-to-pay intent"], SCRIPT)
box(67, 22.5, 31, 9.5, "Scoring (in the app)", ["5 layers: resale record 30 · house/ownership/supply 20", "designer lineage & history 15 · social 25 · macro 10", "Calls: Core Hold · Selective · Watch · Wear, Don't Bank", "Evidence tiers: auction hammer > RealReal sold >", "disappearance > asking prices. Generational lens."], OUTC)

# LAYER 5 outputs
band(19.5, "5 · OUTPUTS")
box(2, 8.5, 31, 9.5, "Appreciation Index app  (Next.js + Claude API)", ["~/Desktop/bag-index · npm run dev · localhost:3000", "House + bag + client cohort: tracker dossier first,", "then web research (3 rounds), then a scored brief with", "retail now / retail then / resale now up front,", "citations, and the not-investment-advice line."], OUTC)
box(34.5, 8.5, 31, 9.5, "Graphics  (exports/)", ["chanel_blazy_first_year.png (new vs resale, by show)", "chanel_lagerfeld_vs_blazy.png · chanel_eras_editorial.png", "Scripts in scripts/ re-read the DB: re-run after any", "refresh and the chart updates itself.", "Editorial style: Didot + Helvetica Neue, era palette."], OUTC)
box(67, 8.5, 31, 9.5, "Data deliverables", ["exports/bag_ledger_v1.csv (63 models: retail then/now,", "asks by site, retention, sell-through, sold reads)", "exports/blazy_chanel_catalogue.csv · retail sources CSV", "findings/ digests after every run · SOURCES.md log", "Memory + agent definitions in ~/.claude"], OUTC)

# arrows between bands (vertical, centred)
for x in (17, 49, 82): arrow(x, 76.3, x, 72.3)
for x in (13.5, 38, 62.5, 86.75): arrow(x, 58.3, x, 57.2)
arrow(50, 50.3, 50, 46.2)
for x in (17.5, 50, 82.5): arrow(x, 36.3, x, 32.2)
for x in (17.5, 50, 82.5): arrow(x, 22.3, x, 18.2)

ax.text(2, 5.2, "Operating rules: sanctioned APIs and storefront JSON first; robots.txt and terms respected; never past a login, paywall or CAPTCHA; Chrome reads at human pace, one job at a time, only while the laptop is open with the "
        "extension signed in and permission mode set to auto.\nNo images, article text or usernames are stored. Private Dior decks never leave the lab. Every brief ends: value-retention analysis based on public market data, not investment advice.",
        fontname=SANS, fontsize=7.8, color=INK3, va="top", linespacing=1.4)
fig.savefig(OUT, facecolor=PAPER); print(OUT)
