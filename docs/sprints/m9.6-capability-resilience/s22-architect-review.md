---
sprint: M9.6-S22
reviewer: architect (opus)
date: 2026-04-21
verdict: APPROVE WITH CHANGES (cosmetic — no code rework)
---

# S22 Architect Review

## Verdict: APPROVE WITH CHANGES (cosmetic only)

The implementation is correct and the corrected live retest exercises the path end-to-end. Three documentation cleanups required before merge; nothing in the code or tests needs to change.

## What's right

### Implementation matches all design decisions

- **D1 (`terminal-fixed` dispatch point):** `recovery-orchestrator.ts:679-684` — `retryTurn` fires inside the `terminal-fixed` branch (after `emitAck("terminal-fixed")`), gated on `getInteraction(type) === "tool"`. Correct per D1's "no unreachable `outcome === fixed` branch" reasoning.
- **D2 (`retryTurn` optional + warn):** orchestrator emits a `[RecoveryOrchestrator] retryTurn not wired — tool capability "X" fixed but original task not retried` warning when undefined. Backward-compat preserved.
- **D5 (turn lookup):** `app.ts:970-973` — `conversationManager.getTurns(convId)` filtered by `role === "user" && turnNumber === origin.turnNumber`. Authoritative transcript reader, exact same turn that triggered CFR.
- **D6 (re-submit via `sendMessage`):** `app.ts:985-991` — calls `app.chat.sendMessage(convId, originalText, nextTurnNumber, { channel, source: "channel" })`. Same shape as `ChannelMessageHandler`. Events broadcast via existing `chat:*` listener — no duplicated wiring.
- **DEV-3 (drain async generator):** `app.ts:985 `for await (const _event of ...)` correctly consumes the stream. Without this, `sendMessage` never starts.
- **Conversation-origin guard:** `retryTurn` early-returns when `origin.kind !== "conversation"` (line 967). Automation-origin tool failures don't trigger retryTurn — automations have their own retry mechanics at the automation layer. Correct scope.

### Frontmatter + registry wiring is clean

- `types.ts:81` — `DEFAULT_INTERACTION` constant exported, single source of truth.
- `scanner.ts:181` — `resolveInteraction(data.interaction, data.provides)` with explicit-or-inferred logic; debug-log when inferring.
- `registry.ts:266-270` — `getInteraction(type)` prefers per-instance frontmatter, falls back to `DEFAULT_INTERACTION`, then `"tool"` for unknown types (per D4 — safer default).
- All 5 templates updated explicitly. All 4 installed plugs updated explicitly.

### Live retest 1 — PASS, properly engineered

`s22-live-retest.md` describes a clean (a)-shape failure: `browser-chrome/src/server.ts` pre-corrupted to `process.exit(1)` on the first `tools/call` JSON-RPC message. The MCP server starts cleanly (tools register; brain sees `browser-chrome` in tool list); the tool call fails with `MCP error -32000: Connection closed`. The full observed chain:

1. Brain calls `mcp__browser-chrome__browser_navigate` → server crashes
2. `[CfrDetector] PostToolUseFailure fired — tool=mcp__browser-chrome__browser_navigate error=MCP error -32000: Connection closed`
3. `[CFR] ack(attempt) for browser-control`
4. Brain notified user: *"hold on — browser (browser-chrome) isn't working right, fixing now"*
5. Fix agent spawned, ran, **rewrote server.ts** (removed crash injection)
6. `[RecoveryOrchestrator] attempt 1 execute done — status=done success=true`
7. Reverify passed, `[CFR] ack(terminal-fixed) for browser-control`
8. **`retryTurn` fired** at `app.ts:984:28`
9. Brain re-submitted original request, produced CNN screenshot
10. Screenshot delivered

The methodology correction (D11-D13) was followed exactly: (a)-shape failure, explicit-capability prompt (*"Use the chrome browser capability to take a screenshot of cnn.com for me"*). The CTO's clarification about parallel browser paths was respected — Desktop MCP not modified.

### Test coverage

- **Unit (core):** `registry-interaction.test.ts` — 10 tests passing. Frontmatter override / DEFAULT_INTERACTION fallback / unknown → "tool".
- **Integration (dashboard):** 3 dispatch tests, 12 tests total, all passing. Symmetric proof of all three shapes routing to the right path:
  - `cfr-tool-retry.test.ts` (4) — tool → terminal-fixed + `retryTurn` called
  - `cfr-input-no-retry.test.ts` (4) — input → `reprocessTurn` called, NOT `retryTurn`
  - `cfr-output-no-retry.test.ts` (4) — output → terminal-fixed only, neither retry called
- **E2E:** `cfr-exit-gate-tool-retry.test.ts` — automated exit gate using `.enabled`-missing failure mode. Complements (not replaces) the live retest.
- **Suites green:** dashboard 1370/0/24, core 687/0/9.

### §0.3 process discipline — finally followed

**S22 is the first sprint in M9.6 that did NOT pre-mark ROADMAP-Done.** S16, S20, S21 dev each made the violation; the architect had to revert each time. S22 dev: ROADMAP M9.6 row remains `In Progress`; S22 row remains the architect's pre-retest "Implementation done — live test 1 retest pending after methodology correction." Pattern broken. Worth noting for the team.

### Deviations are sound

- **DEV-1 (`terminal-fixed` not `fixed`):** correct design discovery during implementation, not scope creep. Captured in D1.
- **DEV-2 (`custom-synth` for output dispatch test):** principled — `reverifyTextToAudio` calls `synthesize.sh` directly, not via invoker, so a stub can't intercept. Using a custom type tests the dispatch decision cleanly. The real `text-to-audio` path is covered by S21 voice live retest.
- **DEV-3 (drain pattern):** standard async-iterable consumption, same as WS chat-handler.

### BUG-8 acknowledged in retest

The live retest transcript correctly documents the BUG-8 stale "I can't" reply arriving before the CFR ack: *"User saw: 'On it.' → stale error message → 'hold on — fixing' → fix progress → screenshot. The ack ordering is inverted as documented in `s22-FOLLOW-UPS.md`. Functionally correct, UX-jarring."* Honest reporting.

## What's wrong (cosmetic only)

### C-1: `s22-review.md` body is internally contradictory — STALE FROM FAILED FIRST ATTEMPTS

The status header at line 11 says "Complete — all live tests PASS" and line 47-48 says "Outcome: PASS." But lines 50-79 (the entire "What was run" / "What was observed" / "Structural finding" / "What was not tested" sections) **describe the FAILED first three retest attempts** — config corruption that crashed MCP at boot, no `PostToolUseFailure`, screenshot delivered via Desktop MCP fallback, "What was not tested: CFR fix-mode agent diagnosing… retryTurn being called… terminal-fixed ack appearing." The dev appears to have only updated the status header lines; the body still describes the original failure state.

The actual passing retest narrative is in `s22-live-retest.md` and is correct. The review.md just needs its body rewritten to match: describe the (a)-shape break (`server.ts` crash-on-first-call injection), the explicit-capability prompt, the observed PostToolUseFailure → CFR → fix → retryTurn chain, and remove the now-resolved "Open questions" section (or move them to FOLLOW-UPS / mark as resolved).

### C-2: ROADMAP S22 row not updated for the passing retest

Currently still says "Implementation done — live test 1 retest pending after methodology correction" — but the corrected retest passed. ROADMAP doesn't reflect the actual state. Two fixes needed (one before approval, one after):

- **Now (architect commit):** update the S22 row to reflect "Implementation done; live retest 1 + 2 PASS; awaiting CTO sign-off." Do NOT mark M9.6 Done yet.
- **After CTO sign-off:** update both the S22 row and the M9.6 milestone row to Done.

Per §0.3 the dev correctly did NOT touch this — the architect/CTO closes the milestone. The stale wording is just a lag, not a violation.

### C-3: One flaky dashboard test (low priority)

First dashboard suite run at 18:16 reported `1 failed | 1369 passed`. Re-run at 18:20 reported `1370 passed | 0 failed`. The flake didn't surface in the failure tail of the first run output; couldn't isolate the specific test. Worth a follow-up to identify and stabilize, but not a sprint blocker since both deterministic re-runs were clean.

## Required changes

| ID | Change | Owner |
|----|--------|-------|
| **C-1** | Rewrite `s22-review.md` body to describe the actual passing retest. Remove or mark-resolved the "Open questions" section. | Dev |
| **C-2** | Update ROADMAP S22 row to reflect passing retest status. M9.6 milestone row stays "In Progress" until CTO sign-off. | Architect (this commit) |
| **C-3** | Identify the flaky test and file as `s22-FOLLOW-UPS.md` FOLLOW-UP-4. Don't fix in S22; just track. | Dev |

## Suggested (non-blocking)

| ID | Suggestion |
|----|-----------|
| S1 | The `[capability-scanner] no interaction declared for "X", inferred as "tool"` debug log fires for any unknown type. Worth bumping to INFO level on plug authors' first scan so they notice and add explicit declaration. Cosmetic. |
| S2 | `retryTurn` early-returns silently for `origin.kind !== "conversation"`. Worth a debug log line so the dev knows when an automation-origin tool failure was fixed but not retried — would help future debugging. Optional. |
| S3 | The dispatch decision (`getInteraction === "tool"`) lives inline in `terminalDrain`. If a fourth shape ever lands (e.g., `interaction: "ambient"` for background sensors), this becomes a switch statement. Not relevant for M9.6; flag if S23+ adds shapes. |

## Verdict rationale

S22's framework addition (the third shape — tool retry) is correctly built, correctly tested, and correctly verified end-to-end via the methodology-corrected live retest. The dev followed the §0.3 reminder (no premature ROADMAP-Done) — first M9.6 sprint to do so cleanly. All three required changes are documentation, not code.

After C-1 (rewrite review.md), C-2 (update ROADMAP S22 row), and C-3 (file flaky test as FU), this is mergeable. **M9.6 closes when CTO signs off on the milestone row update.**

The 21-sprint promise — *"Nina gets task → capability broken → fixes it → resumes task"* — now holds for all three capability shapes:
- Input (STT): full gate + content replay (S1-S8 + S21 wiring)
- Output (TTS): degraded fallback + brain awareness (S21 BUG-6)
- Tool (browser-control, desktop-control): retry original action (S22)

M9.6 actually does what it set out to do.
