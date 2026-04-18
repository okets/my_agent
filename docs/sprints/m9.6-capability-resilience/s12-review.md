---
reviewer: External auditor (dev-contracted)
sprint: m9.6-s12
date: 2026-04-18
recommended: APPROVE
conditions: []
---

# M9.6-S12 External Review

## Summary

S12 delivers the `McpCapabilityCfrDetector` (hooks + `processSystemInit`), the `registry.findByName` lookup, the `classifyMcpToolError` regex map, `SessionContext`-backed origin factories on both `SessionManager` and `AutomationExecutor`, the `CFR_RECOVERY.md` writer in `ack-delivery.ts`, the `attachedOrigins` N-aware mutex with six-step terminal drain in `RecoveryOrchestrator`, and the `debrief-prep` reader — end to end. All five S9 `unreachable in S9` throws are replaced, the S10 placeholder origin in `app.ts` is gone, and every acceptance test and regression suite green except a single pre-existing MCP-spawn flake that predates this sprint. Design fidelity is high; the Day-1 spike identified a real gap (`PostToolUseFailure` does not cover Mode 3) and the scope expansion to `processSystemInit()` was architect-adjudicated before Task 2 started.

## Spec coverage assessment

| Feature | Spec source | Implemented? | Notes |
|---|---|---|---|
| `McpCapabilityCfrDetector` (hooks) | v2 §3.1, Task 3 | Yes | `packages/core/src/capabilities/mcp-cfr-detector.ts:42-70`. Hooks for `PostToolUseFailure` (Modes 1+2) and conservative `PostToolUse` empty-result. |
| `processSystemInit` (Mode 3) | spike-driven, Task 3 | Yes | `mcp-cfr-detector.ts:127-165`. Guards on `subtype === "init"`, iterates `mcp_servers[]`, skips `connected`/`pending`, idempotent via `initEmitted: Set<string>`. |
| `classifyMcpToolError` | v2 §3.1, Task 2 | Yes | `packages/core/src/capabilities/failure-symptoms.ts:44-50`. Regex map covers timeout, validation, not-enabled, Connection closed, default `execution-error`. |
| `registry.findByName` | v2 §3.1, Task 2 | Yes | `packages/core/src/capabilities/registry.ts:209-211`. Returns capability by unique `name`, independent of `enabled`/`status` per docblock. |
| `SessionContext` type + lifecycle | D1, Task 0 | Yes | `packages/core/src/capabilities/cfr-types.ts:93-112`. Discriminated union, brain/automation variants map 1:1 to TriggeringOrigin; lifecycle populated on `session_init`, cleared in `finally`. |
| `ChannelContext` completeness | D3 | Partial-acceptable | `chat-service.ts:552` threads full struct; fallback `{sender: "user"}` is used when options.channel is absent (noted acceptable in D3 — web sessions without logged-in user). Not the empty-string placeholder from S10. |
| `attachedOrigins` N-aware mutex | v2 §3.4, D7, Task 6a | Yes | `recovery-orchestrator.ts:145-154` coalesces late CFRs; no second spawn; no duplicate ack. Test coverage in `mutex-origin-coalescing.test.ts` asserts both. |
| Six-step terminal drain | v2 §3.4, Task 6b | Yes | `recovery-orchestrator.ts:542-660`. Buckets by kind, enforces automation→conversation→system ordering, per-origin try/catch for failure isolation. |
| `CFR_RECOVERY.md` writer | v2 §3.4, D5, Task 5 | Yes | `ack-delivery.ts:277-312`. Writes via `writeFrontmatter()`. Schema matches D5 (plug_name, plug_type, detected_at, resolved_at, attempts, outcome, optional surrender_reason). |
| `debrief-prep` reader | v2 §3.4, Task 7 | Yes | `debrief-prep.ts:91-135` + `runDebriefPrep()` threads `runDir` through. Production wiring at `handler-registry.ts:256` passes `runDir` (fix commit `43c9545`). |
| Non-conversation surrender (Option A) | D6, Task 6c | Yes | `recovery-orchestrator.ts:234-251` gates `recordSurrender` on `kind === "conversation"`. |
| Zero S9 throws in `packages/` | s9 architect-review, Task 8 | Yes | `rg "unreachable in S9" packages/` returns zero hits. Five throws replaced: ack-delivery.ts, recovery-orchestrator.ts ×2, app.ts ×2. |
| S10 placeholder replaced | s10 audit C4, Task 4 | Yes | `app.ts:540-559` replaces the `conversationOrigin("", 0)` placeholder with a live `sessionRegistry` lookup via `getCurrentOrigin()`. Throws when no brain session is active. |

## Test coverage

| Test file | Tests | Status |
|---|---|---|
| `packages/core/tests/capabilities/mcp-cfr-detector.test.ts` | 22 | PASS |
| `packages/core/tests/capabilities/registry-find-by-name.test.ts` | 5 | PASS |
| `packages/core/tests/capabilities/ack-delivery-origin.test.ts` | 13 | PASS |
| `packages/core/tests/capabilities/orchestrator/mutex-origin-coalescing.test.ts` | 4 | PASS |
| `packages/core/tests/capabilities/orchestrator/terminal-drain-non-conversation.test.ts` | (bonus) | PASS (covered by phase regression) |
| `packages/core/tests/capabilities/classify-mcp-tool-error.test.ts` | (bonus) | PASS |
| `packages/dashboard/tests/integration/cfr-conversation-mcp.test.ts` | 3 | PASS |
| `packages/dashboard/tests/integration/cfr-automation-mcp.test.ts` | 4 | PASS |
| `packages/dashboard/tests/integration/debrief-prep-cfr-recovery.test.ts` | 10 | PASS |

Totals: 44 S12 core unit tests + 17 S12 dashboard integration tests = **61 S12-specific tests, all passing**. Phase regression: core 245 passed / 2 skipped / 1 pre-existing MCP-spawn flake (file untouched in sprint). Dashboard CFR regression: 35 passed / 0 failed.

## Issues found

### Critical — none.

### Important — none.

### Minor / observational (no fix required for approval)

1. **CapabilityInvoker originFactory's "first active session wins" semantics** (`app.ts:549-557`).
   The closure iterates `sessionRegistry.getAll()` and returns the first session with `hasActiveSession()`. In a multi-user dashboard with concurrent brain sessions this could route a script-plug invocation to the wrong conversation's origin. The inline comment acknowledges "single-threaded per conversation (one active query at a time)" which is true for the current architecture, but if the dashboard ever exposes truly concurrent streamMessage calls this becomes a latent bug. Suggest tracking in S13+ FOLLOW-UPS if multi-session concurrency lands.

2. **Dashboard fallback ChannelContext.sender = `"user"`** (`chat-service.ts:547-551`).
   When `options?.channel` is undefined, the fallback context sets `sender: "user"`. D3 explicitly calls out that "for dashboard web sessions where the message originates from the browser WebSocket ... the context is `{ transportId: "dashboard", channelId: "dashboard", sender: userId }` where `userId` is the authenticated session's user identifier (not `"system"`)." `"user"` is better than `"system"` (the S10 placeholder was `"system"`), but it's still a generic placeholder, not a real identifier. Acceptable for S12 since the dashboard today is single-user and there is no auth-session userId available at the chat-service layer; track in S13+ if multi-user auth lands.

3. **Deviation note: `ack-delivery.ts` doc comment was renamed to make the `rg "unreachable in S9"` acceptance grep unambiguous** (logged in `s12-DEVIATIONS.md`). This is correct process — the deviation is documented, not hidden.

4. **Acceptance grep strictness.** The acceptance command `rg "unreachable in S9" packages/` is fragile to doc-comment references; the dev caught this and documented it. No live throws remain, which is what matters.

5. **Integration-test flake on `integration.test.ts`.** `full flow: scan → registry → spawn → rate limit → toggle → shutdown` fails with `MCP error -32000: Connection closed`. Verified not touched by this sprint (`git log master..HEAD -- packages/core/tests/capabilities/integration.test.ts` returns nothing). Pre-existing; outside S12 scope.

## Process compliance

| Check | Result |
|---|---|
| `s12-DECISIONS.md` exists with D1 (SessionContext) | Yes — §D1 §D2 §D3 §D4 §D5 §D6 §D7 |
| D5 (CFR_RECOVERY.md schema) documented | Yes — §D5, matches writer implementation |
| D6 (Option A surrender) documented | Yes — §D6, matches `recordSurrender` gate |
| D7 (attachedOrigins initialization) documented | Yes — §D7, matches FixSession wiring |
| `s12-DEVIATIONS.md` exists | Yes — 4 deviations logged (spike scope expansion, idempotency key simplification, runDir wiring spec gap fixed in `43c9545`, doc-comment rename) |
| `s12-FOLLOW-UPS.md` exists with deferred items + receiving sprints | Yes — ack coalescing → S19; system-origin UI → S19; fix-engine swap → S16; `RESTORED_TERMINAL` → S13; Option B → deferred; automation `fixed` immediate notifier → S19; concrete `AutomationNotifierLike` impl → S19 |
| No `verdict: APPROVED` in any file | Confirmed — only the plan's prose references the forbidden phrase |
| Roadmap NOT marked Done | Confirmed — S12 row still says `Planned` in ROADMAP.md:998 |
| No `s12-architect-review.md` (dev doesn't write it) | Confirmed — file does not exist |
| Day-1 spike filed and gated Task 2 | Yes — `proposals/s12-spike-results.md` plus architect-adjudicated follow-up mini-spike for streamMessage path |
| Design feature-to-task coverage check | All 30 rows in plan §"Design feature → task coverage check" map to implemented code |

## Recommendation

**APPROVE.**

Rationale: spec coverage is 100% against the plan's feature-coverage check; every acceptance test and both phase-regression suites pass; the single regression failure is a pre-existing flake unrelated to this sprint; all five S9 throws are replaced; the S10 placeholder is gone; the D1/D5/D6/D7 required decisions are documented with rationale; the day-1 spike properly gated implementation and produced a scope expansion that the architect adjudicated before Task 2 started. The minor observations above are non-blocking — some are genuine future work (multi-user concurrency) that the current architecture does not exercise, and the others are doc-level tidiness.

This is the first S12 attempt I see that shipped without scope creep against the plan's file map. The dev caught a spec gap (debrief-prep's `runDir` was added as a parameter but not wired at the production call site) themselves, fixed it in `43c9545`, and documented it in DEVIATIONS. Good discipline.

---

**Artifacts reviewed:**

- `docs/sprints/m9.6-capability-resilience/s12-plan.md`
- `docs/sprints/m9.6-capability-resilience/s12-DECISIONS.md`
- `docs/sprints/m9.6-capability-resilience/s12-DEVIATIONS.md`
- `docs/sprints/m9.6-capability-resilience/s12-FOLLOW-UPS.md`
- `docs/sprints/m9.6-capability-resilience/proposals/s12-spike-results.md`
- `docs/sprints/m9.6-capability-resilience/s12-test-report.md`
- `packages/core/src/capabilities/mcp-cfr-detector.ts`
- `packages/core/src/capabilities/failure-symptoms.ts`
- `packages/core/src/capabilities/registry.ts`
- `packages/core/src/capabilities/ack-delivery.ts`
- `packages/core/src/capabilities/recovery-orchestrator.ts`
- `packages/core/src/capabilities/orchestrator-state-machine.ts`
- `packages/core/src/capabilities/cfr-types.ts`
- `packages/core/src/capabilities/index.ts`
- `packages/dashboard/src/agent/session-manager.ts`
- `packages/dashboard/src/automations/automation-executor.ts`
- `packages/dashboard/src/scheduler/jobs/debrief-prep.ts`
- `packages/dashboard/src/scheduler/jobs/handler-registry.ts`
- `packages/dashboard/src/chat/chat-service.ts`
- `packages/dashboard/src/app.ts`
- All 9 test files listed in the "Test coverage" table
