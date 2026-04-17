---
sprint: m9.6-s11
title: Template Smoke Fixtures — Test Report
---

# M9.6-S11 Test Report

**Branch:** `sprint/m9.6-s11-template-smoke-fixtures`
**Head:** `437d892`
**Environment:** Node.js, Vitest 4.0.18, `/home/nina/my_agent/packages/core`
**Date:** 2026-04-17

## New test suite — `tests/capabilities/run-smoke-fixture.test.ts`

Command:

```bash
cd /home/nina/my_agent/packages/core && \
  npx vitest run tests/capabilities/run-smoke-fixture.test.ts
```

Result: **4 / 4 passing** (40 ms).

| # | Case | Expectation | Status |
|---|------|-------------|--------|
| 1 | `smoke.sh` present, exits 0 | `pass: true` | PASS |
| 2 | `smoke.sh` present, exits 1 | `pass: false`, `failureMode` matches `/smoke\.sh failed/` | PASS |
| 3 | `smoke.sh` absent, cap status `available` | `pass: true`, `console.warn` called with "template gap" substring | PASS |
| 4 | `smoke.sh` absent, cap status `unavailable` | `pass: false`, `failureMode` matches `/not available/` | PASS |

Raw summary (Vitest output):

```
 ✓ tests/capabilities/run-smoke-fixture.test.ts (4 tests) 40ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

## Full core test suite — regression check

Command:

```bash
cd /home/nina/my_agent/packages/core && npx vitest run
```

Result: **492 passing, 9 skipped, 0 failing** (31.34 s). No regressions relative to pre-S11 baseline.

Skipped files (unchanged from pre-S11):

- `tests/triage-behavioral.test.ts` — 7 skipped
- `tests/capabilities/orchestrator/orchestrator-reverify-integration.test.ts` — 2 skipped

Both are pre-existing skips, not introduced by S11.

Raw summary:

```
Test Files  62 passed | 2 skipped (64)
     Tests  492 passed | 9 skipped (501)
  Duration  31.34s
```

## TypeScript build check

Command:

```bash
cd /home/nina/my_agent/packages/core && npx tsc --noEmit
```

Result: **clean** (no output, exit 0). The new top-level imports (`execFile`, `promisify`) and the new `runSmokeFixture` export compile against the existing `ReverifyResult` and `CapabilityRegistry` types without issue.

## Coverage notes

Branch coverage for `runSmokeFixture` is complete for the implemented logic:

- **`smoke.sh` exists, `execFile` succeeds** — test 1.
- **`smoke.sh` exists, `execFile` rejects** — test 2 (exit-1 script triggers the catch block).
- **`smoke.sh` absent, registry reports `available`** — test 3 (warning branch).
- **`smoke.sh` absent, registry reports non-available** — test 4 (explicit-failure branch).

Indirectly exercised / not under unit test (out of scope for S11):

- `SMOKE_TIMEOUT_MS = 30_000` enforcement — no test spawns a long-running script. Acceptable: the timeout is a passthrough to `execFile` and is not S11-owned logic.
- `cwd: capDir` propagation — not asserted in unit tests, but the four temp-dir scripts are trivial (`#!/usr/bin/env bash\nexit N\n`) and don't depend on cwd. S14's wiring tests will exercise cwd when real smoke scripts read sibling config.
- `env: { ...process.env }` propagation — same story; S14 will exercise this when the smoke scripts call providers needing API keys.

## Template authoring — structural checks

Not executed as automated tests (S11 plan explicitly says "no tsc/vitest requirement" for template edits), but verified by read-through:

| Template | `fallback_action` present | "Smoke Fixture" section present | `smoke.sh` reference is working script vs stub |
|----------|---------|------------------|-------|
| `audio-to-text.md` | `"could you resend as text"` | Yes, line 88 | Working (ffmpeg-generated fixture + jq validation) |
| `text-to-audio.md` | `"you can read my last reply above"` | Yes, line 79 | Working (synthesize.sh + file-size check) |
| `text-to-image.md` | `"try again in a moment"` | Yes, line 78 | Working (generate.sh + file-size check) |
| `browser-control.md` | `"try again in a moment"` | Yes, line 345 | Stub (S14 to replace) — contract spec is full 5-step |
| `desktop-control.md` | `"try again in a moment"` | Yes, line 356 | Stub (S14 to replace) — contract spec is full 5-step |

`skills/capability-templates/_bundles.md:36` carries the new smoke.sh reference line added in commit `437d892`.

## Summary

- All S11 acceptance criteria met.
- New test suite: 4 / 4 passing.
- No regressions in the broader 492-test core suite.
- TypeScript build clean.
- Template edits structurally sound — each of the five gains `fallback_action` + a Smoke Fixture section.
