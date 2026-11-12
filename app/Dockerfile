# The Appreciation Index — long-running Node server (jobs live in process, so this is not a serverless deploy).
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--no-experimental-strip-types
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund
# Where the tracker copy and saved briefs live; mount a persistent volume at /data.
ENV PORT=3000 TRACKER_DB_PATH=/data/tracker.db TRENDS_DB_PATH=/data/trends.db BRIEFS_DIR=/data/briefs
EXPOSE 3000
CMD ["sh", "./scripts/start.sh"]
