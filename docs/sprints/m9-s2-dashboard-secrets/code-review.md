# M9-S2: Dashboard Voice + Secrets — Code Review

> **Reviewer:** Claude Opus 4.6
> **Date:** 2026-04-02
> **Sprint plan:** [plan.md](plan.md)
> **Design spec:** [capability-system.md](../../design/capability-system.md)

---

## Verdict: PASS WITH BUGS (13/17 traceability rows pass, 2 bugs, 2 intentional deferrals)

Server-side work is strong — STT transcription, TTS synthesis, secrets API, capability broadcasting all work correctly. Two client-side bugs need fixing before S3 can proceed: audio player rendering and secret reveal toggle.

---

## Bugs (must fix)

### B1: Audio Player Not Rendered on Client (FAIL — Medium)

**Spec says:** When `text-to-audio` is available and input was voice, show audio player on agent responses.

**Server does (correctly):**
- `chat-service.ts` ~line 651: detects audio input, calls `synthesizeAudio()`
- `synthesizeAudio()` ~line 768: calls `scripts/synthesize.sh`, writes to `public/assets/audio/`, returns URL path
- `chat-handler.ts` ~line 628: forwards `audioUrl` on the `done` WebSocket event
- `protocol.ts` line 127: `audioUrl?: string` field exists on `done` message

**Client does NOT:**
- No `<audio>` element exists anywhere in `index.html`
- The `done` handler in `app.js` ~line 1361 does not read `data.audioUrl`
- No CSS for an audio player component

**The sprint review incorrectly marked task 19 as PASS.**

**Fix required:**
1. In `index.html`, add an `<audio>` element to the message template (both desktop and mobile), conditionally shown when the message has an `audioUrl`
2. In `app.js`, in the `done` event handler, store `data.audioUrl` on the message object
3. Add CSS styling for the audio player (match the glass design language)

---

### B2: Secret Reveal Toggle Non-Functional (BUG — Medium)

**Spec says:** Values masked by default, reveal on click.

**JS does (partially):**
- `toggleReveal()` in `app.js` ~line 48 toggles `secret.revealed` boolean
- `secret.value` is initialized to `""` (line 40) — actual value never fetched from server

**HTML does NOT:**
- Template at ~line 2936 only renders `secret.maskedValue` — no conditional that checks `secret.revealed` to show the full value
- No eye icon SVG or button element in the secrets section HTML

**The sprint review mentions an eye icon that does not exist in the code.**

**Fix required:**
1. Add a reveal/hide icon button to each secret row in `index.html`
2. Add conditional rendering: show `secret.maskedValue` when hidden, `secret.value` when revealed
3. On first reveal, fetch the actual value from the server (GET endpoint should support an `?reveal=true` parameter, or add a dedicated `GET /api/settings/secrets/:key/value` endpoint)
4. Both desktop and mobile settings panels need this fix

---

## Intentional Deferrals (acceptable)

### D1: `broadcastModelChange()` is a No-Op (Low)

**Location:** `session-manager.ts` ~line 444

**Status:** Intentionally deferred to S3. Comment says "will be wired in S3." Client handler in `ws-client.js` ~line 114 and Alpine store in `stores.js` ~line 75 are ready. No action needed — S3 plan covers this.

### D2: No Inline Edit for Secret Values (Low)

**Current behavior:** Users must delete and re-add to change a value. The PUT endpoint supports updating existing keys, so this is a UI-only gap.

**Action:** Optional improvement, not blocking. Delete + re-add works.

---

## What Passed

| Area | Files | Notes |
|------|-------|-------|
| WebSocket `capabilities` message type | `protocol.ts` ~line 217 | Shape matches spec |
| Capabilities broadcast on connect + change | `state-publisher.ts` ~line 157, 269, 365 | Correct |
| Record button — desktop | `index.html` ~line 6130 | Gated on `$store.capabilities.has('audio-to-text')` |
| Record button — mobile | `index.html` ~line 8847 | Same gating |
| MediaRecorder integration | `app.js` ~line 977 | `audio/webm;codecs=opus` with fallback, sends as attachment |
| Server-side STT | `chat-service.ts` ~line 509, 742 | Calls `transcribe.sh`, prefixes with `[Voice message]` |
| Input medium tracking | `protocol.ts` line 94, `chat-service.ts` ~line 510 | `inputMedium: 'text' \| 'audio'` flows through |
| Server-side TTS | `chat-service.ts` ~line 651, 768 | Calls `synthesize.sh`, writes to `public/assets/audio/` |
| `audioUrl` on protocol | `protocol.ts` line 127 | On `done` message |
| Model indicator — desktop | `index.html` ~line 5975 | `model-badge` pill with `x-text="modelDisplayName"` |
| Model indicator — mobile | `index.html` ~line 8734 | Identical |
| Model indicator — CSS | `app.css` ~line 801 | Styled |
| Secrets API — GET | `settings.ts` ~line 340 | Returns masked values + capability associations |
| Secrets API — PUT | `settings.ts` ~line 371 | Sets value, blocks read-only keys |
| Secrets API — DELETE | `settings.ts` ~line 404 | Removes value, blocks read-only keys |
| ANTHROPIC_API_KEY read-only | `settings.ts` ~line 29, 376, 409 | `READ_ONLY_KEYS` set, 403 on edit/delete |
| Re-scan on secret change | `settings.ts` ~line 391, 419 | Calls `rescan()` + emits `capability:changed` |
| Secrets UI — desktop | `index.html` ~line 2915 | Glass-strong card, managed badge, add key modal |
| Secrets UI — mobile | `index.html` ~line 7669 | Identical |
| Add key modal | `index.html` ~line 2966 | Name + value inputs, cancel/add buttons |
| ANTHROPIC_API_KEY read-only badge | `index.html` ~line 2947 | "managed" badge, delete hidden |
| Chat-based key storage | `settings.ts` PUT endpoint | Brain can call `setEnvValue()` via API |
| STT error handling | `chat-service.ts` ~line 523 | `[Voice message -- transcription failed: <error>]` |
| TTS error handling | `chat-service.ts` ~line 793 | Returns null, sends text-only (no silent drop) |

---

## Traceability

| Design Spec Section | Requirement | Status |
|---------------------|-------------|--------|
| Principles §3 | Framework reacts to capability presence | PASS |
| Well-Known Types | audio-to-text → record button | PASS |
| Well-Known Types | text-to-audio → audio player | **B1** |
| Well-Known Types | text-to-image (existing M8-S4) | PASS |
| Framework Reactions > Dashboard | WebSocket capabilities on connect | PASS |
| Framework Reactions > Dashboard | Components gate on capabilities.has() | PASS |
| Framework Reactions > Dashboard | Model indicator in header | PASS |
| Medium Mirroring | Audio in → audio out | **B1** (server OK, client missing) |
| Error Handling | Dashboard STT/TTS errors surface | PASS |
| Secrets Management | Secrets section below AI Connection | PASS |
| Secrets Management | Values masked, reveal on click | **B2** |
| Secrets Management | ANTHROPIC_API_KEY read-only | PASS |
| Secrets Management | Add/edit/delete flows | PARTIAL (no inline edit — D2) |
| Secrets Management | Agent write to .env from chat | PASS |
| Secrets Management | Secret change triggers re-scan | PASS |
| Model Switching | Dashboard status bar shows model | PASS |
| Model Switching | Broadcast model_changed | PLACEHOLDER (D1 — S3) |

---

## Summary for Developer

**Before starting S3, fix B1 and B2:**

1. **B1 — Audio player:** Add `<audio>` element to message templates (desktop + mobile), wire `audioUrl` from `done` event in `app.js`, add CSS. The server-side is done — this is purely client rendering.

2. **B2 — Secret reveal:** Add eye icon button, conditional rendering (`maskedValue` vs `value`), and a mechanism to fetch the actual value from the server on first reveal. Both desktop and mobile settings panels.

These are both contained client-side fixes. No server changes needed for B1. B2 may need a small server endpoint for fetching the unmasked value.
