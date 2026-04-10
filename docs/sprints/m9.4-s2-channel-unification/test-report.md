# M9.4-S2 Test Report

**Date:** 2026-04-10
**Runner:** External Opus Agent (independent review)
**Environment:** Linux 6.17.0-20-generic, Node.js, Vitest 4.0.18

## Test Run Summary

```
Test Files  2 failed | 117 passed | 4 skipped (123)
Tests       6 failed | 1019 passed | 12 skipped (1037)
Duration    21.81s
```

## Failing Tests (All Pre-existing on Master)

### `tests/e2e/conversation-initiator-routing.test.ts` — 5 failures

All 5 tests fail with:
```
TypeError: Cannot read properties of undefined (reading 'sendSystemMessage')
```
at `ConversationInitiator.initiate` line 184. This is a missing mock/wiring issue in the E2E test harness that predates this sprint.

**Verified on master:** Same 5 failures reproduce without any S2 changes.

### `tests/unit/notifications/source-channel.test.ts` — 1 failure

Test "dashboard-sourced + alert fails -> stays in queue, no initiate()" fails because `initiateFn` is called once when it should not be. This is a pre-existing behavior mismatch.

**Verified on master:** Same failure reproduces without S2 changes.

## New Tests Added by S2 (All Passing)

### `tests/integration/channel-unification.test.ts` (8 tests)

| Test | Spec Ref | Status |
|------|----------|--------|
| Channel-switch detection still works | 8.8 Test 2 | PASS |
| Voice note with audio attachment flows through sendMessage | 8.8 Test 4 | PASS |
| Concurrent channel + web messages — no turn number collision | 8.8 Test 5 | PASS |
| source: "channel" reaches post-response hooks | 8.8 Test 6 | PASS |
| Audio attachment with inputMedium="audio" exercises STT path | 8.8 Test 7 | PASS |
| Dashboard audio input exercises STT path | 8.8 Test 8 | PASS |
| detectedLanguage included in done event | 8.8 Test 9 | PASS |
| VOICE_MODE_HINT path exists for audio input | 8.8 Test 10 | PASS |

### `tests/unit/chat/inject-turn.test.ts` (3 tests)

| Test | Spec Ref | Status |
|------|----------|--------|
| Writes turn without brain invocation | 8.4 | PASS |
| Emits conversation:updated event | 8.4 | PASS |
| Stamps channel field when provided | 8.4 | PASS |

### Modified Tests (S1 Corrections)

| Test | File | Status |
|------|------|--------|
| Channel-switch assertion strengthened | conversation-initiator.test.ts | PASS |
| injectRecovery routes through sendSystemMessage | notification-delivery.test.ts | PASS |

## Type Check Results

| Package | Command | Result |
|---------|---------|--------|
| `packages/core` | `npx tsc --noEmit` | Clean (no errors) |
| `packages/dashboard` | `npx tsc --noEmit` | Clean (no errors) |

## Regression Assessment

No new test failures introduced. All 6 failing tests are pre-existing on master (confirmed by running the same tests against master branch).
