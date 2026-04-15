# S1 Code Review — Raw Media Persistence + CFR Detector

**Reviewer:** External review agent (Claude Sonnet 4.6)
**Branch:** `sprint/m9.6-s1-raw-media-cfr-detector`
**Review date:** 2026-04-15
**Plan section reviewed:** Plan §2 (Shared contracts) and §3 (Sprint 1)

---

## Overall Verdict: PASS WITH NOTES

The sprint delivers its primary goal — deterministic CFR event emission at two detection points and raw media persistence before STT — with clean TypeScript, passing acceptance tests, and well-reasoned deviation handling. One item from the plan's shared contracts section was not implemented (see Critical finding below), but it is a relatively small, bounded omission and does not affect the S1 acceptance criteria or S2–S4's immediate needs.

---

## Spec Compliance Summary

### Files to Create

| File | Status | Notes |
|------|--------|-------|
| `packages/core/src/capabilities/cfr-types.ts` | PASS | Matches plan §2.1 exactly, including `SurrenderScope`, `FixAttempt`, `parentFailureId` |
| `packages/core/src/capabilities/failure-symptoms.ts` | PASS | Both functions present with specified signatures |
| `packages/core/src/capabilities/cfr-emitter.ts` | PASS | Matches plan §3.3; fills `id`/`detectedAt`/`attemptNumber`/`previousAttempts` automatically |
| `packages/dashboard/src/media/raw-media-store.ts` | PASS | Matches plan §3.1 exactly; extension policy implemented correctly |

### Files to Modify

| File | Status | Notes |
|------|--------|-------|
| `packages/core/src/capabilities/index.ts` | PASS | All new types and functions re-exported |
| `packages/core/src/lib.ts` | PASS | `CfrEmitter`, `classifySttError`, `classifyEmptyStt`, and all type exports present |
| `packages/dashboard/src/app.ts` | PASS | `cfr: CfrEmitter` and `rawMediaStore: RawMediaStore | null` fields added; both initialized in constructor |
| `packages/dashboard/src/chat/types.ts` | PASS | `rawMediaPath?: string` added with JSDoc (consequence of D2) |
| `packages/dashboard/src/channels/message-handler.ts` | PASS | Raw media persistence block added at correct location; voice note and image branches both covered |
| `packages/dashboard/src/chat/chat-service.ts` | PASS | CFR emission at deps-guard (line 594) and at STT error branch (line 685) and empty-STT branch (line 700); `buildTriggeringInput`/`detectCapabilityTypeFromMimes` helpers well-formed |
| `packages/dashboard/src/conversations/transcript.ts` | FAIL | `TurnCorrectedEvent` not added — see Critical finding |

### Acceptance Tests

| Test | Status | Notes |
|------|--------|-------|
| `raw-media-store.test.ts` | PASS | 17 tests |
| `cfr-emit-deps-missing.test.ts` | PASS | 2 tests; correctly drains generator and catches auth error |
| `cfr-emit-stt-errors.test.ts` | PASS | 12 tests; exhaustive mapping table coverage |
| `cfr-emit-empty-silent-vs-broken.test.ts` | PASS | 11 tests; boundary cases at durationMs=500 and confidence=0.2 correctly tested |

Total: **42/42 tests passing**. `npx tsc --noEmit` clean in both packages.

---

## Issues

### Critical

**`TurnCorrectedEvent` not added to `packages/dashboard/src/conversations/transcript.ts`**

Plan §2.2 states:

> "Append via existing `ConversationManager.appendEvent()` ... **That ingestion change is part of S5**, not S1."

However, the plan also places the _type definition itself_ in S1 under the "Shared data contracts" header (§2), treating it alongside `cfr-types.ts` as a contract that subsequent sprints import against. S5's `TurnCorrectedEvent` ingestion logic and the abbreviation-queue consumer both require this type to exist. Without it, S5 cannot start without either adding the type (modifying a file S1 was supposed to deliver) or importing a type that never arrived.

The omission was not noted in `DECISIONS.md`, `DEVIATIONS.md`, or `FOLLOW-UPS.md`.

**Recommendation:** Add `TurnCorrectedEvent` to `packages/dashboard/src/conversations/transcript.ts` before merging. This is a five-line type definition with zero runtime behavior — it is not a deviation, it is a missing deliverable. It should not require a new commit series; adding it with a fixup commit is appropriate.

---

### Important

**`rawMediaStore` typed as `RawMediaStore | null` but initialized unconditionally**

In `packages/dashboard/src/app.ts` (line 379 and 390):

```typescript
rawMediaStore: RawMediaStore | null = null;
// ...
this.rawMediaStore = new RawMediaStore(agentDir);
```

The field is typed as nullable, but the constructor always initializes it. This forces every call site (message-handler, test harness) to guard against null unnecessarily. The `| null` also creates a semantic hole: in message-handler, `if (this.deps.app.rawMediaStore)` reads as "this might not exist" when in practice it always does for any hatched `App` instance.

This matters for S4 and S5, which will also access `rawMediaStore` and will have to repeat the null guard.

**Recommendation:** Type `rawMediaStore` as `RawMediaStore` (non-nullable) since it is always set in the constructor. If there are unhatched-app code paths that must not write media, enforce that at the `save()` call rather than at the field type level. This is a minor cleanup but it prevents the nullability pattern from propagating into four more sprints.

---

### Suggestions

**S1 test for `cfr-emit-deps-missing` partially touches the real agent directory**

`cfr-emit-deps-missing.test.ts` creates a `ConversationManager` and `AppConversationService` pointing at `agentDir` (a temp dir) but `AppChatService` internally calls `SessionManager`, which initializes against the live `.my_agent/` directory. The session manager reads from the live agent dir during the test. This is visible in the test output (skills disabled, calendar credentials missing).

This does not cause test failures because the test catches all errors from `drain()`, but it does mean the test has a hidden dependency on the live agent directory for session initialization. If `.my_agent/` is absent in a CI environment, the session manager would fail earlier (before the CFR event is emitted), potentially masking the failure.

Consider extracting a lighter stub of `AppChatService` for the deps-missing test that only exercises the attachment/CFR path and stops before session management.

**`buildTriggeringInput` uses `convId!` (non-null assertion) at three call sites**

In `packages/dashboard/src/chat/chat-service.ts` at lines 598, 690, and 705, the code passes `convId!`. `convId` is derived from the function parameter which can be `null` for new conversations at entry. The `!` asserts it is non-null at these points — which is correct because the user turn has already been created by the time CFR is emitted — but the assertion is silent. A defensive check or a typed narrow scope for `convId` after it is resolved would be cleaner, especially given the "contract immutability" goal for CFR types.

---

## Assessment of Deviation D1 (Plugin → Message-Handler)

The deviation is functionally equivalent and arguably architecturally cleaner than the plan's approach.

The plan's intent was "persist before STT processing." That invariant is preserved: `message-handler.ts` calls `rawMediaStore.save()` and then passes `rawMediaPath` into `sendMessage()`, which reaches `transcribeAudio()` downstream. The buffer is on disk before any STT attempt.

The circular-dependency concern documented in DEVIATIONS.md is real. `plugins/channel-whatsapp` imports from `@my-agent/core` only; importing from `packages/dashboard/src/media/` would introduce a dependency from a plugin on a dashboard-internal path, which is the wrong direction in this architecture.

The alternative path noted in the deviation (staging path without conversationId) would have introduced a nonstandard path format and required a rename step — more complexity for no benefit.

**Verdict: D1 is a justified and well-documented deviation. No corrective action needed.**

---

## Assessment of D2, D3, D4

- **D2** (rawMediaPath on ChatMessageOptions, not IncomingMessage): correct consequence of D1. No blast radius.
- **D3** (cap.enabled no cast needed): trivially correct, no review needed.
- **D4** (RawMediaStore in packages/dashboard/src/media/ as planned): consistent with final layout; confirmed the circular dependency concern does not apply because the plugin never imports it.

---

## Recommendations for S2+

1. **Before S2 starts:** add `TurnCorrectedEvent` to `transcript.ts` on this branch. S2 touches different files and can proceed in parallel, but S5 will need to import this type and the contract should be in place.

2. **S4 (Recovery Orchestrator) should not access `rawMediaStore` via null guard.** Fix the nullability type before S4 starts (see Important finding above).

3. **S5 test design:** the session-manager coupling in `cfr-emit-deps-missing.test.ts` is a sign that a test-only `AppChatService` stub or a lighter integration entry point would make CFR tests more robust. Consider this when designing S5's orphan-watchdog tests.

4. **`TriggeringInput.artifact` is optional in the type but treated as required in two emitFailure calls.** The deps-guard emit at line 598 passes no audio attachment reference, so `artifact` is `undefined` there — which is valid per the type. The test for deps-missing asserts `artifact` is defined, which only passes because the test supplies `rawMediaPath`. This is correct behavior for the test case, but future callers of `emitFailure` with non-media deps failures (e.g., an env var missing) should be aware that `artifact` may legitimately be absent on the CFR event.

---

## What Was Done Well

- The `cfr-types.ts` contract is precise, complete, and matches the plan's §2.1 to the field. The immutability comment on each new file (`Immutable after S1`) is good practice and should be preserved.
- `classifyEmptyStt`'s boundary conditions (strict `>` not `>=` for both thresholds) are correctly implemented and tested with explicit boundary tests at 500ms and 0.2 confidence.
- The `CfrEmitter` overload pattern for `on()` gives type-safe event listening without a full typed-emitter library.
- Paper trail (DECISIONS, DEVIATIONS, FOLLOW-UPS) is thorough. D1 in particular is argued well and the blast-radius analysis is honest.
- All 17 file changes are exactly the set declared by the plan — no scope creep, no drive-by fixes.
