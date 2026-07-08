#!/bin/bash
# Shared harness for the end-to-end workflow suite. Run against a THROWAWAY
# database + server instance - the tests create users, visits and files.
# Overridable via env: VT_BASE, VT_DB, VT_PSQL, PGPASSWORD.
BASE=${VT_BASE:-http://localhost:8790}
DBNAME=${VT_DB:-vendortrak_test}
PSQL=${VT_PSQL:-'/c/Program Files/PostgreSQL/17/bin/psql.exe'}
export PGPASSWORD=${PGPASSWORD:-postgres}
D="${TMPDIR:-/tmp}/vendortrak-e2e"; mkdir -p "$D"
sql() { "$PSQL" -U postgres -h localhost -d "$DBNAME" -t -A -c "$1" | tr -d '\r'; }
TODAY=$(date -u +%F)

PASS=0; FAIL=0; FINDINGS="$D/findings.txt"
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; echo "[$0] $1" >> "$FINDINGS"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected [$2] got [$3])"; fi; }
note() { echo "NOTE: $1"; echo "[$0][note] $1" >> "$FINDINGS"; }

# POST helper: post <jar> <path> <curl args...> -> echoes http code (always POSTs)
post() { local jar="$1" path="$2"; shift 2; curl -s -o /dev/null -w '%{http_code}' -X POST -b "$D/jar-$jar.txt" "$@" "$BASE$path"; }
get() { local jar="$1" path="$2"; curl -s -o /dev/null -w '%{http_code}' -b "$D/jar-$jar.txt" "$BASE$path"; }

login() { # login <jar> <email> <password>
  curl -s -o /dev/null -c "$D/jar-$1.txt" -d "email=$2&password=$3" "$BASE/login"
}

load_ids() {
  VENDOR=$(sql "SELECT id FROM vendors WHERE name='Acme Pumps'")
  ADMIN=$(sql "SELECT id FROM users WHERE email='admin@example.com'")
  CORA=$(sql "SELECT id FROM users WHERE email='cora@example.com'")
  MAX=$(sql "SELECT id FROM users WHERE email='max@example.com'")
  TIA=$(sql "SELECT id FROM users WHERE email='tia@example.com'")
  CARL=$(sql "SELECT id FROM users WHERE email='carl@example.com'")
  MONA=$(sql "SELECT id FROM users WHERE email='mona@example.com'")
  TOM=$(sql "SELECT id FROM users WHERE email='tom@example.com'")
}

# Create a routine + return its id (admin jar assumed seeded); args: plan interval start horizon [review]
mkroutine() {
  local plan="$1" interval="$2" start="$3" horizon="$4" review="${5:-on}"
  local extra=()
  [ "$review" = "on" ] && extra=(--data-urlencode "requires_technical_review=on")
  curl -s -o /dev/null -b "$D/jar-admin.txt" \
    --data-urlencode "plan_number=$plan" --data-urlencode "description=Test routine $plan" \
    --data-urlencode "vendor_id=$VENDOR" --data-urlencode "interval_months=$interval" \
    --data-urlencode "start_date=$start" --data-urlencode "call_horizon_months=$horizon" \
    --data-urlencode "vendor_coordinator_id=$CORA" --data-urlencode "maintenance_engineer_id=$MAX" \
    --data-urlencode "technical_engineer_id=$TIA" "${extra[@]}" "$BASE/routines"
  sql "SELECT id FROM routines WHERE plan_number='$plan'"
}

# Create a visit via the manual-create endpoint; echoes id
mkvisit() { # mkvisit <routine_id> <date>
  curl -s -o /dev/null -b "$D/jar-admin.txt" --data-urlencode "routine_id=$1" --data-urlencode "scheduled_date=$2" "$BASE/visits"
  sql "SELECT id FROM visits WHERE routine_id='$1' AND scheduled_date='$2'"
}
