---
sprint: M9.4-S4.1
title: "Follow-ups — Brief Section Preservation"
date: 2026-04-20
runner: team-lead
---

# Follow-ups — M9.4-S4.1

## FU-1 — Alert-layer conversation-context-budget gate

**Type:** Architectural.

**Summary:** The alert layer has no per-conversation context-budget awareness. On a busy day, multiple `alert()` calls from heartbeat + automations can pile onto the brain's conversation and inflate context beyond useful limits. This is distinct from delivery correctness (S4.1's scope) — it's about how much can be said without saturating the brain's attention.

**Suggested approach:** Introduce a per-conversation budget token pool. `alert()` consumers declare a cost; the alert layer coalesces / defers / drops when the pool is low. Instrument with a dashboard pane showing recent alert volume + pool state.

## FU-2 — M9.6-S20 CFR-fix worker output contract change

**Type:** Worker-template redesign.

**Summary:** After S4.1 lands, CFR-fix deliverables still dominate the Haiku 10 000-char condense budget because each attempt writes a ~2–3K forensic `deliverable.md`. The aggregator reads `deliverable.md` as the worker's contribution (see `handler-registry.ts:307-331`). Result: a brief where everything is present but CFR content crowds out user-facing content's fidelity.

**Proposed change (owned by S20):**
- `deliverable.md` becomes one terse paragraph per capability — outcome + file changed, if any. 2–5 lines total across attempts. This is what surfaces in the morning brief.
- Forensic detail (diagnosis, decisions log, validation commands, attempt-by-attempt state) moves to a sibling file in the same `run_dir` (`attempts.md` or `forensic.md`). Same audit trail, not surfaced to the aggregator.

**Impact:** After S4.1 + S20 land together, the morning brief goes back to ~6–8K chars on a normal day. Condense path becomes a safety net rather than a steady-state necessity.

## FU-3 — AlertResult + InitiateResult type alias consolidation

**Type:** Tidy-up.

**Summary:** The `AlertResult` discriminated union is duplicated in five locations across four files. After FU-7 landed the `initiate()` signature change, each of the four inline consumer aliases also gained an inline `InitiateResult` shape — so the duplication budget is now effectively 2× what it was:

- `packages/dashboard/src/agent/conversation-initiator.ts` — canonical `export type AlertResult`, canonical `export type InitiateResult` (source of truth for both)
- `packages/dashboard/src/automations/heartbeat-service.ts` — inline structural types for both `alert()` and `initiate()`
- `packages/dashboard/src/automations/automation-scheduler.ts` — same
- `packages/dashboard/src/automations/automation-processor.ts` — same
- `packages/dashboard/src/server.ts` — same

Any future change to either union requires editing 4 inline copies. TypeScript exhaustiveness catches mismatches but the duplication is friction.

**Suggested approach:** Consolidate to the single exported `AlertResult` / `InitiateResult` types and import them in all consumers. Replace the `HeartbeatConfig.conversationInitiator` and peer interfaces with a shared interface. Low-risk refactor; high readability value.

## FU-4 — Document the 8:13 AM brief delivery latency budget

**Type:** Observability / docs.

**Summary:** The expected worker-completion-to-brain-notification latency for the morning brief is not documented anywhere. On 2026-04-20 the investigation flagged this as a missing specification — when a brief is late, there's no reference for "how late is too late."

**Suggested approach:** Add an explicit budget (e.g., 5 minutes from worker completion to brain notification, 10 minutes from aggregator start to brain response) to the brief pipeline's design doc. Surface on the dashboard debug pane. Capacity debates become data-driven.

## FU-7 — Extend delivery-observation to `initiate()` — ✅ ADDRESSED IN THIS SPRINT

**Original concern:** S4.1's first merge fixed `alert()` to observe `sendSystemMessage()` output before returning. `heartbeat-service.ts:305` still called `markDelivered()` immediately after `initiate()` returned, without observing `initiate()`'s internal stream. Same class of bug, fresh-install `no_conversation` fallback path.

**Resolution (post-audit, in-scope per CTO 2026-04-20):** Full fix landed. See DECISIONS D10.

- `initiate()` signature changed to return `InitiateResult = { conversation: Conversation; delivery: AlertResult }`.
- All six callers updated (heartbeat-service FU-7 target, `alert()` channel-switch, automation-processor, automation-scheduler, `app.ts` AutomationNotifier — also fixed a pre-existing dead-code `if (!alerted)` bug there — and debug.ts).
- Four inline structural aliases of `initiate()`'s return type extended to the InitiateResult shape.
- New test file `conversation-initiator-initiate-outcome.test.ts` (4 tests). Two new heartbeat-service tests for initiate-fallback skipped_busy and send_failed.
- Live verification script re-run: 34,271-byte fixture → 7,098-byte Haiku output, 14/14 wrappers preserved, VERDICT: PASS.

## FU-8 — Drop unused `response` accumulator on external same-channel error/busy branches — ✅ ADDRESSED IN M9.6-S20

**Type:** Cosmetic.

**Summary:** In `conversation-initiator.ts:177-190` (the external same-channel path), the accumulated `response` string is assembled from `text_delta` events and then passed to `forwardToChannel(response, targetChannel)` on the happy path. On the `send_failed` or `skipped_busy` paths, control returns before `forwardToChannel` is called — so the `response` accumulator has no observable use on those branches. Not incorrect, just dead state.

**Suggested approach:** Only accumulate `response` when the loop is going to complete successfully, or use a conditional so the accumulator isn't touched on the error/busy exits. Non-functional — purely readability cleanup.

## FU-6 — Remove vestigial `briefingDelivered` field from `SessionManager` — ✅ ADDRESSED IN THIS SPRINT

**Resolution:** Field declaration + all three writes removed. Zero remaining references. Typecheck clean, 53 sprint-scoped tests pass. See DECISIONS D11.

## FU-5 — Session-manager briefing-timing test independence

**Type:** Test debt.

**Summary:** The initial implementation of `tests/unit/agent/session-manager-briefing-timing.test.ts` contained a local `simulateStreamMessageBriefingPath` helper that replicated the guard logic, rather than driving the real `SessionManager`. If the production guard were reverted, the test continued passing — a tautological test.

**Remediation applied in this sprint:** Following reviewer's Option B, the guard logic was extracted into a single helper within `session-manager.ts` and the test was rewritten to exercise the real helper via synthetic async generators. A revert-restore sanity check was performed: reverting the guard made the tests fail, restoring the fix made them pass — confirming the test is load-bearing.

**Remaining concern (monitored, not acted on):** The extracted helper is still private to the session-manager module. If a future refactor re-inlines it back into two copies without exporting, the duplication-hazard returns. Keep the extraction visible and named; any future audit should re-verify via the revert-restore sanity check.
