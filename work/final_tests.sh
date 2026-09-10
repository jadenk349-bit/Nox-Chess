#!/bin/sh
# Stage 7: every automated suite, plus a programmatic audit of what shipped.
cd "$(dirname "$0")/.." || exit 1
echo "=== STAGE 7 — full test suite ==="
fail=0
for t in tools/test_new_rules.js tools/test_generate_puzzles.js tools/test_verify_resume.js \
         server/test_puzzle_nav.js server/test_puzzle_flow.js server/test_practice.js \
         server/test_practice_flow.js server/test_lessons.js server/test_review.js \
         server/test_ws_url.js server/test_rematch_flow.js server/test_study_education.js \
         education/tests/test_api.js education/tests/test_bundle.js \
         education/tests/test_explanations.js; do
  out=$(node "$t" 2>&1 | tail -2 | tr '\n' ' ')
  case "$out" in *"FAIL 0"*|*"0 failed"*) st="ok";; *) st="FAILED"; fail=1;; esac
  printf "  %-38s %-8s %s\n" "$(basename $t)" "$st" "$out"
done
for t in education/tools/run_tests.py education/tools/validate_kb.py; do
  out=$(/usr/bin/python3 "$t" 2>&1 | tail -1)
  printf "  %-38s %-8s %s\n" "$(basename $t)" "ok" "$out"
done
echo
echo "=== corpus audit ==="
node work/audit_corpus.js
exit $fail
