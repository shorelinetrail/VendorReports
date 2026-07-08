#!/bin/bash
# Group B/C: confirm, reschedule, cancel/reopen, reports at every stage.
source "$(dirname "$0")/lib.sh"; load_ids
FUTURE=$(date -u -d "+45 days" +%F)
RPT_WIN=$(cygpath -m "$D/r.pdf"); printf '%%PDF-1.4 test report' > "$D/r.pdf"

# B1: confirm completes confirm task + seeds upload_report due confirmed+2w.
RB1=$(mkroutine LIF-1 6 "$FUTURE" 2); curl -s -o /dev/null -b "$D/jar-admin.txt" -X POST "$BASE/settings/generate-visits"
VB1=$(sql "SELECT id FROM visits WHERE routine_id='$RB1'")
ENDD=$(date -u -d "$FUTURE +2 days" +%F)
post cora "/visits/$VB1/confirm-date" -d "confirmed_date=$FUTURE" -d "end_date=$ENDD" > /dev/null
check "B1 status date_confirmed" date_confirmed "$(sql "SELECT status FROM visits WHERE id='$VB1'")"
check "B1 confirm task completed" completed "$(sql "SELECT status FROM tasks WHERE visit_id='$VB1' AND task_type='confirm_visit_date'")"
EXPDUE=$(date -u -d "$FUTURE +14 days" +%F)
check "B1 upload task due confirmed+2w" "$EXPDUE" "$(sql "SELECT due_date FROM tasks WHERE visit_id='$VB1' AND task_type='upload_report'")"

# B2: reschedule resets to scheduled, cancels chain tasks, reseeds confirm.
NEWDATE=$(date -u -d "+60 days" +%F)
post cora "/visits/$VB1/reschedule" --data-urlencode "new_date=$NEWDATE" --data-urlencode 'reason=Vendor unavailable' > /dev/null
check "B2 status back to scheduled" scheduled "$(sql "SELECT status FROM visits WHERE id='$VB1'")"
check "B2 upload task cancelled" cancelled "$(sql "SELECT status FROM tasks WHERE visit_id='$VB1' AND task_type='upload_report'")"
check "B2 new confirm task pending" 1 "$(sql "SELECT COUNT(*) FROM tasks WHERE visit_id='$VB1' AND task_type='confirm_visit_date' AND status='pending'")"
check "B2 rescheduled_from recorded" "$FUTURE" "$(sql "SELECT rescheduled_from FROM visits WHERE id='$VB1'")"
check "B2 confirmed_date cleared" "" "$(sql "SELECT COALESCE(confirmed_date,'') FROM visits WHERE id='$VB1'")"
check "B2 end_date cleared on reschedule" "" "$(sql "SELECT COALESCE(end_date,'') FROM visits WHERE id='$VB1'")"

# B2b: reschedule from deep in the flow (in_review) - do technical_review tasks survive?
RB2=$(mkroutine LIF-2 6 "$FUTURE" 2); curl -s -o /dev/null -b "$D/jar-admin.txt" -X POST "$BASE/settings/generate-visits"
VB2=$(sql "SELECT id FROM visits WHERE routine_id='$RB2'")
post cora "/visits/$VB2/confirm-date" -d "confirmed_date=$TODAY" > /dev/null
post cora "/visits/$VB2/reports" -F "file=@$RPT_WIN;type=application/pdf" > /dev/null
post max  "/visits/$VB2/recommendations" --data-urlencode 'description=Check bearings' > /dev/null
check "B2b visit in_review" in_review "$(sql "SELECT status FROM visits WHERE id='$VB2'")"
post cora "/visits/$VB2/reschedule" --data-urlencode "new_date=$NEWDATE" --data-urlencode 'reason=slip' > /dev/null
check "B2b status reset to scheduled" scheduled "$(sql "SELECT status FROM visits WHERE id='$VB2'")"
TR_OPEN=$(sql "SELECT COUNT(*) FROM tasks WHERE visit_id='$VB2' AND task_type='technical_review' AND status IN ('pending','overdue')")
check "B2b technical_review task cancelled by reschedule" 0 "$TR_OPEN"
check "B2b only the new confirm task is open" 1 "$(sql "SELECT COUNT(*) FROM tasks WHERE visit_id='$VB2' AND status IN ('pending','overdue')")"

# B3/B4: cancel requires reason; open tasks cancelled; reopen returns to right stage + reseeds task.
RB3=$(mkroutine LIF-3 6 "$FUTURE" 2); curl -s -o /dev/null -b "$D/jar-admin.txt" -X POST "$BASE/settings/generate-visits"
VB3=$(sql "SELECT id FROM visits WHERE routine_id='$RB3'")
post cora "/visits/$VB3/confirm-date" -d "confirmed_date=$FUTURE" > /dev/null
post cora "/visits/$VB3/cancel" -d 'reason=' > /dev/null
check "B3 cancel without reason rejected" date_confirmed "$(sql "SELECT status FROM visits WHERE id='$VB3'")"
post cora "/visits/$VB3/cancel" --data-urlencode 'reason=Vendor bankrupt' > /dev/null
check "B3 cancelled" cancelled "$(sql "SELECT status FROM visits WHERE id='$VB3'")"
check "B3 no open tasks on cancelled visit" 0 "$(sql "SELECT COUNT(*) FROM tasks WHERE visit_id='$VB3' AND status IN ('pending','in_progress','overdue')")"
post max "/visits/$VB3/reopen" > /dev/null
check "B4 reopen returns to date_confirmed" date_confirmed "$(sql "SELECT status FROM visits WHERE id='$VB3'")"
check "B4 upload task reseeded" 1 "$(sql "SELECT COUNT(*) FROM tasks WHERE visit_id='$VB3' AND task_type='upload_report' AND status='pending'")"

# C1: early upload (while 'scheduled') advances the workflow honestly.
RC1=$(mkroutine LIF-4 6 "$FUTURE" 2); curl -s -o /dev/null -b "$D/jar-admin.txt" -X POST "$BASE/settings/generate-visits"
VC1=$(sql "SELECT id FROM visits WHERE routine_id='$RC1'")
code=$(post cora "/visits/$VC1/reports" -F "file=@$RPT_WIN;type=application/pdf")
check "C1 upload at scheduled accepted" 302 "$code"
check "C1 early upload advances to report_uploaded" report_uploaded "$(sql "SELECT status FROM visits WHERE id='$VC1'")"
check "C1 recs-check task seeded on early upload" 1 "$(sql "SELECT COUNT(*) FROM tasks WHERE visit_id='$VC1' AND task_type='create_recommendations' AND status='pending'")"
check "C1 stale confirm task cancelled" 0 "$(sql "SELECT COUNT(*) FROM tasks WHERE visit_id='$VC1' AND task_type='confirm_visit_date' AND status IN ('pending','overdue')")"
code=$(post max "/visits/$VC1/recommendations" --data-urlencode 'description=Early rec on unconfirmed visit')
check "C1 ME can create rec after early upload" 302 "$code"
check "C1 review-required rec sends visit to in_review" in_review "$(sql "SELECT status FROM visits WHERE id='$VC1'")"
post tia "/visits/$VC1/recommendations/$(sql "SELECT id FROM recommendations WHERE visit_id='$VC1'")/review" -d 'decision=no_action' > /dev/null
code=$(post max "/visits/$VC1/close")
check "C1 visit closeable (confirmation honestly skipped)" 302 "$code"
check "C1 completed with NULL confirmed_date" "completed|" "$(sql "SELECT status||'|'||COALESCE(confirmed_date,'') FROM visits WHERE id='$VC1'")"

# C1b: deleting the only report of a never-confirmed visit rewinds to scheduled.
RC1B=$(mkroutine LIF-4B 6 "$FUTURE" 2); curl -s -o /dev/null -b "$D/jar-admin.txt" -X POST "$BASE/settings/generate-visits"
VC1B=$(sql "SELECT id FROM visits WHERE routine_id='$RC1B'")
post cora "/visits/$VC1B/reports" -F "file=@$RPT_WIN;type=application/pdf" > /dev/null
RB=$(sql "SELECT id FROM visit_reports WHERE visit_id='$VC1B'")
post admin "/visits/$VC1B/reports/$RB/delete" > /dev/null
check "C1b last-report delete on unconfirmed visit rewinds to scheduled" scheduled "$(sql "SELECT status FROM visits WHERE id='$VC1B'")"

# C2: no-report from 'scheduled' behaves the same as an early upload; repeat is blocked.
RC2=$(mkroutine LIF-5 6 "$FUTURE" 2); curl -s -o /dev/null -b "$D/jar-admin.txt" -X POST "$BASE/settings/generate-visits"
VC2=$(sql "SELECT id FROM visits WHERE routine_id='$RC2'")
post cora "/visits/$VC2/no-report" --data-urlencode 'reason=Vendor sent nothing' > /dev/null
check "C2 no-report from scheduled -> report_uploaded" report_uploaded "$(sql "SELECT status FROM visits WHERE id='$VC2'")"
check "C2 confirm task cancelled by no-report" 0 "$(sql "SELECT COUNT(*) FROM tasks WHERE visit_id='$VC2' AND task_type='confirm_visit_date' AND status IN ('pending','overdue')")"
post cora "/visits/$VC2/no-report" --data-urlencode 'reason=second attempt' > /dev/null
check "C2 second no-report rejected (reason unchanged)" "Vendor sent nothing" "$(sql "SELECT no_report_reason FROM visits WHERE id='$VC2'")"

# C3: replacement keeps old file; deleting the ONLY report reverts status.
RC3=$(mkroutine LIF-6 6 "$FUTURE" 2); curl -s -o /dev/null -b "$D/jar-admin.txt" -X POST "$BASE/settings/generate-visits"
VC3=$(sql "SELECT id FROM visits WHERE routine_id='$RC3'")
post cora "/visits/$VC3/confirm-date" -d "confirmed_date=$TODAY" > /dev/null
post cora "/visits/$VC3/reports" -F "file=@$RPT_WIN;type=application/pdf" > /dev/null
FIRST=$(sql "SELECT id FROM visit_reports WHERE visit_id='$VC3'")
post cora "/visits/$VC3/reports" -F "file=@$RPT_WIN;type=application/pdf" -F "replaces_id=$FIRST" > /dev/null
check "C3 both report rows kept" 2 "$(sql "SELECT COUNT(*) FROM visit_reports WHERE visit_id='$VC3'")"
check "C3 replacement links old" "$FIRST" "$(sql "SELECT replaces_id FROM visit_reports WHERE visit_id='$VC3' AND replaces_id IS NOT NULL")"
SECOND=$(sql "SELECT id FROM visit_reports WHERE visit_id='$VC3' AND replaces_id IS NOT NULL")
code=$(post admin "/visits/$VC3/reports/$SECOND/delete"); post admin "/visits/$VC3/reports/$FIRST/delete" > /dev/null
check "C3 all reports deleted" 0 "$(sql "SELECT COUNT(*) FROM visit_reports WHERE visit_id='$VC3'")"
check "C3 status reverted to date_confirmed after last delete" date_confirmed "$(sql "SELECT status FROM visits WHERE id='$VC3'")"

# C4: file validation - wrong extension and oversized rejected.
printf 'MZ fake exe' > "$D/bad.exe"; BAD_WIN=$(cygpath -m "$D/bad.exe")
post cora "/visits/$VC3/reports" -F "file=@$BAD_WIN;type=application/octet-stream" > /dev/null
check "C4 .exe rejected" 0 "$(sql "SELECT COUNT(*) FROM visit_reports WHERE visit_id='$VC3'")"
python - "$D/big.pdf" <<'EOF'
import sys
open(sys.argv[1],'wb').write(b'%PDF'+b'0'*(11*1024*1024))
EOF
BIG_WIN=$(cygpath -m "$D/big.pdf")
post cora "/visits/$VC3/reports" -F "file=@$BIG_WIN;type=application/pdf" > /dev/null
check "C4 11MB rejected" 0 "$(sql "SELECT COUNT(*) FROM visit_reports WHERE visit_id='$VC3'")"

# C5: more-recommendations endpoint on a CANCELLED visit (no isOpen check server-side?)
RC5=$(mkroutine LIF-7 6 "$FUTURE" 2); curl -s -o /dev/null -b "$D/jar-admin.txt" -X POST "$BASE/settings/generate-visits"
VC5=$(sql "SELECT id FROM visits WHERE routine_id='$RC5'")
post cora "/visits/$VC5/cancel" --data-urlencode 'reason=cancelled for test' > /dev/null
post max "/visits/$VC5/more-recommendations" -X POST > /dev/null
OPENTASKS=$(sql "SELECT COUNT(*) FROM tasks WHERE visit_id='$VC5' AND status IN ('pending','in_progress','overdue')")
check "C5 more-recommendations on cancelled visit creates NO open task" 0 "$OPENTASKS"

# C6: upload on cancelled visit rejected.
code=$(post cora "/visits/$VC5/reports" -F "file=@$RPT_WIN;type=application/pdf")
check "C6 upload on cancelled visit rejected (no report row)" 0 "$(sql "SELECT COUNT(*) FROM visit_reports WHERE visit_id='$VC5'")"

echo "=== group B/C: $PASS passed, $FAIL failed ==="
