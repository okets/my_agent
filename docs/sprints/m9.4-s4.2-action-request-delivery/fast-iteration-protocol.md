# Fast Iteration Protocol — M9.4-S4.2 Soak

> **Purpose:** test delivery-path fixes within minutes instead of waiting for daily 07:00 BKK morning briefs. Calendar-day soak gives us 1 observation/day; this protocol gives 5–10/hour for the same structural properties.

**Opened:** 2026-04-29
**Origin:** soak frustration — fu1 took a day to falsify, fu2 might take another. We don't actually need 24h cycles to test the structural fixes; we need them only for gravity-dependent properties.
**Applies to:** any sprint touching the proactive-delivery hop (S4.2 + every fu*).

---

## What needs slow soak vs what needs fast iteration

| Test target | Per-turn? | Method |
|---|---|---|
| Tool-call narration ("Let me read…", "Let me render…") | structural | **Fast** |
| Dismissal patterns ("tomorrow's brief", "background activity") | structural | **Fast** |
| Content body present, sections not silently dropped | structural | **Fast** |
| Voice rendering (Nina's tone, header/structure) | structural | **Fast** |
| Worker `deliverable.md` cleanliness | per-fire | **Fast** |
| Validator enforcement (does it actually run on contaminated content?) | per-fire | **Fast** |
| Conversational gravity (how transcript momentum biases response) | ACCUMULATES | **Slow** |
| Day-over-day cache / SDK session resume | ACCUMULATES | **Slow** |
| Repeated-delivery handling (does Nina handle "I delivered this 3h ago" gracefully?) | partial | **Both** |

Rule of thumb: if the failure mode is observable in a single turn against a fresh state, fast iteration is sufficient. If it requires N turns of accumulated history to manifest, slow soak is the only honest test.

For fu2 specifically: **all four PASS criteria are per-turn structural** — fast iteration is the right gate. Soak afterward only to verify gravity hasn't re-broken it.

---

## The contamination problem with naive fast-firing

If you fire the same automation 5 times in a row into the same conversation, **Nina's prior delivery turns prime her**:

- After turn 1's "Let me read…" leakage, turns 2–5 start with similar phrasing simply because that's what the recent transcript shows.
- After turn 1's clean delivery, turns 2–5 may say "I already covered the AQI section earlier" — referring to her own prior turn, not the model behavior we're testing.
- A 5-fire-in-5-minutes burst is NOT equivalent to 5 organic deliveries — the gravity is wrong, the timing is wrong, and the cumulative session state biases everything.

**Each fire must look like the first delivery into a fresh state.**

---

## Protocol — one iteration

Each fast-iteration cycle:

1. **Fresh conversation** (or rotated SDK session — see §"Two rotation strategies" below).
2. **Fresh content** (a unique nonce in the deliverable so Nina can't pattern-match against prior fires).
3. **Trigger the delivery path** (fire the automation, OR inject a synthetic notification directly — see §"Two trigger strategies").
4. **Wait** for the heartbeat to drain (~30s default; can be reduced to ~5s with `drainNow()`).
5. **Extract** the latest assistant turn from the test conversation's jsonl.
6. **Pattern-check** against the regression list (see §"Pass/fail patterns").
7. **Record** the result (pass/fail + verbatim opener).
8. **Archive** the test conversation (delete or mark inactive — keeps the real conversation list clean).

Iteration time: ~60–90 seconds per cycle if the heartbeat tick is responsive. ~30 seconds with `drainNow()`. **Hours, not days.**

---

## Two rotation strategies

### Strategy A — Fresh conversation per fire (cleanest signal)

Each iteration creates a brand-new conversation, fires into it, observes, archives. Pros: zero inter-fire contamination, each turn is genuinely the first turn. Cons: doesn't test "delivery into an existing conversation" path.

### Strategy B — One sacrificial test conversation, rotate `sdk_session_id` between fires

A single dedicated test conversation (e.g., `conv-FAST-ITERATION-PROBE`); before each fire, set `sdk_session_id = NULL` in the conversations table; fire; observe; repeat. Pros: tests the "fresh SDK session in an existing conversation" path (matches L3b in fu1). Cons: prior turns still in the transcript, may bias the next fire's response.

**Recommendation:** Strategy A for fu2's 4 per-turn checks (most honest). Strategy B only if explicitly testing the conversation-with-history scenario.

---

## Two trigger strategies

### Trigger 1 — Fire the actual automation

```bash
curl -X POST http://localhost:4321/api/automations/debrief-reporter/fire
```

Runs the full cycle: worker pipeline (or aggregator) → reporter → notification → heartbeat → delivery. Pros: end-to-end. Cons: re-runs workers (slow + costs tokens), can hit the 24h debrief window dedup.

For Trigger 1 to deliver a fresh assembled brief each time, we'd also need the worker outputs to differ per fire. Two ways:
- Fire individual workers first (`expat-tips-worker/fire`, `chiang-mai-aqi-worker/fire`, etc.) then fire `debrief-reporter` — each fire sees fresh worker output. Slow + expensive.
- Stage synthetic worker `deliverable.md` files in their `.runs/` directories before firing the reporter. Fast, fully controlled.

### Trigger 2 — Inject a synthetic notification directly

Bypass the worker/reporter pipeline. Enqueue a `job_completed` notification with a hand-crafted `summary` (the resolved deliverable content) and a `run_dir` pointing at a staged file. Heartbeat drains it as normal.

This requires either:
- A debug endpoint (e.g., `POST /api/debug/notification` — *does not exist yet*; build it as part of this protocol).
- A small node script that calls `app.notificationQueue.enqueue()` directly.

Pros: full control over the prompt input (`n.summary` is exactly what you stage); fastest cycle. Cons: bypasses the worker pipeline so won't catch worker-side regressions.

**Recommendation:** Trigger 2 for fu2's prompt-body test (we control `n.summary`). Trigger 1 for end-to-end pipeline tests later in the soak.

---

## Pass/fail patterns

Run each pattern as a grep against the assistant turn's `content` field. For fu2:

```bash
TURN="$(tail -1 ~/my_agent/.my_agent/conversations/conv-FAST-ITERATION-PROBE.jsonl \
  | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("content",""))')"

# REGRESSION patterns — must all be ABSENT
echo -n "Read narration: ";   echo "$TURN" | grep -qiE "(let me read|let me render|I'?ll (read|render)|I (have|need to) read)" && echo "FAIL" || echo "pass"
echo -n "Tool intent: ";      echo "$TURN" | grep -qiE "let me (check|fetch|look|grab|get|load)" && echo "FAIL" || echo "pass"
echo -n "Tomorrow mislabel: "; echo "$TURN" | grep -qiE "tomorrow'?s brief|tomorrow'?s morning brief|tomorrow'?s session" && echo "FAIL" || echo "pass"
echo -n "Background dismissal: "; echo "$TURN" | grep -qiE "background activity|nothing to action|in the background|will deliver at" && echo "FAIL" || echo "pass"
echo -n "Meta-explain worker breakage: "; echo "$TURN" | grep -qiE "the worker (left|saved|wrote|produced)|the deliverable is corrupted|process narration" && echo "FAIL" || echo "pass"

# REQUIRED patterns — must all be PRESENT
echo -n "Markdown headings: "; echo "$TURN" | grep -qE "^## " && echo "pass" || echo "FAIL — no ## headings"
echo -n "First-person voice: "; echo "$TURN" | grep -qiE "you|your|today|here'?s" && echo "pass" || echo "FAIL — no 2nd-person framing"
```

**fu2 PASS:** all 5 regression checks pass + both required checks pass + the body contains the inlined section content (assert by including a unique nonce in the staged content and grep'ing for it in the turn).

---

## Tooling

`scripts/soak-probe.sh` — fast-iteration runner. Build it as part of fu2 or a sibling commit.

```bash
#!/usr/bin/env bash
# Fast-iteration probe for M9.4-S4.2 delivery path.
# Strategy A (fresh conv) + Trigger 2 (synthetic notification) by default.
# Pass --strategy=B or --trigger=1 to switch.
#
# Usage: ./scripts/soak-probe.sh [--strategy=A|B] [--trigger=1|2] [--n=5]
#
# Exits non-zero if any check fails. Run in a loop:
#   for i in 1 2 3 4 5; do ./scripts/soak-probe.sh || break; done

set -euo pipefail

STRATEGY="${STRATEGY:-A}"
TRIGGER="${TRIGGER:-2}"
NONCE="$(date +%s)-$RANDOM"
DASHBOARD="http://localhost:4321"
AGENT_DIR="$HOME/my_agent/.my_agent"

# 1. Create fresh test conversation (Strategy A) or pick the sacrificial one (Strategy B)
if [[ "$STRATEGY" == "A" ]]; then
  CONV_ID=$(curl -sX POST "$DASHBOARD/api/conversations" -d '{}' -H 'Content-Type: application/json' | jq -r .id)
  echo "[probe] Strategy A — created fresh conversation: $CONV_ID"
else
  CONV_ID="conv-FAST-ITERATION-PROBE"
  # rotate SDK session via debug endpoint or DB write — skipped here for brevity
  echo "[probe] Strategy B — using sacrificial conversation: $CONV_ID"
fi

# 2. Stage synthetic content with NONCE
SUMMARY="## AQI ($NONCE)

**AQI: 145 (Unhealthy for Sensitive Groups)**
PM2.5: ~52 µg/m³

## News ($NONCE)

- Test news item one
- Test news item two

## Events ($NONCE)

- Test event"

# 3. Trigger
if [[ "$TRIGGER" == "2" ]]; then
  # Synthetic notification injection — needs debug endpoint
  curl -sX POST "$DASHBOARD/api/debug/notification" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg s "$SUMMARY" --arg c "$CONV_ID" \
      '{type:"job_completed",automation_id:"probe",summary:$s,run_dir:"/tmp/probe-runs/probe-'$NONCE'",conversation_id:$c}')"
else
  curl -sX POST "$DASHBOARD/api/automations/debrief-reporter/fire"
fi

# 4. Wait for delivery
echo "[probe] Waiting for delivery..."
sleep 25

# 5. Extract turn
TURN_PATH="$AGENT_DIR/conversations/${CONV_ID}.jsonl"
[[ -f "$TURN_PATH" ]] || { echo "FAIL — no conversation file at $TURN_PATH"; exit 2; }
TURN_CONTENT="$(tail -1 "$TURN_PATH" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("content",""))')"

# 6. Pattern check
FAIL=0
check() {
  local label="$1"; local invert="$2"; local pattern="$3"
  if echo "$TURN_CONTENT" | grep -qiE "$pattern"; then
    if [[ "$invert" == "must-absent" ]]; then echo "  ✗ $label (FAIL)"; FAIL=1
    else echo "  ✓ $label"; fi
  else
    if [[ "$invert" == "must-absent" ]]; then echo "  ✓ $label"
    else echo "  ✗ $label (FAIL)"; FAIL=1; fi
  fi
}

echo "=== Checks ==="
check "Read narration absent"     "must-absent" "(let me read|let me render|I'?ll (read|render))"
check "Tool intent absent"        "must-absent" "let me (check|fetch|look|grab|get|load)"
check "Tomorrow mislabel absent"  "must-absent" "tomorrow'?s (brief|morning|session)"
check "Background dismissal absent" "must-absent" "background activity|nothing to action"
check "Meta-explain worker absent" "must-absent" "the worker (left|saved|wrote)|deliverable is corrupted"
check "Markdown headings present" "must-present" "^## "
check "Nonce present (content delivered)" "must-present" "$NONCE"

# 7. Archive (Strategy A only)
if [[ "$STRATEGY" == "A" ]]; then
  curl -sX DELETE "$DASHBOARD/api/conversations/$CONV_ID" > /dev/null || true
fi

if [[ $FAIL -eq 1 ]]; then
  echo ""
  echo "=== Turn (verbatim, first 600 chars) ==="
  echo "$TURN_CONTENT" | head -c 600
  echo ""
  echo "[probe] FAIL"
  exit 1
fi

echo "[probe] PASS"
```

**Note:** the `POST /api/debug/notification` endpoint doesn't exist yet. Add it as part of this protocol's tooling work — short Fastify handler that takes a notification body and calls `app.notificationQueue.enqueue()` + `heartbeat.drainNow()`. Restrict to `localhostOnly`.

---

## When to declare "fast-iteration confidence"

After **5 consecutive PASS runs** of `soak-probe.sh` with both strategies (A and B) and both triggers (1 and 2):
- Ship the fix to soak.
- Slow soak picks up the gravity-dependent properties (the only thing fast iteration can't test).

If any fast iteration fails:
- Don't soak. Iterate the prompt or code, re-run the probe loop.
- Soak only when fast iteration is unambiguously green.

---

## Combined plan for fu2

1. **Day of fu2 deploy:** ship the inline-content code change (per `soak-day-2-followup-plan.md`).
2. **Build the probe tool** (`scripts/soak-probe.sh` + `POST /api/debug/notification` endpoint). Half-day.
3. **Run probe loop** — 5+ iterations across both strategies. If green: deploy is good. If red: iterate.
4. **Slow soak Day-3** runs the probe in parallel with the real morning brief. Real brief tests gravity; probe tests structural fixes.
5. **Soak close criterion** updated: 7 days of clean morning briefs OR 5 clean probe runs every day for 3 days, whichever comes first.

The key change: **structural fixes don't need 7 calendar days to validate.** Calendar soak is for gravity. Probe is for structure. Different signals, different tools.

---

## Risk log

| Risk | Likelihood | Mitigation |
|---|---|---|
| `POST /api/debug/notification` adds an attack surface | Low | `localhostOnly` middleware (already used for other debug routes); blocks Tailscale + WhatsApp paths. |
| Probe pollutes the real conversations table | Low | Strategy A creates ephemeral conversations; archive/delete after each fire. |
| Probe doesn't catch gravity bugs | Certain (by design) | That's why slow soak runs in parallel. Don't claim fast probe replaces soak — it complements it. |
| Probe tooling drifts from production prompt shape | Medium | Probe synthesizes content like a real brief but doesn't replicate the real reporter assembly. Strategy 1 (fire real automation) closes this gap when needed. |
| Synthetic content masks worker-side regressions | Certain (by design) | Worker contamination is tested by real fires (Trigger 1) or by direct validator unit tests, not by the probe. |

---

## Out of scope

- Building a full simulation harness for the brain. The probe just tests the delivery hop.
- Replacing slow soak entirely. Gravity-dependent properties still need real morning briefs.
- Validator enforcement gap (Day-2 Factor b). Independent investigation; the probe will surface it cosmetically (worker contamination shows up in delivered turns) but the fix is in `mcp/todo-server.ts`, not here.
