---
sprint: m9.6-s14
date: 2026-04-18
verified-by: Senior Code Reviewer (claude-sonnet-4-6)
---

# M9.6-S14 Test Report

**Sprint:** M9.6-S14 — Friendly names + multi-instance disambiguation + per-type fallback copy
**Date:** 2026-04-18
**Branch:** `sprint/m9.6-s14-friendly-names`

---

## Verification commands and output

### Core typecheck

```
cd packages/core && npx tsc --noEmit
```

exit: 0 (no output)

### Dashboard typecheck

```
cd packages/dashboard && npx tsc --noEmit
```

exit: 0 (no output)

### S14 acceptance tests

```
cd packages/core && npx vitest run \
  tests/capabilities/resilience-messages-coverage \
  tests/capabilities/resilience-messages-multi-instance \
  tests/capabilities/resilience-messages-terminal \
  tests/capabilities/registry-multi-instance \
  tests/capabilities/invoker

 ✓ tests/capabilities/invoker-timeout-fallback.test.ts       (1 test) 7ms
 ✓ tests/capabilities/resilience-messages-terminal.test.ts   (8 tests) 9ms
 ✓ tests/capabilities/invoker.test.ts                        (12 tests) 121ms
 ✓ tests/capabilities/resilience-messages-multi-instance.test.ts (7 tests) 5ms
 ✓ tests/capabilities/registry-multi-instance.test.ts        (23 tests) 24ms
 ✓ tests/capabilities/resilience-messages-coverage.test.ts   (7 tests) 395ms
     ✓ every installed provides type has copy and fallback    390ms

 Test Files  6 passed (6)
       Tests  58 passed (58)
    Start at  16:52:21
    Duration  729ms (transform 484ms, setup 0ms, import 997ms, tests 562ms, environment 1ms)
```

Dynamic scan ran: `.my_agent/capabilities/` is present. `browser-chrome` (provides: `browser-control`) scanned and passed.

### Full capabilities regression

```
cd packages/core && npx vitest run tests/capabilities

 ✓ tests/capabilities/test-harness-mcp.test.ts        (3 tests) 2396ms
 ✓ tests/capabilities/watcher.test.ts                 (2 tests) 2309ms
 ✓ tests/capabilities/desktop-extraction.test.ts      (3 tests) 1075ms
 ✓ tests/capabilities/schema-validation.test.ts       (5 tests) 1053ms
 ✓ tests/capabilities/resilience-messages-coverage.test.ts (7 tests) 325ms
     ✓ every installed provides type has copy and fallback  320ms
 ✓ tests/capabilities/no-first-match-browser-control.test.ts (1 test) 151ms
 ✓ tests/capabilities/scanner-system.test.ts          (7 tests) 102ms
 ✓ tests/capabilities/functional-screenshot.test.ts   (1 test) 1059ms
 [... 35 more test files all passing ...]
 ✓ tests/capabilities/orchestrator/orchestrator-surrender-cooldown-ack.test.ts (1 test) 9ms
 ✓ tests/capabilities/orchestrator/orchestrator-state-machine.test.ts (21 tests) 8ms
 ✓ tests/capabilities/invoker-timeout-fallback.test.ts (1 test) 5ms
 ✓ tests/capabilities/cfr-types-origin.test.ts        (5 tests) 5ms
 ✓ tests/capabilities/classify-mcp-tool-error.test.ts (8 tests) 6ms
 ✓ tests/capabilities/resilience-messages-multi-instance.test.ts (7 tests) 5ms
 ✓ tests/capabilities/types.test.ts                   (3 tests) 4ms
 ↓ tests/capabilities/orchestrator/orchestrator-reverify-integration.test.ts (2 tests | 2 skipped)
 ✓ tests/capabilities/mcp-spawner.test.ts             (5 tests) 27553ms

 Test Files  43 passed | 1 skipped (44)
       Tests  290 passed | 2 skipped (292)
    Start at  16:52:26
    Duration  28.16s (transform 1.31s, setup 0ms, import 7.42s, tests 51.25s, environment 8ms)
```

Skipped: `orchestrator-reverify-integration.test.ts` — 2 tests, pre-existing skip since S12 (requires live capability fixture not present in CI). Not new in S14.

---

## Universal coverage check

Installed capabilities in `.my_agent/capabilities/` at sprint time:

| Type | Friendly name | Fallback action source | Terminal ack | Multi-instance |
|---|---|---|---|---|
| browser-control | "browser" | generic default ("try again in a moment") — FU-2 tracks backfill | "browser (name) is back — try again whenever you'd like." (multi) | true (WELL_KNOWN_MULTI_INSTANCE fallback — no frontmatter field yet) |

Dynamic scan also confirmed:
- `getFallbackAction("browser-control")` → `"try again in a moment"` (generic default; FU-2 tracks adding `fallback_action:` to installed plug frontmatter)
- `isMultiInstance("browser-control")` → `true` (via `WELL_KNOWN_MULTI_INSTANCE` safety net; FU-2 tracks explicit frontmatter backfill)
- `ack()` and `terminalAck()` both non-empty

Well-known type static coverage (Layer 1 — all FRIENDLY_NAMES entries verified):

| Type | Friendly name | Entry present |
|---|---|---|
| audio-to-text | "voice transcription" | yes |
| image-to-text | "image understanding" | yes |
| text-to-audio | "voice reply" | yes |
| text-to-image | "image generation" | yes |
| browser-control | "browser" | yes |
| desktop-control | "desktop control" | yes |

---

## Review findings

See `s14-review.md` for the full assessment. Summary of findings:

- **Issue 1 (Important):** `isTerminalKind()` in `ack-delivery.ts` does not include `"terminal-fixed"`, so automation-origin capabilities that recover via the S13 reverify path do not get a `CFR_RECOVERY.md` written. Conversation-origin and system-origin acks are unaffected. Fix: add `"terminal-fixed"` to the `isTerminalKind` guard, and treat it as a recovery (not surrender) in `buildRecoveryBody`.

- **Issue 2 (Suggestion):** Dynamic coverage gate asserts non-empty ack output rather than the raw-type non-match check the architect required. Static Layer 1 covers all currently registered types; this is only a gap for future unknown types.

---

## Notes

- DEV-1: `AckDelivery.writeAutomationRecovery` and `buildRecoveryBody` type widened to accept `"terminal-fixed"` — required to resolve dashboard type error from the new `terminal-fixed` emitAck branch. Correct change; correctly documented in DEVIATIONS.md.
- Bug fix D5: `terminal-fixed` AckKind (wired in S13) was silently falling through to the `"budget"` branch in `emitAck`. Fixed.
- Bug fix D6 (renamed from plan as D5 in DECISIONS): `surrender-cooldown` was routing to `"iteration-3"` SurrenderReason. Fixed.
- `ack-delivery.ts` env path in coverage test: the dynamic scan uses `.my_agent/.env` (derived from capabilities dir path), not `packages/dashboard/.env`. Practically harmless today since `browser-chrome` has no `requires.env` fields, but would silently mark env-dependent plugs as `unavailable` during the test scan.
