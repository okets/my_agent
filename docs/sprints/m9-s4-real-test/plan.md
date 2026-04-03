# M9-S4: Capability Templates + The Real Test (Revised)

> **Milestone:** M9 — Capability System
> **Design spec:** [capability-system.md](../../design/capability-system.md)
> **Templates proposal:** [capability-templates-proposal.md](../../design/capability-templates-proposal.md)
> **Status:** Planned (revised after S4 failure — Nina gave generic advice instead of using her own system)
> **Date:** 2026-04-03

---

## Root Cause Analysis

S4 failed because:
1. **The brainstorming skill never fired.** Possible causes: description wording, skill naming collision, missing `origin` field.
2. **Nina had no persistent awareness** of the capability system. The system existed in code but not in her operational knowledge.
3. **The builder had no measurable contract.** It knew conventions but couldn't verify its own output against a framework expectation.

## Architecture: TDD-Like Expansion Points

**We build the sockets. The agent builds the plugs.**

The framework has integration points — functions that call capability scripts with specific inputs and expect specific outputs. Templates define the socket shape. The builder creates the plug that fits. test.sh validates the plug fits the socket.

```
Framework (our team):                    Agent-generated (per user):

chat-service.ts                          .my_agent/capabilities/stt-deepgram/
  → detects audio input                   scripts/
  → calls transcribe.sh <file>  ──────→     transcribe.sh  ← agent writes this
  → expects { "text": "..." }                (calls Deepgram, returns JSON)
  → passes text to brain
                                         Template (our team):
registry.ts                              skills/capability-templates/audio-to-text.md
  → runs test harness on activation ←──    defines: input format, output schema,
  → updates status: ok | error              test fixture, timeout, exit codes
```

**Three owners, clear boundaries:**

| Owner | Maintains | Changes when |
|-------|-----------|-------------|
| Framework team | Integration points (chat-service, registry, channels) | New well-known types added |
| Framework team | Templates (script contract, test harness, known providers) | Contract evolves |
| Agent (Opus builder) | Capability scripts, config, CAPABILITY.md | User asks for a new ability |

---

## Tasks

### Phase A: Fix Skill Triggering

| # | Task | Files | Details |
|---|------|-------|---------|
| A1 | Diagnose why brainstorming skill didn't match in S4 | `.my_agent/.claude/skills/capability-brainstorming/SKILL.md` | Check: is `origin` field missing? Are there naming collisions with `brainstorming` and `brainstorming-techniques` skills? Test skill matching with "I want voice messages" |
| A2 | Fix skill frontmatter | `.my_agent/.claude/skills/capability-brainstorming/SKILL.md` | Add `origin` field if missing. Rewrite description with explicit trigger phrases: "voice", "image generation", "speech", "transcribe", "new ability", "extend capabilities" |
| A3 | Test skill activation in isolation | Manual | Send "I want you to understand voice messages" — verify brainstorming skill fires before anything else |

### Phase B: Permanent Brain Awareness

| # | Task | Files | Details |
|---|------|-------|---------|
| B1 | Write notebook reference | `.my_agent/notebook/reference/capabilities.md` | Injected into every system prompt via `loadNotebookReference()`. Contains: the capability system exists, check templates before building, use brainstorming skill, use builder agent, NEVER just explain — DO it |
| B2 | Strengthen CLAUDE.md directive | `CLAUDE.md` | Add explicit imperative to capability section: "When a user requests a new ability, invoke the capability-brainstorming skill immediately. Do not explain options." |
| B3 | Add prompt footer for empty registry | `packages/core/src/prompt.ts` | In `loadCapabilityHints()`, when no capabilities are installed, append: "No capabilities installed. If the user asks for one, use the capability-brainstorming skill to create it." |

### Phase C: Capability Templates

Templates are framework code — they define the contract between integration points and agent-generated scripts.

| # | Task | Files | Details |
|---|------|-------|---------|
| C1 | Create template directory | `skills/capability-templates/` | Framework-authored, public repo, versioned |
| C2 | Write `audio-to-text.md` template | `skills/capability-templates/audio-to-text.md` | See Template Spec below |
| C3 | Write `text-to-audio.md` template | `skills/capability-templates/text-to-audio.md` | See Template Spec below |
| C4 | Write `text-to-image.md` template | `skills/capability-templates/text-to-image.md` | See Template Spec below |
| C5 | Write `_bundles.md` | `skills/capability-templates/_bundles.md` | Composite requests: "voice" = audio-to-text + text-to-audio |

### Phase D: Test Harness in Registry

| # | Task | Files | Details |
|---|------|-------|---------|
| D1 | Add `test()` method to registry | `packages/core/src/capabilities/registry.ts` | Runs the template's test harness against the capability's script. Returns `{ status: "ok", latency_ms, provider }` or `{ status: "error", message }` |
| D2 | Add `health` field to Capability type | `packages/core/src/capabilities/types.ts` | Extend status: `unavailable` (missing env), `available` (env present, untested or healthy), `degraded` (env present, test failed + error message) |
| D3 | Run test on activation | `packages/core/src/capabilities/registry.ts` | When capability transitions from `unavailable` → env vars present, run test before marking `available`. If test fails, mark `degraded` with error |
| D4 | Run test on startup | `packages/dashboard/src/app.ts` | After initial capability scan, run tests for all capabilities with env vars present |
| D5 | Expose test-on-demand via registry | `packages/core/src/capabilities/registry.ts` | `registry.test(type)` — brain can call this to diagnose issues |
| D6 | Update system prompt with health status | `packages/core/src/prompt.ts` | Show health in capability hints: `audio-to-text (Deepgram STT) [available, healthy, 1.2s]` or `[degraded: 401 Unauthorized]` |

### Phase E: Builder + Brainstorming Updates

| # | Task | Files | Details |
|---|------|-------|---------|
| E1 | Update builder prompt — template precedence | `packages/core/src/agents/definitions.ts` | Add: "When a capability template is provided, the template's script contract takes precedence over generic conventions." |
| E2 | Update builder prompt — test.sh validation | `packages/core/src/agents/definitions.ts` | Add: "Your work is not done until the framework's test harness passes against your script. Run the test, read the result, fix until it passes." |
| E3 | Update brainstorming skill — glob for templates | `.my_agent/.claude/skills/capability-brainstorming/SKILL.md` | Step 1: glob `skills/capability-templates/` for a matching template. If found, follow it. If not, use generic conventions |
| E4 | Update brainstorming skill — composite requests | `.my_agent/.claude/skills/capability-brainstorming/SKILL.md` | Check `_bundles.md` for composite requests. "I want voice" → build both audio-to-text and text-to-audio |
| E5 | Update brainstorming skill — self-healing protocol | `.my_agent/.claude/skills/capability-brainstorming/SKILL.md` | When brain sees a degraded capability, it can spawn the builder with the error context to fix it. Distinguish: script bug (fix), provider outage (wait), key expired (escalate to user) |

### Phase F: The Real Test (Retry)

| # | Task | Details |
|---|------|---------|
| F1 | Test skill triggering | "I want you to understand voice messages" → brainstorming skill fires |
| F2 | Test brainstorming reads template | Skill finds `audio-to-text.md`, presents framework benefits to user, asks about provider preference |
| F3 | Test builder follows template | Builder writes transcribe.sh matching the template's script contract |
| F4 | Test harness validates | Registry runs test against transcribe.sh — passes or builder fixes |
| F5 | Test end-to-end STT | Dashboard record → transcribe. WhatsApp voice note → transcribe |
| F6 | Repeat for TTS | "I want you to respond with voice" → builds text-to-audio → test passes → voice replies work |
| F7 | Test composite request | "I want voice" → builds both STT and TTS |
| F8 | Test degraded recovery | Break a script → registry marks degraded → brain sees error → spawns builder to fix → test passes → healthy |
| F9 | Test activation validation | Remove API key → unavailable. Add key → test runs → available (or degraded if key is bad) |
| F10 | Update CLAUDE.md | Add capability conventions, template reference |

---

## Template Spec: `audio-to-text.md`

```markdown
# audio-to-text — Capability Template

> template_version: 1

## What the Framework Does

When `provides: audio-to-text` is installed and available:
- **Dashboard:** Record button appears on compose bar (desktop + mobile)
- **Channels:** Incoming audio messages are automatically transcribed
- **System prompt:** Brain sees "audio-to-text [available]"

When unavailable or degraded:
- Record button hidden
- Audio messages passed as "[Voice note received — no transcription configured]"

## Script Contract: transcribe.sh

**Input:** `./scripts/transcribe.sh <absolute-path-to-audio-file>`

Audio formats the framework may send: OGG/Opus, WebM/Opus, WAV, MP3.
Your script must handle ALL of these. If your provider doesn't accept
a format natively, transcode in the script (e.g., ffmpeg).

**Output (stdout):** JSON on a single line
```json
{ "text": "the transcribed text" }
```

**Exit codes:**
- 0 = success (stdout has valid JSON)
- 1 = error (stderr has error message)

**Timeout:** 30 seconds

**Security:** Do not read .env directly. Your API key is available as
an environment variable (declared in requires.env). Do not write
outside the capability directory.

## CAPABILITY.md Frontmatter

```yaml
---
name: <Provider Name> STT
provides: audio-to-text
interface: script
requires:
  env:
    - <YOUR_API_KEY_NAME>
---
```

Body: brief description of what provider is used and any notes.

## Test Contract

The framework validates your script by running:

1. Provide a short audio fixture (create a 1-second silent OGG or use
   a text-to-speech tool to generate a test clip)
2. Run: `./scripts/transcribe.sh <fixture-path>`
3. Parse stdout as JSON
4. Verify: has `text` field, value is a non-empty string
5. Verify: exit code is 0
6. Test with a non-existent path — verify exit code is 1

On success, report: `{ "status": "ok", "latency_ms": <time> }`
On failure, report: `{ "status": "error", "message": "<reason>" }`

The framework runs this test:
- On first activation (env vars become available)
- On startup
- On demand (when brain diagnoses issues)

Keep test input minimal to avoid API costs.

## Known Providers

Research current options. These have worked:
- **Deepgram Nova-2** — cloud REST API, ~$0.004/min, fast
- **faster-whisper** — local, Python, needs CPU/GPU
- **Groq Whisper** — cloud, fast, free tier available
- **OpenAI Whisper API** — cloud, $0.006/min

## config.yaml

Non-secret settings your scripts may need:

```yaml
model: nova-2          # provider-specific model name
language: en           # preferred language
```
```

---

## Template Spec: `text-to-audio.md`

Same structure as above, with these differences:

**Script contract:** `./scripts/synthesize.sh <text> <output-path>`
- `<text>`: the text to synthesize (quoted string)
- `<output-path>`: absolute path where the OGG file should be written

**Output (stdout):** JSON
```json
{ "path": "/absolute/path/to/output.ogg" }
```

**Test contract:**
1. Run: `./scripts/synthesize.sh "Hello, this is a test." /tmp/test-output.ogg`
2. Verify: exit code 0, JSON has `path` field, file exists at path, file is > 0 bytes
3. Verify: output is valid OGG audio (channels can send it as voice note)

**Known providers:** ElevenLabs, OpenAI TTS, Kokoro (local), Piper (local/fast)

**config.yaml:**
```yaml
voice: nova             # voice name/ID
speed: 1.0              # speech rate
```

---

## Template Spec: `text-to-image.md`

**Script contract:** `./scripts/generate.sh <prompt> <output-path>`
- `<prompt>`: image generation prompt (quoted string)
- `<output-path>`: absolute path where the image should be written

**Output (stdout):** JSON
```json
{ "path": "/absolute/path/to/output.png" }
```

**Test contract:**
1. Run: `./scripts/generate.sh "A simple red circle on white background" /tmp/test-image.png`
2. Verify: exit code 0, JSON has `path` field, file exists, file is > 0 bytes
3. Verify: file is a valid image (PNG or JPEG)

**Known providers:** DALL-E 3, Stable Diffusion (local), Midjourney API, Replicate

---

## Iteration Rule (carried from original S4)

**Fix the process, not the instance.** When the builder fails, only modify generic process instructions — never add provider-specific hints. The goal is a builder that succeeds on any capability, not one coached to pass a specific test.

---

## Dependencies & Ordering

```
Phase A (Skill triggering)     ← no dependencies, do first
Phase B (Brain awareness)      ← no dependencies, parallel with A
Phase C (Templates)            ← no dependencies, parallel with A+B
Phase D (Test harness)         ← depends on C (needs template contracts)
Phase E (Builder/skill updates)← depends on C+D
Phase F (Real test)            ← depends on A+B+C+D+E
```

Phases A, B, C can run in parallel. D needs C. E needs C+D. F is the final validation.

---

## Success Criteria

The milestone is complete when:

1. Brainstorming skill fires on "I want voice" (A3)
2. Nina reads the template, presents framework benefits, asks about provider (F2)
3. Builder produces scripts that pass the framework's test harness (F4)
4. STT and TTS work end-to-end on dashboard and WhatsApp (F5, F6)
5. Composite "I want voice" builds both capabilities (F7)
6. Degraded capability triggers self-healing (F8)
7. Activation validation catches bad keys before user's first request (F9)
8. No provider-specific hints in the builder prompt (iteration rule)

---

## Traceability Matrix

| Design Spec Section | Requirement | Task(s) |
|---------------------|-------------|---------|
| Principles §2 | Agent builds its own skills | F3, F6 |
| Principles §7 | Scripts are the universal adapter | C2, C3, C4 |
| Skill Generation > Skill 1 | Brainstorming triggered on capability request | A1, A2, A3 |
| Skill Generation > Skill 1 | Prior art + template reference | E3 |
| Skill Generation > Skill 2 | Builder follows template contract | E1, E2 |
| Trust Model | Builder tests before declaring done | E2, D1 |
| Model Switching | Visible model switch messages | B1 (via skill instruction) |
| Error Handling | Errors surface, never silently drop | D2, D6, E5 |
| Implementation Phase 4 | Delete dummies, Nina creates real ones | F1-F9 |
| Templates Proposal | Templates define script contract | C1-C5 |
| Templates Proposal | Notebook reference for permanent awareness | B1 |
| Templates Proposal | Multi-capability bundles | C5, E4 |
| Adversary §1 | Skill activation root cause | A1, A2 |
| Adversary §3 | Notebook reference in system prompt | B1 |
| Adversary §6 | Testing without providers / validation-on-activation | D3, D4, F9 |
| Adversary §7 | "NEVER explain — DO it" enforcement | B1, B2, B3 |
| Adversary §9 | Test all input formats | C2 (template requires it) |
| Adversary §10 | Multi-capability requests | C5, E4 |
| Advocate §1 | Templates transport-agnostic | C2, C3, C4 (no channel names) |
| Advocate §15 | Template versioning | C2-C4 (`template_version: 1`) |
