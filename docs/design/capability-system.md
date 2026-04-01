# Capability System — Design Spec

> **Status:** Draft
> **Created:** 2026-04-01
> **Scope:** Extensibility architecture for self-extending agent capabilities
> **Roadmap:** This is milestone-level scope. Requires a new milestone entry in `docs/ROADMAP.md`.

---

## Problem

Different users have different machines, preferences, and needs. One user wants local voice recognition on a GPU server. Another wants a cloud API on a weak VPS. A third wants image generation. A fourth wants a custom tool for their internal systems.

The framework can't ship every integration. Instead, the agent itself should be able to research, propose, build, and install new capabilities — using Claude's coding ability. The framework provides the conventions and discovery mechanism. The agent does the rest.

## Principles

1. **Capabilities are files, not code registrations.** Drop a folder in the right place, it gets discovered. Delete it, it's gone.
2. **The agent builds its own skills.** The framework provides conventions simple enough that an Opus-powered agent can author a working capability from scratch.
3. **The framework reacts to capability presence.** UI elements, channel behaviors, and brain awareness adapt automatically based on what's installed.
4. **Markdown is source of truth.** Consistent with the rest of the project.
5. **Secrets are centralized.** API keys live in `.env`, managed via Settings UI. Capabilities declare what they need, they don't store keys themselves.
6. **The registry is the contract.** Capabilities exist if and only if they are discovered in the registry. The UI, channels, and brain all query the same registry. No other registration mechanism exists.
7. **Scripts are the universal adapter.** A shell script can wrap anything: a cloud REST API, a local binary, a Python library, an MCP server. This is why `interface: script` is sufficient for most capabilities — the script is the integration layer.

---

## Capability Registry

### Directory Convention

```
.my_agent/capabilities/
  stt-deepgram/
    CAPABILITY.md          # required — identity + instructions
    scripts/
      transcribe.sh        # the actual tool
      install.sh           # optional — setup steps
    config.yaml            # optional — settings the scripts read
  tts-kokoro/
    CAPABILITY.md
    scripts/
      synthesize.sh
      install.sh
    config.yaml
```

Each capability is one folder, one level deep. No nesting.

Capabilities MAY include a `references/` directory for detailed documentation. Keep CAPABILITY.md under 2k words; move detailed API docs, error codes, and examples to reference files. The brain loads these on-demand when the CAPABILITY.md body references them.

The building worker writes `config.yaml` during capability creation, based on user preferences discovered during brainstorming. Scripts read `config.yaml` at execution time for non-secret configuration (e.g., model name, voice ID, output format). The agent can modify `config.yaml` later if the user wants to change settings.

### CAPABILITY.md Format

```yaml
---
name: Deepgram STT
provides: audio-to-text
interface: script
requires:
  env:
    - DEEPGRAM_API_KEY
---

Transcribes audio files to text using Deepgram Nova-2 API.

## transcribe

- **Input:** `scripts/transcribe.sh <audio-file-path>`
- **Output:** JSON `{ "text": "transcribed text" }`
```

**Frontmatter fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Human-readable name |
| `provides` | No | Well-known capability type (see below). Omit for custom capabilities. |
| `interface` | Yes | `script` or `mcp` (see Interface Types below) |
| `requires.env` | No | Environment variables that must exist in `.env` for the capability to work |

**Body:** Free-form instructions for the brain. Describes how to call scripts, what input/output to expect, edge cases. Loaded into context when the brain uses the capability.

### Interface Types

**`interface: script`** — the capability exposes shell scripts. Scripts can wrap anything: `curl` to a cloud API, a local binary like `faster-whisper`, a Python library, or even an MCP client call. The script is the universal adapter layer.

**`interface: mcp`** — the capability wraps an MCP server. Two sub-patterns:

1. **Lifecycle wrapper** — the capability folder contains scripts that manage an MCP server's lifecycle (`scripts/start.sh`, `scripts/stop.sh`) and the framework calls them. The MCP server is an implementation detail managed by the capability.
2. **Direct passthrough** — the capability folder contains a `.mcp.json` file. The framework registers it directly with the Agent SDK. No scripts needed — the tools come from the MCP protocol. In `.mcp.json`, `${CAPABILITY_ROOT}` is expanded to the capability's absolute path. Variables from `requires.env` are automatically passed to MCP servers via the `env` field.

The framework detects which sub-pattern by checking: if `.mcp.json` exists in the capability folder, use direct passthrough. Otherwise, expect lifecycle scripts.

**Activation timing:** Script-interface capabilities take effect immediately (brain uses Bash tool). MCP-interface capabilities are added to the shared MCP server pool and take effect on the next user message (SDK limitation — MCP servers can't be added mid-query).

**Who calls the scripts:**
- **Well-known capabilities** (`provides` matches a known type) — the framework calls scripts directly from channel/dashboard code. The brain doesn't need to invoke them manually. Example: a voice note arrives on WhatsApp → the channel code calls `transcribe.sh` automatically.
- **Custom capabilities** (no `provides` or unknown type) — the brain calls scripts via the Bash tool, guided by the CAPABILITY.md instructions.

### Discovery

1. On startup, scan `.my_agent/capabilities/*/CAPABILITY.md`
2. Read frontmatter, build in-memory registry map
3. Check `requires.env` against `.env` — mark capability as `available` or `unavailable` (with reason)
4. Emit `capability_changed` event so dashboard and channels can react
5. File watcher on the directory — re-scan when folders are added or removed

### Registry API

```typescript
// In-memory after scan
interface Capability {
  name: string
  provides?: string        // well-known type or undefined
  interface: 'script' | 'mcp'
  path: string             // absolute path to capability folder
  status: 'available' | 'unavailable'
  unavailableReason?: string  // e.g. "missing DEEPGRAM_API_KEY"
}

// Query
capabilities.has('audio-to-text')    // boolean
capabilities.get('audio-to-text')    // Capability | undefined
capabilities.list()                  // Capability[]
```

---

## Well-Known Capability Types

These are capability types the framework knows how to react to. The list grows over time as new framework reactions are built.

| Type | What It Does | UI Reaction | Channel Reaction |
|------|-------------|-------------|-----------------|
| `audio-to-text` | Converts audio files to text (STT) | Record button appears on chat input | Voice notes get transcribed before passing to brain |
| `text-to-audio` | Converts text to audio files (TTS) | Audio player on agent responses | Sends voice note replies when input was voice |
| `text-to-image` | Generates images from text | Image rendered inline in chat | Sends image via channel |

**Note:** `image-to-text` (OCR/vision) is NOT a capability — it's built into Claude natively.

Custom capabilities (no `provides:` or unknown type) have no framework reactions. The brain reads the CAPABILITY.md and uses them directly via scripts.

### Error Handling for Well-Known Capabilities

When the framework calls a well-known capability script (e.g., STT on an incoming voice note) and it fails:

1. Don't silently drop the message.
2. Pass the failure context to the brain as text: `"[Voice note received — transcription failed: <stderr output>]"`
3. The brain can then tell the user what happened and offer to fix the capability.

This applies only to framework-called scripts. Brain-called scripts (custom capabilities via Bash) already return errors naturally through the Bash tool.

### Medium Mirroring

When `text-to-audio` is available: if the user sent audio, respond with audio. This is a channel-level behavior, not a brain decision. The brain always outputs text. The channel wraps it.

```
audio in → [audio-to-text capability] → text → brain → text → [text-to-audio capability] → audio out
```

---

## Framework Reactions

### Dashboard

The dashboard receives the capability list over WebSocket on connect.

| Capability Present | UI Change |
|-------------------|-----------|
| `audio-to-text` | Record button appears on chat input bar |
| `text-to-audio` | Audio player widget on agent responses (when input was voice) |
| `text-to-image` | Images rendered inline in chat messages |

Components gate on `capabilities.has('audio-to-text')` — the code is always there, just hidden until the capability exists.

**WebSocket protocol:** A new `capabilities` message type broadcasts the capability list to all connected clients on connect and on `capability_changed` events. Format: `{ type: "capabilities", data: Capability[] }`.

**Model indicator:** The dashboard header/status area shows the active model (e.g., "Sonnet" or "Opus"). Updates via WebSocket when the model changes for capability work. This is a new UI element — no model indicator exists today.

### Channels (WhatsApp, etc.)

| Capability Present | Channel Change |
|-------------------|---------------|
| `audio-to-text` | Voice notes transcribed automatically, text passed to brain |
| `text-to-audio` | If input was audio, response synthesized and sent as voice note |

### Brain Prompt

Available capabilities are injected into the system prompt:

```
You have the following capabilities available:
- audio-to-text (Deepgram STT) [available]: transcribe audio files
- text-to-audio (Kokoro TTS) [unavailable: missing KOKORO_PATH]: synthesize speech
```

The brain sees both available and unavailable capabilities, so it can tell the user what's possible and what needs configuration.

---

## Secrets Management

### Current State

`packages/dashboard/.env` holds `ANTHROPIC_API_KEY`. Loaded via `--env-file=.env` in the systemd service.

### Extension

All capability secrets go in the same `.env` file. Capabilities declare what they need via `requires.env`. The registry checks presence on scan.

### Settings UI

Settings gets a "Secrets" section:

```
┌─ Settings ──────────────────────────┐
│                                     │
│  AI Connection                      │
│  ● Connected          [Disconnect]  │
│                                     │
│  Secrets                            │
│  DEEPGRAM_API_KEY     ••••••dk92    │
│  ELEVENLABS_API_KEY   ••••••xf31    │
│                       [+ Add Key]   │
│                                     │
└─────────────────────────────────────┘
```

- Values masked by default, reveal on click
- Stored in `.env` (same file as `ANTHROPIC_API_KEY`)
- `ANTHROPIC_API_KEY` appears as read-only in Secrets (managed by "AI Connection" section, not editable here)
- Nina can direct user: "Go to Settings → Secrets and add your Deepgram key"
- Nina can also write to `.env` programmatically if user pastes key in chat (with confirmation)
- When the credential vault lands (M12), the UI stays the same, backend swaps to encrypted storage

### Flow When Key Is Missing

```
Registry scans → DEEPGRAM_API_KEY missing → capability marked "unavailable"
Brain sees: "STT capability unavailable: missing DEEPGRAM_API_KEY"
Brain to user: "Voice transcription is set up but needs a Deepgram API key.
               You can add it in Settings → Secrets (recommended, more secure),
               or paste it here and I'll store it for you."
User provides key → written to .env → Secrets API triggers registry re-scan → capability becomes available
```

**Note:** The file watcher watches `.my_agent/capabilities/`, not `.env`. When a secret is added via the Settings API or chat, the API endpoint explicitly triggers a capability re-scan. This is cleaner than watching `.env`.

---

## Skill Generation

Two skills work together to let the agent create capabilities.

### Skill 1: Capability Brainstorming (Brain)

A brain-level skill in `.my_agent/.claude/skills/capability-brainstorming/`.

**Triggered when:** User asks for a new capability ("I want you to understand voice messages", "can you generate images?", "I need you to access my calendar").

**What it does:**
- Researches available options (cloud vs local, providers, trade-offs)
- Asks clarifying questions (budget, privacy, latency preferences)
- Picks an approach
- Produces a spec for the builder

**Model:** Opus (auto-switches, see Model Switching below).

**Prior art:** STT/TTS engine evaluation was conducted during this design phase (2026-04-01). Key findings: Deepgram Nova-2 is the best cloud STT ($0.0043/min, 1-2s latency), faster-whisper is the best local STT (small model, 3-5s on CPU). Kokoro 82M is the best local TTS (near-cloud quality on CPU), ElevenLabs is the best cloud TTS. The brainstorming skill should be able to conduct similar evaluations for any capability domain — these findings serve as a reference for voice specifically.

### Skill 2: Capability Building (Worker)

Defined as an `AgentDefinition` with `model: "opus"` and tools: `["Read", "Write", "Edit", "Bash", "Glob", "Grep"]`. Spawned by the brain via the Task tool. Using a subagent avoids switching the brain's model mid-session (which would discard conversation context).

**Receives:** Spec from brainstorming ("create an STT capability using Deepgram Nova-2, cloud API").

**What it does:**
- Writes `CAPABILITY.md`, scripts, config
- Installs dependencies if needed (with permission)
- Tests the scripts (runs them, checks output format)
- Fixes errors autonomously
- Escalates only for user-required actions

**Model:** Opus (set on the `AgentDefinition`, independent of the brain's model).

**Escalation contract:**

| Situation | Action |
|-----------|--------|
| Script has a bug | Fix it |
| Missing system binary | Install it |
| API returns auth error | Escalate: "key doesn't work" |
| API requires signup/payment | Escalate: "you need an account" |
| Failed after 3 attempts | Escalate to brain with findings |

---

## Trust Model

When the agent extends itself, different actions carry different risk levels.

| Action | Trust Level | Rationale |
|--------|------------|-----------|
| Write/modify CAPABILITY.md | Autonomous | It's just metadata and instructions |
| Write/modify scripts in capability folder | Autonomous | Contained to the capability directory |
| Write/modify config.yaml | Autonomous | Instance-specific settings |
| Run `install.sh` (pip install, npm install, etc.) | **Ask first** — show what will be installed | System-level changes, potential security impact |
| Use a configured capability (call scripts) | Autonomous | Already approved by being installed |
| Delete a capability folder | **Ask first** | Destructive, may lose configuration |

The building worker operates within these boundaries. It can author files freely but must get permission before running install scripts or removing capabilities.

---

## Model Switching

Capability brainstorming and building require Opus. The system communicates model changes to the user.

**When activating Opus:**
- Send a visible message in chat: "Switching to Opus for capability work"
- Dashboard status bar updates to show current model

**When returning to default model:**
- Send a visible message: "Back to Sonnet"
- Dashboard status bar updates

**Policy:**
- Capability brainstorming → Opus
- Capability building (worker) → Opus
- Using an existing capability (calling a script) → default model (Sonnet)

---

## Implementation & Validation Strategy

The implementation uses voice (STT/TTS) as the proving ground for the entire capability system.

### Phase 1: Dummy Capabilities

Create dummy `audio-to-text` and `text-to-audio` capabilities:
- STT dummy: always returns the same hardcoded string
- TTS dummy: always returns the same audio file

**Validates:** Registry discovery, availability checking, CAPABILITY.md parsing.

### Phase 2: Wire Dashboard & Channels

- Dashboard shows record button when `audio-to-text` is present
- Dashboard shows audio player when `text-to-audio` is present
- WhatsApp channel transcribes voice notes when `audio-to-text` is present
- WhatsApp channel sends voice replies when `text-to-audio` is present and input was audio

**Validates:** Framework reactions work end-to-end with dummy data.

### Phase 3: Skill Generation System

Build the two skills (brainstorming + building) that let Nina create capabilities.

**Validates:** The conventions are documented well enough for the skills to work.

### Phase 4: The Real Test

1. Delete the dummy STT capability
2. Ask Nina to create a real one
3. Iterate until she can reliably produce a working `audio-to-text` capability end-to-end
4. Repeat for `text-to-audio`

**Validates:** The entire system works — an agent can self-extend, and the framework reacts correctly.

### Phase 5: Secrets UI

Add the Secrets section to Settings.

---

## Non-Goals

- **No marketplace / sharing system.** Sharing is a security nightmare — we can't trust that users will create safe, reusable components. Capabilities live in the instance. If someone wants to share, they copy the folder. If it breaks on the receiving end, the receiving agent can read the errors and fix it. This is a deliberate rejection, not a "not yet."
- **No resource management.** The agent figures out what works on the machine during brainstorming.
- **No capability-type framework code.** The framework doesn't know about "voice" or "images" specifically — it knows about well-known capability types and reacts generically.
- **No encrypted vault yet.** `.env` is the interim secret store. Vault is M12.

---

## Open Questions

1. ~~**MCP interface capabilities**~~ — Resolved. See Interface Types section: direct passthrough (`.mcp.json` exists) or lifecycle wrapper (scripts manage the server).
2. **Capability versioning** — do we need it? Probably not for instance-only capabilities.
3. **Capability dependencies** — can one capability depend on another? (e.g., a voice-chat capability that needs both STT and TTS). Probably handle this in the brainstorming skill rather than the registry.
4. **Capability-provided hooks** — should capabilities be able to provide hooks (e.g., a PostToolUse hook that auto-synthesizes audio)? For now, well-known capability types handle the common cases via framework reactions. Custom hook integration deferred until a concrete need arises beyond well-known types.
