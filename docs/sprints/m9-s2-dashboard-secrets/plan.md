# M9-S2: Dashboard Voice UI + Secrets Management

> **Milestone:** M9 — Capability System
> **Design spec:** [capability-system.md](../../design/capability-system.md)
> **Implementation plan:** [2026-04-01-capability-system.md](../../plans/2026-04-01-capability-system.md)
> **Status:** Planned

---

## Goal

Dashboard adapts to capability presence — record button appears when STT exists, audio player when TTS exists. Users can manage API keys via a new Secrets section in Settings.

## Prerequisites

- M9-S1 complete (registry, dummies, prompt integration)

## Tasks

### WebSocket Protocol

| # | Task | Files | Parallel? |
|---|------|-------|-----------|
| 13 | Add `capabilities` message type — `{ type: "capabilities", data: Capability[] }` | `packages/dashboard/src/ws/protocol.ts` | Yes (with 22) |
| 14 | Broadcast capabilities on WebSocket connect + on `capability:changed` events | `packages/dashboard/src/state/state-publisher.ts` | After 13 |

### Record Button (audio-to-text)

| # | Task | Files | Parallel? |
|---|------|-------|-----------|
| 15 | Add microphone button to compose bar — desktop (~line 5734) and mobile (~line 8523). Hidden unless `capabilities.has('audio-to-text')` | `packages/dashboard/public/index.html`, `packages/dashboard/public/css/app.css` | After 14 |
| 16 | MediaRecorder integration — capture audio, send as attachment via WebSocket (reuse existing attachment system) | `packages/dashboard/public/js/app.js` | After 15 |
| 17 | Handle audio attachment on server — detect audio → call STT capability script → pass transcribed text to brain with `[Voice message]` prefix | `packages/dashboard/src/ws/` | After 16 |
| 18 | Track input medium per message — `inputMedium: 'text' | 'audio'` flag for medium mirroring | `packages/dashboard/src/agent/chat-service.ts` | After 17 |

### Audio Playback (text-to-audio)

Note: `text-to-image` framework reactions already exist from M8-S4 (Rich I/O). Image rendering in dashboard and WhatsApp image sending work — they just need capability registry gating when a `text-to-image` capability is created (future).

| # | Task | Files | Parallel? |
|---|------|-------|-----------|
| 19 | Add audio player component — inline `<audio>` player on agent responses when input was voice and `text-to-audio` available | `packages/dashboard/public/index.html`, `packages/dashboard/public/css/app.css` | After 14 |
| 20 | TTS post-processing — after brain response, if input was audio AND TTS capability exists → call synthesize script → attach audio URL to response | `packages/dashboard/src/agent/chat-service.ts` | After 18, 19 |
| 21 | Add `audioUrl` field to response protocol — extend Turn/response message | `packages/dashboard/src/ws/protocol.ts` | After 13 |

### Model Indicator

| # | Task | Files | Parallel? |
|---|------|-------|-----------|
| 22 | Add model indicator to dashboard header — pill/badge showing "Sonnet" or "Opus". New UI element (none exists today) | `packages/dashboard/public/index.html`, `packages/dashboard/public/css/app.css` | Yes (with 13) |
| 23 | Broadcast model changes — `{ type: "model_changed", model: string }`. Sent when capability work starts/ends | `packages/dashboard/src/ws/protocol.ts`, `packages/dashboard/src/agent/session-manager.ts` | After 22 |

### Secrets API

| # | Task | Files | Parallel? |
|---|------|-------|-----------|
| 28 | Add secrets API endpoints — `GET /api/settings/secrets` (masked values, capability needs), `PUT /api/settings/secrets/:key`, `DELETE /api/settings/secrets/:key`. Block edit/delete of `ANTHROPIC_API_KEY` (read-only, managed by AI Connection) | `packages/dashboard/src/routes/settings.ts` | Yes (with 13) |
| 29 | Trigger capability re-scan on secret change — after PUT/DELETE, call `registry.rescan()` → emit `capability:changed` | `packages/dashboard/src/routes/settings.ts` | After 28 |

### Secrets UI

| # | Task | Files | Parallel? |
|---|------|-------|-----------|
| 30 | Add Secrets section to Settings — glass-strong card below "AI Connection". List keys with masked values (last 4 chars). Eye icon to reveal. [+ Add Key] button. `ANTHROPIC_API_KEY` shown as read-only | `packages/dashboard/public/index.html` | After 28 |
| 31 | Implement add/edit/delete flows — modal for adding key (name + value), inline edit for value, confirm dialog for delete | `packages/dashboard/public/js/app.js` | After 30 |
| 31b | Support key storage from chat — brain can write to `.env` via `setEnvValue()` when user pastes a key in chat (with confirmation). Triggers capability re-scan | `packages/dashboard/src/agent/chat-service.ts`, `packages/core/src/env.ts` | After 29 |

### Error Handling

| # | Task | Files | Parallel? |
|---|------|-------|-----------|
| 27-dash | Dashboard error handling for failed STT/TTS — if recording transcription fails, show error in chat. If TTS fails, show text response with error note | `packages/dashboard/src/agent/chat-service.ts` | After 17, 20 |

## Verification

- [ ] Record button appears when `stt-dummy` is present, disappears when removed
- [ ] Recording captures audio and sends to server
- [ ] Server calls transcribe script, brain receives transcribed text
- [ ] Audio player appears on responses when input was voice + TTS exists
- [ ] Model indicator shows "Sonnet" in header
- [ ] Settings → Secrets shows list of keys (masked)
- [ ] Can add, reveal, edit, delete secrets
- [ ] `ANTHROPIC_API_KEY` is read-only
- [ ] Adding a key triggers capability re-scan (unavailable → available)
- [ ] Failed transcription shows error in chat, not silent drop

## Deliverables

- Dashboard: record button, audio player, model indicator
- Settings: Secrets section (CRUD)
- Secrets API endpoints
- WebSocket: capabilities + model_changed message types
