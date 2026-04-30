#!/usr/bin/env bash
# Fast-iteration probe for M9.4-S4.2 delivery path.
#
# Tests the structural delivery-path properties (Read-tool narration,
# tool-call leakage, tomorrow/background dismissal patterns, content
# rendering) in ~60-90 seconds per iteration instead of waiting 24h for the
# 07:00 BKK morning brief.
#
# Two-stage check (M9.4-S4.2-fu3):
#   STAGE 1 — pre-delivery: deliverable.md is clean (worker wrote cleanly +
#             executor didn't overwrite with stream). Only meaningful for
#             Trigger 1 (real automation fire); skipped for Trigger 2.
#   STAGE 2 — post-delivery: assistant turn doesn't narrate Read tool, etc.
#
# See docs/sprints/m9.4-s4.2-action-request-delivery/fast-iteration-protocol.md
# for the full design rationale.
#
# Strategy A (default): create a fresh probe conversation per fire, restore
#   user's conversation as current after. Cleanest signal — no inter-fire
#   contamination. Only used with Trigger 2 (synthetic notification).
#
# Strategy B: rotate sdk_session_id on a single sacrificial test conversation.
#   Tests the "fresh SDK session in an existing conversation" path (matches
#   L3b in fu1). Not yet implemented.
#
# Trigger 1: fire a real automation. The worker produces its own
#   deliverable.md; the executor's fu3 contract checks/reads it; the
#   heartbeat delivers via action-request to the user's current conv.
#   Pass automation_id as positional arg or via AUTOMATION env var.
#
# Trigger 2 (default): synthesize notification + sendActionRequest into a
#   fresh probe conv. Bypasses the worker pipeline; full control over
#   `n.summary`. Tests the action-request prompt-shape change (fu2) only.
#
# Usage:
#   ./scripts/soak-probe.sh                                  # Strategy A, Trigger 2
#   TRIGGER=1 ./scripts/soak-probe.sh chiang-mai-aqi-worker  # Trigger 1, real fire
#   for i in 1 2 3 4 5; do TRIGGER=1 ./scripts/soak-probe.sh chiang-mai-aqi-worker || break; sleep 60; done
#
# Exits 0 on PASS, 1 on FAIL (regression patterns matched), 2 on infrastructure
# error (server unreachable, conv create failed, etc.).

set -euo pipefail

# ── config ──────────────────────────────────────────────────────────────────

STRATEGY="${STRATEGY:-A}"
TRIGGER="${TRIGGER:-2}"
DASHBOARD="${DASHBOARD:-http://localhost:4321}"
AGENT_DIR="${AGENT_DIR:-$HOME/my_agent/.my_agent}"
WAIT_SECS="${WAIT_SECS:-2}"
SACRIFICIAL_CONV="${SACRIFICIAL_CONV:-conv-FAST-ITERATION-PROBE}"
WORKER_TIMEOUT_SECS="${WORKER_TIMEOUT_SECS:-90}"
DELIVERY_TIMEOUT_SECS="${DELIVERY_TIMEOUT_SECS:-60}"
AUTOMATION_ID="${AUTOMATION:-}"

# Parse args. First positional = automation_id (for Trigger 1).
for arg in "$@"; do
  case "$arg" in
    --strategy=*) STRATEGY="${arg#*=}" ;;
    --trigger=*) TRIGGER="${arg#*=}" ;;
    --wait=*) WAIT_SECS="${arg#*=}" ;;
    --automation=*) AUTOMATION_ID="${arg#*=}" ;;
    -h|--help)
      grep -E "^# " "$0" | head -45
      exit 0
      ;;
    --*)
      echo "[probe] Unknown flag: $arg" >&2
      exit 2
      ;;
    *)
      # Positional → automation_id (for Trigger 1)
      AUTOMATION_ID="$arg"
      ;;
  esac
done

NONCE="$(date +%s)-$RANDOM"

# ── helpers ─────────────────────────────────────────────────────────────────

log() { echo "[probe] $*"; }
fail() { echo "[probe] $*" >&2; exit "${2:-1}"; }

require_localhost() {
  local code
  code="$(curl -fsS -o /dev/null -w '%{http_code}' "$DASHBOARD/" 2>/dev/null || echo "000")"
  [[ "$code" == "200" ]] || fail "Dashboard not reachable at $DASHBOARD (got HTTP $code)" 2
}

json_get() {
  python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('$1', ''))"
}

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

# Strategy-A cleanup (only meaningful for Trigger 2).
cleanup_strategy_a() {
  if [[ "${STRATEGY:-A}" != "A" || "${TRIGGER:-2}" != "2" ]]; then return 0; fi
  if [[ -n "${CONV_ID:-}" ]]; then
    curl -fsS -X POST "$DASHBOARD/api/admin/conversation/$CONV_ID/delete" >/dev/null 2>&1 \
      || log "  (warn) failed to delete probe conv $CONV_ID"
  fi
  if [[ -n "${PREVIOUS_CURRENT:-}" ]]; then
    curl -fsS -X POST "$DASHBOARD/api/admin/conversation/$PREVIOUS_CURRENT/activate" >/dev/null 2>&1 \
      || log "  (warn) failed to activate previous current $PREVIOUS_CURRENT"
  fi
}

# STAGE 1 check: deliverable.md cleanliness against the validator's regex.
# Returns 0 on pass, 1 on fail. Echoes diagnostic output.
stage1_check_deliverable() {
  local deliverable_path="$1"
  if [[ ! -f "$deliverable_path" ]]; then
    echo "  ✗ STAGE 1 — no deliverable.md at $deliverable_path"
    return 1
  fi

  local head
  head="$(head -c 300 "$deliverable_path")"
  local body_len
  body_len=$(wc -c < "$deliverable_path")

  if [[ "$body_len" -lt 50 ]]; then
    echo "  ✗ STAGE 1 — deliverable.md too short ($body_len chars; need ≥50)"
    return 1
  fi

  # Strong opener regex (matches the validator's STRONG_OPENERS at todo-validators.ts:128)
  if echo "$head" | grep -qiE \
      "^(Let me start by|I'?ll start (by|executing)|I'?ll help (you )?(condense|summarize|format)|Now I'?ll (start|check|look)|Here'?s what I'?ll do|Let'?s check)"; then
    echo "  ✗ STAGE 1 — deliverable.md opens with strong narration:"
    echo "    $head" | head -c 200
    return 1
  fi

  # Doubled-signal: ≥2 weak narration markers in head 300 chars
  local second_count
  second_count=$(echo "$head" | grep -ciE \
      "(Now let me|Now I need(\\s+to)?|Let me (check|look|fetch|read|get|find|search|create|locate)|I'?ll (check|fetch|read|look|get|find|search|create|locate))")
  if [[ "$second_count" -ge 2 ]]; then
    echo "  ✗ STAGE 1 — $second_count narration markers in head"
    echo "    $head" | head -c 200
    return 1
  fi

  echo "  ✓ STAGE 1 — deliverable.md is clean ($body_len chars)"
  return 0
}

# ── pre-flight ──────────────────────────────────────────────────────────────

require_localhost
log "Strategy=$STRATEGY  Trigger=$TRIGGER  Nonce=$NONCE  Automation=${AUTOMATION_ID:-N/A}"

PREVIOUS_CURRENT=""

# ── trigger ─────────────────────────────────────────────────────────────────

if [[ "$TRIGGER" == "2" ]]; then
  # Trigger 2: synthetic notification → direct sendActionRequest into fresh probe conv
  if [[ "$STRATEGY" == "A" ]]; then
    CREATE_JSON="$(curl -fsS -X POST "$DASHBOARD/api/admin/conversations" \
      -H 'Content-Type: application/json' -d '{}')" \
      || fail "Failed to create probe conversation" 2
    CONV_ID="$(echo "$CREATE_JSON" | json_get id)"
    PREVIOUS_CURRENT="$(echo "$CREATE_JSON" | json_get previous_current_id)"
    [[ -n "$CONV_ID" ]] || fail "Probe conversation creation returned empty id" 2
    log "Created fresh probe conv: $CONV_ID  (previous current: ${PREVIOUS_CURRENT:-none})"
  else
    fail "Strategy B not yet implemented" 2
  fi

  # Stage synthetic content (generic — no instance-specific data)
  read -r -d '' SUMMARY <<EOF || true
## Air Quality

**Reading: 89 — Moderate** (improved from yesterday)
Measurement: 28.8 units, ambient 24°C, humidity 73-78%.
Forecast: Moderate today and tomorrow, possible bump to elevated next week, then conditions clear for months.

## Top Story

**Probe-Verify-${NONCE}**: Provincial budget review meeting confirmed for Friday — projects under review include the road extension and the new district health center. Public comment period opens Monday.

## Events

- **Week 1**: Vinyl weekend festival
- **Week 3**: International touch tournament
- **Week 4**: City pillar festival (free, all week)
- **End of month**: Candlelight procession

## Project Status

11 test failures across 7 files all in CFR phase-2 TTS replay e2e suite. M9.6 still blocked on the 3 production blockers from April 20 live test (AckDelivery, brain-races-CFR, reprocessTurn). Fix sprint needed before close.
EOF

  RUN_DIR_T2="/tmp/probe-runs/probe-$NONCE"
  log "Trigger 2: synthesizing notification + sendActionRequest into $CONV_ID"
  PAYLOAD="$(python3 -c "
import json, sys
print(json.dumps({
    'type': 'job_completed',
    'automation_id': 'probe',
    'summary': '''$SUMMARY''',
    'run_dir': '$RUN_DIR_T2',
    'target_conversation_id': '$CONV_ID',
}))
")"
  RESP="$(curl -fsS -X POST "$DASHBOARD/api/debug/notification" \
    -H 'Content-Type: application/json' -d "$PAYLOAD")" \
    || { cleanup_strategy_a; fail "POST /api/debug/notification failed" 2; }
  TURN="$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('response',''))")"
  log "  endpoint returned: response_len=${#TURN}"
  STAGE1_RESULT="N/A — Trigger 2 stages content directly; no worker pipeline to check"

elif [[ "$TRIGGER" == "1" ]]; then
  # Trigger 1: fire a real automation. End-to-end pipeline: worker writes
  # deliverable.md → executor's fu3 gate validates it → heartbeat delivers
  # via action-request to user's current conv.
  [[ -n "$AUTOMATION_ID" ]] || fail "Trigger 1 requires automation_id (positional arg or AUTOMATION env)" 2

  # Capture user's current conv BEFORE firing so we can read the resulting turn
  USER_CONV="$(curl -fsS "$DASHBOARD/api/conversations" 2>/dev/null \
    | python3 -c "import json,sys; d=json.load(sys.stdin); curr=[c for c in d.get('conversations',[]) if c.get('status')=='current']; print(curr[0]['id'] if curr else '')" \
    2>/dev/null || echo "")"
  if [[ -z "$USER_CONV" ]]; then
    # Fallback: scan jsonl files for the most recent current conv
    USER_CONV="$(ls -t "$AGENT_DIR/conversations"/conv-*.jsonl 2>/dev/null \
      | head -1 | xargs -I{} basename {} .jsonl)"
  fi
  [[ -n "$USER_CONV" ]] || fail "Could not determine user's current conversation" 2
  log "Will observe user conv: $USER_CONV"

  # Snapshot the existing transcript so we can detect the new turn
  TURNS_BEFORE=$(wc -l < "$AGENT_DIR/conversations/${USER_CONV}.jsonl" 2>/dev/null || echo "0")
  log "Transcript lines before fire: $TURNS_BEFORE"

  log "Trigger 1: firing real automation '$AUTOMATION_ID'"
  curl -fsS -X POST "$DASHBOARD/api/automations/$AUTOMATION_ID/fire" >/dev/null \
    || fail "Failed to fire automation $AUTOMATION_ID" 2

  # Poll for worker completion: new run dir + deliverable.md + status-report.md
  log "Polling up to ${WORKER_TIMEOUT_SECS}s for worker to finish..."
  RUN_DIR_T1=""
  ATTEMPTS=$((WORKER_TIMEOUT_SECS / 5))
  for ((i=1; i<=ATTEMPTS; i++)); do
    sleep 5
    CANDIDATE=$(ls -td "$AGENT_DIR/automations/.runs/$AUTOMATION_ID"/* 2>/dev/null | head -1)
    if [[ -n "$CANDIDATE" && -f "$CANDIDATE/deliverable.md" && -f "$CANDIDATE/status-report.md" ]]; then
      RUN_DIR_T1="$CANDIDATE"
      log "Worker completed after ${i}*5s: $RUN_DIR_T1"
      break
    fi
  done
  [[ -n "$RUN_DIR_T1" ]] || fail "Worker did not produce deliverable.md + status-report.md within ${WORKER_TIMEOUT_SECS}s" 1

  # STAGE 1 — pre-delivery: check deliverable.md cleanliness
  log "STAGE 1: checking deliverable.md cleanliness..."
  STAGE1_OUTPUT="$(stage1_check_deliverable "$RUN_DIR_T1/deliverable.md" 2>&1)" || STAGE1_FAIL=1
  echo "$STAGE1_OUTPUT"
  STAGE1_RESULT="$STAGE1_OUTPUT"
  if [[ "${STAGE1_FAIL:-0}" -eq 1 ]]; then
    echo ""
    echo "=== Deliverable head (first 600 chars) ==="
    head -c 600 "$RUN_DIR_T1/deliverable.md"
    echo ""
    echo ""
    log "OVERALL FAIL — STAGE 1 failed (deliverable.md is contaminated)"
    log "  This means the worker is producing contaminated content directly."
    log "  Investigation: validator regex hole OR todo-server bypass (Hypothesis H2)."
    log "  Separate bug from fu3."
    exit 1
  fi

  # Wait for heartbeat to deliver
  log "Polling up to ${DELIVERY_TIMEOUT_SECS}s for delivery to user conv..."
  TURN=""
  ATTEMPTS=$((DELIVERY_TIMEOUT_SECS / 5))
  for ((i=1; i<=ATTEMPTS; i++)); do
    sleep 5
    TURNS_NOW=$(wc -l < "$AGENT_DIR/conversations/${USER_CONV}.jsonl" 2>/dev/null || echo "0")
    if [[ "$TURNS_NOW" -gt "$TURNS_BEFORE" ]]; then
      TURN="$(latest_assistant_content "$AGENT_DIR/conversations/${USER_CONV}.jsonl")"
      if [[ -n "$TURN" ]]; then
        log "Delivery landed after ${i}*5s ($TURNS_NOW transcript lines)"
        break
      fi
    fi
  done
  [[ -n "$TURN" ]] || fail "No new assistant turn appeared within ${DELIVERY_TIMEOUT_SECS}s" 1

else
  fail "Unknown trigger: $TRIGGER" 2
fi

# ── STAGE 2 — assistant turn pattern checks ─────────────────────────────────

if [[ "$TRIGGER" == "2" ]]; then
  log "Waiting ${WAIT_SECS}s for transcript write to settle..."
  sleep "$WAIT_SECS"
  if [[ -z "$TURN" ]]; then
    cleanup_strategy_a
    fail "No response received (endpoint returned empty content)" 1
  fi
fi

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

check "Read narration absent"        "must-absent" "(let me read|let me render|i'?ll (read|render)|i (have|need to) read)"
check "Tool intent absent"           "must-absent" "let me (check|fetch|look|grab|get|load)"
check "Tomorrow mislabel absent"     "must-absent" "tomorrow'?s (brief|morning|session)"
check "Background dismissal absent"  "must-absent" "background activity|nothing to action"
check "Meta-explain worker absent"   "must-absent" "worker\s+(left|saved|wrote|produced|narrat)|deliverable\s+(is\s+corrupt|has\s+the\s+worker)|process\s+narrat"

RESP_LEN=${#TURN}
if [[ $RESP_LEN -gt 200 ]]; then
  RESULTS+="  ✓ Response length ($RESP_LEN chars > 200)\n"
else
  RESULTS+="  ✗ Response length ($RESP_LEN chars ≤ 200; likely refusal/error)\n"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

check "Structured rendering"         "must-present" "(^## |\*\*[A-Z]|\n- |\n[0-9]+\.)"

# Trigger 2 has known staged markers; Trigger 1 doesn't. Skip survives-paraphrasing check for T1.
if [[ "$TRIGGER" == "2" ]]; then
  HIT=0
  for marker in "Reading" "Measurement" "Vinyl" "International touch" "City pillar" "CFR phase-2" "M9.6"; do
    grep -qiE "$(printf '%q' "$marker")" <<<"$TURN" && HIT=$((HIT + 1)) || true
  done
  if [[ $HIT -ge 2 ]]; then
    RESULTS+="  ✓ Staged facts survive ($HIT/7 markers preserved)\n"
  else
    RESULTS+="  ✗ Staged facts survive ($HIT/7 markers; content not faithfully rendered)\n"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
fi

# ── cleanup ─────────────────────────────────────────────────────────────────

cleanup_strategy_a

# ── report ──────────────────────────────────────────────────────────────────

echo ""
echo "=== Probe results ($NONCE) ==="
if [[ "$TRIGGER" == "1" ]]; then
  echo "STAGE 1 (deliverable.md cleanliness):"
  echo "$STAGE1_RESULT"
  echo "STAGE 2 (assistant turn):"
fi
echo -e "$RESULTS"

if [[ $FAIL_COUNT -gt 0 ]]; then
  echo "=== Turn (verbatim, first 800 chars) ==="
  echo "$TURN" | head -c 800
  echo ""
  echo ""
  if [[ "$TRIGGER" == "1" ]]; then
    log "OVERALL FAIL — STAGE 1 PASS, STAGE 2 failed ($FAIL_COUNT check(s))"
    log "  STAGE 1 PASS means worker wrote clean content + executor preserved it."
    log "  STAGE 2 fail means the prompt body / delivery still has issues."
    log "  Re-engage the architectural conversation (model swap, etc.)."
  else
    log "FAIL ($FAIL_COUNT check(s) failed)"
  fi
  exit 1
fi

if [[ "$TRIGGER" == "1" ]]; then
  log "OVERALL PASS — STAGE 1 + STAGE 2 both green"
else
  log "PASS — all checks green"
fi
exit 0
