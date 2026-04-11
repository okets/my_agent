# M9.5-S2 Settings UI -- Test Report

**Date:** 2026-04-11
**Branch:** `sprint/m9.5-s2-settings-ui`

---

## Unit Tests

### S2 Dashboard Tests

**Command:** `cd packages/dashboard && npx vitest run tests/capabilities-routes.test.ts`
**Result:** 10/10 PASSED (13ms test time, 1.97s total)

| # | Test | Result |
|---|------|--------|
| 1 | returns all four well-known types even when registry is empty | PASS |
| 2 | not-installed types have status "not-installed" and hint with agent name | PASS |
| 3 | installed + available + enabled shows correct state | PASS |
| 4 | installed + available + disabled shows correct state | PASS |
| 5 | installed + unavailable shows unavailable state with reason | PASS |
| 6 | installed + degraded shows degraded state with reason | PASS |
| 7 | MCP interface reports toggleTiming as "next-session" | PASS |
| 8 | script interface reports toggleTiming as "immediate" | PASS |
| 9 | toggle returns new enabled state and timing | PASS |
| 10 | toggle returns undefined for unknown type | PASS |

### S1 Core Capability Tests (regression check)

**Command:** `cd packages/core && npx vitest run tests/capabilities/`
**Result:** 36/36 PASSED (7 test files, 41.97s test time)

| File | Tests | Result |
|------|-------|--------|
| scanner-system.test.ts | 7 | PASS |
| mcp-middleware.test.ts | 7 | PASS |
| registry-toggle.test.ts | 10 | PASS |
| types.test.ts | 3 | PASS |
| test-harness-mcp.test.ts | 3 | PASS |
| integration.test.ts | 1 | PASS |
| mcp-spawner.test.ts | 5 | PASS |

### TypeScript Build

**Command:** `cd packages/dashboard && npx tsc`
**Result:** Clean (no errors)

---

## Browser Verification

Browser verification was not performed in this review session (headless review only). The plan's Task 5 Step 3 checklist should be executed before merge:

| # | Check | Expected | Status |
|---|-------|----------|--------|
| 1 | All four well-known types visible in Capabilities card | Four rows: Voice Input, Voice Output, Image Generation, Desktop Control | Pending |
| 2 | Installed capabilities show green indicator + toggle | Green dot with pulse, toggle switch ON | Pending |
| 3 | Not-installed capabilities show greyed indicator + hint | Grey dot, italic hint text "Ask {name} to add {type}" | Pending |
| 4 | Toggle voice off -> mic button disappears | Mic button hidden in chat input | Pending |
| 5 | Toggle voice on -> mic button returns | Mic button visible in chat input | Pending |
| 6 | Unavailable capability shows reason + disabled toggle | "Unavailable" text, toggle greyed out, reason shown | Pending |
| 7 | Desktop Control card (old) still works independently | Below Capabilities card, functional as before | Pending |
| 8 | Mobile settings shows matching Capabilities card | Same four rows in mobile popover | Pending |
| 9 | MCP toggle shows "Takes effect next session" timing | Cyan text appears for 4s after toggling MCP-type capability | Pending |

---

## Summary

All 46 automated tests pass (10 new S2 + 36 existing S1). No regressions. TypeScript builds cleanly. Browser verification pending -- recommend running the 9-point checklist before merge.
