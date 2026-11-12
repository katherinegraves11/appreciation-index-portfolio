#!/bin/sh
# Copy the latest Fashion Data Lab tracker into the app (run before each deploy).
cp "$HOME/Desktop/Fashion Data Lab/db/luxury_bags.db" "$(dirname "$0")/data/tracker.db" && echo "tracker.db synced"
