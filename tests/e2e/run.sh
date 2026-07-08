#!/bin/bash
# End-to-end workflow suite (119 checks). Needs a test server already running
# against a THROWAWAY database, e.g. from the repo root in PowerShell:
#
#   $env:DATABASE_URL='postgres://postgres:postgres@localhost:5432/vendortrak_test'
#   npm run db:migrate
#   $env:PORT='8790'; $env:FILES_DIR='data/test-reports'; npx tsx src/server.ts
#
# then: bash tests/e2e/run.sh
# The target database must be EMPTY (drop + re-migrate between runs).
cd "$(dirname "$0")"
source ./lib.sh

if ! curl -s -o /dev/null "$BASE/login"; then
  echo "No server responding at $BASE - start the test instance first (see header)."
  exit 1
fi
if [ "$(sql 'SELECT COUNT(*) FROM users')" != "0" ]; then
  echo "Database $DBNAME is not empty - drop it and re-run 'npm run db:migrate' first."
  exit 1
fi

TOTAL_PASS=0; TOTAL_FAIL=0
for group in 00-seed 01-generation 02-lifecycle 03-recommendations 04-permissions; do
  out=$(bash "./$group.sh")
  echo "$out"
  TOTAL_PASS=$((TOTAL_PASS + $(echo "$out" | grep -c '^PASS:')))
  TOTAL_FAIL=$((TOTAL_FAIL + $(echo "$out" | grep -c '^FAIL:')))
done
echo
echo "=== TOTAL: $TOTAL_PASS passed, $TOTAL_FAIL failed ==="
exit $([ "$TOTAL_FAIL" -eq 0 ] && echo 0 || echo 1)
