# M9-S2 External Verification Report

> **Sprint:** M9-S2 — Dashboard Voice UI + Secrets Management
> **Reviewer:** External (Claude Opus 4.6)
> **Date:** 2026-04-01
> **Verdict:** PASS with minor gaps

---

## Spec Coverage

| Traceability Row | Spec Requirement | Task(s) | Status | Notes |
|-----------------|-----------------|---------|--------|-------|
| Principles §3 | Framework reacts to capability presence | 15, 19, 22 | PASS | Record button gated on `$store.capabilities.has('audio-to-text')`, model badge in header |
| Well-Known Types | audio-to-text → record button | 15, 16, 17 | PASS | MediaRecorder integration captures audio, sends as attachment, server calls `transcribe.sh` |
| Well-Known Types | text-to-audio → audio player on responses | 19, 20, 21 | PASS | `audioUrl` field on done event, `synthesizeAudio()` in chat-service, protocol updated |
| Well-Known Types | text-to-image → image inline (existing) | Note | PASS | Acknowledged as existing from M8-S4, no new code needed |
| Framework Reactions > Dashboard | WebSocket capabilities message on connect | 13, 14 | PASS | `capabilities` message type in protocol.ts, broadcast on connect + `capability:changed` in state-publisher.ts |
| Framework Reactions > Dashboard | Components gate on capabilities.has() | 15, 19 | PASS | Alpine store `capabilities` with `has(type)` method, UI elements use `x-show="$store.capabilities.has(...)"`  |
| Framework Reactions > Dashboard | Model indicator in header | 22, 23 | PARTIAL | Badge shows in header (desktop + mobile). `broadcastModelChange()` in session-manager.ts is a **placeholder** — deferred to S3. Model badge works via existing `conversation_model_changed` messages. |
| Medium Mirroring | Audio in → audio out (channel-level) | 18, 20 | PASS | `inputMedium` field on ClientMessage, TTS synthesis triggered when `isAudioInput && assistantContent.trim()` |
| Error Handling | Don't silently drop failed STT/TTS (dashboard) | 27-dash | PASS | STT failure: `[Voice message — transcription failed: <error>]` passed to brain. TTS failure: returns null, text response sent without audio |
| Secrets > Settings UI | Secrets section below AI Connection | 30 | PASS | Glass-strong card in Settings, both desktop and mobile |
| Secrets > Settings UI | Values masked, reveal on click | 30 | BUG | See Gap G1 below — reveal toggle does not show actual value |
| Secrets > Settings UI | ANTHROPIC_API_KEY read-only | 28, 30 | PASS | `READ_ONLY_KEYS` set includes `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN`. API returns 403 on PUT/DELETE. UI shows "managed" badge, no delete button |
| Secrets > Settings UI | Add/edit/delete flows | 31 | PARTIAL | Add and delete work with modals + confirmation. **Inline edit for existing values is missing** — see Gap G2 |
| Secrets > Settings UI | Agent can write to .env from chat | 31b | PASS | `setEnvValue()` exported from core, `rescanCapabilities()` wired on secret change |
| Secrets > Flow When Key Missing | Secret added triggers re-scan → available | 29 | PASS | PUT and DELETE endpoints both call `rescanCapabilities()` which triggers `capability:changed` event |
| Model Switching | Dashboard status bar shows model | 22 | PASS | Purple pill badge next to conversation title (desktop + mobile) |
| Model Switching | Broadcast model_changed via WebSocket | 23 | PLACEHOLDER | `broadcastModelChange()` is a no-op stub. Client-side handler exists in ws-client.js. Comment says "will be wired in S3" |

---

## Test Results

| Suite | Result |
|-------|--------|
| Core build (`npm run build`) | PASS — clean |
| Dashboard TypeScript (`tsc --noEmit`) | PASS — no errors |
| Dashboard Vitest (`npx vitest run`) | **911 passed**, 0 failed, 8 skipped |

---

## Browser Verification

| Check | Result | Evidence |
|-------|--------|----------|
| Model indicator badge in header | PASS | Purple "Opus" badge visible next to conversation title. Works on both desktop and mobile. |
| Record button in compose bar | PASS | Microphone icon visible in compose bar, between `/` slash indicator and send button. Gated on STT capability store. |
| Settings → Secrets section | PASS | Glass-strong card showing `CLAUDE_CODE_OAUTH_TOKEN` with masked value `••••••_QAA`, eye icon for reveal, "managed" badge, "+ Add Key" button |
| CLAUDE_CODE_OAUTH_TOKEN read-only | PASS | No delete button shown, "managed" badge present |
| Design language compliance | PASS | Violet accent colors, glass-strong panels, Tokyo Night palette throughout |

Screenshots captured:
- `m9-s2-review-dashboard-overview.png` — full dashboard with header badge + compose bar
- `m9-s2-review-secrets-panel.png` — Settings scrolled to Secrets section
- `m9-s2-review-compose-bar.png` — compose bar close-up with record button

---

## Gaps Found

### G1: Reveal toggle shows empty string (BUG)

**Severity:** Medium
**Location:** `packages/dashboard/public/js/app.js` line 48-51, `packages/dashboard/public/index.html` (Secrets panel)

The `toggleReveal()` function sets `secret.revealed = !secret.revealed`, and the HTML displays `secret.revealed ? secret.value : secret.maskedValue`. However, `secret.value` is initialized to `""` on load (line 40: `value: ""`). The API (`GET /api/settings/secrets`) only returns masked values — there is no endpoint to retrieve the actual secret value.

**Result:** Clicking the eye icon toggles to showing an empty string instead of the real value.

**Fix options:**
1. Add a `GET /api/settings/secrets/:key/reveal` endpoint that returns the actual value (security consideration: only over Tailscale)
2. Remove the reveal feature and only show masked values (simpler, more secure)
3. Toggle between showing/hiding the masked value itself (minimal change)

### G2: Missing inline edit for secret values

**Severity:** Low
**Location:** Task 31 in plan.md specifies "inline edit for value" but no edit UI exists.

Users can add new secrets and delete existing ones, but cannot edit the value of an existing secret. The only workaround is delete + re-add.

**Impact:** Low — re-adding a key via the "+ Add Key" flow effectively performs an edit (PUT endpoint handles both create and update). The UX is slightly less smooth than inline editing.

### G3: `broadcastModelChange()` is a placeholder

**Severity:** Low (intentional deferral)
**Location:** `packages/dashboard/src/agent/session-manager.ts` line 411-413

Task 23 specifies broadcasting `model_changed` via WebSocket when capability work starts/ends. The function is a no-op placeholder with a comment "will be wired in S3". The client-side handler in `ws-client.js` is ready.

**Impact:** Low for this sprint — the model badge still works because it reads from the conversation's model field. The `model_changed` broadcast becomes relevant in S3 when capability brainstorming switches to Opus.

### G4: `resolveEnvPath` changed to use `process.cwd()`

**Severity:** Info
**Location:** `packages/core/src/env.ts` line 83-86

`resolveEnvPath()` was changed from resolving relative to `agentDir` to using `path.resolve('.env')` (process working directory). This works when the dashboard is the entry point (`packages/dashboard/`), but could break if called from a different working directory (e.g., tests, CLI, other packages).

---

## Verdict

**PASS with minor gaps.**

The sprint delivers all major requirements: WebSocket capability protocol, record button with MediaRecorder integration, STT/TTS pipeline, model indicator, Secrets CRUD API and UI with read-only protection and capability re-scan. Code quality is solid — clean TypeScript, consistent design language, both desktop and mobile templates updated in sync.

G1 (reveal shows empty string) is a real bug that should be fixed before release. G2 and G3 are minor — G2 is a UX shortcut (add/delete covers the use case), G3 is an intentional deferral to S3. G4 is worth noting for future cross-package usage of `resolveEnvPath`.
