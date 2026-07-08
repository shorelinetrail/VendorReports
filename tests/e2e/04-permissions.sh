#!/bin/bash
# Group F/G: permissions matrix, impersonation, admin functions, settings, imports, delete cascade.
source "$(dirname "$0")/lib.sh"; load_ids
FUTURE=$(date -u -d "+45 days" +%F)
RPT_WIN=$(cygpath -m "$D/r.pdf"); [ -f "$D/r.pdf" ] || printf '%%PDF-1.4 test' > "$D/r.pdf"

# F1: unassigned same-role users must be denied visit transitions.
RF=$(mkroutine PERM-1 6 "$FUTURE" 2); curl -s -o /dev/null -b "$D/jar-admin.txt" -X POST "$BASE/settings/generate-visits"
VF=$(sql "SELECT id FROM visits WHERE routine_id='$RF'")
post carl "/visits/$VF/confirm-date" -d "confirmed_date=$TODAY" > /dev/null   # carl = coordinator NOT on this visit
check "F1 unassigned coordinator cannot confirm" scheduled "$(sql "SELECT status FROM visits WHERE id='$VF'")"
post cora "/visits/$VF/confirm-date" -d "confirmed_date=$TODAY" > /dev/null
post carl "/visits/$VF/reports" -F "file=@$RPT_WIN;type=application/pdf" > /dev/null
check "F1 unassigned coordinator cannot upload" 0 "$(sql "SELECT COUNT(*) FROM visit_reports WHERE visit_id='$VF'")"
post cora "/visits/$VF/reports" -F "file=@$RPT_WIN;type=application/pdf" > /dev/null
post mona "/visits/$VF/recommendations" --data-urlencode 'description=not my visit' > /dev/null   # mona = unassigned ME
check "F1 unassigned ME cannot create rec" 0 "$(sql "SELECT COUNT(*) FROM recommendations WHERE visit_id='$VF'")"
post max "/visits/$VF/recommendations" --data-urlencode 'description=legit rec' > /dev/null
RECF=$(sql "SELECT id FROM recommendations WHERE visit_id='$VF'")
post tom "/visits/$VF/recommendations/$RECF/review" -d 'decision=no_action' > /dev/null           # tom = unassigned TE
check "F1 unassigned TE cannot review" in_review "$(sql "SELECT status FROM recommendations WHERE id='$RECF'")"
post mona "/visits/$VF/close" -X POST > /dev/null
check "F1 unassigned ME cannot close" in_review "$(sql "SELECT status FROM visits WHERE id='$VF'")"
code=$(post max "/visits/$VF/reassign" --data-urlencode "vendor_coordinator_id=$CORA" --data-urlencode "maintenance_engineer_id=$MAX" --data-urlencode "technical_engineer_id=$TIA")
check "F1 non-admin cannot reassign team (coordinator unchanged)" "$CORA" "$(sql "SELECT vendor_coordinator_id FROM visits WHERE id='$VF'")"
code=$(post max "/visits/$VF/delete")
check "F1 non-admin cannot delete visit" 403 "$code"
# finish this visit cleanly
post tia "/visits/$VF/recommendations/$RECF/review" -d 'decision=no_action' > /dev/null
post max "/visits/$VF/close" -X POST > /dev/null

# F2: reschedule/cancel are coordinator-or-admin, NOT ME/TE.
RF2=$(mkroutine PERM-2 6 "$FUTURE" 2); curl -s -o /dev/null -b "$D/jar-admin.txt" -X POST "$BASE/settings/generate-visits"
VF2=$(sql "SELECT id FROM visits WHERE routine_id='$RF2'")
post max "/visits/$VF2/reschedule" --data-urlencode "new_date=$FUTURE" --data-urlencode 'reason=me trying' > /dev/null
check "F2 ME cannot reschedule" "" "$(sql "SELECT COALESCE(reschedule_reason,'') FROM visits WHERE id='$VF2'")"
post tia "/visits/$VF2/cancel" --data-urlencode 'reason=te trying' > /dev/null
check "F2 TE cannot cancel" scheduled "$(sql "SELECT status FROM visits WHERE id='$VF2'")"

# F3: impersonation - only admin; actions authorized as effective user; audit actor = real admin.
code=$(post cora /impersonate -d "user_id=$MAX")
check "F3 non-admin cannot impersonate" 403 "$code"
curl -s -o /dev/null -c "$D/jar-imp.txt" -d 'email=admin@example.com&password=admin-pass-123' "$BASE/login"
post imp /impersonate -d "user_id=$CORA" > /dev/null
post imp "/visits/$VF2/confirm-date" -d "confirmed_date=$TODAY" > /dev/null
check "F3 impersonated coordinator can confirm" date_confirmed "$(sql "SELECT status FROM visits WHERE id='$VF2'")"
AUDIT_ACTOR=$(sql "SELECT actor_id FROM audit_log WHERE table_name='visits' AND record_id='$VF2' AND new_data LIKE '%date_confirmed%' ORDER BY id DESC LIMIT 1")
check "F3 audit actor is the REAL admin, not cora" "$ADMIN" "$AUDIT_ACTOR"
# while impersonating a non-admin, admin pages must be blocked? requireRole checks REAL user -> allowed.
code=$(get imp /users)
check "F3 admin keeps admin pages while impersonating (real-user check)" 200 "$code"
post imp /impersonate/stop -X POST > /dev/null

# F4: task reassign - visit coordinator or admin only; moves assignment.
TASKF=$(sql "SELECT id FROM tasks WHERE visit_id='$VF2' AND task_type='upload_report' AND status='pending'")
code=$(post max "/tasks/$TASKF/reassign" -d "assigned_to_id=$MONA")
check "F4 ME cannot reassign task" "$CORA" "$(sql "SELECT assigned_to_id FROM tasks WHERE id='$TASKF'")"
post cora "/tasks/$TASKF/reassign" -d "assigned_to_id=$CARL" > /dev/null
check "F4 coordinator can reassign own visit's task" "$CARL" "$(sql "SELECT assigned_to_id FROM tasks WHERE id='$TASKF'")"

# F5: deactivation blocks the session on the next request.
curl -s -o /dev/null -c "$D/jar-victim.txt" -d 'email=tom@example.com&password=password123' "$BASE/login"
check "F5 tom signed in" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$D/jar-victim.txt" "$BASE/tasks")"
post admin "/users/$TOM/toggle-active" -X POST > /dev/null
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$D/jar-victim.txt" "$BASE/tasks")
[ "$code" = "302" ] && ok "F5 deactivated session redirected to login" || bad "F5 deactivated session redirected (got $code)"
post admin "/users/$TOM/toggle-active" -X POST > /dev/null   # reactivate
login tom tom@example.com password123

# G1: settings validation bounds.
post admin /settings -d 'visit_confirmation_days=0&report_upload_weeks=2&recommendations_review_days=7&technical_review_days=7' > /dev/null
check "G1 zero rejected" 14 "$(sql "SELECT config_value FROM system_config WHERE config_key='visit_confirmation_days'")"
post admin /settings -d 'visit_confirmation_days=366&report_upload_weeks=2&recommendations_review_days=7&technical_review_days=7' > /dev/null
check "G1 366 rejected" 14 "$(sql "SELECT config_value FROM system_config WHERE config_key='visit_confirmation_days'")"
post admin /settings -d 'visit_confirmation_days=abc&report_upload_weeks=2&recommendations_review_days=7&technical_review_days=7' > /dev/null
check "G1 non-numeric rejected" 14 "$(sql "SELECT config_value FROM system_config WHERE config_key='visit_confirmation_days'")"
post admin /settings -d 'visit_confirmation_days=21&report_upload_weeks=2&recommendations_review_days=7&technical_review_days=7' > /dev/null
check "G1 valid value saved" 21 "$(sql "SELECT config_value FROM system_config WHERE config_key='visit_confirmation_days'")"
post admin /settings/reset -X POST > /dev/null
check "G1 reset restores default" 14 "$(sql "SELECT config_value FROM system_config WHERE config_key='visit_confirmation_days'")"

# G2: CSV import (users) - valid rows in, duplicates rejected per-row.
printf 'full_name,email,role,password\nIna Import,ina@example.com,vendor_coordinator,password123\nDupe Person,cora@example.com,admin,password123\n' > "$D/users.csv"
CSV_WIN=$(cygpath -m "$D/users.csv")
post admin /users/import -F "file=@$CSV_WIN;type=text/csv" > /dev/null
check "G2 valid csv row imported" 1 "$(sql "SELECT COUNT(*) FROM users WHERE email='ina@example.com'")"
check "G2 duplicate email rejected (still one cora)" 1 "$(sql "SELECT COUNT(*) FROM users WHERE email='cora@example.com'")"

# G3: analytics + export respond with data.
check "G3 analytics 200" 200 "$(get admin '/analytics?months=6')"
EXPORT=$(curl -s -b "$D/jar-admin.txt" "$BASE/analytics/export?months=6" | head -3 | wc -l)
[ "$EXPORT" -ge 2 ] && ok "G3 export csv has rows" || bad "G3 export csv has rows (got $EXPORT lines)"

# G4: visit delete cascades rows AND files.
RG=$(mkroutine PERM-3 6 "$FUTURE" 2); curl -s -o /dev/null -b "$D/jar-admin.txt" -X POST "$BASE/settings/generate-visits"
VG=$(sql "SELECT id FROM visits WHERE routine_id='$RG'")
post cora "/visits/$VG/confirm-date" -d "confirmed_date=$TODAY" > /dev/null
post cora "/visits/$VG/reports" -F "file=@$RPT_WIN;type=application/pdf" > /dev/null
FKEY=$(sql "SELECT file_key FROM visit_reports WHERE visit_id='$VG'")
TESTFILES="${VT_FILES:-$(dirname "$0")/../../data/test-reports}"
[ -f "$TESTFILES/$FKEY" ] && ok "G4 file exists before delete" || bad "G4 file exists before delete"
post admin "/visits/$VG/delete" -X POST > /dev/null
check "G4 visit gone" 0 "$(sql "SELECT COUNT(*) FROM visits WHERE id='$VG'")"
check "G4 tasks cascaded" 0 "$(sql "SELECT COUNT(*) FROM tasks WHERE visit_id='$VG'")"
check "G4 report rows cascaded" 0 "$(sql "SELECT COUNT(*) FROM visit_reports WHERE visit_id='$VG'")"
[ ! -f "$TESTFILES/$FKEY" ] && ok "G4 file removed from disk" || bad "G4 file removed from disk"

# G5: change own password + login with it; wrong current rejected.
post mona /account/password -d 'current_password=wrong&new_password=newpass12345' > /dev/null
login mona2 mona@example.com password123
check "G5 wrong current password keeps old" 200 "$(get mona2 /tasks)"
post mona /account/password -d 'current_password=password123&new_password=newpass12345' > /dev/null
curl -s -o /dev/null -c "$D/jar-mona3.txt" -d 'email=mona@example.com&password=newpass12345' "$BASE/login"
check "G5 login with new password" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$D/jar-mona3.txt" "$BASE/tasks")"

# G6: cross-user report download - any signed-in user may download? (check intent)
RG6=$(mkroutine PERM-4 6 "$FUTURE" 2); curl -s -o /dev/null -b "$D/jar-admin.txt" -X POST "$BASE/settings/generate-visits"
VG6=$(sql "SELECT id FROM visits WHERE routine_id='$RG6'")
post cora "/visits/$VG6/confirm-date" -d "confirmed_date=$TODAY" > /dev/null
post cora "/visits/$VG6/reports" -F "file=@$RPT_WIN;type=application/pdf" > /dev/null
RID=$(sql "SELECT id FROM visit_reports WHERE visit_id='$VG6'")
check "G6 unassigned user can download report (by design? all roles see visits)" 200 "$(get tom "/visits/$VG6/reports/$RID/download")"
check "G6 anonymous download blocked" 302 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/visits/$VG6/reports/$RID/download")"

# E2 rerun: global invariant after all permission probes.
BADROWS=$(sql "SELECT COUNT(*) FROM tasks t JOIN visits v ON v.id=t.visit_id WHERE v.status IN ('completed','cancelled') AND t.status IN ('pending','in_progress','overdue')")
check "F/G invariant: no open tasks on closed/cancelled visits" 0 "$BADROWS"

echo "=== group F/G: $PASS passed, $FAIL failed ==="
