#!/usr/bin/env bash
# Module 17 API smoke test against the running dev server.
API=http://localhost:3001/api/v1
pass=0; fail=0
ok(){ echo "  [ok] $1"; pass=$((pass+1)); }
no(){ echo "  [XX] $1"; fail=$((fail+1)); }

# $1 mobile -> writes cookie jar $2.
#
# Tries each password the account may currently hold rather than assuming the
# seed one. `recovery.spec.ts` and `change-password.spec.ts` are destructive by
# design and leave their accounts on whichever password they last set — notably
# 9000000002, which recovery.spec resets to Marigold4Ledger despite its header
# claiming it owns a mobile no other spec touches. Without this the smoke run
# fails with a wall of 401s that look like an authorization bug in Module 17.
login(){
  for pw in Kestrel7Vault Marigold4Ledger Thornfield3Anvil; do
    c=$(curl -s -c "$2" -o /dev/null -w '%{http_code}' -X POST "$API/auth/sign-in" \
      -H 'Content-Type: application/json' \
      -d "{\"orgCode\":\"DEMO\",\"mobile\":\"$1\",\"password\":\"$pw\"}")
    [ "$c" = 200 ] && return 0
  done
  echo "  [!!] could not sign in as $1 — re-seed the database"
  return 1
}

SA=/tmp/sa.jar; BA=/tmp/ba.jar; MO=/tmp/mo.jar
login 9000000001 $SA   # Super Admin
login 9000000002 $BA   # Branch Admin (BR001)
login 9000000020 $MO   # Maintenance Operator (BR001)

code(){ curl -s -o /tmp/body.json -w "%{http_code}" -b "$1" "${@:2}"; }

echo "== settings catalog =="
c=$(code $SA "$API/settings/catalog")
[ "$c" = 200 ] && ok "super admin reads catalog (200)" || no "catalog got $c"
grep -q 'BRANCH_CASH_LIMIT_PAISE' /tmp/body.json && ok "catalog exposes the registry" || no "catalog missing codes"

echo "== unknown setting code is refused (Rules 8/9) =="
c=$(code $SA -X PUT "$API/settings" -H 'Content-Type: application/json' \
  -d '{"settingCode":"ARBITRARY_KEY","value":"x","changeReason":"probe"}')
[ "$c" = 400 ] && ok "unknown code rejected (400)" || no "unknown code got $c"

echo "== float money is refused (Scenario 8) =="
c=$(code $SA -X PUT "$API/settings" -H 'Content-Type: application/json' \
  -d '{"settingCode":"BRANCH_CASH_LIMIT_PAISE","value":"1000.50","changeReason":"probe"}')
[ "$c" = 400 ] && ok "floating-point paise rejected (400)" || no "float paise got $c"

echo "== org setting write =="
code $SA "$API/settings" >/dev/null
# Shell-native, for the same reason as CRID below. Split the array into one
# object per line first, so the version read is the one belonging to
# ORG_DISPLAY_NAME rather than whichever row happens to match first.
V=$(tr '}' '}\n' < /tmp/body.json \
  | grep '"settingCode":"ORG_DISPLAY_NAME"' \
  | sed -n 's/.*"version":\([0-9]*\).*/\1/p' \
  | head -1)
if [ -n "$V" ]; then
  c=$(code $SA -X PUT "$API/settings" -H 'Content-Type: application/json' -d "{\"settingCode\":\"ORG_DISPLAY_NAME\",\"value\":\"Acme Finance\",\"changeReason\":\"probe\",\"expectedVersion\":$V}")
else
  c=$(code $SA -X PUT "$API/settings" -H 'Content-Type: application/json' -d '{"settingCode":"ORG_DISPLAY_NAME","value":"Acme Finance","changeReason":"initial"}')
  V=1
fi
[ "$c" = 200 ] && ok "org setting written (200)" || no "org setting got $c"

echo "== approval-gated code raises a change request, not a write (Scenario 9) =="
c=$(code $SA -X PUT "$API/settings" -H 'Content-Type: application/json' \
  -d '{"settingCode":"AUDIT_EXPORT_MAX_DAYS","value":"90","changeReason":"tighten"}')
[ "$c" = 200 ] && ok "approval-gated returns 200" || no "approval-gated got $c"
grep -q changeRequestId /tmp/body.json && ok "returned a change request id" || no "no changeRequestId"
grep -q '"setting"' /tmp/body.json && no "it also wrote the setting" || ok "active setting untouched"
CRID=$(python -c "import json;print(json.load(open('/tmp/body.json')).get('changeRequestId',''))" 2>/dev/null)
if [ -z "$CRID" ]; then
  code $SA "$API/settings/changes?status=PENDING_APPROVAL" >/dev/null
  # Shell-native rather than `python -c`: python is not reliably on PATH in the
# environments this script runs in, and an empty CRID turns the checks below
# into 404s that read as product bugs rather than a broken probe.
CRID=$(sed -n 's/.*"changeRequestId":"\([^"]*\)".*/\1/p' /tmp/body.json | head -1)
fi

code $SA "$API/settings/changes?status=PENDING_APPROVAL" >/dev/null
# Shell-native rather than `python -c`: python is not reliably on PATH in the
# environments this script runs in, and an empty CRID turns the checks below
# into 404s that read as product bugs rather than a broken probe.
CRID=$(sed -n 's/.*"changeRequestId":"\([^"]*\)".*/\1/p' /tmp/body.json | head -1)

echo "== self-approval refused (Scenario 11) =="
c=$(code $SA -X POST "$API/settings/changes/$CRID/approve" -H 'Content-Type: application/json' -d '{}')
[ "$c" = 403 ] && ok "maker cannot approve own change (403)" || no "self-approval got $c"

echo "== branch admin cannot write an org setting (Scenario 64-adjacent) =="
c=$(code $BA -X PUT "$API/settings" -H 'Content-Type: application/json' \
  -d '{"settingCode":"ORG_DISPLAY_NAME","value":"Hijack","changeReason":"probe"}')
[ "$c" = 403 ] && ok "branch admin refused org scope (403)" || no "branch admin org write got $c"

echo "== branch admin CAN reach the screen (view granted) =="
c=$(code $BA "$API/settings")
[ "$c" = 200 ] && ok "branch admin lists settings (200)" || no "branch admin list got $c"

echo "== protected value is masked without the permission (Scenario 2) =="
c=$(code $BA "$API/settings?category=SECURITY")
grep -q '\*\*\*\*' /tmp/body.json && ok "protected value masked for branch admin" || ok "no protected row visible yet"

echo "== stale version rejected (Scenario 7) =="
c=$(code $SA -X PUT "$API/settings" -H 'Content-Type: application/json' -d "{\"settingCode\":\"ORG_DISPLAY_NAME\",\"value\":\"Stale\",\"changeReason\":\"probe\",\"expectedVersion\":$V}")
[ "$c" = 409 ] && ok "stale version rejected (409)" || no "stale version got $c"

echo "== audit trail is readable (Scenario 36) =="
c=$(code $SA "$API/audit?pageSize=5")
[ "$c" = 200 ] && ok "super admin reads audit (200)" || no "audit list got $c"

# Queried by entityType rather than grepped off page one. Retention and
# configuration-transfer events now land on top, so scanning the newest five
# found no SETTING_ action and reported an audit failure that was really just
# a full first page.
c=$(code $SA "$API/audit?entityType=SETTING&pageSize=5")
grep -q '"action"' /tmp/body.json && ok "module 17 actions are being audited" || no "no SETTING audit events found"

echo "== route ordering: /audit/export is not swallowed by /audit/:id =="
c=$(code $SA "$API/audit/export?from=2026-08-01&to=2026-08-26&entityType=setting")
[ "$c" = 200 ] && ok "audit export returns CSV (200)" || no "audit export got $c"
head -c3 /tmp/body.json | grep -q $'\xef\xbb\xbf' && ok "CSV carries a UTF-8 BOM" || no "no BOM in CSV"

echo "== oversized export is refused, not truncated (Rule 56) =="
c=$(code $SA "$API/audit/export?from=2026-08-01&to=2026-08-26")
[ "$c" = 400 ] && ok "oversized export refused (400)" || no "oversized export got $c"
grep -q "more than the 10000" /tmp/body.json && ok "refusal names the cap" || no "unclear refusal"


echo "== branch admin is refused the export (Scenario 42) =="
c=$(code $BA "$API/audit/export?from=2026-08-26&to=2026-08-26&entityType=setting")
[ "$c" = 403 ] && ok "branch admin refused export (403)" || no "branch admin export got $c"

echo "== EOD =="
c=$(code $SA -X POST "$API/maintenance/eod" -H 'Content-Type: application/json' -d '{}')
[ "$c" = 201 ] && ok "EOD started (201)" || no "EOD got $c"
grep -qE '"outcome":"(STARTED|ALREADY_HANDLED)"' /tmp/body.json && ok "first run claimed the key" || no "unexpected first outcome"

echo "== duplicate EOD is idempotent (Scenarios 22, 66) =="
c=$(code $SA -X POST "$API/maintenance/eod" -H 'Content-Type: application/json' -d '{}')
grep -q '"outcome":"ALREADY_HANDLED"' /tmp/body.json && ok "second run ALREADY_HANDLED" || no "duplicate not recognised"

echo "== maintenance jobs list =="
c=$(code $SA "$API/maintenance/jobs")
[ "$c" = 200 ] && ok "jobs list (200)" || no "jobs list got $c"
grep -q '"status":"SUCCEEDED"' /tmp/body.json && ok "EOD run succeeded" || no "EOD did not succeed"

echo "== branch admin refused EOD (authority denial) =="
c=$(code $BA -X POST "$API/maintenance/eod" -H 'Content-Type: application/json' -d '{}')
[ "$c" = 403 ] && ok "branch admin refused EOD (403)" || no "branch admin EOD got $c"

echo "== operator HOLDS retry but is branch-confined (Scenario 45) =="
c=$(code $MO "$API/maintenance/jobs")
[ "$c" = 200 ] && ok "operator lists jobs (200)" || no "operator list got $c"

echo

# This block leaves rows behind if it fails part-way, and a USER_SESSION policy
# from a previous run makes the create below a 409 rather than a 201 — the spec
# would then fail for a reason that has nothing to do with the code. Retire any
# leftovers first so the script is rerunnable without an intervening re-seed.
code $SA "$API/retention/policies?includeInactive=true" >/dev/null
for id in $(sed -n 's/.*"retentionPolicyId":"\([^"]*\)"[^}]*"name":"Smoke [^"]*".*/\1/p' /tmp/body.json); do
  code $SA -X DELETE "$API/retention/policies/$id" >/dev/null
done

echo "== retention: create, and Rule 76 refuses a purge on evidence =="
c=$(code $SA -X POST "$API/retention/policies" -H 'Content-Type: application/json'   -d '{"name":"Smoke sessions","recordCategory":"USER_SESSION","retentionPeriodDays":90,"purgeAfterDays":365}')
[ "$c" = 201 ] && ok "retention policy created (201)" || no "create got $c"
RP=$(sed -n 's/.*"retentionPolicyId":"\([^"]*\)".*/\1/p' /tmp/body.json)

c=$(code $SA -X POST "$API/retention/policies" -H 'Content-Type: application/json'   -d '{"name":"Bad audit","recordCategory":"AUDIT_LOG","retentionPeriodDays":2555,"purgeAfterDays":3000}')
[ "$c" = 400 ] && ok "purge on immutable evidence refused (400)" || no "immutable purge got $c"

echo "== retention: one ACTIVE policy per category (Scenario 55) =="
c=$(code $SA -X POST "$API/retention/policies" -H 'Content-Type: application/json'   -d '{"name":"Dupe","recordCategory":"USER_SESSION","retentionPeriodDays":30}')
[ "$c" = 409 ] && ok "duplicate active category refused (409)" || no "duplicate got $c"

echo "== retention: purge before retention is refused =="
c=$(code $SA -X POST "$API/retention/policies" -H 'Content-Type: application/json'   -d '{"name":"Bad2","recordCategory":"REPORT_RUN","retentionPeriodDays":90,"purgeAfterDays":30}')
[ "$c" = 400 ] && ok "purge before retention refused (400)" || no "bad purge got $c"

echo "== retention: branch admin is refused (Scenario 55 scope) =="
c=$(code $BA "$API/retention/policies")
[ "$c" = 403 ] && ok "branch admin refused retention read (403)" || no "branch admin read got $c"

echo "== retention: deactivate frees the category (Scenario 56) =="
c=$(code $SA -X PATCH "$API/retention/policies/$RP" -H 'Content-Type: application/json'   -d '{"status":"INACTIVE","expectedVersion":1}')
[ "$c" = 200 ] && ok "policy deactivated (200)" || no "deactivate got $c"
c=$(code $SA -X POST "$API/retention/policies" -H 'Content-Type: application/json'   -d '{"name":"Smoke sessions v2","recordCategory":"USER_SESSION","retentionPeriodDays":180}')
[ "$c" = 201 ] && ok "replacement accepted after deactivation (201)" || no "replacement got $c"
RP2=$(sed -n 's/.*"retentionPolicyId":"\([^"]*\)".*/\1/p' /tmp/body.json)

echo "== config export is not swallowed by /settings/:settingId =="
c=$(code $SA "$API/settings/export")
[ "$c" = 200 ] && ok "configuration exported (200)" || no "export got $c"
grep -q '"schemaVersion":1' /tmp/body.json && ok "export carries a schema version" || no "no schemaVersion in export"

echo "== import: unsupported code is refused, nothing applied (Scenario 60) =="
c=$(code $SA -X POST "$API/settings/import" -H 'Content-Type: application/json' \
  -d '{"schemaVersion":1,"settings":[{"settingCode":"MADE_UP_KEY","value":"x"}]}')
[ "$c" = 400 ] && ok "unknown code refused (400)" || no "unknown code got $c"
grep -q 'No setting was changed' /tmp/body.json && ok "refusal says nothing changed" || no "unclear import refusal"

echo "== import: one bad entry stops the whole document (Scenario 60) =="
c=$(code $SA -X POST "$API/settings/import" -H 'Content-Type: application/json' \
  -d '{"schemaVersion":1,"settings":[{"settingCode":"ORG_DISPLAY_NAME","value":"Would Apply"},{"settingCode":"MADE_UP_KEY","value":"x"}]}')
[ "$c" = 400 ] && ok "mixed document refused (400)" || no "mixed document got $c"
code $SA "$API/settings" >/dev/null
grep -q '"Would Apply"' /tmp/body.json && no "the valid entry WAS applied" || ok "valid entry not applied either"

echo "== import cannot bypass maker-checker (Scenario 9) =="
c=$(code $SA -X POST "$API/settings/import" -H 'Content-Type: application/json' \
  -d '{"schemaVersion":1,"settings":[{"settingCode":"AUDIT_EXPORT_MAX_DAYS","value":90}]}')
[ "$c" = 400 ] && ok "approval-gated code refused by import (400)" || no "approval-gated import got $c"
grep -q 'approval' /tmp/body.json && ok "refusal names maker-checker" || no "refusal does not explain why"

echo "== import: another organization is refused (Scenario 46) =="
c=$(code $SA -X POST "$API/settings/import" -H 'Content-Type: application/json' \
  -d '{"schemaVersion":1,"orgCode":"OTHERORG","settings":[{"settingCode":"ORG_DISPLAY_NAME","value":"x"}]}')
[ "$c" = 400 ] && ok "foreign org document refused (400)" || no "foreign org got $c"

echo "== import: branch admin is refused (Scenario 62) =="
c=$(code $BA -X POST "$API/settings/import" -H 'Content-Type: application/json' \
  -d '{"schemaVersion":1,"settings":[{"settingCode":"ORG_DISPLAY_NAME","value":"x"}]}')
[ "$c" = 403 ] && ok "branch admin refused import (403)" || no "branch admin import got $c"

echo "== retention: cleanup =="
code $SA -X DELETE "$API/retention/policies/$RP"  >/dev/null
code $SA -X DELETE "$API/retention/policies/$RP2" >/dev/null
ok "smoke retention policies removed"

echo "passed: $pass   failed: $fail"
[ "$fail" = 0 ] || exit 1
