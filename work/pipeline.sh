#!/bin/sh
# The production pipeline, end to end, resumable at every stage.
#
# Each stage writes a .done marker when it finishes, and the driver skips any
# stage already marked — so this script can be killed at any moment and
# restarted, and it will pick up where it stopped. That is the same bargain the
# per-puzzle checkpoints make one level down: nothing expensive is ever
# repeated, and nothing half-finished is ever mistaken for finished.
#
# Quality settings are the approved ones and are not parameters here. No stage
# may lower a depth, a MultiPV, or a threshold; --budget 0 everywhere means no
# puzzle is ever rejected for being slow.
#
#   sh work/pipeline.sh          # run / resume
set -u
cd "$(dirname "$0")/.." || exit 1

W=work
L=$W/logs
mkdir -p "$L" "$W/gen" "$W/practices"
JOBS=10
RUNGS="1600,1600,2000,2000,2000"

say(){ echo "[$(date '+%H:%M:%S')] $*" | tee -a "$L/pipeline.log"; }
done_marker(){ echo "$W/.stage-$1.done"; }
is_done(){ [ -f "$(done_marker "$1")" ]; }
mark_done(){ date > "$(done_marker "$1")"; say "STAGE $1 COMPLETE"; }

say "=========== pipeline start (branch $(git branch --show-current)) ==========="

# ---------------------------------------------------------------- STAGE 1
# Re-verify the whole existing corpus against the complete new standard.
# Shared queue across all three tracks; per-puzzle checkpointing; the 173
# results already on disk are skipped by id.
if is_done 1; then say "stage 1 already done, skipping"; else
  say "STAGE 1 — re-verifying existing corpus (resuming from checkpoints)"
  node tools/verify_puzzles.js \
    --dir "$W/stage1" --tracks opening,middlegame,endgame \
    --write --resort --budget 0 --jobs $JOBS \
    >> "$L/stage1.log" 2>&1 || { say "STAGE 1 FAILED"; exit 1; }
  mark_done 1
fi

# ---------------------------------------------------------------- STAGE 2
# How many survived, and therefore how many are still needed.
if is_done 2; then say "stage 2 already done, skipping"; else
  say "STAGE 2 — deficit calculation"
  node work/deficit.js > "$L/stage2.log" 2>&1 || { say "STAGE 2 FAILED"; exit 1; }
  cat "$L/stage2.log" | tee -a "$L/pipeline.log"
  mark_done 2
fi
GAMES=$(cat "$W/games.txt" 2>/dev/null || echo 12000)

# ---------------------------------------------------------------- STAGE 3
# Mine replacements from the approved 40/60 r1600/r2000 mix. The pool file is
# kept so the ladders can be re-cut later without re-mining.
if is_done 3; then say "stage 3 already done, skipping"; else
  say "STAGE 3 — mining $GAMES games at $RUNGS"
  node tools/generate_puzzles.js \
    --games "$GAMES" --jobs $JOBS --seed 7 \
    --rungs "$RUNGS" --spread 0 \
    --out "$W/gen" --poolsOut "$W/gen/pools.json" \
    >> "$L/stage3.log" 2>&1 || { say "STAGE 3 FAILED"; exit 1; }
  mark_done 3
fi

# ---------------------------------------------------------------- STAGE 4
# The full Stockfish 18 standard over everything newly mined.
if is_done 4; then say "stage 4 already done, skipping"; else
  say "STAGE 4 — full verification of new candidates"
  node tools/verify_puzzles.js \
    --dir "$W/gen" --tracks opening,middlegame,endgame \
    --write --resort --budget 0 --jobs $JOBS \
    >> "$L/stage4.log" 2>&1 || { say "STAGE 4 FAILED"; exit 1; }
  mark_done 4
fi

# ------------------------------------------------------------- STAGE 5a/5b
# The two practice sets. Their own standards; the same engine and depths.
if is_done 5a; then say "stage 5a already done, skipping"; else
  say "STAGE 5a — Opening Practices"
  node tools/generate_practices.js \
    --kind opening --games 3000 --want 100 --jobs $JOBS \
    --rungs "$RUNGS" --out practices --write \
    >> "$L/stage5a.log" 2>&1 || { say "STAGE 5a FAILED"; exit 1; }
  mark_done 5a
fi

if is_done 5b; then say "stage 5b already done, skipping"; else
  say "STAGE 5b — Middle Game Practices"
  node tools/generate_practices.js \
    --kind middlegame --games 6000 --want 100 --jobs $JOBS \
    --rungs "$RUNGS" --perGameTries 20 --out practices --write \
    >> "$L/stage5b.log" 2>&1 || { say "STAGE 5b FAILED"; exit 1; }
  mark_done 5b
fi

# ---------------------------------------------------------------- STAGE 6
# One corpus, five non-overlapping pools, dealt round-robin over difficulty.
if is_done 6; then say "stage 6 already done, skipping"; else
  say "STAGE 6 — building the five pools"
  node work/build_pools.js > "$L/stage6.log" 2>&1 || { say "STAGE 6 FAILED"; exit 1; }
  cat "$L/stage6.log" | tee -a "$L/pipeline.log"
  mark_done 6
fi

# ---------------------------------------------------------------- STAGE 7
if is_done 7; then say "stage 7 already done, skipping"; else
  say "STAGE 7 — integrity checks and full test suite"
  sh work/final_tests.sh > "$L/stage7.log" 2>&1
  cat "$L/stage7.log" | tee -a "$L/pipeline.log"
  mark_done 7
fi

say "=========== pipeline finished ==========="
