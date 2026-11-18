#!/usr/bin/env bash
# One command for every check. Prints only failures plus a one-line summary.
#   ./check.sh          typecheck + unit tests + build
#   ./check.sh --ui     the above + text overflow sweep at all widths (for HUD/layout changes)
#   ./check.sh --ui 390 360   sweep only these widths
cd "$(dirname "$0")"
fail=0; log=$(mktemp)

if ! npx tsc --noEmit >"$log" 2>&1; then echo "TYPECHECK FAILED"; head -40 "$log"; fail=1; fi

passed=0; total=0
for t in tests/*.test.ts; do
  total=$((total + 1))
  if (cd tests && npx tsx "$(basename "$t")") >"$log" 2>&1; then passed=$((passed + 1))
  else echo "TEST FAILED: $t"; grep -v "^npm notice" "$log" | grep -v "^ok " | head -25; fail=1; fi
done

if ! npx vite build >"$log" 2>&1; then echo "BUILD FAILED"; tail -30 "$log"; fail=1; fi

if [ "$1" = "--ui" ] && [ $fail = 0 ]; then
  shift
  npx vite preview --port 4173 --strictPort >/dev/null 2>&1 & srv=$!
  for _ in $(seq 30); do curl -s localhost:4173 >/dev/null && break; sleep 0.3; done
  if ! python3 tools/ui_check.py "$@" >"$log" 2>&1; then echo "UI SWEEP FAILED"; grep -v "no problems" "$log" | head -40; fail=1; fi
  kill $srv 2>/dev/null
fi

rm -f "$log"
if [ $fail = 0 ]; then echo "ALL GREEN: typecheck, $passed/$total test files, build$([ -n "$srv" ] && echo ", ui sweep")"; else echo "CHECKS FAILED ($passed/$total test files passed)"; fi
exit $fail
