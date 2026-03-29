# M8-S2: Desktop Control — Linux X11 — Test Report

**Date:** 2026-03-29
**Branch:** `sprint/m8-s2-desktop-control-linux`
**Verdict:** PASS

---

## Test Suite Results

**Full suite:** 112 passed, 2 failed, 4 skipped (118 total)
**Duration:** 28.92s

### Pre-existing Failures (not from this sprint)

| Test File | Error | Cause |
|-----------|-------|-------|
| `tests/browser/automation-ui.test.ts` | EACCES: permission denied, mkdir `/home/docs/sprints/m7-s9-e2e-test-suite/screenshots` | Hardcoded absolute path with wrong prefix |
| `tests/mcp/skill-triage-scenarios.test.ts` | task-triage SKILL.md not found | Missing fixture file |

Both failures exist on master and are unrelated to M8-S2 changes.

### New Test Files (all passing)

| Test File | Tests | Status |
|-----------|-------|--------|
| `tests/unit/desktop/desktop-capability-detector.test.ts` | 6 | PASS |
| `tests/unit/desktop/x11-backend.test.ts` | 10 | PASS |
| `tests/unit/desktop/computer-use-service.test.ts` | 7 | PASS |
| `tests/unit/mcp/desktop-server.test.ts` | 6 | PASS |
| `tests/unit/hooks/desktop-hooks.test.ts` | 5 | PASS |
| **Total new tests** | **34** | **PASS** |

---

## TypeScript Compilation

| Package | Command | Result |
|---------|---------|--------|
| `packages/core` | `npx tsc --noEmit` | Clean, no errors |
| `packages/dashboard` | `npx tsc --noEmit` | Clean, no errors |

---

## Live Endpoint Check

```
GET /api/debug/desktop-status
```

Response (from the running dashboard on this X11 machine):

```json
{
  "available": true,
  "displayServer": "x11",
  "backend": "x11",
  "capabilities": {
    "screenshot": true,
    "mouse": true,
    "keyboard": true,
    "windowManagement": true,
    "accessibility": false
  },
  "setupNeeded": [],
  "computerUseAvailable": false
}
```

- `available: true` -- display detected, backend created
- `computerUseAvailable: false` -- expected; ANTHROPIC_API_KEY is not set in the running service (the ComputerUseService needs it at startup)
- All X11 tools detected (xdotool, maim, wmctrl installed on this machine)
- `accessibility: false` -- correct, AT-SPI2 detection is not implemented in S2

---

## Test Coverage Assessment

| Component | Unit Tests | Integration Tests | Notes |
|-----------|-----------|-------------------|-------|
| Desktop types | N/A (types only) | Compile check | Types compile clean |
| Capability detector | 6 tests | Endpoint check | Covers X11, Wayland, headless, missing tools |
| X11Backend | 10 tests | N/A | All xdotool/maim args verified, wmctrl parsing, display info |
| ComputerUseService | 7 tests | N/A | Scale factor, coord translation, mutex, maxActions=0 |
| Desktop MCP server | 6 tests | N/A | Shallow -- tests object creation, not handler behavior (see review I3) |
| Desktop hooks | 5 tests | N/A | Rate limiter + sliding window + audit logger |
| Desktop route | 0 tests | Endpoint check | Verified via curl |
| Settings UI | 0 tests | Visual only | HTML verified in diff |
| Hatching integration | 0 tests | N/A | Tool + prompt change, covered by hatching flow |
| Skill | 0 tests | N/A | Markdown file, no executable code |

---

## Risk Areas

1. **MCP server handler paths untested.** The desktop_task error path (no ComputerUseService), desktop_screenshot error path (no backend), and desktop_info capabilities query (null backend) are not exercised by tests. These are the most likely paths to hit in production (headless servers, missing API key).

2. **Computer use API integration untested.** The full run() loop -- API call, tool_use parsing, action execution, screenshot cycling -- is not tested end-to-end because it requires a real Anthropic API call. The static helpers (computeScaleFactor, toScreenCoord) are well-tested. The mutex is tested.

3. **Rate limiter not wired.** See review issue I1. Even if tested in isolation, it cannot prevent runaway automation in its current state.
