# The Appreciation Index: data pipeline

The collection and analysis layer behind [The Appreciation Index](https://github.com/katherinegraves11/appreciation-index), a tool that tells a luxury-bag buyer whether a bag is likely to hold its value. This repository holds the code and the working method only. The data it collects (the tracker database, raw pulls, photos and findings) stays local and is never committed.

- `scrapers/`: paced readers for resale listings (The RealReal, resellers), auction results, house retail catalogues and stock, Google Trends, TikTok Creative Center and runway captures. Derived data only: no images, captions or usernames are stored.
- `scripts/`: ingest (Muse social-listening briefs), the knowledge index (`build_knowledge.py`, SQLite FTS5, words only, with public, licensed and private visibility), the golden test set, backups and charts.
- `sql/`: analysis views, such as retail against resale, auctions and supply chain.
- `ARCHITECTURE.md`, `SCAN_MAP.md`, `BUZZ_PROTOCOL.md`, `FASHION_WEEK_PROTOCOL.md`: the plan, the daily schedule and the social-listening and fashion-week methods.

Built by Katie Graves with Claude.
