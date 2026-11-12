#!/bin/sh
# One command for Katie: opens the tool, starting the server first only if it is not already up.
cd "$(dirname "$0")/.." || exit 1
if curl -s -m 3 -o /dev/null http://localhost:3000/; then
  echo "The Appreciation Index is already running."
else
  echo "Starting the server…"
  nohup npm run start > /tmp/appreciation-index.log 2>&1 &
  for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; curl -s -m 2 -o /dev/null http://localhost:3000/ && break; done
fi
open -a "Google Chrome" http://localhost:3000 2>/dev/null || open http://localhost:3000
