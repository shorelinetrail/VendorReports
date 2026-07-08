#!/bin/bash
# Group A: visit generation, task seeding rules, expiry, ad-hoc, multi-day, manual creation.
source "$(dirname "$0")/lib.sh"; load_ids
FUTURE=$(date -u -d "+45 days" +%F)
PAST=$(date -u -d "-10 days" +%F)

# A1: horizon + idempotency. start today, interval 1, horizon 2 -> visits today, +1m, +2m.
R1=$(mkroutine GEN-1 1 "$TODAY" 2)
curl -s -o /dev/null -b "$D/jar-admin.txt" -X POST "$BASE/settings/generate-visits"
check "A1 three visits to horizon" 3 "$(sql "SELECT COUNT(*) FROM visits WHERE routine_id='$R1'")"
curl -s -o /dev/null -b "$D/jar-admin.txt" -X POST "$BASE/settings/generate-visits"
check "A1 rerun creates no duplicates" 3 "$(sql "SELECT COUNT(*) FROM visits WHERE routine_id='$R1'")"

# A2: every visit gets a confirm task; inside the window the due date clamps to today.
check "A2 today's visit gets confirm task due today" "$TODAY" \
  "$(sql "SELECT t.due_date FROM tasks t JOIN visits v ON v.id=t.visit_id WHERE v.routine_id='$R1' AND v.scheduled_date='$TODAY' AND t.task_type='confirm_visit_date'")"
check "A2 far visits get confirm tasks" 2 \
  "$(sql "SELECT COUNT(*) FROM tasks t JOIN visits v ON v.id=t.visit_id WHERE v.routine_id='$R1' AND v.scheduled_date>'$TODAY' AND t.task_type='confirm_visit_date'")"

# A3: expire-tasks flips past-due open tasks to overdue.
R3=$(mkroutine GEN-3 6 "$FUTURE" 2)
curl -s -o /dev/null -b "$D/jar-admin.txt" -X POST "$BASE/settings/generate-visits"
V3=$(sql "SELECT id FROM visits WHERE routine_id='$R3'")
sql "UPDATE tasks SET due_date='$PAST' WHERE visit_id='$V3'" > /dev/null
curl -s -o /dev/null -b "$D/jar-admin.txt" -X POST "$BASE/settings/expire-tasks"
check "A3 past-due task flipped to overdue" overdue "$(sql "SELECT status FROM tasks WHERE visit_id='$V3' AND task_type='confirm_visit_date'")"

# A4: ad-hoc visits - any signed-in role can create one; notification number required.
code=$(post tia /visits/adhoc --data-urlencode "vendor_id=$VENDOR" --data-urlencode 'description=Emergency valve check' \
  --data-urlencode 'notification_number=NOT-1001' --data-urlencode "scheduled_date=$FUTURE" \
  --data-urlencode "vendor_coordinator_id=$CORA" --data-urlencode "maintenance_engineer_id=$MAX" --data-urlencode "technical_engineer_id=$TIA")
check "A4 TE can create ad-hoc visit" 302 "$code"
ADHOC=$(sql "SELECT id FROM visits WHERE notification_number='NOT-1001'")
[ -n "$ADHOC" ] && ok "A4 ad-hoc visit exists" || bad "A4 ad-hoc visit exists"
check "A4 ad-hoc confirm task seeded (far date)" 1 "$(sql "SELECT COUNT(*) FROM tasks WHERE visit_id='$ADHOC' AND task_type='confirm_visit_date'")"
code=$(post max /visits/adhoc --data-urlencode "vendor_id=$VENDOR" --data-urlencode 'description=No notif' \
  --data-urlencode "scheduled_date=$FUTURE" --data-urlencode "vendor_coordinator_id=$CORA" \
  --data-urlencode "maintenance_engineer_id=$MAX" --data-urlencode "technical_engineer_id=$TIA")
check "A4 missing notification number still 302 (flash err)" 302 "$code"
check "A4 visit without notification number NOT created" 0 "$(sql "SELECT COUNT(*) FROM visits WHERE description='No notif'")"

# A5: multi-day validation: end before start rejected.
code=$(post tia /visits/adhoc --data-urlencode "vendor_id=$VENDOR" --data-urlencode 'description=Bad end date' \
  --data-urlencode 'notification_number=NOT-1002' --data-urlencode "scheduled_date=$FUTURE" --data-urlencode "end_date=$TODAY" \
  --data-urlencode "vendor_coordinator_id=$CORA" --data-urlencode "maintenance_engineer_id=$MAX" --data-urlencode "technical_engineer_id=$TIA")
check "A5 end<start rejected (no visit)" 0 "$(sql "SELECT COUNT(*) FROM visits WHERE notification_number='NOT-1002'")"

# A6: MANUAL visit creation - does it seed a confirm task like the generator/ad-hoc do?
R6=$(mkroutine GEN-6 6 "$PAST" 0)   # no generated visits in horizon (start past, horizon 0 -> ...)
V6=$(mkvisit "$R6" "$FUTURE")
[ -n "$V6" ] && ok "A6 manual visit created" || bad "A6 manual visit created"
CONFTASKS=$(sql "SELECT COUNT(*) FROM tasks WHERE visit_id='$V6' AND task_type='confirm_visit_date'")
check "A6 manual visit seeds confirm task (consistency with generator/ad-hoc)" 1 "$CONFTASKS"

# A7: generator on the manually-created visit's routine must not duplicate that date.
curl -s -o /dev/null -b "$D/jar-admin.txt" -X POST "$BASE/settings/generate-visits"
check "A7 no duplicate for manually created visit" 1 "$(sql "SELECT COUNT(*) FROM visits WHERE routine_id='$R6' AND scheduled_date='$FUTURE'")"

echo "=== group A: $PASS passed, $FAIL failed ==="
