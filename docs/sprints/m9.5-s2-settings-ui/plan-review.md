# M9.5-S2: Settings UI — Plan Review

**Reviewer:** CTO architect session
**Date:** 2026-04-11

---

## Verdict: APPROVED

Plan covers all spec requirements. 5 tasks map cleanly to the design. All four well-known types, all UI states, both endpoints, desktop + mobile, store fix, state publisher, browser verification. Two corrections, one known limitation.

---

## Spec Coverage

| Design Spec Requirement | Plan Task | Status |
|---|---|---|
| `GET /api/settings/capabilities` | Task 1 | Covered |
| `POST /api/settings/capabilities/:type/toggle` | Task 1 | Covered |
| All 4 well-known types always visible | Task 1 + Task 4 | Covered |
| Installed + healthy: green toggle ON | Task 4 | Covered |
| Installed + degraded: amber indicator | Task 4 | Covered |
| Installed + disabled: grey toggle OFF | Task 4 | Covered |
| Not installed: greyed + hint with agent name | Task 1 + Task 4 | Covered |
| Toggle timing: script=immediate, MCP=next-session | Task 1 + Task 4 | Covered |
| `$store.capabilities.has()` respects enabled | Task 3 | Covered |
| State publisher broadcasts `enabled` field | Task 2 | Covered |
| Desktop routes stay (removed in S3) | Explicit decision | Covered |
| Desktop + mobile settings | Task 4 | Covered |
| Browser verification | Task 5 | Covered |
| Desktop routes removal | Deferred to S3 | Already tracked in S3 scope |

---

## Corrections Required

### C1: Toggle optimistically sets `'healthy'` — incorrect for degraded capabilities

Task 4 toggle handler:
```javascript
cap.state = d.enabled ? 'healthy' : 'disabled';
```

If a capability was `degraded` before toggle-off/toggle-on, it snaps to `'healthy'` in the UI. The actual health hasn't changed.

**Fix:** Refetch the full capability list after toggle, or track the pre-toggle health:

```javascript
cap.state = d.enabled ? (cap._prevHealth || 'healthy') : 'disabled';
```

Or simpler — after the toggle response, refetch:
```javascript
fetch('/api/settings/capabilities').then(r => r.json()).then(d => { this.caps = d.capabilities; });
```

The refetch approach is cleanest. One extra request on toggle, always correct.

### C2: Browser verification checklist missing `unavailable` state

Task 5 Step 3 tests installed, not-installed, and toggle. It does not test the `unavailable` state (capability installed but missing env vars).

**Fix:** Add to the browser checklist:
- If an `audio-to-text` capability exists but `DEEPGRAM_API_KEY` is missing: verify it shows "Unavailable" with reason text, toggle disabled.

---

## Known Limitation (accepted, not deferred)

**Capabilities card doesn't live-update from WebSocket.** It fetches on `init()` only. If the registry rescans (e.g., after adding a secret in the Secrets card), the Capabilities card goes stale until settings is reopened.

This is acceptable for S2. The toggle response optimistically updates local state, and the card refetches on every open. Real-time WebSocket sync would be nice but is not in the spec and adds complexity for a low-frequency interaction.

---

## Deferred Items

| Item | Assigned To | Reason |
|---|---|---|
| Remove `routes/desktop.ts` | S3 | Desktop capability folder doesn't exist yet — nothing for generic toggle to target |

This is already tracked in S3's roadmap scope. No new deferrals.

---

## Summary

Clean plan. All spec requirements covered. Two corrections (optimistic health state, missing browser test for unavailable). One accepted limitation (no WebSocket live-update). No new deferrals — the only deferred item (desktop routes removal) was already approved and tracked in S3.
