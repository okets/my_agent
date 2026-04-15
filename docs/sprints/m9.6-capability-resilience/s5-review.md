# S5 External Code Review — Orphaned-Turn Watchdog

Sprint: M9.6-S5
Reviewer: Claude claude-opus-4-6 (external review session)
Date: 2026-04-15
Spec ref: `docs/sprints/m9.6-capability-resilience/plan.md` §7 + `docs/design/capability-resilience.md` §"Sprint 4 — Orphaned-Turn Watchdog"
Branch: `sprint/m9.6-s5-orphaned-turn-watchdog`

---

## Verdict

**APPROVED WITH MINOR OBSERVATIONS.**

Implementation matches the plan precisely. All 5 plan deliverables (§7.1–§7.5) are present and wired. All 4 acceptance tests pass. Typecheck is clean in both `packages/core` and `packages/dashboard`. Deviations are self-answered per sprint protocol and are materially trivial (import-direction constraints and line-number drift in `app.ts`). Observations below are for follow-up, not merge blockers.

---

## Plan ↔ code audit

| # | Plan item | Location | Status | Notes |
|---|-----------|----------|--------|-------|
| §7.1 | `orphan-watchdog.ts` class + `OrphanWatchdogConfig` + `OrphanSweepReport` shapes | `packages/core/src/conversations/orphan-watchdog.ts` | ✅ Matches plan | Config signature matches `conversationLimit`, `staleThresholdMs`, `rawMediaStore`, `conversationManager`, `systemMessageInjector` as specified. `reverify` added as optional — see D6. |
| §7.1 | Idempotence via `watchdog_rescued` marker | `orphan-watchdog.ts:463` (`hasWatchdogEventFor`) | ✅ Matches plan | Also skips on `watchdog_resolved_stale` (stronger than plan required; correct). |
| §7.1 | Event written BEFORE `systemMessageInjector` | `orphan-watchdog.ts:318–332` | ✅ Matches plan | At-most-once semantics correctly preserved. |
| §7.1 | `watchdog_rescue_completed` event on success | **not implemented** | ⚠ Minor gap | Plan §7.1 paragraph 2 mentions a paired `watchdog_rescue_completed` event "on success" in addition to `watchdog_rescued`. The implementation uses only the `watchdog_rescued` marker; `rescued.push(...)` into the report is the only "completion" signal. No JSONL event exists for completion. See finding F1. |
| §7.2 | `WatchdogRescuedEvent` + `WatchdogResolvedStaleEvent` type declarations | `packages/dashboard/src/conversations/types.ts:200–216` + re-exported from `transcript.ts:20–24` | ✅ Matches plan (via D4) | Plan literally said `transcript.ts`; Deviation D4 moved them to `types.ts` to avoid circular import. `transcript.ts` re-exports for back-compat. Clean. |
| §7.3 | Abbreviation queue ingests `turn_corrected` | `packages/dashboard/src/conversations/abbreviation.ts:147–179` | ✅ Matches plan | Uses `manager.getFullTranscript()`, builds a `turnNumber → correctedContent` map, substitutes for user turns only. Integration test present. |
| §7.4 | Wire `OrphanWatchdog` in `app.ts` | `packages/dashboard/src/app.ts:931–986` | ✅ Matches plan (via D5) | Placed after ConversationInitiator block instead of after RecoveryOrchestrator — correctly justified in DECISIONS.md D5. Functionally equivalent to plan's intent (boot-time, once, capped at 10s via `Promise.race` timeout). |
| §7.4 | Cap sweep at 10s | `app.ts:970–985` | ✅ Matches plan | 10s timeout via `Promise.race`. Boot never blocks on a slow sweep. |
| §7.5 | Rescue-prompt template at `packages/core/src/prompts/orphan-rescue.md` | File exists with exact wording from plan | ✅ Matches plan | Plus inline fallback (D3). Loader picks disk copy first, inline second — safe. |
| §7 acceptance | `orphan-watchdog-basic.test.ts` | `packages/core/tests/conversations/orphan-watchdog-basic.test.ts` | ✅ 3/3 pass | Covers fresh rescue, stale resolution, and "already-answered → no rescue". |
| §7 acceptance | `orphan-watchdog-idempotence.test.ts` | `packages/core/tests/conversations/orphan-watchdog-idempotence.test.ts` | ✅ 2/2 pass | Covers re-run-after-rescue and re-run-after-stale. |
| §7 acceptance | `orphan-watchdog-audio-rescue.test.ts` | `packages/core/tests/conversations/orphan-watchdog-audio-rescue.test.ts` | ✅ 2/2 pass | Covers reverify-success path AND the missing-raw-media graceful-degrade path (an extra case, good defensive testing). |
| §7 acceptance | `abbreviation-honors-correction.test.ts` | `packages/dashboard/tests/conversations/abbreviation-honors-correction.test.ts` | ✅ 2/2 pass | Plan said `tests/automations/abbreviation` but file lives in `tests/conversations/` (path drift, not a spec gap — the test exists and asserts the right behavior). |
| §7 verification | `npx vitest run tests/conversations/orphan-watchdog` | `packages/core` | ✅ 7/7 pass | |
| §7 verification | `npx vitest run tests/automations/abbreviation` | `packages/dashboard` | ⚠ Path drift | Actual path: `tests/conversations/abbreviation-honors-correction`. Tests pass. Plan's path string is stale; implementation chose `conversations/` subdir (consistent with the other conversation-related tests). |

Verification commands run during this review:
- `cd packages/core && npx vitest run tests/conversations/orphan-watchdog` → **3 files, 7 tests, all pass** (377 ms)
- `cd packages/dashboard && npx vitest run tests/conversations/abbreviation-honors-correction` → **1 file, 2 tests, pass** (2.15 s)
- `cd packages/core && npx tsc --noEmit` → **clean**
- `cd packages/dashboard && npx tsc --noEmit` → **clean**

---

## Design decisions audited

All six decisions in `s5-DECISIONS.md` are sound:

- **D1 (structural interfaces)** — Prevents core→dashboard cycle. Dashboard types are structurally assignable; test mocks don't depend on the dashboard. Correct inversion.
- **D2 (marker before inject)** — Matches plan §7.1 paragraph 2 literally. Favours at-most-once, which is the right tradeoff for orphan rescue where a missed rescue is a user-obvious "please resend" while a double-rescue is a disorienting replay.
- **D3 (inline prompt fallback)** — `orphan-rescue.md` isn't in the tsc build output. Inline fallback ensures a prod build run from `dist/` still works. Content is byte-identical to the `.md` file.
- **D4 (event types in `types.ts` not `transcript.ts`)** — Deviation is structural, not semantic. `transcript.ts` already imports from `types.ts`; the plan's literal instruction would have introduced a circular import. Re-export preserves any pre-existing imports.
- **D5 (wire after ConversationInitiator)** — Required because the injector closure calls `app.conversationInitiator.forwardToChannel()`, which doesn't exist at the line the plan suggested. Still boot-time, still once, still within the 10s cap.
- **D6 (optional `reverify`)** — Correct graceful-degrade: non-audio orphans and un-hatched agents must still be able to sweep. Audio rescue only engages when capability registry is loaded.

---

## Findings

### F1 — Plan mentions `watchdog_rescue_completed`; implementation omits it — MINOR

Plan §7.1 paragraph 2 says:

> Event written after re-drive initiation, not completion — this prevents the "crash-during-rescue" loop the red-team flagged (M10). Paired with a `watchdog_rescue_completed` event on success.

The implementation appends `watchdog_rescued` before calling the injector (correct, per D2 and the "at-most-once" intent), but there is no corresponding `watchdog_rescue_completed` event written after successful completion. The `OrphanSweepReport.rescued[]` array is the only in-process signal; nothing ends up in the JSONL to signal "this rescue actually succeeded."

**Impact:** Low. The plan calls `watchdog_rescue_completed` a paired event, but the same paragraph clarifies "the in-flight re-drive is either alive or it's the user's problem to re-prompt" — so the completion event is not load-bearing for idempotence (which is handled by `watchdog_rescued` alone). The observability gap is small: if you want to audit "which orphans actually got an assistant reply," you'd look for an assistant turn with turnNumber ≥ the orphan's — which already exists.

**Recommendation:** Either (a) add the completion event now to match plan literally, or (b) amend the plan/DECISIONS.md to declare completion-event intentionally dropped because the assistant turn itself is the completion signal. Not a merge blocker; pick one.

### F2 — "Respects conversation state (resolved via surrender)" design rule not yet enforced — OBSERVATION (S6 dependency)

Design spec §"Sprint 4 — Orphaned-Turn Watchdog" lists: *"Respects conversation state: if conversation is explicitly marked resolved (via surrender message), skip."*

Surrender messages are an S6 deliverable (`packages/core/src/capabilities/resilience-messages.ts`). No surrender marker event exists in the transcript yet, so the rule is vacuously satisfied today. When S6 lands, the watchdog will need a check like `hasSurrenderEventFor(transcript, turnNumber)` alongside `hasWatchdogEventFor`.

**Impact:** None today. Reminder for S6.

**Recommendation:** Add a follow-up to `s5-FOLLOW-UPS.md` (or the S6 plan) noting that the watchdog must honor surrender markers once they exist.

### F3 — Verification command path drift — NIT

Plan §7 says:

```bash
cd packages/dashboard && npx vitest run tests/automations/abbreviation
```

The actual file lives at `tests/conversations/abbreviation-honors-correction.test.ts`. Test exists and passes. Choice of `tests/conversations/` is consistent with all other conversation-layer tests in dashboard; this is arguably a better location than `tests/automations/`.

**Impact:** Rerunning the plan's literal command finds no files. The command in plan §7 is stale.

**Recommendation:** Update plan §7's verification command (or document this path under DECISIONS). Already done implicitly; updating plan text would prevent future confusion.

### F4 — `findOrphanedUserTurn` "assistant turnNumber ≥ user turnNumber counts as answered" — DEFENSIBLE BUT WORTH CALLING OUT

`orphan-watchdog.ts:449`:

```ts
if (turn.turnNumber >= lastUserTurn.turnNumber) {
  sawAssistantAfter = true;
}
```

This treats any assistant turn with turnNumber ≥ the user's as "answered". Given that user+assistant share turnNumbers (see `types.ts:82`), this is correct for the normal case (answered turn → user and assistant both have the same turnNumber). It also correctly handles a later assistant turn with higher turnNumber (unusual, but would still imply the earlier user turn was superseded).

**Impact:** None observed. The alternative — strict `turn.turnNumber === lastUserTurn.turnNumber` — would be slightly tighter. Current implementation is more forgiving, which is the right bias for a rescue scanner (false negative = extra rescue attempt on already-answered turn; strict check catches that via the already-answered-by-timestamp heuristic).

**Recommendation:** Keep as-is. Consider adding a comment explaining the `>=` choice.

### F5 — No direct-disk raw-media reconciliation in the orphan sweep — OBSERVATION

`maybeRescueAudio` uses `turn.attachments[].id` as the `attachmentId` passed to `rawMediaStore.pathFor`. As noted in `s5-FOLLOW-UPS.md#FU1`, this field's match against the channel layer's raw-media save key has not been verified. The graceful-degrade path (`exists: false → fall through to placeholder rescue`) makes this non-fatal.

**Impact:** Not verified; could silently miss audio rescue opportunities. Follow-up FU1 captures this for S7.

**Recommendation:** Leave as-is. FU1 is the right home; S7 exercises this end-to-end.

---

## Security & safety

- **No unbounded loops / periodic sweeps.** `sweep()` is called exactly once in `app.ts`. No setInterval, no retry-on-failure loops. Design rule "Startup-only. No periodic sweeps (loop risk)" is honored.
- **Error handling is defensive.** `sweep()` catches list failures and returns an empty report; `processConversation()` errors are routed into `report.corruptSkipped`. An injector that throws post-marker does not re-queue. Malformed timestamps write to `corruptSkipped`.
- **Privacy.** No real names, phone numbers, or secrets in test fixtures. `conv-voice`, `conv-fresh`, `conv-stale` are synthetic IDs. `user@example.com`-style cleanliness maintained.
- **Resource limits.** Default `conversationLimit: 5`, 10s timeout, bounded `staleThresholdMs`. Fanout is controlled.
- **Marker-before-inject** is the critical safety property for M9.6-S5 (red-team #10 scenario). Implementation honors it.

---

## Test quality

- **Unit tests use structural mocks** (`ConversationManagerLike`, `RawMediaStoreLike`) — no heavy setup, no I/O. Fast (377ms for 7 tests).
- **Idempotence test explicitly asserts second-run `injectCount === 1`** — directly catches a regression in the marker-before-inject rule.
- **Audio-rescue test covers both success and missing-artifact paths** (one more than plan required). Event ordering (`correctedIdx < rescuedIdx`) is explicitly asserted.
- **Abbreviation test uses SDK mock at `@my-agent/core`** — correctly isolates Haiku call, captures the prompt text, asserts substitution.
- **Negative case ("turns without correction unchanged")** is present — good defensive coverage.

One observation: the tests do not exercise a `systemMessageInjector` that throws (the "injector failed after marker written" path in `orphan-watchdog.ts:337–350`). That path is currently untested. Recommend adding a small test case or marking as follow-up.

---

## Code style / structure

- **No new dependencies introduced.** `fs`, `path`, `url` only — Node builtins.
- **Structural typing keeps the module portable** — could be reused by any future conversation store that matches `ConversationManagerLike`.
- **Pure helpers (`findOrphanedUserTurn`, `hasWatchdogEventFor`) are exported** — good testability.
- **Comments explain *why*, not *what*** (e.g. the long block comment at file top explaining at-most-once semantics is the kind of comment reviewers want).
- **No dead code, no speculative abstractions.**

---

## Summary

S5 is implemented faithfully to the plan, with deviations documented and self-answered. The only spec gap of consequence is F1 (the `watchdog_rescue_completed` companion event), which is minor — the design's idempotence guarantee does not require it, and the project can choose to add it later or amend the plan. Test coverage is strong. Typechecks are clean. Pre-existing `channel-unification` failures are not introduced by S5 and are already captured in S2/S5 follow-ups (FU3).

**Recommendation:** Merge. File a small S6 note to (a) decide F1 (add `watchdog_rescue_completed` or amend plan), (b) honor surrender markers per F2 once S6 lands, and (c) update plan §7's verification command path per F3.
