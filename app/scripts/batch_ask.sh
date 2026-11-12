#!/bin/sh
# Ask the Appreciation Index about the whole tracked universe, one bag at a time (each takes ~4 min and spends API credits).
# Usage: sh scripts/batch_ask.sh [list-file]   (default list below). Results: .data/batch/<date>.tsv
export PATH=/usr/local/bin:/usr/bin:/bin
cd "$(dirname "$0")/.." || exit 1
LIST=${1:-scripts/bags.txt}
OUT=.data/batch/$(date +%F).tsv; mkdir -p .data/batch
# wait for the server
n=0; until [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3000)" = "200" ] || [ $n -ge 100 ]; do sleep 6; n=$((n+1)); done
printf 'question\tcall\tcomposite\tconfidence\tplain_answer\tflip_1y\thold_5y\thold_10y\twear\tid\n' >> "$OUT"
while IFS= read -r q; do
  [ -z "$q" ] && continue
  case "$q" in \#*) continue;; esac
  echo "=== $(date +%H:%M) $q"
  TMP=$(mktemp)
  curl -s -N -X POST http://localhost:3000/api/ask?stream=1 -H 'content-type: application/json' --data "$(python3 -c 'import json,sys;print(json.dumps({"question":sys.argv[1]}))' "$q")" > "$TMP" 2>&1
  python3 - "$TMP" "$OUT" "$q" <<'PY'
import json,sys
tmp,out,q=sys.argv[1:4]; row=None; err=None
for line in open(tmp):
    line=line.strip()
    if '"done":true' in line:
        d=json.loads(line); r=d['result']; sig={s['intent']:s['verdict'] for s in r.get('signals',[])}
        row=[q,r['call'],str(r['composite']),r['confidence'],r.get('plain_answer','').replace('\t',' '),sig.get('flip_1y',''),sig.get('hold_5y',''),sig.get('hold_10y',''),sig.get('wear',''),d['id']]
    elif '"error"' in line or '"clarification"' in line: err=line[:200]
with open(out,'a') as f:
    f.write('\t'.join(row)+'\n' if row else f"{q}\tERROR\t\t\t{err}\t\t\t\t\t\n")
print(row[1:5] if row else err)
if err and 'credit balance' in err: sys.exit(42)
PY
  rc=$?; rm -f "$TMP"
  if [ "$rc" = "42" ]; then echo "=== STOPPED: Anthropic API credit balance too low. Top up at console.anthropic.com (Plans & Billing), then re-run: sh scripts/batch_ask.sh"; break; fi
done < "$LIST"
echo "=== batch done $(date)"
