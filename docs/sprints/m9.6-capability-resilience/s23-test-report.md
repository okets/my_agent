---
sprint: M9.6-S23
title: Mode 3 Verification + Matcher Fix — Test Report
date: 2026-04-21
status: PASS — live retest complete
---

# S23 Test Report

## Phase 1 — Diagnostic + Code Changes

### What was added

**`packages/core/src/capabilities/mcp-cfr-detector.ts`:**

- `console.debug("[CfrDetector] processSystemInit:", JSON.stringify(systemMessage.mcp_servers))` immediately after the `isInitSystemMessage` guard. Kept permanently at debug level for future Mode 3 diagnostics.
- Replaced the dual positive/negative status check with an explicit `FAILED_STATUSES` Set (`"failed"`, `"needs-auth"`, `"disabled"`). Same logic, clearer intent — documents exactly which strings are accepted and why.
- Wrapped the per-entry `cfr.emitFailure(...)` call in a `try/catch`. If `originFactory()` throws (e.g. session context not yet promoted when `system_init_raw` fires), the error is logged via `console.error` and the loop continues for remaining entries. Previously an originFactory throw would propagate up through `processSystemInit` and could break the session-manager's `for-await` loop.

**`packages/dashboard/tests/integration/cfr-mode3-init-detection.test.ts` (new):**

5 tests covering the conversation-origin Mode 3 chain:
- `processSystemInit fires CFR → orchestrator receives it and emits attempt ack` — full chain: failed init entry → CFR emitted with real conversation origin → orchestrator spawns fix job → attempt ack delivered via broadcast
- `debug log fires with the actual mcp_servers[] payload` — confirms the S23 diagnostic log is present and fires
- `connected servers in the same init frame do NOT trigger CFR` — regression guard
- `originFactory error is caught and logged — does not propagate to the message loop` — proves the try/catch guards the for-await loop
- `is idempotent — second processSystemInit for the same server does not double-emit` — guards `initEmitted` Set behaviour

### Suite results (pre-live-retest)

| Package | Passed | Failed | Skipped |
|---------|--------|--------|---------|
| core | 687 | 0 | 9 |
| dashboard | 1375 | 0 | 24 |

---

## Phase 2 — Live Diagnostic Capture

**DATE:** 2026-04-21 20:51 UTC

### Break method used

Option A: `entrypoint` in `browser-chrome/CAPABILITY.md` changed to `npx tsx src/nonexistent-s23-test.ts`. Dashboard restarted. Message `"What time is it?"` sent to conversation `conv-01KPRHN3NDNFB7QAKP16EREZTP`.

### Actual SDK mcp_servers[] payload captured

```json
[
  {"name":"browser-chrome","status":"failed"},
  {"name":"desktop-x11","status":"connected"},
  {"name":"memory","status":"connected"},
  {"name":"conversations","status":"connected"},
  {"name":"knowledge","status":"connected"},
  {"name":"debrief","status":"connected"},
  {"name":"space-tools","status":"connected"},
  {"name":"automation-tools","status":"connected"},
  {"name":"skills","status":"connected"},
  {"name":"playwright-screenshot","status":"connected"},
  {"name":"chart-tools","status":"connected"},
  {"name":"image-fetch-tools","status":"connected"},
  {"name":"todo","status":"connected"}
]
```

### Matcher decision

`browser-chrome` appears in `mcp_servers[]` with `status: "failed"`. This matches the existing allow-list exactly (`FAILED_STATUSES = new Set(["failed", "needs-auth", "disabled"])`). **No matcher change required.** The S12 spike prediction was correct.

Note: no `error` field present when the entrypoint script doesn't exist (process exits before stdio handshake). The existing fallback `"MCP server failed to start"` is used as detail.

---

## Phase 3 — Live Retest

**DATE:** 2026-04-21 20:51–20:54 UTC (Chiang Mai time 12:51–12:54 AM)
**CTO:** Hanan (watching, confirmed results)

### Conversation transcript observed in dashboard

```
User:  What time is it?

Nina:  hold on — browser (browser-chrome) isn't working right, fixing now.
       [20:52]
Nina:  12:51 AM, Wednesday April 22nd. (Chiang Mai time)
       [20:52]
Nina:  still fixing — second attempt.
       [20:52]
Nina:  browser is back.
       [20:54]
Nina:  Still 12:51 AM. You asked twice — everything okay?
```

### Pass conditions

| # | Check | Status |
|---|-------|--------|
| (a) | `[CfrDetector] processSystemInit` log fires with `browser-chrome` entry | ✓ PASS |
| (b) | CFR emits proactively — `[CFR] ack(attempt) for browser-control` fires without any tool call | ✓ PASS |
| (c) | Fix-mode agent spawns | ✓ PASS — two attempts observed |
| (d) | `terminal-fixed` ack after fix | ✓ PASS — "browser is back" |
| (e) | Original simple message answered correctly (not blocked by CFR pipeline) | ✓ PASS — "12:51 AM" delivered |
| (f) | Subsequent explicit browser-chrome prompt succeeds | ✓ PASS — plug restored, CTO confirmed |

### Observation: retryTurn fires for Mode 3

After `terminal-fixed`, `retryTurn` re-submitted the original user message "What time is it?". The brain answered again and said "You asked twice". This is because Mode 3's `processSystemInit` uses a conversation-origin (the session that was active when init fired), so `getInteraction(type) === "tool"` is true and `retryTurn` fires.

For Mode 1/2 this is correct — the tool-using task actually failed and needs retry. For Mode 3, the brain already completed the turn successfully via fallback (it answered "12:51 AM" without needing browser-chrome), so the retry is spurious.

**Impact:** UX-jarring but functionally correct. Not a blocker for S23 close.
**Filed as:** S23-FOLLOW-UPS FOLLOW-UP-1.

### Overall verdict: PASS

All six pass conditions green. Mode 3 detection works end-to-end for conversation-origin sessions.
