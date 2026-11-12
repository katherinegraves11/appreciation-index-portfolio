#!/bin/sh
# Nightly backup of the tracker (Katie, 2026-10-26: "this will only be as strong as the information we hold onto. Non-negotiable").
# A consistent SQLite copy of each database, dated and compressed. Backups are never overwritten or deleted.
B="/Users/katiegraves/Desktop/Fashion Data Lab/backups"; D="/Users/katiegraves/Desktop/Fashion Data Lab/db"; TS=$(date +%Y-%m-%d-%H%M)
mkdir -p "$B"
for f in luxury_bags trends; do
  sqlite3 -cmd ".timeout 60000" "$D/$f.db" ".backup '$B/$f-$TS.db'" && gzip -9 "$B/$f-$TS.db" || { echo "BACKUP FAILED: $f"; exit 1; }
done
# an off-laptop copy in Katie's Dropbox (her choice, 2026-10-26: "putting something in one of my cloud services is good")
C="/Users/katiegraves/Library/CloudStorage/Dropbox/Appreciation Index Backups"; mkdir -p "$C"
for f in luxury_bags trends; do cp -n "$B/$f-$TS.db.gz" "$C/" || echo "CLOUD COPY FAILED: $f"; done
# the saved reads (Katie, 2026-11-11): bag-index lives outside iCloud now, so these dated archives are their off-laptop copy.
# A night with no new or changed read is skipped; a failure is reported, never hidden.
R="/Users/katiegraves/Desktop/bag-index/.data/briefs"; LAST=$(ls -1t "$B"/briefs-*.tar.gz 2>/dev/null | head -1)
if [ -n "$LAST" ] && [ -z "$(find "$R" -type f -newer "$LAST" | head -1)" ]; then echo "briefs unchanged since $(basename "$LAST")"
else tar -czf "$B/briefs-$TS.tar.gz" -C "$(dirname "$R")" briefs && cp -n "$B/briefs-$TS.tar.gz" "$C/" && echo "briefs-$TS.tar.gz: $(ls -1 "$R" | wc -l | tr -d ' ') reads" || echo "BRIEFS BACKUP FAILED"; fi
# integrity check of the live database; a failure is reported, never hidden
sqlite3 "$D/luxury_bags.db" "pragma quick_check" | head -1
ls -1 "$B" | wc -l | xargs echo "backups kept:"
# rebuild the knowledge layer from its sources (ARCHITECTURE.md, Storage & knowledge); a failure is reported, never fatal
python3 -I "/Users/katiegraves/Desktop/Fashion Data Lab/scripts/build_knowledge.py" || echo "KNOWLEDGE REBUILD FAILED"
