---
sprint: M9.4-S4.1
reviewer: external-opus
date: 2026-04-20
verdict: PASS
---

# External Review — M9.4-S4.1

## Verdict

**PASS** — the sprint materially delivers the two invariants it set out to enforce ("truncation may summarize, must not drop a section" and "delivery may fail, must not lie"), with three-layer defense on heading preservation, accurate `AlertResult` propagation to all callers, and a load-bearing `ackBriefingOnFirstOutput` test whose revert-restore behavior I independently reproduced.

## Spec fidelity

- **Task 1 — fixture.** PASS. `packages/dashboard/tests/fixtures/debrief-2026-04-20.md` exists (34,327 bytes post-sanitization), carries the required HTML-comment provenance header documenting source path, capture date, original byte count, and sanitization rationale. All 14 top-level worker-wrapper headings enumerated in the plan are present verbatim in file order (verified via `grep -n "^## "`).

- **Task 2 — `summary-resolver.ts`.** PASS on all five subtasks:
  - `text.slice(0, 20_000)` is gone (0 matches in file; only surviving `.slice(0, N)` calls in the package are cosmetic — `randomUUID().slice(0, 8)` in media-staging and an ISO-date `.slice(0, 10)` in automation-executor).
  - `HARD_INPUT_CAP = 100_000` (line 74). Stub format matches plan exactly: `[Debrief exceeded safe size (<N>K chars across <M> sections) — content preserved at <path>. Section list:\n- <h1>\n- <h2>...]` (lines 96–108). `console.warn` fires with total bytes + section count.
  - `CONDENSE_SYSTEM_PROMPT` mandates top-level `## ` heading preservation in original order (lines 7–13), wording matches plan verbatim.
  - Post-Haiku heading verification runs on every condense (lines 115–133). When any expected heading is missing from output, the resolver `console.warn`s with the missing names and returns the raw input.
  - Haiku-throws fallback preserved: `catch { console.warn(...); }` → `return text;` at lines 136–142.

- **Task 3 — resolver tests.** PASS. Four new tests in `tests/unit/automations/summary-resolver.test.ts` (18 total in file, up from 14):
  - Huge-early-tiny-late (lines 165–191): mocks `queryModelFn`, asserts the prompt passed to Haiku contains all four `## late-section-*` headings (i.e. not sliced).
  - Haiku-drops-section (lines 193–215): asserts fallback to raw (result contains `## section-gamma`, length > 10K) and warn message includes the missing name.
  - Hard-cap stub (lines 217–239): asserts `queryModelFn` is not called, result contains `"exceeded safe size"` + each section heading, warn message contains `"Hard cap exceeded"`.
  - Live fixture test (lines 261–331) gated via `WAS_NESTED` from `tests/live/helpers.ts` — the correct Agent-SDK-session gate per the project's OAuth/Max constraint (not `ANTHROPIC_API_KEY`). Graceful-skip if the Haiku call fails, with the raw-content fallback path itself exercised.

- **Task 4 — alert() outcome observation.** PASS.
  - `AlertResult` union extended (lines 66–71 of `conversation-initiator.ts`) with `skipped_busy` and `send_failed { reason }`.
  - Web-delivery path (lines 125–140) consumes the generator to completion, tracking `sawDone`/`errorMsg`, returning `send_failed` → `skipped_busy` → `delivered` in priority order.
  - External-channel same-channel path (lines 174–200) mirrors the pattern: `sawDone`/`errorMsg` observation before calling `forwardToChannel`. If the model errors, `send_failed` returns before a broken response is forwarded.
  - `transport_failed` remains for channel-unreachable cases (lines 151–155, 194–199) — not collapsed into the new statuses, semantic preserved per plan.

- **Task 5 — caller updates.** PASS on all four inline alias updates plus the handling branch. Typecheck is clean on both packages.
  - `heartbeat-service.ts`: `HeartbeatConfig.conversationInitiator.alert` return-type alias extended (lines 79–80); handling branch added for `skipped_busy`/`send_failed` (lines 306–316) calling `incrementAttempts`, matching the existing `transport_failed` retry semantics.
  - `automation-scheduler.ts`: inline alias extended (lines 28–30).
  - `automation-processor.ts`: inline alias extended (lines 45–47); handling in its fallback branch switched to `reason in result ? result.reason : result.status` so all three non-happy statuses log consistently.
  - `server.ts`: inline alias in the Fastify module declaration extended (lines 76–78).
  - `npx tsc --noEmit` clean on dashboard and core (see Correctness gates).

- **Task 6 — `markDelivered()` timing.** PASS.
  - Helper `ackBriefingOnFirstOutput(stream, briefingResult)` exported from `session-manager.ts` (lines 342–354). Fires `markDelivered()` on the first `text_delta` event, guarded by a local `delivered` boolean (idempotency).
  - `streamMessage()` wraps both stream loops with the helper (lines 718 and 760) — no duplicated guard blocks remain. After each loop completes, `pendingBriefingResult` is cleared and `briefingDelivered` set true so the resume-fallback loop doesn't double-fire.
  - At the former mark-before-invocation site (lines 836–841), the code now stores `briefingResult` on the instance rather than calling `markDelivered()`.

- **Task 7 — delivery-ack tests.** PASS.
  - `heartbeat-service.test.ts` adds `skipped_busy` and `send_failed` cases (lines 398–454). Both assert notification stays in `pending`, `delivery_attempts >= 1` after tick, nothing moved to `delivered/`; the `send_failed` case additionally asserts the warn string contains `"send failed: model error: context limit"`.
  - `conversation-initiator-alert-outcome.test.ts` has three tests — busy (empty generator → `skipped_busy`), error (yields `{type: "error", message: "oops"}` → `send_failed` with reason `"oops"`), happy (start + text_delta + done → `delivered`).
  - `session-manager-briefing-timing.test.ts` (6 tests) imports the real `ackBriefingOnFirstOutput` — not a local simulation. Tests exercise: first-text_delta firing, empty stream (no call), stream-throws-before-text_delta (no call + rejects), idempotency over multiple deltas, null briefingResult passthrough, event-stream passthrough fidelity.

- **Task 8 — sweep.** PASS on the sprint-scoped subset. Full dashboard suite had 8 pre-existing failures per the test-report; I did not re-run the full suite but the failure categories listed (Playwright, knowledge-extractor parse, progress-card UI) are unrelated to S4.1's touched files.

- **Task 9 — docs.** PASS. DECISIONS.md covers D1-D7 with clear rationale, DEVIATIONS.md honestly logs DEV-1 (4th structural alias surfaced by TS exhaustiveness) and DEV-2 (test rewritten after tautology flag), FOLLOW-UPS.md lists FU-1..FU-5 with suggested approaches, test-report.md documents typecheck, sprint-scoped tests, full-suite regression analysis, revert-restore sanity check, and fixture provenance.

## Correctness gates

- **`packages/dashboard` typecheck:** PASS — `npx tsc --noEmit` exit 0, no output.
- **`packages/core` typecheck:** PASS — exit 0, no output.
- **Sprint-scoped vitest (4 files):** PASS — 43 tests passed, 0 failed, 2.01s.
  ```
  Test Files  4 passed (4)
        Tests  43 passed (43)
  ```
  Live fixture test ran, Haiku call surfaced the graceful-skip path (`[live-test] Haiku condense unavailable — result is raw (33052 chars)`) as expected in this environment without authenticated Agent SDK session. The test's load-bearing assertions remain gated behind successful Haiku return; per the plan and FU, those are validated against the next authenticated run or the 2026-04-21 morning brief.
- **Revert-restore sanity check:** PASS — reproduced independently. Stripped the guard body of `ackBriefingOnFirstOutput` down to a pass-through; tests went `2 failed | 4 passed` (the two `toHaveBeenCalledTimes(1)` assertions failed — "got 0 times"). Restored the guard; tests went back to `6 passed`. The timing test is demonstrably load-bearing against the production helper, not a local simulation.

## Spec gap analysis

No gaps that block the verdict. A few observations for completeness:

- **"Truncation may summarize — must not drop."** Beyond `summary-resolver.ts`, I scanned the aggregator path (`handler-registry.ts`) and the automations package for other byte-level truncation hazards. No hidden `.slice(0, N)` on content exists — the only surviving slice calls are identifier/date shortening (`randomUUID().slice(0, 8)`, `ISO.slice(0, 10)`). `resolveJobSummary` (the synchronous DB-display path at line 71) still performs a `text.slice(0, maxLength) + "[Full results in job workspace]"` — this is the documented DB-display path (`DB_DISPLAY_LIMIT = 2000`) separate from the brain-feed condense path, and the user-visible notice makes it fail-loud rather than silent. Acceptable and out of scope.

- **"Delivery may fail — must not lie."** Other `markDelivered` callers in `heartbeat-service.ts`:
  - line 256: max-delivery-attempts give-up — intentional, not a lie (the notification has been retried `MAX_DELIVERY_ATTEMPTS=10` times; moving to delivered is the explicit give-up per D5).
  - line 277: stale `job_interrupted` discard — intentional, the job recovered and the notification is no longer valid.
  - line 298: happy path, now predicated on observed `{status: "delivered"}` from `alert()`.
  - line 305: fallback after `no_conversation` — fires after `initiate()` returns, which itself doesn't observe model-stream outcomes. This is a residual minor gap (marking delivered after `initiate()` without observing its `sendSystemMessage()` generator), but `initiate()` is only taken on the fresh-install `no_conversation` edge case, which is rare and the plan explicitly scopes Task 4 Step 3 to `sendSystemMessage` paths in `alert()`. Worth an FU note but not a spec violation.

- **Three-layer defense for heading preservation.**
  1. Prompt-level (line 7-13): present, wording matches plan.
  2. Runtime check (lines 122-133): present, substring match on `"## <name>"`, iterates over `expectedHeadings` derived from input.
  3. Raw-content fallback (line 131): returns `text` (the stripped input) when any heading missing.
  Each layer is independent and the runtime check does not rely on the prompt being followed — exactly the belt-and-suspenders described in D4.

- **AlertResult exhaustiveness.** I grepped for `result.status` switch/if-chains across `packages/dashboard/src`. All five occurrences (4 inline alias consumers + the canonical) now carry the full 5-variant union. TypeScript exhaustiveness would flag any future addition (good — that's FU-3's raison d'être).

## Concerns

None blocking. Two minor notes for future sprints:

1. `heartbeat-service.ts:305` marks delivered immediately after `initiate()` returns, without observing `initiate()`'s internal `sendSystemMessage` stream for the same `sawDone`/`errorMsg` signal. This mirrors a lying-delivery risk specifically on the `no_conversation` fallback path. Consider extending Task 4's outcome observation to `initiate()` in a follow-up. Low severity — fresh-install edge case only.

2. `conversation-initiator.ts:177-190` (external same-channel path) still calls `forwardToChannel(response, targetChannel)` with an accumulated `response` even when `sawDone`/`errorMsg` branches already returned. Code is structurally correct (returns before forward), just observationally: the `response` accumulator is unused on the error/busy paths. Cosmetic, not functional.

## Summary

The sprint closed the 2026-04-20 section-drop bug at the source (byte-slice removal + three-layer heading defense) and corrected the latent delivery-ack lying by propagating a richer `AlertResult` union across all five consumers with TypeScript exhaustiveness doing its job — catching the fourth structural alias that the plan undercounted (DEV-1 is an honest log of that). The extracted `ackBriefingOnFirstOutput` helper eliminates a duplication hazard in `session-manager.ts` while making the timing invariant directly testable; the revert-restore sanity check (reproduced independently) confirms the test is load-bearing rather than tautological. All success criteria #1-4 are satisfied by CI-runnable tests; #5 is a next-morning manual check as scheduled. Ship it.
