# The Appreciation Index

A tool for luxury-bag buyers. Ask about a bag in plain words or drop a photo, and it tells you whether that exact bag (model, size, leather, finish and hardware) is likely to hold its value. Every number comes from a tracker of real prices: today's boutique price, sold and asking prices on resale sites, auction results and private sourcer purchases, each with its count and date. Culture is read alongside: press, social listening, runway and creative-director changes.

**Built by Katie Graves** (Cornell Tech MBA; previously VP, Development and Current Series at Amazon MGM Studios) with Claude, October to November 2026.

## What is here

| Folder | What it is |
|---|---|
| [`app/`](app) | The product: a Next.js app with question and photo intake, a version-safe matcher that never lets a size, leather, finish or distinct model borrow another's price, code-written verdicts and timing, and a Claude-powered read that must cite the tracker rows it uses |
| [`pipeline/`](pipeline) | The data layer: paced scrapers for resale, auction, house catalogues, stock and trends, social-listening ingest, a SQLite FTS knowledge index (words only, with public, licensed and private visibility) and analysis SQL |
| [`pipeline/ARCHITECTURE.md`](pipeline/ARCHITECTURE.md) | The plan and the rules the product is held to |

## How it is held to account
- **No number without a source.** Prices come from SQL on the tracker, never from the model's memory. Every claim carries its count and date.
- **Versions never mix.** Embossed is never real crocodile, and a 25 never takes a 30's price. A fringe bag's beads are its fringe.
- **A review panel.** Sixteen personas (buyers by generation, a sourcer, a luxury strategist, finance, an editor and a staff engineer) review every customer-facing change. A golden set of approved questions is checked before each release.
- **Courteous collection.** Randomised pacing, robots.txt respected, stop on any block. Derived data only: no images, captions or usernames are stored.
- **Private stays private.** The collected data (tracker database, raw pulls, photos and findings) and the private sourcer and purchase records are not in this repository.

## Run it
See [`app/README.md`](app/README.md) and [`app/DEPLOY.md`](app/DEPLOY.md). The app expects a tracker database at `app/data/luxury_bags.db`, which is not included.
