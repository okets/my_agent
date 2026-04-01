# Capability System — Implementation Plan

> **Design spec:** `docs/design/capability-system.md`
> **Created:** 2026-04-01
> **Scope:** M9: Capability System (4 sprints, ~49 tasks)

---

## Phase 1: Capability Registry & Dummy Capabilities

**Goal:** Framework discovers capabilities from `.my_agent/capabilities/` and makes them queryable.

### S1.1 — Registry Core

| # | Task | Files | Details |
|---|------|-------|---------|
| 1 | Create `Capability` type and `CapabilityRegistry` class | `packages/core/src/capabilities/types.ts`, `packages/core/src/capabilities/registry.ts` | Type from spec (name, provides, interface, path, status, unavailableReason). Registry: `scan()`, `has()`, `get()`, `list()`, `rescan()` |
| 2 | Create `CapabilityScanner` | `packages/core/src/capabilities/scanner.ts` | Scans `.my_agent/capabilities/*/CAPABILITY.md`, parses YAML frontmatter via `readFrontmatter()`, checks `requires.env` against `process.env`, returns `Capability[]` |
| 3 | Unify `.env` path resolution | `packages/core/src/env.ts` | Add `resolveEnvPath()` — currently hardcoded in multiple places (hatching `auth.ts`, dashboard `server.ts`). All consumers should use this single function |
| 4 | Add `capability:changed` event | `packages/dashboard/src/app-events.ts` | New event in `AppEventMap`: `"capability:changed": [capabilities: Capability[]]` |
| 5 | Wire FileWatcher for capabilities | `packages/dashboard/src/index.ts` | Reuse existing `FileWatcher` from `packages/core/src/sync/file-watcher.ts`. Watch `.my_agent/capabilities/`, pattern `**/CAPABILITY.md`, long poll interval (5s). On change → `registry.rescan()` → emit `capability:changed` |
| 6 | Wire registry into App initialization | `packages/dashboard/src/index.ts`, `packages/dashboard/src/app.ts` | Scan capabilities at startup, before MCP server init. For `interface: mcp` capabilities: if `.mcp.json` exists → direct passthrough (register with SDK via `addMcpServer()`). If no `.mcp.json` → lifecycle wrapper (call `scripts/start.sh` to start the server, `scripts/stop.sh` on shutdown). Note: MCP capabilities added mid-session take effect on the next user message (SDK limitation — MCP servers can't be added mid-query). Script capabilities take effect immediately |
| 7 | `${CAPABILITY_ROOT}` expansion | `packages/core/src/capabilities/scanner.ts` | When reading `.mcp.json` from a capability folder, replace `${CAPABILITY_ROOT}` with absolute path. Pass `requires.env` vars to the MCP server's `env` field |

### S1.2 — Dummy Capabilities

| # | Task | Files | Details |
|---|------|-------|---------|
| 8 | Create dummy STT capability | `.my_agent/capabilities/stt-dummy/CAPABILITY.md`, `.my_agent/capabilities/stt-dummy/scripts/transcribe.sh` | `provides: audio-to-text`, `interface: script`. Script always returns `{ "text": "This is a dummy transcription for testing." }` |
| 9 | Create dummy TTS capability | `.my_agent/capabilities/tts-dummy/CAPABILITY.md`, `.my_agent/capabilities/tts-dummy/scripts/synthesize.sh`, `.my_agent/capabilities/tts-dummy/assets/dummy.ogg` | `provides: text-to-audio`, `interface: script`. Script always copies `assets/dummy.ogg` to output path |
| 10 | Verify registry discovers dummies | Manual test | Start app, check logs, confirm both capabilities show as `available` |

### S1.3 — System Prompt Integration

| # | Task | Files | Details |
|---|------|-------|---------|
| 11 | Add `loadCapabilityHints()` to prompt assembly | `packages/core/src/prompt.ts` | Reads from registry, formats as "You have the following capabilities available:" block. Include both available and unavailable with reasons |
| 12 | Invalidate prompt cache on capability change | `packages/dashboard/src/agent/system-prompt-builder.ts` | Listen to `capability:changed` event → call `invalidateCache()` |
| 12b | Load capability body + references on use | `packages/core/src/capabilities/registry.ts` | `getContent(type)` reads full CAPABILITY.md body. `getReference(type, filename)` reads from `references/` subdirectory. Brain calls these when using a capability. Framework calls `getContent()` for well-known types to get script paths |

---

## Phase 2: Dashboard & Channel Reactions

**Goal:** UI and channels adapt to capability presence.

### S2.1 — WebSocket Protocol

| # | Task | Files | Details |
|---|------|-------|---------|
| 13 | Add `capabilities` message type | `packages/dashboard/src/ws/protocol.ts` | New `ServerMessage` variant: `{ type: "capabilities", data: Capability[] }` |
| 14 | Broadcast capabilities on connect | `packages/dashboard/src/state/state-publisher.ts` | On WebSocket connect, send current capability list. On `capability:changed`, broadcast update |

**Note on `text-to-image`:** The spec lists `text-to-image` as a well-known type. Dashboard image rendering and WhatsApp image sending already exist from M8-S4 (Rich I/O). The framework reaction is: when brain generates an image via capability script → use existing image rendering pipeline. No new UI work needed — just capability registry gating. This is validated when a user creates an image-gen capability (future, not in S4 scope).

### S2.2 — Dashboard Record Button (audio-to-text)

| # | Task | Files | Details |
|---|------|-------|---------|
| 15 | Add microphone button to desktop compose bar | `packages/dashboard/public/index.html` | Next to send button. Hidden unless `capabilities.has('audio-to-text')`. Both desktop (~line 5734) and mobile (~line 8523) compose bars |
| 16 | Implement MediaRecorder integration | `packages/dashboard/public/js/app.js` | Capture audio via MediaRecorder API. On stop, send as attachment via WebSocket (reuse existing attachment system) |
| 17 | Handle audio attachment on server | `packages/dashboard/src/ws/` | Detect audio attachment → call STT capability script → pass transcribed text to brain. Include `[Voice message]` prefix so brain knows input was audio |
| 18 | Track input medium per message | `packages/dashboard/src/agent/chat-service.ts` | Flag on the message: `inputMedium: 'text' | 'audio'`. Used for medium mirroring |

### S2.3 — Dashboard Audio Playback (text-to-audio)

| # | Task | Files | Details |
|---|------|-------|---------|
| 19 | Add audio player component to message rendering | `packages/dashboard/public/index.html`, `packages/dashboard/public/css/app.css` | Inline `<audio>` player on agent responses when input was voice and `text-to-audio` is available |
| 20 | TTS post-processing in chat service | `packages/dashboard/src/agent/chat-service.ts` | After brain response completes, if input was audio AND `text-to-audio` capability exists → call synthesize script → attach audio URL to response |
| 21 | Add `audioUrl` field to response protocol | `packages/dashboard/src/ws/protocol.ts` | Extend Turn/response message to include optional `audioUrl` |

### S2.4 — Dashboard Model Indicator

| # | Task | Files | Details |
|---|------|-------|---------|
| 22 | Add model indicator to dashboard header | `packages/dashboard/public/index.html`, `packages/dashboard/public/css/app.css` | Small pill/badge showing "Sonnet" or "Opus" in the status area. Updates via WebSocket |
| 23 | Broadcast model changes | `packages/dashboard/src/ws/protocol.ts`, `packages/dashboard/src/agent/session-manager.ts` | New message: `{ type: "model_changed", model: string }`. Sent when capability work starts/ends |

### S2.5 — WhatsApp Voice Integration

| # | Task | Files | Details |
|---|------|-------|---------|
| 24 | Handle incoming voice notes | `plugins/channel-whatsapp/src/plugin.ts` | Detect `msg.message?.audioMessage`, download via `downloadMediaMessage()`, save to temp file. If `audio-to-text` capability available → call transcribe script → pass text to brain with `[Voice note]` prefix. If unavailable → pass `[Voice note received — no transcription capability configured]` |
| 25 | Add `onAudioMessage` callback to plugin config | `plugins/channel-whatsapp/src/plugin.ts`, `packages/core/src/types.ts` | Keep plugin decoupled from capability registry. Dashboard wires the callback to the registry at init |
| 26 | Send voice replies | `plugins/channel-whatsapp/src/plugin.ts` | If input was audio AND `text-to-audio` available → call synthesize script → send via `sock.sendMessage(to, { audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true })` |
| 27 | Error handling for failed transcription/synthesis | `plugins/channel-whatsapp/src/plugin.ts`, `packages/dashboard/src/agent/chat-service.ts` | On script failure in any channel (WhatsApp or dashboard), pass error context to brain as text: `[Voice note — transcription failed: <reason>]` or `[TTS failed: <reason>]`. Don't silently drop. Dashboard: show error in chat if recording transcription fails. WhatsApp: pass error text to brain |

---

## Phase 3: Secrets Management

**Goal:** Users can manage API keys via the dashboard Settings UI.

### S3.1 — Settings API

| # | Task | Files | Details |
|---|------|-------|---------|
| 28 | Add secrets API endpoints | `packages/dashboard/src/routes/settings.ts` | `GET /api/settings/secrets` — list all keys (masked values, last 4 chars visible). Show which capabilities need each key. `PUT /api/settings/secrets/:key` — set a secret (writes to `.env`). `DELETE /api/settings/secrets/:key` — remove a secret. Block edit/delete of `ANTHROPIC_API_KEY` (managed by AI Connection) |
| 29 | Trigger capability re-scan on secret change | `packages/dashboard/src/routes/settings.ts` | After PUT/DELETE, call `registry.rescan()` → emit `capability:changed`. This is how adding a key makes a capability go from `unavailable` → `available` |

### S3.2 — Settings UI

| # | Task | Files | Details |
|---|------|-------|---------|
| 30 | Add Secrets section to Settings panel | `packages/dashboard/public/index.html` | Glass-strong card below "AI Connection". List keys with masked values (••••••dk92). Eye icon to reveal. [+ Add Key] button. `ANTHROPIC_API_KEY` shown as read-only |
| 31 | Implement add/edit/delete flows | `packages/dashboard/public/js/app.js` | Modal for adding key (name + value inputs). Inline edit for value. Confirm dialog for delete. Call secrets API endpoints |
| 31b | Support key storage from chat | `packages/dashboard/src/agent/chat-service.ts`, `packages/core/src/env.ts` | When brain detects user pasting an API key in chat, it can call a `store_secret` MCP tool (or use Bash to call `setEnvValue()`). The tool writes to `.env` with confirmation message. Triggers capability re-scan |

---

## Phase 4: Skill Generation System

**Goal:** Nina can create capabilities through conversation.

### S4.1 — Capability Builder Agent

| # | Task | Files | Details |
|---|------|-------|---------|
| 32 | Define capability-builder `AgentDefinition` | `packages/core/src/agents/definitions.ts` | `model: "opus"`, `tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]`, prompt includes: directory conventions, CAPABILITY.md format (keep under 2k words, use `references/` for detailed docs), script I/O contracts, `config.yaml` conventions (non-secret config like model name, voice ID; scripts read via relative path), testing instructions, trust model constraints (autonomous for file writes, ask before install.sh, ask before deleting capability folders), 3-attempt escalation limit |
| 33 | Wire builder agent into brain | `packages/core/src/brain.ts` or `packages/dashboard/src/agent/session-manager.ts` | Add to `agents` map so brain can spawn via Task tool |

### S4.2 — Brainstorming Skill

| # | Task | Files | Details |
|---|------|-------|---------|
| 34 | Write capability-brainstorming SKILL.md | `.my_agent/.claude/skills/capability-brainstorming/SKILL.md` | Triggered when user asks for new capability. Instructions: research options, ask clarifying questions, pick approach, produce spec, spawn builder agent. Model hint: Opus |
| 35 | Add reference material | `.my_agent/.claude/skills/capability-brainstorming/references/` | Voice evaluation findings (from this session). Well-known capability types reference. CAPABILITY.md template |

### S4.3 — Model Switch UX

| # | Task | Files | Details |
|---|------|-------|---------|
| 36 | Send visible model-switch messages | `packages/dashboard/src/agent/chat-service.ts` | When capability brainstorming/building starts: inject system message "Switching to Opus for capability work". On completion: "Back to Sonnet". These are chat messages, not just status bar updates |
| 37 | Broadcast model change to dashboard | `packages/dashboard/src/agent/session-manager.ts` | Emit `model_changed` WebSocket message when spawning Opus subagent and when it completes |

---

## Phase 5: The Real Test

**Goal:** Delete dummy capabilities, have Nina create real ones end-to-end.

| # | Task | Files | Details |
|---|------|-------|---------|
| 38 | Delete dummy STT | Manual | Remove `.my_agent/capabilities/stt-dummy/`. Verify: record button disappears, WhatsApp stops transcribing |
| 39 | Ask Nina to create STT | Conversation | "I want you to understand voice messages." Nina brainstorms, picks provider, spawns builder, creates capability. Iterate until it works |
| 40 | Verify STT end-to-end | Manual | Send voice note on WhatsApp → gets transcribed. Record audio in dashboard → gets transcribed. Brain responds to transcribed text |
| 41 | Ask Nina to create TTS | Conversation | "I want you to respond with voice." Same flow. Iterate until it works |
| 42 | Verify TTS end-to-end | Manual | Send voice note → get voice response on WhatsApp. Record in dashboard → get audio playback |
| 43 | Verify medium mirroring | Manual | Text message → text response. Voice message → voice response. Mixed → follows input medium |

---

## Phase 6: Roadmap & Migration

**Goal:** Integrate this milestone into the project roadmap.

| # | Task | Files | Details |
|---|------|-------|---------|
| 44 | ~~Add milestone to ROADMAP.md~~ | `docs/ROADMAP.md` | **Done** — M9 added to roadmap during design phase |
| 45 | Migrate existing Anthropic key management | `packages/core/src/hatching/steps/auth.ts`, `packages/dashboard/src/server.ts` | Unify `.env` path using `resolveEnvPath()` from task 3. Hatching continues to write `ANTHROPIC_API_KEY` to `.env` as before — no functional change, just path unification |
| 46 | Update CLAUDE.md | `CLAUDE.md` | Add capabilities section: directory convention, well-known types, how to add capabilities, config.yaml conventions |

---

## Dependencies & Ordering

```
Phase 1 (Registry + Dummies)
  ├── S1.1 (Registry Core) ← no dependencies
  ├── S1.2 (Dummies) ← depends on S1.1
  └── S1.3 (Prompt) ← depends on S1.1

Phase 2 (UI + Channels) ← depends on Phase 1
  ├── S2.1 (WebSocket) ← depends on S1.1
  ├── S2.2 (Record button) ← depends on S2.1
  ├── S2.3 (Audio playback) ← depends on S2.1, S2.2
  ├── S2.4 (Model indicator) ← independent, can parallel with S2.2
  └── S2.5 (WhatsApp) ← depends on S1.1, can parallel with S2.2

Phase 3 (Secrets) ← can parallel with Phase 2
  ├── S3.1 (API) ← depends on S1.1 (re-scan trigger)
  └── S3.2 (UI) ← depends on S3.1

Phase 4 (Skill Gen) ← depends on Phase 1
  ├── S4.1 (Builder agent) ← depends on S1.1 (needs conventions)
  ├── S4.2 (Brainstorming skill) ← depends on S4.1
  └── S4.3 (Model switch UX) ← depends on S2.4

Phase 5 (Real test) ← depends on Phase 1-4
Phase 6 (Roadmap) ← can start anytime, finish after Phase 5
```

## Sprint Mapping (suggested)

| Sprint | Phases | Focus |
|--------|--------|-------|
| S1 | Phase 1 | Registry + dummies + prompt integration |
| S2 | Phase 2 (S2.1-S2.3) + Phase 3 | Dashboard voice UI + secrets management |
| S3 | Phase 2 (S2.4-S2.5) + Phase 4 | WhatsApp voice + model indicator + skill generation |
| S4 | Phase 5 + Phase 6 | Real test + roadmap integration |

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| MediaRecorder API browser compatibility | Record button may not work on all browsers | Test on Chrome/Firefox, degrade gracefully |
| Opus subagent cost | Capability building uses expensive model | Building is infrequent — cost per capability creation is low |
| WhatsApp audio format complexity | OGG/OPUS codecs may need conversion for STT providers | Most STT APIs accept OGG natively. If not, `ffmpeg` converts |
| File watcher CPU on VPS | Polling adds overhead | Long interval (5s), capabilities change rarely |
| Agent-authored scripts may have bugs | Nina's first attempts at scripts may fail | Builder agent has 3-attempt retry with self-debugging. This IS the test |
