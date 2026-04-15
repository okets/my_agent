# S4 Test Report

**Sprint:** M9.6-S4 — Recovery Orchestrator
**Date:** 2026-04-15
**Reviewer:** external review session (claude-opus-4-6)
**Branch:** sprint/m9.6-s4-recovery-orchestrator

---

## Test Results

```
 RUN  v4.0.18 /home/nina/my_agent/packages/core

 ✓ tests/capabilities/orchestrator/orchestrator-state-machine.test.ts   (19 tests)  11ms
 ✓ tests/capabilities/orchestrator/orchestrator-surrender-scope.test.ts ( 4 tests)  33ms
 ✓ tests/capabilities/orchestrator/orchestrator-budget.test.ts          ( 5 tests)  18ms
 ↓ tests/capabilities/orchestrator/orchestrator-reverify-integration.test.ts (2 tests | 2 skipped)

 Test Files  3 passed | 1 skipped (4)
       Tests  28 passed | 2 skipped (30)
    Start at  21:09:04
    Duration  805ms (transform 692ms, setup 0ms, import 1.32s, tests 62ms, environment 1ms)
```

### Coverage breakdown

| Test file | Tests | Result | Notes |
|---|---|---|---|
| `orchestrator-state-machine.test.ts` | 19 | PASS | Table-driven — covers IDLE → ACKED → EXECUTING → REFLECTING → REVERIFYING → DONE happy path, all iterate branches, budget exhaustion, NOOPs for mismatched events. |
| `orchestrator-surrender-scope.test.ts` | 4 | PASS | Cross-conv cooldown, different-type not blocked, `onCapabilityNowAvailable` clears all, expiresAt ~10 min in future. |
| `orchestrator-budget.test.ts` | 5 | PASS | Dedup on in-flight session, surrender after 3 attempts, cooldown path, scope-clear, ≤5 spawns across full run. |
| `orchestrator-reverify-integration.test.ts` | 2 | SKIPPED | D3-approved skip via `it.skipIf(!fs.existsSync(audioPath))`. Audio fixture is gitignored at `packages/core/tests/fixtures/cfr/.local/voice-1-incident.ogg` or `CFR_INCIDENT_AUDIO` env var. |

### Skipped test details (by design)

The two skipped tests in `orchestrator-reverify-integration.test.ts` exercise the real `transcribe.sh` against the CTO's incident voice audio. Per sprint deviation D3 (CTO-specified during pre-flight), the audio is not committed to the public repo. The test header at lines 1-12 documents the skip gate:

- `CFR_INCIDENT_AUDIO` env var pointing to the file, OR
- `tests/fixtures/cfr/.local/voice-1-incident.ogg` existing locally

Both tests use `it.skipIf(!fs.existsSync(audioPath))` so the skip is explicit rather than a silent pass. When the audio is available, the first test asserts `recoveredContent` contains "voice messages" (case-insensitive), and the second asserts a non-empty string result.

---

## TypeScript Compilation

### `packages/core`

```
$ cd packages/core && npx tsc --noEmit
(no output — clean)
```

Exit code: 0. No errors or warnings.

### `packages/dashboard`

```
$ cd packages/dashboard && npx tsc --noEmit
(no output — clean)
```

Exit code: 0. No errors or warnings.

---

## Commands Run

```bash
cd /home/nina/my_agent/packages/core && npx tsc --noEmit
cd /home/nina/my_agent/packages/dashboard && npx tsc --noEmit
cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/orchestrator
```

---

## Verdict

PASS

All 28 executing tests pass across 3 test files. Both packages compile without errors or warnings. The 2 skipped tests are correctly gated via `it.skipIf()` per approved deviation D3 — the skip is explicit, documented, and reversible on any machine with the incident audio available.

Total wall time: ~805ms for the orchestrator test suite. No flaky tests observed; the dedup test uses a promise-gated spawn and yields to the event loop rather than relying on timing.

One missing-test gap is flagged in s4-review.md (F1): plan acceptance §6 test 2.b — "nested CFR + nested cap fails → ≤5 jobs across sessions" — is not exercised. This is an OBSERVATION rather than a test regression, because no code path currently emits nested CFRs (`CapabilityFailure.parentFailureId` is declared but no producer sets it).
