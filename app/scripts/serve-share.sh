#!/bin/sh
# Start the app for sharing (Katie, 2026-10-25, WGSN): passcode gate on, daily limits sized for outside visitors.
# The passcode lives in ~/Desktop/Appreciation Index passcode.txt and is never printed.
SP=/private/tmp/claude-501/-Users-katiegraves-Desktop/0f6f52ed-9ba2-4f42-99c7-e0d4a6a50618/scratchpad
cd "$(dirname "$0")/.." || exit 1
pkill -f "next start"; pkill -f next-server; sleep 1
ACCESS_CODE="$(tr -d '\n' < "$HOME/Desktop/Appreciation Index passcode.txt")" \
ASK_DAILY_PER_VISITOR=30 ASK_DAILY_TOTAL=150 IDENTIFY_DAILY_PER_VISITOR=30 \
PUBLIC_API_KEY="$(cat "$SP/local_test_key.txt" 2>/dev/null)" \
nohup npm run start > "$SP/server.log" 2>&1 &
