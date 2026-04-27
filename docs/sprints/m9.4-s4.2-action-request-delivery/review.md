---
sprint: M9.4-S4.2
reviewer: External Opus (independent, no shared context with implementation team)
date: 2026-04-27
verdict: PASS WITH CONCERNS
---

# External Review — M9.4-S4.2: Proactive Delivery as Action Request

## Spec Coverage

| Task | Description | Status | Evidence |
|------|-------------|--------|----------|
| 1 | Bug record | COVERED | `docs/bugs/2026-04-27-proactive-delivery-dismissed.md` exists (6.6 KB). Commit `1eee571`. |
| 2 | SDK pre-flight (D1) | COVERED | `DECISIONS.md` D1 cites `sdk.d.ts:1473-1476` + `:2219-2228`; method (type-decl read instead of probe) is justified. Commit `025037b`. |
| 3 | `injectActionRequest` + `invalidateCache()` | COVERED | `session-manager.ts:904` (5-line `streamMessage` passthrough). `system-prompt-builder.ts` has public `invalidateCache()` (D2 cites line 239). Test `inject-action-request.test.ts` exists (56 lines). |
| 4 | `sendActionRequest` chat path + wiring | COVERED | `chat/send-action-request.ts` (107 lines, mirrors `send-system-message.ts`). Registered in `chat-service.ts:1043`. `ChatServiceLike` extended in `conversation-initiator.ts:38-43`. `MockSessionManager.injectActionRequest` + `lastInjectionKind` field at `mock-session.ts:76, 100`. |
| 5 | Deliverable validator | COVERED | `todo-validators.ts:128-156` implements doubled-signal: `STRONG_OPENERS` array + `SECOND_MARKERS` regex with `>= 2` threshold. 5 tests in `deliverable-validator.test.ts`. |
| 6 | ATOMIC trigger conversion | COVERED | All four `[SYSTEM:]` pre-wrap sites the plan named are removed in `d1cb289`: `conversation-initiator.ts:184` (now bare `prompt`), `heartbeat-service.ts:313` (now bare `prompt`), `automation-processor.ts:306` (bare), `app.ts:726` (bare). Default `firstTurnPrompt` at `:255` rewritten without wrap. `[Pending Briefing]` → `[Pending Deliveries]` confirmed in `system-prompt-builder.ts:165` and `status-prompt-acceptance.test.ts` (5 assertions updated). `verbatimFraming`/`Background work results`/`VERBATIM framing` strings: ZERO matches in `src/`. Orphaned docstring relocated above `injectSystemTurn` at `session-manager.ts:872-885`. `run_dir` field added at `persistent-queue.ts:28`; populated at `app.ts:2038` and `automation-processor.ts:283`. |
| 7 | DELETE `pendingNotifications` queue | COVERED | `grep pendingNotifications\|queueNotification\|hasPendingNotifications packages/dashboard/src` returns ZERO matches. Regression test at `tests/unit/agent/no-system-prepend-from-queue.test.ts` (3 tests). Commit `6251894`. |
| 8 | `notify` default uses `manifest.system` | COVERED | `defaultNotifyFor()` helper at `automation-manager.ts:25-27`. Used at three sites: `:78` (create), `:227` (list), `:352` (frontmatterToManifest). 3 tests in `automation-manager.test.ts`. Task 8.7 archive is local-only (gitignored), unverifiable from PR but not load-bearing for code review. |
| 9 | (folded into Task 8) | N/A | Plan explicitly merges 8+9. |
| 10 | Strip Haiku preamble + telemetry | COVERED | `summary-resolver.ts:139-159` implements heuristic with two distinct log paths: `Stripped Haiku preamble (N chars …)` and `no-heading-passthrough — …`. Wrapper-marker invariant comment at `:133-138`. Tests in `summary-resolver.test.ts`. |
| 11 | Standing-orders + cache invalidation | PARTIAL (D2 only — `.my_agent/` is gitignored, edits + restart not visible in PR) | D2 documented in `DECISIONS.md`. Standing-orders edits and `systemctl --user restart` are local-host operations on private data — out of PR scope by design. Reviewer cannot verify edits landed; this is intrinsic to the framework's privacy split. Not a defect. |
| 12 | CLAUDE.md update | COVERED | `packages/dashboard/CLAUDE.md:106-158` rewritten. Action-request pattern documented; `if (!alerted)` example removed; cites the 2026-04-25–27 incident. |
| 13 | Feature flag (D3) | COVERED | `env.ts` exports `proactiveDeliveryAsActionRequest()`. Three flag-gated `sender =` selections in `conversation-initiator.ts:157-159, 213-215, 286-288` (web alert, same-channel alert, initiate). `formatNotification` and `[Pending Deliveries]` are NOT flag-gated (matches D3 scope). 4 tests in `feature-flag.test.ts`. |
| 14 | Integration test | COVERED | `tests/integration/proactive-delivery-aged-conversation.test.ts` (132 lines, 2 tests). Seeds 50 turns, asserts `lastInjectionKind === "action_request"` and prompt does not match `/^\[SYSTEM:/`. Header note acknowledges synthetic-vs-real-gravity caveat. |
| 15 | ROADMAP update | COVERED | M9.4 row at `docs/ROADMAP.md:32, 903, 920` includes detailed S4.2 entry with all four buckets. Cross-doc footnote (Task 15.1.5) status not directly verified — non-blocking. |
| 16 | 7-day live soak | DEFERRED | Begins on merge per plan; out of PR scope. Reviewer correctly does not gate on this. |

## Test Results

- **Command:** `npx tsc --noEmit && npx vitest run` (run from `/home/nina/my_agent-s4.2/packages/dashboard`)
- **Typecheck:** clean (exit 0)
- **Vitest:** 173 test files, **1358 passed, 24 skipped, 0 failed** (matches implementer's report exactly)
- **Duration:** 65 s
- **Skipped tests:** 24, all CFR live/e2e tests skipped on `realAgentDir not found` / no `ANTHROPIC_API_KEY` precondition — expected, not regressions

## Browser Verification

**N/A — no UI changes in this sprint.** Confirmed by `git diff master..HEAD --stat`: zero files under `packages/dashboard/public/`, zero HTML/CSS/JS changes. Skipped per `docs/procedures/external-reviewer.md` ("Skip when: Sprint only modifies internal library code, tests, docs").

## Audit Coverage Spot-Check

**audit.md (3 critical):**
- Top-1 (`pendingNotifications` queue): RESOLVED via deletion (Task 7), not discriminator. Verified zero callers.
- Top-2 (cache invalidation): RESOLVED via D2 + service restart workflow + public `invalidateCache()` available for future hot-reload.
- Top-3 (Task 8 fictional API / wrong constants): RESOLVED — uses `manifest.system` flag at three real sites; `defaultNotifyFor()` helper avoids the fictional `normalizeManifest()` call.

**dead-code-audit.md (5 deletions):**
- `verbatimFraming` const + "Background work results" template: GONE from `heartbeat-service.ts` (grep returns nothing).
- Celebratory `VERBATIM framing` log: GONE.
- `[Pending Briefing]` literal: RENAMED to `[Pending Deliveries]` everywhere (src + tests).
- `if (!alerted)` historical commentary at `app.ts:720-742`: GONE (zero `if (!alerted)` matches in src).
- Orphan docstring at `session-manager.ts:889-897`: REPOSITIONED — comment now sits at `:872-885`, immediately above `injectSystemTurn` at `:886`. Correct.

## Gaps Found

### G1 — Two `[SYSTEM:]` pre-wrap sites still live (NOT in plan scope)

The plan and dead-code audit both promised "all four pre-wrap sites" cleared. Verified clear: `conversation-initiator.ts:184/255`, `heartbeat-service.ts:313`, `automation-processor.ts:306`, `app.ts:726`. **But two more pre-wrap sites exist that neither audit identified:**

- `packages/dashboard/src/automations/automation-scheduler.ts:329` — `notifyFailure()` initiate fallback. Wraps prompt in `[SYSTEM: ${prompt}]`.
- `packages/dashboard/src/routes/debug.ts:752, 761` — debug endpoint `/debug/proactive-delivery` initiate paths.

Severity: LOW for both.
- `automation-scheduler.ts:329` is on the `notifyFailure` (job_failed) path, which the plan explicitly preserves with status framing. The wrap there is consistent with that intent — but contradicts the rule "never pre-wrap on initiate fallback" the new CLAUDE.md establishes. Either the rule needs a "system-event exception" carve-out or the wrap should drop and rely on `formatNotification` framing.
- `routes/debug.ts:752, 761` is a manual-test endpoint. Risk is that anyone using it to reproduce the bug will pre-wrap and not see the new behavior.

Neither blocks merge — both are minor. File for follow-up.

### G2 — Feature flag rollback path is asymmetric

When `PROACTIVE_DELIVERY_AS_ACTION_REQUEST=0`, routing reverts to `sendSystemMessage` (which wraps in `[SYSTEM: …]` via `injectSystemTurn`). But the *prompt body* now says "Read the deliverable, render its contents in your voice, and present it to the user now." So the rollback path delivers an action-request-shaped prompt wrapped in `[SYSTEM: …]` — the very combination plan v3 §6 calls "strictly worse than today" for the forward path. D3 acknowledges this ("strictly different from S4.1 behaviour, but provides a path back"). It is a documented, deliberate design choice, but is worth flagging: the rollback is escape-hatch only, not an equivalent of S4.1.

Severity: LOW. Documented in D3.

### G3 — `infra_alert` framing comment mentions "verbatim"

`heartbeat-service.ts:402-404`: comment "Caller supplies the full user-facing prompt in `summary`. Passed through verbatim …". The word "verbatim" here is correct (it describes pass-through, not a Nina-facing instruction), but a future reader scanning for residual S4-era language may flag it. Not a defect; cosmetic only.

### G4 — `routing-presence.test.ts` fixture rename

The dead-code audit asked for `"Background work finished."` → neutral `"Job completed."` at `routing-presence.test.ts:135`. Confirmed neither string appears now. Plan says it was renamed; reviewer cannot verify the new wording without checking history, but the audit's concern (perpetuating S4-era framing) is addressed.

## Verdict

**PASS WITH CONCERNS**

## Summary

Sprint executes the plan faithfully and closes every load-bearing claim. All four pre-wrap sites the plan promised to remove are gone; the dead `pendingNotifications` queue is fully deleted (zero callers verified); `verbatimFraming`/Background work results/VERBATIM framing console.log are removed; `[Pending Briefing]` is renamed everywhere including 5 test assertions; `defaultNotifyFor()` correctly uses the existing `manifest.system: boolean` flag at three sites; Haiku preamble strip emits both the "stripped" and "no-heading-passthrough" telemetry paths; the feature flag is correctly routing-only and gates exactly three sender selections in `conversation-initiator.ts`. Typecheck clean, 1358/1358 tests passing (24 skipped on env preconditions). Three audits' worth of feedback all visibly folded in. The two surprises — pre-wrap sites in `automation-scheduler.ts:329` and `routes/debug.ts:752/761` that neither audit caught — are minor (failure-path and debug-endpoint, respectively) and worth a follow-up rather than blocking merge. Task 16 (7-day live soak) is the load-bearing acceptance gate and correctly remains open. Recommend merge; track G1 as follow-up.
