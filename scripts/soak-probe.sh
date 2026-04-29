#!/usr/bin/env bash
# Fast-iteration probe for M9.4-S4.2 delivery path.
#
# Tests the structural delivery-path properties (Read-tool narration,
# tool-call leakage, tomorrow/background dismissal patterns, content
# rendering) in ~60-90 seconds per iteration instead of waiting 24h for the
# 07:00 BKK morning brief.
#
# See docs/sprints/m9.4-s4.2-action-request-delivery/fast-iteration-protocol.md
# for the full design rationale.
#
# Strategy A (default): create a fresh probe conversation per fire, restore
#   user's conversation as current after. Cleanest signal — no inter-fire
#   contamination. Tests the "first delivery into a fresh state" path.
#
# Strategy B: rotate sdk_session_id on a single sacrificial test conversation.
#   Tests the "fresh SDK session in an existing conversation" path (matches
#   L3b in fu1).
#
# Trigger 2 (default): inject synthetic notification via debug endpoint.
#   Bypasses the worker pipeline; full control over `n.summary`. Tests the
#   action-request prompt-shape change (fu2).
#
# Trigger 1 (NOT YET IMPLEMENTED): fire the actual debrief-reporter.
#
# Usage:
#   ./scripts/soak-probe.sh                    # Strategy A, Trigger 2 (defaults)
#   ./scripts/soak-probe.sh --strategy=B
#   for i in 1 2 3 4 5; do ./scripts/soak-probe.sh || break; done
#
# Exits 0 on PASS, 1 on FAIL (regression patterns matched), 2 on infrastructure
# error (server unreachable, conv create failed, etc.).

set -euo pipefail

# ── config ──────────────────────────────────────────────────────────────────

STRATEGY="${STRATEGY:-A}"
TRIGGER="${TRIGGER:-2}"
DASHBOARD="${DASHBOARD:-http://localhost:4321}"
AGENT_DIR="${AGENT_DIR:-$HOME/my_agent/.my_agent}"
WAIT_SECS="${WAIT_SECS:-30}"  # heartbeat drainNow returns when delivery completes; this is a safety buffer
SACRIFICIAL_CONV="${SACRIFICIAL_CONV:-conv-FAST-ITERATION-PROBE}"

# Parse --strategy=A|B  --trigger=1|2  --wait=N
for arg in "$@"; do
  case "$arg" in
    --strategy=*) STRATEGY="${arg#*=}" ;;
    --trigger=*) TRIGGER="${arg#*=}" ;;
    --wait=*) WAIT_SECS="${arg#*=}" ;;
    -h|--help)
      grep -E "^# " "$0" | head -40
      exit 0
      ;;
    *) echo "[probe] Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

NONCE="$(date +%s)-$RANDOM"

# ── helpers ─────────────────────────────────────────────────────────────────

log() { echo "[probe] $*"; }
fail() { echo "[probe] $*" >&2; exit "${2:-1}"; }

require_localhost() {
  curl -fsS -o /dev/null "$DASHBOARD/api/auth/status" 2>/dev/null \
    || fail "Dashboard not reachable at $DASHBOARD" 2
}

# Extract a JSON field from stdin via python3 (avoids jq dependency)
json_get() {
  python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('$1', ''))"
}

# Read the latest assistant turn's content from a conversation jsonl
latest_assistant_content() {
  local jsonl_path="$1"
  python3 -c "
import json, sys
last = None
with open('$jsonl_path') as f:
    for line in f:
        try:
            row = json.loads(line)
        except Exception:
            continue
        if row.get('type') == 'turn' and row.get('role') == 'assistant':
            last = row
print(last.get('content', '') if last else '')
"
}

# Strategy-A cleanup: delete the probe conv + restore the user's previous-current
# (must be defined before any call site that references it).
cleanup_strategy_a() {
  if [[ "${STRATEGY:-A}" != "A" ]]; then return 0; fi

  # Delete probe conversation
  if [[ -n "${CONV_ID:-}" ]]; then
    curl -fsS -X POST "$DASHBOARD/api/admin/conversation/$CONV_ID/delete" >/dev/null 2>&1 \
      || log "  (warn) failed to delete probe conv $CONV_ID"
  fi

  # Restore previous current (if any)
  if [[ -n "${PREVIOUS_CURRENT:-}" ]]; then
    curl -fsS -X POST "$DASHBOARD/api/admin/conversation/$PREVIOUS_CURRENT/activate" >/dev/null 2>&1 \
      || log "  (warn) failed to activate previous current $PREVIOUS_CURRENT"
  fi
}

# ── Strategy: pre-flight ────────────────────────────────────────────────────

require_localhost

log "Strategy=$STRATEGY  Trigger=$TRIGGER  Nonce=$NONCE"

PREVIOUS_CURRENT=""

if [[ "$STRATEGY" == "A" ]]; then
  # Create fresh conv. POST /api/admin/conversations response includes
  # previous_current_id (post-fu2-probe deploy) so we can restore later.
  CREATE_JSON="$(curl -fsS -X POST "$DASHBOARD/api/admin/conversations" \
    -H 'Content-Type: application/json' -d '{}')" \
    || fail "Failed to create probe conversation" 2

  CONV_ID="$(echo "$CREATE_JSON" | json_get id)"
  PREVIOUS_CURRENT="$(echo "$CREATE_JSON" | json_get previous_current_id)"
  [[ -n "$CONV_ID" ]] || fail "Probe conversation creation returned empty id" 2

  log "Created fresh probe conv: $CONV_ID  (previous current: ${PREVIOUS_CURRENT:-none})"
elif [[ "$STRATEGY" == "B" ]]; then
  CONV_ID="$SACRIFICIAL_CONV"
  log "Using sacrificial conv: $CONV_ID (Strategy B requires manual setup of this conv + sdk_session_id rotation; not implemented in this iteration)"
  fail "Strategy B not yet implemented — use Strategy A for fu2 validation" 2
else
  fail "Unknown strategy: $STRATEGY" 2
fi

# ── stage synthetic content with NONCE ──────────────────────────────────────

read -r -d '' SUMMARY <<EOF || true
## Sensor Reading ($NONCE)

**Reading: 145 (above threshold)**
Measurement: ~52 units

## News ($NONCE)

- Test news item one
- Test news item two

## Events ($NONCE)

- Test event one
- Test event two
EOF

RUN_DIR="/tmp/probe-runs/probe-$NONCE"

# ── trigger ─────────────────────────────────────────────────────────────────

if [[ "$TRIGGER" == "2" ]]; then
  log "Trigger 2: injecting synthetic notification via /api/debug/notification"
  PAYLOAD="$(python3 -c "
import json, sys
print(json.dumps({
    'type': 'job_completed',
    'automation_id': 'probe',
    'summary': '''$SUMMARY''',
    'run_dir': '$RUN_DIR',
}))
")"
  RESP="$(curl -fsS -X POST "$DASHBOARD/api/debug/notification" \
    -H 'Content-Type: application/json' \
    -d "$PAYLOAD")" || fail "POST /api/debug/notification failed" 2
  log "  enqueue+drainNow returned: $(echo "$RESP" | head -c 200)"
elif [[ "$TRIGGER" == "1" ]]; then
  fail "Trigger 1 (real automation fire) not yet implemented" 2
else
  fail "Unknown trigger: $TRIGGER" 2
fi

# ── wait for delivery to complete ───────────────────────────────────────────

# drainNow returns when the alert chain completes, so the assistant turn
# should already be persisted. This sleep is a safety buffer for transcript
# write to settle to disk.
log "Waiting ${WAIT_SECS}s for transcript write to settle..."
sleep "$WAIT_SECS"

# ── extract turn ────────────────────────────────────────────────────────────

TURN_PATH="$AGENT_DIR/conversations/${CONV_ID}.jsonl"
if [[ ! -f "$TURN_PATH" ]]; then
  cleanup_strategy_a
  fail "No conversation file at $TURN_PATH" 1
fi

TURN="$(latest_assistant_content "$TURN_PATH")"
if [[ -z "$TURN" ]]; then
  cleanup_strategy_a
  fail "No assistant turn found in $TURN_PATH" 1
fi

# ── pattern checks ──────────────────────────────────────────────────────────

FAIL_COUNT=0
RESULTS=""

check() {
  local label="$1"; local invert="$2"; local pattern="$3"
  if grep -qiE "$pattern" <<<"$TURN"; then
    if [[ "$invert" == "must-absent" ]]; then
      RESULTS+="  ✗ $label (FAIL — pattern matched)\n"; FAIL_COUNT=$((FAIL_COUNT + 1))
    else
      RESULTS+="  ✓ $label\n"
    fi
  else
    if [[ "$invert" == "must-absent" ]]; then
      RESULTS+="  ✓ $label\n"
    else
      RESULTS+="  ✗ $label (FAIL — pattern not matched)\n"; FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  fi
}

# Regression patterns — must all be ABSENT (fu2 PASS criteria)
check "Read narration absent"        "must-absent" "(let me read|let me render|i'?ll (read|render)|i (have|need to) read)"
check "Tool intent absent"           "must-absent" "let me (check|fetch|look|grab|get|load)"
check "Tomorrow mislabel absent"     "must-absent" "tomorrow'?s (brief|morning|session)"
check "Background dismissal absent"  "must-absent" "background activity|nothing to action"
check "Meta-explain worker absent"   "must-absent" "worker\s+(left|saved|wrote|produced|narrat)|deliverable\s+(is\s+corrupt|has\s+the\s+worker)|process\s+narrat"

# Required patterns — must all be PRESENT
check "Markdown headings present"    "must-present" "^## "
check "Nonce present (content delivered)" "must-present" "$NONCE"

# ── cleanup (Strategy A) ────────────────────────────────────────────────────

cleanup_strategy_a

# ── report ──────────────────────────────────────────────────────────────────

echo ""
echo "=== Probe results ($NONCE) ==="
echo -e "$RESULTS"

if [[ $FAIL_COUNT -gt 0 ]]; then
  echo "=== Turn (verbatim, first 800 chars) ==="
  echo "$TURN" | head -c 800
  echo ""
  echo ""
  log "FAIL ($FAIL_COUNT check(s) failed)"
  exit 1
fi

log "PASS — all 7 checks green"
exit 0
