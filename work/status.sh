#!/bin/sh
# Read-only pipeline status. Touches nothing, opens no engine, holds no lock —
# safe to run at any moment while the production run is going.
cd "$(dirname "$0")/.." || exit 1

echo "=================== NOX PIPELINE STATUS ==================="
date
echo
echo "--- running ---"
pgrep -fl "verify_puzzles.js|generate_puzzles.js|generate_practices.js" 2>/dev/null \
  | sed 's/^/  /' || echo "  (nothing running)"
echo "  stockfish processes: $(ps aux | grep -c '[s]tockfish')"
echo "  load:$(uptime | sed 's/.*load averages*://')"
echo

echo "--- stage 1: re-verifying the existing corpus ---"
for t in opening middlegame endgame; do
  f="work/stage1/$t.json.progress.jsonl"
  src="work/stage1/$t.json"
  if [ -f "$f" ]; then
    tot=$(/usr/bin/python3 -c "import json;print(len(json.load(open('$src'))))" 2>/dev/null || echo '?')
    /usr/bin/python3 - "$f" "$t" "$tot" <<'PY'
import json,sys
path,track,tot=sys.argv[1],sys.argv[2],sys.argv[3]
kept=drop=0; why={}
for line in open(path):
    try: r=json.loads(line)
    except Exception: continue
    if r.get('puzzle'): kept+=1
    else:
        drop+=1
        w=(r.get('note') or {}).get('dropped') or 'unknown'
        w=w.split('(')[0].strip()
        why[w]=why.get(w,0)+1
done=kept+drop
pct=('%d%%'%(done*100/int(tot))) if tot.isdigit() and int(tot) else '?'
print('  %-11s %4d/%-4s %-5s  kept %-4d dropped %d' % (track,done,tot,pct,kept,drop))
for w,c in sorted(why.items(), key=lambda x:-x[1])[:4]:
    print('       %4d  %s' % (c,w))
PY
  else
    echo "  $t        not started"
  fi
done
echo

echo "--- stage 5b live funnel ---"
if [ -f practices/middlegame.progress.json ]; then
  /usr/bin/python3 - <<'EOF'
import json,time,os
d=json.load(open('practices/middlegame.progress.json'))
age=int(time.time()-os.path.getmtime('practices/middlegame.progress.json'))
print('  games        %5d / %d' % (d['games'], d['maxGames']))
print('  positions    %5d examined' % d['positions'])
print('  nominated    %5d passed the cheap pass' % d['nominated'])
print('  reached +35  %5d' % d['reached35'])
print('  QUALIFIED    %5d / %d' % (d['qualified'], d['want']))
print('  rate         %d games/hour, %.1f%% of those reaching +35 pass' % (d['gamesPerHour'], d['qualifyRate']))
print('  elapsed      %dh %02dm   counters %ds old' % (d['elapsedSec']//3600,(d['elapsedSec']%3600)//60, age))
if d['qualified']:
    left=d['want']-d['qualified']
    per=d['elapsedSec']/d['qualified']
    print('  eta          ~%dh %02dm for the remaining %d' % (int(left*per)//3600,(int(left*per)%3600)//60,left))
else:
    print('  eta          no qualifier yet — cannot project')
if age > 120: print('  *** counters stale (>2 min) — investigate ***')
EOF
else echo "  no progress file (stage 5b not running)"; fi
echo

echo "--- practices ---"
for k in opening middlegame; do
  f="practices/$k.json"; p="practices/$k.json.progress.jsonl"
  n='-'; d='-'
  [ -f "$f" ] && n=$(/usr/bin/python3 -c "import json;print(len(json.load(open('$f'))))" 2>/dev/null)
  [ -f "$p" ] && d=$(wc -l < "$p" | tr -d ' ')
  echo "  $k: verified $d, written $n"
done
echo

echo "--- final pools ---"
if [ -d puzzles/modes ]; then
  for m in sighted board blindfold fog rush; do
    f="puzzles/modes/$m.json"
    if [ -f "$f" ]; then
      echo "  $m: $(/usr/bin/python3 -c "import json;print(len(json.load(open('$f'))))" 2>/dev/null)"
    else echo "  $m: not built"; fi
  done
else
  echo "  not built yet (stage 6)"
fi
echo
echo "--- last log lines ---"
for l in work/logs/*.log; do
  [ -f "$l" ] || continue
  echo "  $(basename "$l"): $(tail -c 220 "$l" | tr '\n' ' ' | tail -c 200)"
done
echo "==========================================================="
