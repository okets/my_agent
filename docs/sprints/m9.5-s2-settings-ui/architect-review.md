# M9.5-S2: Settings UI — Architect Review

**Reviewer:** CTO architect session
**Date:** 2026-04-11

---

## Verdict: PASS — pending browser verification

All deliverables implemented and correct. 10 new tests passing, 36 S1 regression tests passing, TypeScript builds clean. Both plan review corrections (C1: refetch after toggle, C2: unavailable in checklist) addressed. One bonus fix (per-socket publish). Browser verification must be completed before merge.

---

## Spec Compliance

| Design Spec Requirement | Status | Notes |
|---|---|---|
| `GET /api/settings/capabilities` | Done | Returns all 4 well-known types merged with registry state |
| `POST /api/settings/capabilities/:type/toggle` | Done | Returns `{ enabled, effective }`, emits `capability:changed` |
| All 4 well-known types always visible | Done | `WELL_KNOWN_TYPES` constant, tested with empty registry |
| Installed + healthy: green toggle ON | Done | `bg-emerald-400`, `animate-pulse`, toggle enabled |
| Installed + degraded: amber indicator | Done | `bg-amber-400`, degraded reason shown, toggle enabled |
| Installed + disabled: grey toggle OFF | Done | `bg-white/20`, toggle enabled |
| Not installed: greyed + hint with agent name | Done | `bg-white/10`, hint from `loadAgentNickname()`, toggle disabled |
| Unavailable: reason shown, toggle disabled | Done | `unavailableReason` displayed, `canToggle: false` |
| Toggle timing: script=immediate, MCP=next-session | Done | `toggleTiming` field, 4-second UI message after toggle |
| Hint uses agent name | Done | `loadAgentNickname()`, tested |
| `$store.capabilities.has()` respects enabled | Done | `enabled !== false` guard for backward compat |
| State publisher broadcasts `enabled` | Done | Both `publishCapabilities()` and `publishAllTo()` paths |
| Desktop + mobile settings cards | Done | Both templates with identical logic |
| Desktop routes stay (S3 removes) | Done | `routes/desktop.ts` confirmed untouched |

---

## Plan Review Corrections

| Correction | Status | Evidence |
|---|---|---|
| C1: Refetch after toggle (not optimistic 'healthy') | Resolved | Both desktop and mobile toggle handlers refetch full list. Comment in HTML explains why. |
| C2: Unavailable state in browser checklist | Resolved | Added to test report checklist as item 6. Unit test covers the state. |

---

## Bonus Fix

**D4: Per-socket initial publish.** The plan only specified updating `publishCapabilities()` (broadcast to all). The developer discovered that `publishAllTo()` (initial state for new WebSocket connections) also omitted `enabled`. Fixed in a separate commit. Good catch — without this, clients connecting after toggle would see stale state.

---

## Corrections Required

### C1: Browser verification must be completed before merge

The 9-point browser checklist is defined but not executed. All items marked "Pending" in the test report. Unit tests verify logic, but the actual settings UI rendering, toggle behavior, and mic button interaction have not been visually confirmed.

**Action:** Run through the full browser checklist on the Tailscale dashboard URL. Verify:
1. All 4 well-known types visible in Capabilities card
2. Installed capabilities show green indicator + provider name
3. Not-installed capabilities show hint text with agent name
4. Toggle voice off → mic button disappears from chat input
5. Toggle voice on → mic button returns
6. Unavailable capability shows reason + disabled toggle
7. MCP toggle shows "Takes effect next session" message
8. Mobile settings popover shows same Capabilities card
9. Desktop Control card (old) still works independently

No code changes expected — this is verification only.

---

## Minor Issues (non-blocking)

### I1: Variable shadowing in toggle handler

Both desktop and mobile toggle handlers use `d` as parameter name in nested `.then()` callbacks, shadowing the outer toggle response. Works today because `showTiming` is captured before the shadow, but fragile for future edits.

**Recommendation:** Rename inner parameter to `fresh` or `listData` when next touching this code. Not worth a dedicated fix commit.

---

## Decisions — Reviewed

| Decision | Verdict |
|---|---|
| D1: Desktop routes stay (pre-approved by architect) | Agree |
| D2: Refetch after toggle instead of optimistic update | Agree — always correct |
| D3: `enabled !== false` for backward compatibility | Agree — graceful for mid-upgrade WebSocket messages |
| D4: Per-socket publish fix | Agree — necessary for correctness |

---

## Deferred Items

No new deferrals. The only item deferred from the plan (desktop routes removal) was pre-approved and is already tracked in S3's scope.

---

## Summary

Clean sprint. All spec requirements met. Both architect corrections from plan review addressed. One bonus fix improves correctness. 10 new tests + 36 regression tests passing. Single action item: complete the browser verification checklist before merge.
