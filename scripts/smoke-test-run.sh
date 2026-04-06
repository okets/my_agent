#!/usr/bin/env bash
set -euo pipefail

# Smoke Test Run — fires a real automation against the live dashboard and verifies artifacts.
# Prerequisite: run smoke-test-reset.sh first.
#
# Flow:
#   1. Write automation manifest to disk (no REST create endpoint)
#   2. Restart dashboard so syncAll() indexes it
#   3. Fire via POST /api/automations/:id/fire
#   4. Poll for job completion
#   5. Verify artifacts on disk

AGENT_DIR="${MY_AGENT_DIR:-$(cd "$(dirname "$0")/.." && pwd)/.my_agent}"
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:4321}"
PASS=true
AUTOMATION_ID="smoke-test-modify-cap"

echo "=== Smoke Test: Agentic Flow ==="

# Step 1: Write automation manifest to disk
echo "[test] Writing automation manifest..."
cat > "$AGENT_DIR/automations/$AUTOMATION_ID.md" << 'AUTOMEOF'
---
name: smoke-test-modify-cap
status: active
trigger:
  - type: manual
notify: immediate
once: true
target_path: .my_agent/capabilities/smoke-test-cap
todos:
  - text: Read current process.sh and config.yaml
  - text: Add --verbose flag handling to process.sh
  - text: Update config.yaml with verbose setting
  - text: Test the script with and without --verbose
job_type: capability_modify
created: 2026-04-06T00:00:00.000Z
---

Modify the smoke-test-cap capability: add a --verbose flag to process.sh that prints extra debug output when passed. Update config.yaml to include verbose: true as the default setting.

## Current State

The capability is at .my_agent/capabilities/smoke-test-cap/ with:
- scripts/process.sh — echoes input back as JSON
- config.yaml — has language and format settings
- CAPABILITY.md — basic frontmatter

## What to Change

1. In process.sh: detect a --verbose flag. If present, print debug info before the JSON output.
2. In config.yaml: add `verbose: true` line.
3. Test both modes work.
AUTOMEOF

# Step 2: Restart dashboard to sync the new automation
echo "[test] Restarting dashboard to sync automation..."
systemctl --user restart nina-dashboard.service
sleep 3

# Verify dashboard is up
if ! curl -sf "$DASHBOARD_URL/" > /dev/null 2>&1; then
  echo "[FAIL] Dashboard not responding after restart"
  exit 1
fi

# Verify automation was indexed
echo "[test] Verifying automation indexed..."
AUTOMATION_CHECK=$(curl -sf "$DASHBOARD_URL/api/automations/$AUTOMATION_ID" 2>/dev/null || echo "")
if echo "$AUTOMATION_CHECK" | grep -q "smoke-test-modify-cap"; then
  echo "[test] Automation found in index"
else
  echo "[FAIL] Automation not found in dashboard after sync"
  echo "Response: $AUTOMATION_CHECK"
  exit 1
fi

# Step 3: Fire the automation
echo "[test] Firing automation..."
FIRE_RESPONSE=$(curl -sf "$DASHBOARD_URL/api/automations/$AUTOMATION_ID/fire" -X POST 2>/dev/null || echo "")
if echo "$FIRE_RESPONSE" | grep -q '"ok":true'; then
  echo "[test] Automation fired successfully"
else
  echo "[FAIL] Could not fire automation"
  echo "Response: $FIRE_RESPONSE"
  exit 1
fi

# Step 4: Poll for job completion (timeout: 5 minutes)
echo "[test] Waiting for job to complete..."
TIMEOUT=300
ELAPSED=0
JOB_STATUS="pending"
JOB_ID=""

while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  JOBS_RESPONSE=$(curl -sf "$DASHBOARD_URL/api/automations/$AUTOMATION_ID/jobs" 2>/dev/null || echo "")
  JOB_STATUS=$(echo "$JOBS_RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    jobs = data.get('jobs', [])
    if jobs:
        print(jobs[0].get('status', 'pending'))
    else:
        print('pending')
except:
    print('pending')
" 2>/dev/null || echo "pending")
  JOB_ID=$(echo "$JOBS_RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    jobs = data.get('jobs', [])
    if jobs:
        print(jobs[0].get('id', ''))
    else:
        print('')
except:
    print('')
" 2>/dev/null || echo "")

  if [ "$JOB_STATUS" = "completed" ] || [ "$JOB_STATUS" = "needs_review" ] || [ "$JOB_STATUS" = "failed" ] || [ "$JOB_STATUS" = "interrupted" ]; then
    break
  fi

  echo "  ... $JOB_STATUS (${ELAPSED}s) job=$JOB_ID"
  sleep 10
  ELAPSED=$((ELAPSED + 10))
done

echo "[test] Job finished: status=$JOB_STATUS, id=$JOB_ID"

if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
  echo "[FAIL] Timed out waiting for job completion"
  PASS=false
fi

# Step 5: Check artifacts
echo ""
echo "=== Artifact Verification ==="

# 5a. Find the run directory
RUN_DIR="$AGENT_DIR/automations/.runs/$AUTOMATION_ID/$JOB_ID"
if [ ! -d "$RUN_DIR" ]; then
  # Try to find it
  RUN_DIR=$(find "$AGENT_DIR/automations/.runs/$AUTOMATION_ID" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -1)
fi

if [ -z "$RUN_DIR" ] || [ ! -d "$RUN_DIR" ]; then
  echo "[FAIL] Run directory not found"
  echo "Looked in: $AGENT_DIR/automations/.runs/$AUTOMATION_ID/"
  PASS=false
else
  echo "[CHECK] Run directory: $RUN_DIR"

  # 5b. Check todos.json
  TODOS_FILE="$RUN_DIR/todos.json"
  if [ -f "$TODOS_FILE" ]; then
    echo "[CHECK] todos.json exists: YES"

    TODOS_STATS=$(python3 -c "
import json
d = json.load(open('$TODOS_FILE'))
items = d.get('items', [])
total = len(items)
done = len([i for i in items if i.get('status') == 'done'])
mandatory = len([i for i in items if i.get('mandatory')])
mandatory_done = len([i for i in items if i.get('mandatory') and i.get('status') == 'done'])
blocked = len([i for i in items if i.get('mandatory') and i.get('status') == 'blocked'])
print(f'{done}/{total} done ({mandatory_done}/{mandatory} mandatory done, {blocked} blocked)')
" 2>/dev/null || echo "parse error")

    echo "[CHECK] Todo items: $TODOS_STATS"
  else
    echo "[FAIL] todos.json NOT FOUND at $TODOS_FILE"
    PASS=false
  fi

  # 5c. Check deliverable
  DELIVERABLE="$RUN_DIR/deliverable.md"
  if [ -f "$DELIVERABLE" ]; then
    echo "[CHECK] deliverable.md exists: YES"

    if grep -q "change_type:" "$DELIVERABLE"; then
      CHANGE_TYPE=$(grep "change_type:" "$DELIVERABLE" | head -1 | sed 's/.*change_type:\s*//')
      echo "[CHECK] change_type: $CHANGE_TYPE"
      if [ "$CHANGE_TYPE" = "unknown" ]; then
        echo "[FAIL] change_type is 'unknown'"
        PASS=false
      fi
    else
      echo "[WARN] No change_type in deliverable frontmatter"
    fi
  else
    echo "[WARN] deliverable.md not found (may be in job response)"
  fi
fi

# 5d. Check DECISIONS.md was updated
DECISIONS="$AGENT_DIR/capabilities/smoke-test-cap/DECISIONS.md"
if [ -f "$DECISIONS" ]; then
  ENTRY_COUNT=$(grep -c "^## " "$DECISIONS" 2>/dev/null || echo "0")
  if [ "$ENTRY_COUNT" -gt 0 ]; then
    echo "[CHECK] DECISIONS.md has $ENTRY_COUNT entries: YES"
  else
    echo "[WARN] DECISIONS.md exists but has no entries"
  fi
else
  echo "[FAIL] DECISIONS.md not found"
  PASS=false
fi

# 5e. Check capability was actually modified
if [ -f "$AGENT_DIR/capabilities/smoke-test-cap/scripts/process.sh" ]; then
  if grep -q "verbose" "$AGENT_DIR/capabilities/smoke-test-cap/scripts/process.sh"; then
    echo "[CHECK] process.sh contains verbose flag: YES"
  else
    echo "[WARN] process.sh does not mention verbose"
  fi

  if grep -q "verbose" "$AGENT_DIR/capabilities/smoke-test-cap/config.yaml" 2>/dev/null; then
    echo "[CHECK] config.yaml contains verbose setting: YES"
  else
    echo "[WARN] config.yaml does not mention verbose"
  fi
fi

# 5f. Check job status
echo "[CHECK] Final job status: $JOB_STATUS"
if [ "$JOB_STATUS" != "completed" ] && [ "$JOB_STATUS" != "needs_review" ]; then
  echo "[FAIL] Expected 'completed' or 'needs_review', got '$JOB_STATUS'"
  PASS=false
fi

# 5g. Check notification was created
NOTIF_COUNT=$(find "$AGENT_DIR/notifications" -name "*$AUTOMATION_ID*" -o -name "*$JOB_ID*" 2>/dev/null | wc -l)
echo "[CHECK] Notifications for this job: $NOTIF_COUNT"

echo ""
echo "=== Results ==="
if [ "$PASS" = true ]; then
  echo "SMOKE TEST: PASS"
  echo "All checks passed. The agentic flow works correctly."
else
  echo "SMOKE TEST: FAIL"
  echo "Some checks failed. Review output above."
  echo ""
  echo "To retry: ./scripts/smoke-test-reset.sh && ./scripts/smoke-test-run.sh"
fi
