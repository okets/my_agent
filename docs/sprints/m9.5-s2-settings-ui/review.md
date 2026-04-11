# M9.5-S2 Settings UI -- External Code Review

**Reviewer:** External (Opus)
**Date:** 2026-04-11
**Branch:** `sprint/m9.5-s2-settings-ui` (5 commits ahead of master)

---

## Verdict: PASS

All spec requirements implemented. Architect corrections addressed. Code quality is solid. Two suggestions and one important issue noted below, none blocking.

---

## What Was Done Well

- **Clean separation of concerns.** The `buildCapabilityList()` function is pure logic with no Fastify dependency, making it directly testable. The route file exports both the function and the constant, allowing unit tests to skip Fastify setup entirely.
- **All four UI states covered** with distinct visual treatment (healthy/green pulse, degraded/amber, disabled/grey, not-installed/greyed hint). The state machine in `buildCapabilityList` handles each case explicitly with clear priority order: unavailable > disabled > health-based.
- **Architect correction C1 fully addressed.** Toggle handler refetches the full capability list after POST instead of optimistically setting state. Comment in the HTML explains why: "avoids optimistically snapping degraded -> healthy."
- **Architect correction C2 addressed.** The unavailable state has a dedicated test case (test 5: "installed + unavailable shows unavailable state with reason") and browser verification checklist item in the plan (Task 5, Step 3, item 6).
- **Per-socket publish fixed in a separate commit** (commit `1012a8c`). Both the broadcast path AND the initial-connect path now include `enabled`. This was not in the original plan -- good catch.
- **Desktop routes untouched.** `routes/desktop.ts` has zero diff, correctly deferred to S3.
- **Backward-compatible store fix.** `c.enabled !== false` (not `=== true`) means older broadcasts without the field still work.

---

## Spec Compliance Matrix

| Design Spec Requirement | Status | Evidence |
|---|---|---|
| `GET /api/settings/capabilities` | Done | `capabilities.ts` lines 110-132 |
| `POST /api/settings/capabilities/:type/toggle` | Done | `capabilities.ts` lines 134-155 |
| All 4 well-known types always visible | Done | `WELL_KNOWN_TYPES` constant, `buildCapabilityList` maps over it |
| Installed + healthy: green toggle ON | Done | State `'healthy'`, `stateColor` returns `bg-emerald-400`, `animate-pulse` |
| Installed + degraded: amber indicator | Done | State `'degraded'`, `stateColor` returns `bg-amber-400` |
| Installed + disabled: grey toggle OFF | Done | State `'disabled'`, toggle ON visible, `canToggle: true` |
| Not installed: disabled toggle + hint with agent name | Done | `canToggle: false`, hint uses `agentName` param |
| Toggle timing: script=immediate, MCP=next-session | Done | Tested in unit tests 7 and 8 |
| Hint uses agent's configured name | Done | `loadAgentNickname()` called in both GET and no-registry fallback |
| State publisher broadcasts `enabled` | Done | Both `publishCapabilities()` and `publishAllTo()` updated |
| `$store.capabilities.has()` respects enabled | Done | `stores.js` line 112 |
| Desktop + mobile settings cards | Done | Desktop at line 3014, mobile at line 7893 |

---

## Issues

### Important

**I1: Refetch after toggle clobbers `_timing` overlay.**

The toggle handler sets `cap._timing = 'Takes effect next session'` then immediately refetches the full list with `this.caps = d.capabilities`. The refetch replaces the array, destroying the `_timing` property. The 4-second `setTimeout` that clears it points at the old (now orphaned) object.

In practice, because the fetch round-trip takes ~50-100ms and the refetch replaces `caps` almost immediately, users may see the timing message flash for one frame or not at all.

**Fix:** After the refetch, re-apply the timing to the new object:

```javascript
return fetch('/api/settings/capabilities').then(r => r.json()).then(fresh => {
  this.caps = fresh.capabilities;
  if (d.effective === 'next_session') {
    const newCap = this.caps.find(c => c.type === type);
    if (newCap) {
      newCap._timing = 'Takes effect next session';
      setTimeout(() => { newCap._timing = null; }, 4000);
    }
  }
});
```

And remove the pre-refetch `_timing` assignment. Applies to both desktop and mobile templates.

### Suggestions

**S1: Mobile template missing `capabilityName` sub-line.**

Desktop shows `cap.capabilityName` (e.g., "Deepgram STT") below the label for installed capabilities. The mobile template omits this. The plan explicitly states the mobile version is "the same HTML as desktop" with minor adaptations. This is a minor parity gap -- users on mobile don't see which specific capability provides a type.

**S2: Duplicated Alpine component logic between desktop and mobile.**

The `x-data` object (init, toggle, stateColor, stateText) is duplicated verbatim across desktop and mobile templates. If a bug is found, it must be fixed in two places. This is the existing pattern in the codebase (other settings cards do the same), so it is not a blocker, but worth noting for future extraction into a shared Alpine component or store method.

---

## Test Coverage Assessment

| Area | Tests | Coverage |
|---|---|---|
| All 4 well-known types present (empty registry) | 1 | Good |
| Not-installed state + hint text | 1 | Good |
| Installed + healthy | 1 | Good |
| Installed + disabled | 1 | Good |
| Installed + unavailable + reason | 1 | Good |
| Installed + degraded + reason | 1 | Good |
| MCP toggle timing | 1 | Good |
| Script toggle timing | 1 | Good |
| Toggle returns new state | 1 | Good |
| Toggle returns undefined for unknown | 1 | Good |
| **Total** | **10** | |

**Missing test coverage (non-blocking):**
- No Fastify integration test for the actual HTTP endpoints (404 on unknown type, 503 when no registry). The test file tests `buildCapabilityList` and `registry.toggle` directly, which covers the logic. Full HTTP tests would require Fastify setup and are reasonable to defer.
- No test for the no-registry fallback path in the GET handler (lines 114-127 of capabilities.ts). This is a defensive guard that returns all-not-installed when the app hasn't initialized yet.

---

## Architecture Notes

- The `buildCapabilityList` function is well-structured as a pure function taking registry + agentName. This makes it easy to test and reuse.
- The toggle endpoint correctly emits `capability:changed` after toggling, ensuring WebSocket-connected clients get updated state.
- Error handling covers both missing registry (503) and unknown type (404) with clear error messages.
- The `as const` assertions on `WELL_KNOWN_TYPES` and return values provide good type narrowing.

---

## No Regressions

- S1 core capability tests: 36 passed (7 test files)
- S2 dashboard tests: 10 passed (1 test file)
- TypeScript build: clean (no errors)
- `routes/desktop.ts`: zero diff

---

## Summary

Solid implementation that faithfully follows the plan and addresses both architect corrections. The important issue (I1: timing overlay clobbered by refetch) is a minor UX glitch, not a functional bug -- the underlying toggle and refetch work correctly. The mobile parity gap (S1) is cosmetic. Recommend fixing I1 in a follow-up commit before merge, but it is not blocking.
