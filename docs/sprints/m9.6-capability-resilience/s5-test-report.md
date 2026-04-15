# S5 Test Report — Orphaned-Turn Watchdog

Sprint: M9.6-S5
Date: 2026-04-15
Branch: `sprint/m9.6-s5-orphaned-turn-watchdog`
Reviewer: Claude claude-opus-4-6 (external review session)

---

## Results

| Test file | Package | Count | Status | Notes |
|-----------|---------|-------|--------|-------|
| `tests/conversations/orphan-watchdog-basic.test.ts` | core | 3 | ✅ PASS | fresh rescue, stale resolve, already-answered skip |
| `tests/conversations/orphan-watchdog-idempotence.test.ts` | core | 2 | ✅ PASS | rerun-after-rescue, rerun-after-stale |
| `tests/conversations/orphan-watchdog-audio-rescue.test.ts` | core | 2 | ✅ PASS | reverify happy path, missing-raw-media graceful degrade |
| `tests/conversations/abbreviation-honors-correction.test.ts` | dashboard | 2 | ✅ PASS | substitutes corrected content, leaves uncorrected turns alone |

**S5-introduced tests: 9 tests across 4 files, all passing.**

### Commands run

```bash
cd /home/nina/my_agent/packages/core && npx vitest run tests/conversations/orphan-watchdog
# Test Files  3 passed (3)
# Tests       7 passed (7)
# Duration    377ms

cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/conversations/abbreviation-honors-correction
# Test Files  1 passed (1)
# Tests       2 passed (2)
# Duration    2.15s
```

### Typecheck

```bash
cd /home/nina/my_agent/packages/core && npx tsc --noEmit     # clean (exit 0, no output)
cd /home/nina/my_agent/packages/dashboard && npx tsc --noEmit # clean (exit 0, no output)
```

---

## New tests introduced by S5

1. **`packages/core/tests/conversations/orphan-watchdog-basic.test.ts`** (3 tests)
   - `rescues a fresh orphan (age 2m) — injects system message and writes watchdog_rescued`
   - `marks a stale orphan (age 45m) as resolved-stale — no injection`
   - `ignores conversations whose last user turn already has an assistant reply`

2. **`packages/core/tests/conversations/orphan-watchdog-idempotence.test.ts`** (2 tests)
   - `skips a turn that already has a watchdog_rescued event`
   - `skips a turn that already has a watchdog_resolved_stale event`

3. **`packages/core/tests/conversations/orphan-watchdog-audio-rescue.test.ts`** (2 tests)
   - `runs reverify, writes turn_corrected, and injects real transcript`
   - `skips audio rescue when the raw media artifact is missing on disk`

4. **`packages/dashboard/tests/conversations/abbreviation-honors-correction.test.ts`** (2 tests)
   - `substitutes correctedContent for user turns that were later corrected`
   - `leaves user turns without a corresponding turn_corrected event unchanged`

---

## Pre-existing failures (not introduced by S5)

### `packages/dashboard/tests/integration/channel-unification.test.ts` — 3 failures

All three failures throw `TypeError: Cannot read properties of undefined (reading 'emitFailure')` at `src/chat/chat-service.ts:594` — the test harness constructs `AppChatService` without wiring `app.cfr` (the `CapabilityFailureReporter`).

Affected tests:
- `S2 Validation: Channel Unification (Spec 8.8) > dashboard text input follows sendMessage → streamResponse → persistTurn path`
- `S2 Validation: Channel Unification (Spec 8.8) > dashboard image input with inputMedium='image' surfaces capability failure`
- `S2 Validation: Channel Unification (Spec 8.8) > dashboard audio input with inputMedium='audio' exercises STT path`

Already captured in `s5-FOLLOW-UPS.md#FU3`. Pre-dates S5 (originates from S2). Not a blocker for S5 merge.

Other pre-existing failures outside the S5 scope (browser / visual tests) were not run in this review — they are unrelated to the orphan watchdog changes.

---

## Coverage observations

Areas covered:
- Fresh-orphan rescue path
- Stale-orphan resolution (no injection)
- Already-answered skip
- Idempotence across re-runs for both rescued and resolved-stale markers
- Audio rescue happy path (reverify → turn_corrected → watchdog_rescued)
- Audio rescue graceful degrade when raw media missing
- `turn_corrected` substitution in abbreviation
- Negative case: no substitution when no correction event

Areas not directly unit-tested (see s5-review.md for detail):
- `systemMessageInjector` throwing AFTER the `watchdog_rescued` marker is written (the reported-as-corruptSkipped-but-marker-stays path at `orphan-watchdog.ts:337–350`). Behavior is defensible but untested.
- E2E boot sweep triggered from `app.ts` — relies on the targeted unit tests plus manual inspection; end-to-end integration test is deferred to S7 (E2E incident replay).

---

## Verdict

**PASS.**

All 9 S5-introduced tests pass across both packages. Typechecks are clean. The 3 pre-existing `channel-unification` failures are documented as FU3 and are not caused by S5 changes.
