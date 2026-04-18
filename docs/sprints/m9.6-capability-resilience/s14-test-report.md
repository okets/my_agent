# S14 Test Report

**Sprint:** M9.6-S14 — Friendly names + multi-instance disambiguation + per-type fallback copy  
**Date:** 2026-04-18  
**Branch:** `sprint/m9.6-s14-friendly-names`

---

## Type-check

```
cd packages/core && npx tsc --noEmit   → PASS (0 errors)
cd packages/dashboard && npx tsc --noEmit → PASS (0 errors)
```

---

## S14 targeted tests

```
npx vitest run \
  tests/capabilities/resilience-messages-coverage \
  tests/capabilities/resilience-messages-multi-instance \
  tests/capabilities/resilience-messages-terminal \
  tests/capabilities/registry-multi-instance \
  tests/capabilities/invoker

 ✓ tests/capabilities/invoker-timeout-fallback.test.ts    (1 test)
 ✓ tests/capabilities/resilience-messages-terminal.test.ts (8 tests)
 ✓ tests/capabilities/invoker.test.ts                      (12 tests)
 ✓ tests/capabilities/resilience-messages-multi-instance.test.ts (7 tests)
 ✓ tests/capabilities/resilience-messages-coverage.test.ts (7 tests)
     ✓ every installed provides type has copy and fallback (dynamic scan: browser-chrome)
 ✓ tests/capabilities/registry-multi-instance.test.ts      (23 tests)

 Test Files  6 passed (6)
       Tests  58 passed (58)
    Duration  856ms
```

---

## Full capability regression

```
npx vitest run tests/capabilities

 Test Files  43 passed | 1 skipped (44)
       Tests  290 passed | 2 skipped (292)
    Duration  29.45s
```

Skipped: `orchestrator-reverify-integration.test.ts` (2 tests) — requires live env, intentionally skipped in CI.

---

## Dynamic scan detail

`.my_agent/capabilities/` installed at test time: `browser-chrome` (provides: `browser-control`).

- `getFallbackAction("browser-control")` → `"try again in a moment"` (no `fallback_action` in CAPABILITY.md frontmatter — FU-2 tracks backfill)
- `isMultiInstance("browser-control")` → `true` (via WELL_KNOWN_MULTI_INSTANCE fallback — FU-2 tracks explicit frontmatter)
- `ack()` and `terminalAck()` both non-empty ✓

---

## Notes

- DEV-1: `AckDelivery.writeAutomationRecovery` type widened to accept `"terminal-fixed"` — required to resolve dashboard type error surfaced by the new `terminal-fixed` emitAck branch.
- Bug fix bundled: `terminal-fixed` AckKind (S13) was silently falling through to the `"budget"` branch in `emitAck` before this sprint. Fixed in D6.
- Bug fix bundled: `surrender-cooldown` was routing to `"iteration-3"` reason instead of `"surrender-cooldown"`. Fixed in D5.
