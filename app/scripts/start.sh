#!/bin/sh
# Boot: refresh the read-only tracker copy from TRACKER_DB_URL (if set), then start Next.
set -e
mkdir -p "$(dirname "${TRACKER_DB_PATH:-/data/tracker.db}")" "${BRIEFS_DIR:-/data/briefs}"
if [ -n "$TRACKER_DB_URL" ] || [ -n "$TRENDS_DB_URL" ]; then
  node ./scripts/fetch-db.mjs || echo "a database download failed; keeping the copies already on disk (if any)"
fi
exec ./node_modules/.bin/next start -p "${PORT:-3000}"
