#!/bin/bash
# Seed the isolated test instance: admin, role users (assigned + unassigned spares), vendor.
source "$(dirname "$0")/lib.sh"
: > "$FINDINGS"

curl -s -o /dev/null -c "$D/jar-admin.txt" -d 'full_name=Admin&email=admin@example.com&password=admin-pass-123' "$BASE/setup"
for u in 'Cora Coordinator|cora@example.com|vendor_coordinator' \
         'Max Engineer|max@example.com|maintenance_engineer' \
         'Tia Engineer|tia@example.com|technical_engineer' \
         'Carl Coordinator2|carl@example.com|vendor_coordinator' \
         'Mona Engineer2|mona@example.com|maintenance_engineer' \
         'Tom Engineer2|tom@example.com|technical_engineer'; do
  IFS='|' read -r name email role <<< "$u"
  curl -s -o /dev/null -b "$D/jar-admin.txt" \
    --data-urlencode "full_name=$name" --data-urlencode "email=$email" \
    --data-urlencode "password=password123" --data-urlencode "role=$role" "$BASE/users"
done
curl -s -o /dev/null -b "$D/jar-admin.txt" --data-urlencode 'name=Acme Pumps' --data-urlencode 'vendor_number=V-100' "$BASE/vendors"

for j in cora max tia carl mona tom; do login "$j" "$j@example.com" password123; done

check "seeded users" 7 "$(sql 'SELECT COUNT(*) FROM users')"
check "seeded vendor" 1 "$(sql 'SELECT COUNT(*) FROM vendors')"
echo "=== seed: $PASS passed, $FAIL failed ==="
