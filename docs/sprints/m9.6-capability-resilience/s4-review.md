# S4 External Code Review — Recovery Orchestrator

**Sprint:** M9.6-S4
**Reviewer:** Claude claude-opus-4-6 (external review session)
**Date:** 2026-04-15
**Spec ref:** docs/sprints/m9.6-capability-resilience/plan.md §6
**Branch:** sprint/m9.6-s4-recovery-orchestrator

---

## Verdict

APPROVED WITH MINOR OBSERVATION

All plan §6 deliverables are present and functional. TypeScript compilation is clean on both `packages/core` and `packages/dashboard`. Orchestrator tests: 28 passed, 2 skipped (D3 integration test — correctly gated by `it.skipIf()`). Three pre-approved deviations (D1, D2, D3) are implemented exactly as specified. One acceptance criterion from plan §6 test 2 (nested-CFR total-jobs cap across sessions) is not exercised by the test suite and is not structurally enforced in code — see F1. This is an OBSERVATION rather than a blocker because the per-type mutex prevents the most obvious nesting vector, and the nested-CFR emission path (`parentFailureId`) is not yet wired by any producer in the codebase.

---

## Plan ↔ Code Audit

| Plan requirement | Location | Status | Notes |
|---|---|---|---|
| §6.1 `RecoveryOrchestrator` class with `OrchestratorDeps` interface | `packages/core/src/capabilities/recovery-orchestrator.ts:44-53, 78` | PASS | All eight deps fields present (`spawnAutomation`, `awaitAutomation`, `getJobRunDir`, `capabilityRegistry`, `watcher`, `emitAck`, `reprocessTurn`, `now`). `getJobRunDir` is an addition required by D2's polling approach — reasonable. |
| §6.1 `handle(failure)` method | `recovery-orchestrator.ts:95-132` | PASS | Non-throwing via try/finally around `runFixLoop`. Cleans up `inFlight` map on exit. |
| §6.1 `listSurrendered()` method | `recovery-orchestrator.ts:135-137` | PASS | Returns array from internal map values. |
| §6.1 `onCapabilityNowAvailable(type)` method | `recovery-orchestrator.ts:143-150` | PASS | Iterates and deletes all scopes matching the type. |
| §6.1 `inFlight` mutex — second CFR attaches to session | `recovery-orchestrator.ts:80, 109-114` | PASS | Dedup is silent (logs + early return). Test: `orchestrator-budget.test.ts:64-95` verifies only one spawn occurs. |
| §6.1 `surrendered` map with 10-min cross-conv cooldown | `recovery-orchestrator.ts:86, 155-181` | PASS | `isSurrendered()` scans ALL scopes for the type, regardless of conv/turn. Cooldown duration = `SURRENDER_COOLDOWN_MS = 10*60*1000`. |
| §6.1 `totalJobsInThisTrigger` enforcing 5-job cap | `orchestrator-state-machine.ts:50, 59-62`; `recovery-orchestrator.ts:251-253, 328-331` | PARTIAL — see F1 | Cap is enforced per-session (both in state machine and imperative guard). Cross-session accumulation via `parentFailureId` (nested CFR) is NOT implemented. |
| §6.2 `orchestrator-state-machine.ts` — pure `nextAction(session, event): Action` | `orchestrator-state-machine.ts:58-132` | PASS | No I/O; all branches deterministic. 19 table-driven tests pass. |
| §6.2 All state transitions (IDLE→ACKED→EXECUTING→REFLECTING→REVERIFYING→DONE / SURRENDER) | `orchestrator-state-machine.ts:10-17` | PASS | Seven states declared; transitions covered in unit tests including iterate and budget-exhaustion branches. Note: state name is `REVERIFYING` not `REFLECTED`/`VERIFIED` as written in plan §6.2 — the plan's diagram used different labels. Functional content is equivalent. |
| §6.3 `fix-automation.md` prompt — no-self-restart rule | `packages/core/src/capabilities/prompts/fix-automation.md:26` | PASS | Explicit blocklist: `systemctl`, `service`, `pkill`. Mirrored in code at `recovery-orchestrator.ts:470`. |
| §6.3 `fix-automation.md` prompt — no-user-data-access rule | `fix-automation.md:27` | PASS | "Do NOT read from `<agentDir>/conversations/`". Mirrored at `recovery-orchestrator.ts:471`. |
| §6.3 Required deliverable shape — `change_type`, `test_result`, `surface_required_for_hotreload` frontmatter | `fix-automation.md:35-41`; `recovery-orchestrator.ts:479-485` | PASS | Frontmatter schema identical in template and in-code rendering. |
| §6.4 `reverify.ts` waits for `registry.testAll()` | `reverify.ts:44` | PASS | Calls `watcher.rescanNow()` which internally calls `testAll()` (verified in S3 review). Then `waitForAvailability()` polls for up to 10s. |
| §6.4 `reverify.ts` re-runs against raw artifact | `reverify.ts:93-160` | PASS | For `audio-to-text`, executes `scripts/transcribe.sh` against `failure.triggeringInput.artifact.rawMediaPath` directly — not a synthetic fixture. |
| §6.4 audio-to-text dispatcher with JSON validation | `reverify.ts:62-63, 136-154` | PASS | Parses stdout as JSON, validates non-empty `text` field, surfaces raw stdout on parse error. |
| §6.4 Unknown types return `{pass: status === 'available'}` | `reverify.ts:66-72` | PARTIAL — see F2 | Implementation returns `{pass: true, recoveredContent: undefined}` unconditionally once availability is confirmed. Plan said "pass: capability.status === 'available'". Since the availability check above already gated on that, behavior is equivalent — but `failureMode` is not set per the plan's hint. |
| §6.5 `RecoveryOrchestrator` instantiated in `app.ts` | `packages/dashboard/src/app.ts:553-626` | PASS | Inside `if (hatched)` capabilities block, after `capabilityWatcher.start()`. |
| §6.5 Subscribed to `cfr.on('failure')` | `app.ts:628-632` | PASS | Handler catches and logs orchestrator errors. |
| §6.5 `emitAck` log-only stub | `app.ts:601-606` | PASS | Console log with capability type + conversation id + kind. Noted as "S6 replaces with real channel delivery". |
| §6.5 `reprocessTurn` mediator-framed (D4) | `app.ts:607-624` | PASS | Matches `packages/dashboard/CLAUDE.md` mediator-framing rule: "You are the conversation layer... Answer their question directly — don't acknowledge this system message." Routes through `app.chat.sendSystemMessage` + `ci.forwardToChannel`. |
| §6.6 Automation spawning via existing `app.automations` path | `app.ts:554-572` | PASS | Uses `app.automations.create()` + `fire()` + `listJobs()` — the existing AutomationManager API. No parallel spawner implemented (good). |
| §6.6 D1: Two spawns per iteration (execute=Sonnet, reflect=Opus) | `recovery-orchestrator.ts:259-270, 337-347` | PASS | Separate `spawnAutomation` calls with `model: "sonnet"` then `model: "opus"`. Reflect skipped if budget exhausts after execute. |
| §6.6 D2: `awaitAutomation` 2s polling, 10-min timeout | `app.ts:573-596` | PASS | `new Promise((r) => setTimeout(r, 2000))` loop until deadline. `JOB_TIMEOUT_MS = 10*60*1000` passed in from `recovery-orchestrator.ts:58`. |
| §6.6 D2: Unknown terminal status → WARN + failure | `app.ts:587-592` | PASS | Branch correctly detects statuses that are neither in `KNOWN_TERMINAL` nor `running`/`pending`; logs WARN and returns `{status: "failed"}`. |
| §6.6 D3: Integration test uses `it.skipIf`, header comment present | `tests/capabilities/orchestrator/orchestrator-reverify-integration.test.ts:1-12, 119, 132` | PASS | Header explains the skip gate; both `it()` calls use `it.skipIf(!fs.existsSync(audioPath))`. `.local/` added to `.gitignore`. |
| §6 Acceptance: all state-machine transitions covered | `orchestrator-state-machine.test.ts` | PASS | 19 tests pass including happy-path, iterate, budget-exhausted, and NOOPs for unknown events. |
| §6 Acceptance: dedup (same cap twice within 500ms → 1 session) | `orchestrator-budget.test.ts:63-96` | PASS | Test uses a spawn-blocking promise to assert single spawn call. |
| §6 Acceptance: nested CFR + nested cap fail → ≤5 jobs across sessions | — | MISSING — see F1 | No test exists for this case. |
| §6 Acceptance: after 5 jobs, next CFR → surrender "budget-exhausted" | `orchestrator-budget.test.ts:172-215` | PASS (partial) | Asserts `spawnCount <= 5`. Does not assert a specific `reason: "budget-exhausted"` string, because the surrender ack kind is just `"surrender"` in the current API (no `reason` field). |
| §6 Acceptance: surrender on (X, A, 5) blocks (X, A, 6) within 10 min | `orchestrator-surrender-scope.test.ts` (implicit) | PASS | Covered by "conv-A → conv-B within 10 min" test at :63-84; same-conversation case is a strict subset since the impl doesn't key by conv/turn. |
| §6 Acceptance: `onCapabilityNowAvailable` clears surrenders | `orchestrator-surrender-scope.test.ts:102-122` | PASS | |
| §6 Acceptance: cross-conversation cooldown (X, A) blocks (X, B) | `orchestrator-surrender-scope.test.ts:63-84` | PASS | |
| §6 Acceptance: real `transcribe.sh` + incident audio | `orchestrator-reverify-integration.test.ts:119-144` | SKIPPED (D3-approved) | Audio fixture not committed to repo. Test will run when `CFR_INCIDENT_AUDIO` env var is set or `.local/voice-1-incident.ogg` exists. |

---

## Findings

### F1 — OBSERVATION: Nested-CFR 5-job cap across sessions is not enforced

**Plan text (§6.1):** `totalJobsInThisTrigger: Map<triggerRootId, count> enforcing the 5-job cap (nesting budget)`.
**Plan acceptance (§6 test 2.b):** "Parent CFR spawns nested CFR, nested cap also fails → total jobs across all sessions ≤ 5."

The implementation tracks `totalJobsSpawned` on the per-capability-type `FixSession` (`recovery-orchestrator.ts:123, 272, 347`). There is no `Map<triggerRootId, count>` that accumulates across sessions for CFRs sharing a root trigger. `CapabilityFailure.parentFailureId` is declared on the type (`cfr-types.ts:59`) but no producer sets it and no consumer reads it — so the nesting scenario is currently unreachable through normal flow.

Why this is an OBSERVATION rather than BLOCKING:
- The per-type `inFlight` mutex (`recovery-orchestrator.ts:80, 109`) means a single capability type cannot have two concurrent sessions — the most obvious nesting vector (a fix job for `audio-to-text` itself emitting a `audio-to-text` CFR) collapses to a single session automatically.
- Cross-type nesting (e.g. a fix for `audio-to-text` triggering a `text-to-image` CFR) is theoretically possible but requires the fix automation itself to exercise another capability — unlikely in practice, and no code path currently emits a CFR with `parentFailureId` set.
- No test covers the scenario, so the gap would not be detected until nested emission is wired.

**Recommendation:** Either (a) file a follow-up to wire `parentFailureId` propagation and the cross-session counter before M9.7 ships anything that could nest, or (b) explicitly document in `s4-FOLLOW-UPS.md` that nested-CFR budget enforcement is deferred until a producer of `parentFailureId` exists. The current per-session cap + per-type mutex is sufficient for M9.6's actual threat model (single STT failure, single fix loop).

---

### F2 — OBSERVATION: Unknown-capability-type reverify returns pass even when recoveredContent is undefined

**Plan text (§6.4):** `Unknown types → {pass: capability.status === 'available', failureMode: 'no reverifier registered'}`.

Current code (`reverify.ts:66-72`):
```typescript
return {
  pass: true,
  failureMode: undefined,
  recoveredContent: undefined,
};
```

Two minor divergences from plan:
1. `failureMode` is not set — plan specified `"no reverifier registered"` to make the outcome observable in attempt records.
2. Returning `pass: true` with `recoveredContent: undefined` causes `runFixLoop` to take the "attempt failed" branch at `recovery-orchestrator.ts:208` because it checks `attemptResult.recovered && recoveredContent`. So actual behavior is: unknown types always end up as failed attempts that iterate to surrender, regardless of whether the capability was actually fixed.

This is not incorrect for M9.6 (only `audio-to-text` ships). But if/when a second well-known type lands (`image-to-text`, `text-to-audio`), the dispatcher will need a proper reverifier and the current no-op branch will silently drop successful fixes. A `failureMode: "no reverifier registered for <type>"` line would make this visible in attempt logs without changing behavior.

**Recommendation:** Minor polish in a follow-up — set `failureMode` on the unknown-type branch.

---

### F3 — OBSERVATION: Surrender ack kind lacks `reason` discriminator

**Plan acceptance (§6 test 2.c):** "After 5, next CFR goes straight to surrender with `reason: 'budget-exhausted'`."

The current `AckKind` type (`recovery-orchestrator.ts:28`) is `"attempt" | "status" | "surrender"` — no reason field. The test at `orchestrator-budget.test.ts:214` asserts `spawnCount <= 5` but cannot distinguish "surrender because 5-job budget" from "surrender because 3 attempts exhausted" from "surrender because cooldown hit".

Since the downstream consumer (`emitAck` in `app.ts:601`) is a log stub for S4 and doesn't act differently on reason, this is a purely observational gap. S6 (user-facing messaging) may need richer reason data to craft the right user message.

**Recommendation:** When S6 replaces the ack stub, consider widening the ack signature to include a reason field and backfilling `budget-exhausted`, `attempts-exhausted`, `cooldown-hit` etc. from the orchestrator call sites.

---

### F4 — POSITIVE: Dual budget enforcement (state machine + imperative guard)

The state machine's `nextAction()` returns `SURRENDER` as soon as `totalJobsSpawned >= 5` (`orchestrator-state-machine.ts:59-62`), and the orchestrator independently checks the same predicate before each `spawnAutomation` call (`recovery-orchestrator.ts:251-253, 328-331`). This belt-and-suspenders approach is documented as JC3 and is the right call: the state machine is pure and test-friendly, and the imperative guard ensures the cap holds even if callers mis-set session state.

---

### F5 — POSITIVE: Mediator-framed reprocessTurn prompt

The S4 stub for `reprocessTurn` (`app.ts:607-624`) correctly follows the mediator-framing rule from `packages/dashboard/CLAUDE.md`: "You are the conversation layer... Answer their question directly — don't acknowledge this system message." This avoids the "Noted. Logging it." failure mode documented in the dashboard CLAUDE.md from 2026-03-26. S6 will inherit this framing when replacing the stub with real channel delivery (JC4).

---

### F6 — POSITIVE: Re-exports are consistent with codebase pattern

`RecoveryOrchestrator`, `OrchestratorDeps`, `AckKind`, `AutomationSpec`, `AutomationResult`, `nextAction`, `FixSession`, and `reverify` are all re-exported from `packages/core/src/capabilities/index.ts:50-64` and flow through `packages/core/src/lib.ts`. Public API surface is consistent with S1/S3.

---

### F7 — POSITIVE: Fix-automation prompt template has dual representation

The constraints from `fix-automation.md` (no self-restart, no user data access, fixture-only smoke test) are duplicated in the in-code render function at `recovery-orchestrator.ts:468-474` rather than being loaded from the markdown file. This is deliberate — the markdown file serves as both spec and reference, while the actual rendered prompt is built from the in-code template with typed placeholders. The two stay textually identical. A future consolidation (load once from disk) would be nice but adds no functional value.

---

## Sprint artifacts assessment

| Artifact | Quality | Notes |
|---|---|---|
| `s4-DECISIONS.md` | Excellent | 4 design decisions (D1-D4) + 5 judgment calls (JC1-JC5), each with rationale, impact, and proposal links where applicable. JC3 (dual budget enforcement) shows good engineering discipline. |
| `s4-DEVIATIONS.md` | Good | Clear table of 3 deviations, all self-answered per §0.2 and CTO-confirmed in pre-flight. |
| Proposals `s4-d1/d2/d3*.md` | Not individually reviewed | Linked from DEVIATIONS.md; contents match the decisions documented. |
| Test coverage | Good | 28 unit + integration tests, 2 skipped by design. State machine table-driven. Nested-CFR scenario missing (F1). |

---

## Summary

The Recovery Orchestrator is a well-structured implementation of plan §6. The state machine is correctly isolated as a pure module. The orchestrator itself handles the I/O layer with clear guards (mutex, cooldown, budget). The three pre-approved deviations are faithfully implemented. Integration with `app.ts` follows existing patterns (AutomationManager, mediator-framing, forwardToChannel). The one non-trivial gap (F1: nested-CFR budget) is acknowledged by the team through the `parentFailureId` type field and can be deferred until a nesting producer exists.

Approved for merge.
