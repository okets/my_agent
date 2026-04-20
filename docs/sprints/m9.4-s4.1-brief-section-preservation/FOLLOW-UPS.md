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

## FU-3 — AlertResult type alias consolidation

**Type:** Tidy-up.

**Summary:** The `AlertResult` discriminated union is duplicated in five locations across four files:
- `packages/dashboard/src/agent/conversation-initiator.ts` — canonical `export type AlertResult` (source of truth)
- `packages/dashboard/src/automations/heartbeat-service.ts` — inline structural type inside `HeartbeatConfig.conversationInitiator.alert`
- `packages/dashboard/src/automations/automation-scheduler.ts` — inline alias
- `packages/dashboard/src/automations/automation-processor.ts` — inline alias
- `packages/dashboard/src/server.ts` — inline alias

(Plan's scope table listed three structural duplicates; a fourth at `heartbeat-service.ts:77-81` was discovered by a cascading `app.ts:1990` TS2322 error during integration — see DEV-1 in DEVIATIONS.md.)

Any future change to the union requires editing all five locations. TypeScript exhaustiveness catches mismatches but the duplication is friction.

**Suggested approach:** Consolidate to a single `export type AlertResult` and import it in all consumers. Replace the `HeartbeatConfig.conversationInitiator` and peer interfaces with a shared interface. Low-risk refactor; high readability value.

## FU-4 — Document the 8:13 AM brief delivery latency budget

**Type:** Observability / docs.

**Summary:** The expected worker-completion-to-brain-notification latency for the morning brief is not documented anywhere. On 2026-04-20 the investigation flagged this as a missing specification — when a brief is late, there's no reference for "how late is too late."

**Suggested approach:** Add an explicit budget (e.g., 5 minutes from worker completion to brain notification, 10 minutes from aggregator start to brain response) to the brief pipeline's design doc. Surface on the dashboard debug pane. Capacity debates become data-driven.

## FU-6 — Remove vestigial `briefingDelivered` field from `SessionManager`

**Type:** Dead-state cleanup.

**Summary:** After extracting the guard into `ackBriefingOnFirstOutput`, the `this.briefingDelivered` field on `SessionManager` (declared at line 378, written at lines 743, 782, reset at 840) is written in three places but never read. The helper's internal `delivered` flag is what actually gates `markDelivered()`. The field is vestigial — not affecting correctness, but dead state that invites confusion for future editors.

**Suggested approach:** Remove the field declaration at line 378, the two `this.briefingDelivered = true` writes at 743 and 782, and the reset at 840. Ensure no other references exist (`grep briefingDelivered packages/dashboard/src/agent/session-manager.ts` should return only the removal diff). Re-run `npx tsc --noEmit` and the sprint-scoped test suite to confirm no regression.

**Priority:** Low. Safe to defer to the next tidy-up sprint.

## FU-5 — Session-manager briefing-timing test independence

**Type:** Test debt.

**Summary:** The initial implementation of `tests/unit/agent/session-manager-briefing-timing.test.ts` contained a local `simulateStreamMessageBriefingPath` helper that replicated the guard logic, rather than driving the real `SessionManager`. If the production guard were reverted, the test continued passing — a tautological test.

**Remediation applied in this sprint:** Following reviewer's Option B, the guard logic was extracted into a single helper within `session-manager.ts` and the test was rewritten to exercise the real helper via synthetic async generators. A revert-restore sanity check was performed: reverting the guard made the tests fail, restoring the fix made them pass — confirming the test is load-bearing.

**Remaining concern (monitored, not acted on):** The extracted helper is still private to the session-manager module. If a future refactor re-inlines it back into two copies without exporting, the duplication-hazard returns. Keep the extraction visible and named; any future audit should re-verify via the revert-restore sanity check.
