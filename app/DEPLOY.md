# Going live (Railway)

The app keeps running questions in process (a question takes about three minutes and the page polls
for it), so it needs a long-running server, not a serverless host. Railway runs the Dockerfile in this
repo, gives a persistent disk for the tracker copy and saved briefs, and costs about $5 a month.

## One-time setup (Katie, about ten minutes)
1. railway.com → Login with GitHub (katherinegraves11).
2. New Project → Deploy from GitHub repo → `appreciation-index`. Railway finds the Dockerfile on its own.
3. Service → Settings → Volumes → Add volume, mount path `/data`.
4. Service → Variables, add:
   - `ANTHROPIC_API_KEY` — the key from console.anthropic.com (never committed).
   - `ACCESS_CODE` — one word or phrase; everyone you send the link to types it once. Keeps strangers
     from running questions on your API budget.
   - `TRACKER_DB_URL` — a direct-download link to a copy of `luxury_bags.db` (a Dropbox share link
     with `dl=1` works). The server downloads it at every boot, so a redeploy refreshes the data.
   - `TRENDS_DB_URL` — a direct-download link to a copy of `trends.db` (the weekly Google search history the
     Trends page and the connective-tissue lines use). Without it those lines say there is no search history.
   - optional spend caps: `ASK_DAILY_PER_VISITOR` (default 12), `ASK_DAILY_TOTAL` (60), `ASK_MAX_RUNNING` (3),
     `IDENTIFY_DAILY_PER_VISITOR` (40). Also set a monthly spend limit in the Anthropic console; that is the hard stop.
   - `PUBLIC_API_KEY` — a long random string; turns on the partner API at `/api/v1/` (for a Lovable front end). Leave it unset and the API stays off.
   - optional `HIDE_PRIVATE=1` withholds the sourcer-quote averages on the site and the API (off by default: Katie's call, 2026-10-24). Private Dior preview decks are never shown either way.
   - optional `BAGINDEX_MODEL` (defaults to claude-opus-5).
5. Service → Settings → Networking → Generate domain. The first build takes about ten minutes.
6. Open the URL, enter the access code, ask one question end to end before sending it to anyone.

## Refreshing the data
Copy `luxury_bags.db` and `trends.db` into the Dropbox files behind `TRACKER_DB_URL` and `TRENDS_DB_URL`,
then Deploy → Redeploy. Saved briefs live on the volume at `/data/briefs` (the Dockerfile sets `BRIEFS_DIR`)
and survive redeploys.

## What is never deployed
The private decks, `.data`, `.env*`, and the Desktop database file itself (see `.dockerignore`).

## Connecting a Lovable front end
The tool stays the brain (tracker, scans, answers); Lovable can be a second face. Lovable calls the partner API from its own server-side functions, with the key stored in Lovable's secrets, never in the browser.

| Call | What it does |
|---|---|
| `GET /api/v1/houses` | The houses the tool covers |
| `POST /api/v1/ask` with `{"question": "...", "horizon": 1}` | Starts an answer; returns `{"job": "<id>"}`. Takes about three minutes |
| `GET /api/v1/ask?job=<id>&since=<n>` | Progress lines, then a final event with `result`, `input` and `numbers` |
| `GET /api/v1/answer?id=<answer id>` | A saved answer with today's numbers |

Every call sends `Authorization: Bearer <PUBLIC_API_KEY>`. Answers carry sourced data and the sourcer-quote averages. The same spend caps apply as on the site.
