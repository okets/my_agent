---
sprint: m9.6-s10
title: CapabilityInvoker + exec-bit validation — test report
date: 2026-04-17
---

# S10 Test Report

## New Test Files

### packages/core/tests/capabilities/invoker.test.ts

17 tests — 9 in the 6-symptom matrix + 1 triggeringInput forwarding check + additional success/error variants.

```
✓ tests/capabilities/invoker.test.ts (9 tests) 94ms
```

Scenarios covered:
- not-installed: empty registry → failure + CFR emitted
- not-enabled: cap.enabled=false → failure + CFR emitted
- execution-error (status): cap.status=unavailable → failure + CFR emitted
- timeout: `sleep 9999` script + timeoutMs=50 → failure(timeout) + CFR emitted
- validation-failed: script exits 0 with non-JSON → failure + CFR emitted
- success (JSON): script outputs `{"text":"hello","language":"en"}` → success + parsed
- success (raw): no expectJson, script outputs plain text → success + raw stdout
- execution-error (exit 1): `exit 1` script → failure(execution-error) + CFR emitted
- triggeringInput forwarding: the exact TriggeringInput object is passed through to cfr.emitFailure

### packages/core/tests/capabilities/exec-bit-validator.test.ts

8 tests covering validateScriptExecBits() and scanCapabilities() integration.

```
✓ tests/capabilities/exec-bit-validator.test.ts (8 tests) 72ms
```

Scenarios covered:
- no scripts/ directory → valid
- empty scripts/ → valid
- all .sh executable → valid
- one .sh non-executable → invalid, reason contains filename + "executable bit"
- mixed (some executable, some not) → invalid, reason names only non-executable files
- non-.sh files with no exec bit → valid (ignored)
- scanCapabilities: script-interface cap with non-executable .sh → status=invalid, error contains filename
- scanCapabilities: script-interface cap with executable .sh → status=available

## Full Suite Results

### packages/core — capabilities + conversations

```
Test Files  30 passed | 1 skipped (31)
Tests      183 passed | 2 skipped (185)
Duration   28.84s
```

The 2 skipped tests are pre-existing (`orchestrator-reverify-integration.test.ts` — skipped pending S13 invoker migration). No regressions.

### packages/dashboard — CFR tests

```
Test Files  4 passed (4)
Tests      35 passed (35)
Duration   3.61s
```

Note: `cfr-emit-stt-errors.test.ts` was deleted this sprint. It previously tested `classifySttError` which was removed. All scenarios it covered are now exercised by `invoker.test.ts`.

## TypeScript

```
packages/core:      npx tsc --noEmit → clean
packages/dashboard: npx tsc --noEmit → clean
```

## Coverage Gaps (per universal-coverage rule)

- `synthesizeAudio()` (TTS) not wired through invoker — tracked in s10-FOLLOW-UPS.md FU-1, deferred to S13/S17 per plan-phase2-coverage.md §2.2.
- `reverifyAudioToText()` legacy bash-wrapper fallback — tracked in FU-2, to be removed in S13.
