# M9-S3: WhatsApp Voice + Skill Generation

> **Milestone:** M9 — Capability System
> **Design spec:** [capability-system.md](../../design/capability-system.md)
> **Implementation plan:** [2026-04-01-capability-system.md](../../plans/2026-04-01-capability-system.md)
> **Status:** Planned

---

## Goal

Voice works across WhatsApp (not just the dashboard). Nina can create capabilities herself via a brainstorming skill + builder agent.

## Prerequisites

- M9-S2 complete (dashboard voice UI, secrets management)

## Tasks

### WhatsApp Voice Integration

| # | Task | Files | Parallel? |
|---|------|-------|-----------|
| 24 | Handle incoming voice notes — detect `msg.message?.audioMessage`, download via `downloadMediaMessage()`, save to temp file. If `audio-to-text` available → call transcribe script → pass text to brain with `[Voice note]` prefix. If unavailable → pass `[Voice note received — no transcription capability configured]` | `plugins/channel-whatsapp/src/plugin.ts` | Yes (with 32) |
| 25 | Add `onAudioMessage` callback to plugin config — keep plugin decoupled from capability registry. Dashboard wires the callback to the registry at init | `plugins/channel-whatsapp/src/plugin.ts`, `packages/core/src/types.ts` | After 24 |
| 26 | Send voice replies — if input was audio AND `text-to-audio` available → call synthesize script → send via `sock.sendMessage(to, { audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true })` | `plugins/channel-whatsapp/src/plugin.ts` | After 25 |
| 27 | Error handling for failed transcription/synthesis — pass error context to brain as text: `[Voice note — transcription failed: <reason>]`. Never silently drop | `plugins/channel-whatsapp/src/plugin.ts` | After 24 |

### Capability Builder Agent

| # | Task | Files | Parallel? |
|---|------|-------|-----------|
| 32 | Define capability-builder `AgentDefinition` — `model: "opus"`, `tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]`. Prompt includes: directory conventions, CAPABILITY.md format (keep under 2k words, use `references/` for detailed docs), script I/O contracts, `config.yaml` conventions (non-secret config — model name, voice ID, output format; scripts read via relative path), testing instructions (create test input, run script, validate output JSON, verify exit code — all generic, no provider-specific hints), trust model constraints (autonomous for file writes, ask before `install.sh`, ask before deleting capability folders), 3-attempt escalation limit. **Critical: the prompt must contain only generic process instructions, never provider-specific knowledge. Opus researches providers on its own.** | `packages/core/src/agents/definitions.ts` | Yes (with 24) |
| 33 | Wire builder agent into brain — add to `agents` map so brain can spawn via Task tool | `packages/core/src/brain.ts` or `packages/dashboard/src/agent/session-manager.ts` | After 32 |

### Brainstorming Skill

| # | Task | Files | Parallel? |
|---|------|-------|-----------|
| 34 | Write capability-brainstorming SKILL.md — triggered when user asks for new capability. Instructions: research options, ask clarifying questions, pick approach, produce spec, spawn builder agent. Model hint: Opus | `.my_agent/.claude/skills/capability-brainstorming/SKILL.md` | After 32 |
| 35 | Add reference material — voice evaluation findings (Deepgram Nova-2, faster-whisper, Kokoro, ElevenLabs). Well-known capability types reference. CAPABILITY.md template. `config.yaml` conventions | `.my_agent/.claude/skills/capability-brainstorming/references/` | After 34 |

### Model Switch UX

| # | Task | Files | Parallel? |
|---|------|-------|-----------|
| 36 | Send visible model-switch messages — inject chat message "Switching to Opus for capability work" when brainstorming/building starts. "Back to Sonnet" on completion | `packages/dashboard/src/agent/chat-service.ts` | After 33 |
| 37 | Broadcast model change to dashboard — emit `model_changed` WebSocket message when spawning Opus subagent and when it completes | `packages/dashboard/src/agent/session-manager.ts` | After 36 |

## Verification

- [ ] Send voice note on WhatsApp → gets transcribed → brain receives text with `[Voice note]` prefix
- [ ] Brain responds → response synthesized → sent as PTT voice note on WhatsApp
- [ ] Voice note with unavailable STT → brain gets `[Voice note received — no transcription capability configured]`
- [ ] Failed transcription → error passed to brain, not dropped
- [ ] Capability builder agent can be spawned by brain
- [ ] Brainstorming skill activates when user asks for new capability
- [ ] Model indicator updates to "Opus" during capability work
- [ ] Chat shows "Switching to Opus" and "Back to Sonnet" messages
- [ ] Builder agent writes valid CAPABILITY.md + scripts + config.yaml
- [ ] Builder agent tests scripts and fixes errors autonomously
- [ ] Builder agent asks before running install.sh

## Traceability Matrix

| Design Spec Section | Requirement | Task(s) |
|---------------------|-------------|---------|
| Framework Reactions > Channels | Voice notes transcribed (audio-to-text) | 24, 25 |
| Framework Reactions > Channels | Voice replies when input was audio (text-to-audio) | 26 |
| Error Handling | Don't silently drop failed scripts | 27 |
| Error Handling | Pass failure context to brain as text | 27 |
| Medium Mirroring | Audio in → audio out (channel-level) | 26 |
| Skill Generation > Skill 2 | AgentDefinition with model: opus | 32 |
| Skill Generation > Skill 2 | Tools: Read, Write, Edit, Bash, Glob, Grep | 32 |
| Skill Generation > Skill 2 | Spawned by brain via Task tool | 33 |
| Skill Generation > Skill 2 | Subagent avoids mid-session model switch | 32 |
| Skill Generation > Skill 1 | Brainstorming skill in .my_agent/.claude/skills/ | 34 |
| Skill Generation > Skill 1 | Triggered on new capability request | 34 |
| Skill Generation > Skill 1 | Prior art reference material | 35 |
| Trust Model | Autonomous for file writes | 32 |
| Trust Model | Ask before install.sh | 32 |
| Trust Model | Ask before deleting capability | 32 |
| Escalation Contract | Fix bugs autonomously | 32 |
| Escalation Contract | Escalate for auth errors, signup, 3-attempt limit | 32 |
| Model Switching | Visible "Switching to Opus" message | 36 |
| Model Switching | Visible "Back to Sonnet" message | 36 |
| Model Switching | Broadcast model_changed | 37 |
| CAPABILITY.md Format | Keep under 2k words, use references/ | 32 |
| Directory Convention | config.yaml conventions | 32, 35 |

## Deliverables

- WhatsApp: voice note transcription + voice replies
- `capability-builder` agent definition (Opus)
- `capability-brainstorming` skill + references
- Model switch UX (chat messages + status bar)
