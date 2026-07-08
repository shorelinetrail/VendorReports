#!/bin/bash
# Group D/E: recommendation flows, review decisions, gates, close, self-heal, invariants.
source "$(dirname "$0")/lib.sh"; load_ids
FUTURE=$(date -u -d "+45 days" +%F)
RPT_WIN=$(cygpath -m "$D/r.pdf"); [ -f "$D/r.pdf" ] || printf '%%PDF-1.4 test' > "$D/r.pdf"

# Helper: fresh visit at report_uploaded stage. Args: plan [review-flag]
fresh_reported() {
  local R V
  R=$(mkroutine "$1" 6 "$FUTURE" 2 "${2:-on}"); curl -s -o /dev/null -b "$D/jar-admin.txt" -X POST "$BASE/settings/generate-visits"
  V=$(sql "SELECT id FROM visits WHERE routine_id='$R'")
  post cora "/visits/$V/confirm-date" -d "confirmed_date=$TODAY" > /dev/null
  post cora "/visits/$V/reports" -F "file=@$RPT_WIN;type=application/pdf" > /dev/null
  echo "$V"
}

# D1: request_sap decision -> approved; complete blocked until SAP details; then complete.
V=$(fresh_reported REC-1)
post max "/visits/$V/recommendations" --data-urlencode 'description=Needs SAP notification' > /dev/null
REC=$(sql "SELECT id FROM recommendations WHERE visit_id='$V'")
post tia "/visits/$V/recommendations/$REC/review" -d 'decision=request_sap&response=Raise in SAP' > /dev/null
check "D1 rec approved after request_sap" approved "$(sql "SELECT status FROM recommendations WHERE id='$REC'")"
post max "/visits/$V/recommendations/$REC/complete" -X POST > /dev/null
check "D1 complete blocked without SAP details" approved "$(sql "SELECT status FROM recommendations WHERE id='$REC'")"
post max "/visits/$V/recommendations/$REC/sap" --data-urlencode 'sap_notification_number=SAP-123' --data-urlencode "due_date=$FUTURE" > /dev/null
post max "/visits/$V/recommendations/$REC/complete" -X POST > /dev/null
check "D1 complete allowed after SAP details" completed "$(sql "SELECT status FROM recommendations WHERE id='$REC'")"
check "D1 close task seeded after last rec" 1 "$(sql "SELECT COUNT(*) FROM tasks WHERE visit_id='$V' AND task_type='close_visit' AND status='pending'")"

# D2: other_action with assignee -> respond task; complete blocked until response; respond completes task.
V2=$(fresh_reported REC-2)
post max "/visits/$V2/recommendations" --data-urlencode 'description=Assign follow-up' > /dev/null
REC2=$(sql "SELECT id FROM recommendations WHERE visit_id='$V2'")
post tia "/visits/$V2/recommendations/$REC2/review" --data-urlencode 'decision=other_action' \
  --data-urlencode 'action_description=Check torque specs' --data-urlencode "assign_to=$CORA" > /dev/null
check "D2 respond task assigned to cora" 1 "$(sql "SELECT COUNT(*) FROM tasks WHERE visit_id='$V2' AND task_type='review_recommendations' AND assigned_to_id='$CORA' AND status='pending'")"
post max "/visits/$V2/recommendations/$REC2/complete" -X POST > /dev/null
check "D2 complete blocked without response" approved "$(sql "SELECT status FROM recommendations WHERE id='$REC2'")"
code=$(post tia "/visits/$V2/recommendations/$REC2/respond" --data-urlencode 'response=not mine')
check "D2 non-assignee cannot respond" "" "$(sql "SELECT COALESCE(action_response,'') FROM recommendations WHERE id='$REC2'")"
post cora "/visits/$V2/recommendations/$REC2/respond" --data-urlencode 'response=Torque verified at 45Nm' > /dev/null
check "D2 assignee response recorded" "Torque verified at 45Nm" "$(sql "SELECT action_response FROM recommendations WHERE id='$REC2'")"
check "D2 respond task completed" 0 "$(sql "SELECT COUNT(*) FROM tasks WHERE visit_id='$V2' AND task_type='review_recommendations' AND status='pending'")"
post max "/visits/$V2/recommendations/$REC2/complete" -X POST > /dev/null
check "D2 complete allowed after response" completed "$(sql "SELECT status FROM recommendations WHERE id='$REC2'")"

# D3: reassign moves the respond task to the NEW TE even though the rec is assigned to cora?
V3=$(fresh_reported REC-3)
post max "/visits/$V3/recommendations" --data-urlencode 'description=Reassign interaction' > /dev/null
REC3=$(sql "SELECT id FROM recommendations WHERE visit_id='$V3'")
post tia "/visits/$V3/recommendations/$REC3/review" --data-urlencode 'decision=other_action' \
  --data-urlencode 'action_description=Do the thing' --data-urlencode "assign_to=$CORA" > /dev/null
post admin "/visits/$V3/reassign" --data-urlencode "vendor_coordinator_id=$CARL" \
  --data-urlencode "maintenance_engineer_id=$MONA" --data-urlencode "technical_engineer_id=$TOM" > /dev/null
OWNER=$(sql "SELECT u.email FROM tasks t JOIN users u ON u.id=t.assigned_to_id WHERE t.visit_id='$V3' AND t.task_type='review_recommendations' AND t.status='pending'")
RECASSIGN=$(sql "SELECT u.email FROM recommendations r JOIN users u ON u.id=r.action_assigned_to_id WHERE r.id='$REC3'")
check "D3 respond task still follows the rec assignee (cora)" "cora@example.com" "$OWNER"
[ "$OWNER" != "$RECASSIGN" ] && note "D3 finding: after team reassign the respond TASK belongs to '$OWNER' but the REC still awaits '$RECASSIGN' - task and gate now disagree."
# respond as cora still works (gate keys off the rec), then complete as new ME mona
post cora "/visits/$V3/recommendations/$REC3/respond" --data-urlencode 'response=done' > /dev/null
RESPTASK=$(sql "SELECT COUNT(*) FROM tasks WHERE visit_id='$V3' AND task_type='review_recommendations' AND status IN ('pending','overdue')")
check "D3 respond task completed after the rec-assignee responds" 0 "$RESPTASK"
post mona "/visits/$V3/recommendations/$REC3/complete" -X POST > /dev/null
check "D3 new ME can complete" completed "$(sql "SELECT status FROM recommendations WHERE id='$REC3'")"

# D4: recs-check - confirm none with required reason; zero-rec close.
V4=$(fresh_reported REC-4)
post max "/visits/$V4/recommendations-check" -d 'reason=' > /dev/null
check "D4 confirm-none without reason rejected (task still open)" 1 "$(sql "SELECT COUNT(*) FROM tasks WHERE visit_id='$V4' AND task_type='create_recommendations' AND status='pending'")"
post max "/visits/$V4/recommendations-check" --data-urlencode 'reason=Report shows all systems nominal' > /dev/null
check "D4 recs-check task completed" 0 "$(sql "SELECT COUNT(*) FROM tasks WHERE visit_id='$V4' AND task_type='create_recommendations' AND status='pending'")"
check "D4 reason stored as comment" 1 "$(sql "SELECT COUNT(*) FROM visit_comments WHERE visit_id='$V4' AND body LIKE 'No recommendations required%'")"
post max "/visits/$V4/close" -X POST > /dev/null
check "D4 zero-rec visit closeable after confirm-none" completed "$(sql "SELECT status FROM visits WHERE id='$V4'")"

# D5: close blocked while recs-check pending.
V5=$(fresh_reported REC-5)
post max "/visits/$V5/close" -X POST > /dev/null
check "D5 close blocked while recs-check open" report_uploaded "$(sql "SELECT status FROM visits WHERE id='$V5'")"

# D6: rec reopen semantics + close task cancelled.
post max "/visits/$V5/recommendations" --data-urlencode 'description=Reopen me' > /dev/null
REC5=$(sql "SELECT id FROM recommendations WHERE visit_id='$V5'")
post tia "/visits/$V5/recommendations/$REC5/review" -d 'decision=no_action' > /dev/null
check "D6 rec completed via no_action" completed "$(sql "SELECT status FROM recommendations WHERE id='$REC5'")"
post max "/visits/$V5/recommendations/$REC5/reopen" -X POST > /dev/null
check "D6 reviewed rec reopens as approved" approved "$(sql "SELECT status FROM recommendations WHERE id='$REC5'")"
check "D6 close task cancelled on rec reopen" 0 "$(sql "SELECT COUNT(*) FROM tasks WHERE visit_id='$V5' AND task_type='close_visit' AND status='pending'")"
post max "/visits/$V5/recommendations/$REC5/complete" -X POST > /dev/null

# D7: edit blocked on completed rec, but /sap endpoint is NOT blocked - inconsistency?
post max "/visits/$V5/recommendations/$REC5/edit" --data-urlencode 'description=changed after completion' > /dev/null
check "D7 edit rejected on completed rec" "Reopen me" "$(sql "SELECT description FROM recommendations WHERE id='$REC5'")"
post max "/visits/$V5/recommendations/$REC5/sap" --data-urlencode 'sap_notification_number=SAP-LATE' --data-urlencode "due_date=$FUTURE" > /dev/null
SAPAFTER=$(sql "SELECT COALESCE(sap_notification_number,'') FROM recommendations WHERE id='$REC5'")
if [ "$SAPAFTER" = "SAP-LATE" ]; then
  note "D7 finding: /sap endpoint edits a COMPLETED recommendation (edit endpoint blocks this; sap does not)."
else
  ok "D7 sap endpoint blocked on completed rec"
fi

# D8: send-review is only for visits whose plan requires technical review.
V7=$(fresh_reported REC-7 off)
post max "/visits/$V7/recommendations" --data-urlencode 'description=No-review-plan rec' > /dev/null
REC7=$(sql "SELECT id FROM recommendations WHERE visit_id='$V7'")
check "D8 rec on no-review plan stays open" open "$(sql "SELECT status FROM recommendations WHERE id='$REC7'")"
post max "/visits/$V7/recommendations/$REC7/send-review" > /dev/null
check "D8 send-review denied on no-review plan" open "$(sql "SELECT status FROM recommendations WHERE id='$REC7'")"
post max "/visits/$V7/recommendations/$REC7/complete" > /dev/null

# D9: recommendations-check denied when no recs check is pending.
COMMENTS_BEFORE=$(sql "SELECT COUNT(*) FROM visit_comments WHERE visit_id='$V7'")
post max "/visits/$V7/recommendations-check" --data-urlencode 'reason=no pending check' > /dev/null
check "D9 recs-check denied without a pending check (no comment added)" "$COMMENTS_BEFORE" "$(sql "SELECT COUNT(*) FROM visit_comments WHERE visit_id='$V7'")"

# E1: sweepCloseTasks self-heals a deleted close task.
V6=$(fresh_reported REC-6)
post max "/visits/$V6/recommendations-check" --data-urlencode 'reason=nothing to raise' > /dev/null
sql "DELETE FROM tasks WHERE visit_id='$V6' AND task_type='close_visit'" > /dev/null
curl -s -o /dev/null -b "$D/jar-admin.txt" -X POST "$BASE/settings/expire-tasks"   # runs sweepCloseTasks too
check "E1 sweep re-seeds missing close task" 1 "$(sql "SELECT COUNT(*) FROM tasks WHERE visit_id='$V6' AND task_type='close_visit' AND status='pending'")"

# E2: global invariant - no completed/cancelled visit anywhere has open tasks.
BADROWS=$(sql "SELECT COUNT(*) FROM tasks t JOIN visits v ON v.id=t.visit_id WHERE v.status IN ('completed','cancelled') AND t.status IN ('pending','in_progress','overdue')")
check "E2 invariant: no open tasks on closed/cancelled visits" 0 "$BADROWS"

# E3: notifications/dashboard sanity - completed-this-month counts our closes.
DASH=$(curl -s -b "$D/jar-admin.txt" "$BASE/")
echo "$DASH" | grep -q 'Completed This Month' && ok "E3 dashboard renders stat cards" || bad "E3 dashboard renders stat cards"

echo "=== group D/E: $PASS passed, $FAIL failed ==="
