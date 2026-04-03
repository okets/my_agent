# Capability Templates — Design Proposal

> **Status:** Draft proposal
> **Date:** 2026-04-03
> **Context:** M9-S4 revealed that the agent doesn't know how to use the capability system it was built to extend

---

## Problem

During M9-S4 testing, the CTO asked Nina to set up voice capabilities. Nina responded like any Claude would — she listed providers, compared options, asked about budget. Generic LLM advice.

She had no idea that:
- A capability system exists in the framework
- A builder agent is available to do the actual work
- Specific script contracts exist that trigger automatic UI/channel reactions
- She can install capabilities by creating folders, not by explaining things to the user

The brainstorming skill exists, but Nina doesn't read it proactively. And even if she did, the skill describes a *process* — it doesn't describe the *contract* the framework expects.

The missing piece: **Nina needs to know what to build, not just how to build.**

---

## Proposed Solution: Capability Templates

Templates are framework-authored instruction files that describe the contract for each well-known capability type. They tell the builder agent exactly what script interface to implement so the framework can react automatically.

### Template Location

```
skills/capability-templates/
  audio-to-text.md
  text-to-audio.md
  text-to-image.md
```

These live in the public repo (framework code, not instance-specific). They're versioned and maintained by framework developers, not by the agent.

### Template Contents

Each template specifies:

1. **What the framework does with this type** — what UI appears, what channels do
2. **Script contract** — input arguments, output JSON shape, exit codes
3. **Directory structure** — required files, naming conventions
4. **Testing instructions** — how to verify the script works before declaring done
5. **Common providers** — not recommendations, just a list of known-good options the builder can research

Example structure for `audio-to-text.md`:

```markdown
# audio-to-text — Capability Template

## What the Framework Does

When a capability with `provides: audio-to-text` is installed and available:
- **Dashboard:** Record button appears on compose bar
- **WhatsApp:** Incoming voice notes are automatically transcribed
- **System prompt:** Brain sees "audio-to-text [available]"

When unavailable (missing API key):
- Record button hidden
- Voice notes passed as "[Voice note received — no transcription configured]"

## Script Contract

### scripts/transcribe.sh

**Input:** `transcribe.sh <audio-file-path>`
- Audio file is OGG (WhatsApp), WebM (browser), or WAV
- Path is absolute

**Output (stdout):** JSON
```json
{ "text": "transcribed text here" }
```

**Exit codes:**
- 0 = success
- 1 = error (stderr contains error message)

**Timeout:** 30 seconds

## CAPABILITY.md Frontmatter

```yaml
---
name: <Provider Name> STT
provides: audio-to-text
interface: script
requires:
  env:
    - <API_KEY_NAME>
---
```

## Testing

1. Find or create a short audio file (any format)
2. Run: `./scripts/transcribe.sh /path/to/test.ogg`
3. Verify output is valid JSON with a `text` field
4. Verify exit code is 0
5. Test with a non-existent file — verify exit code is 1

## Known Providers

The builder agent should research current options. These have been used successfully:
- Deepgram Nova-2 (cloud, REST API)
- faster-whisper (local, Python)
- Groq Whisper (cloud, fast, free tier)
```

### How Nina Uses Templates

The flow changes from:

**Before (broken):**
```
User: "I want you to understand voice messages"
Nina: "Here are some options..." (generic LLM advice)
```

**After:**
```
User: "I want you to understand voice messages"
Nina: reads skills/capability-templates/audio-to-text.md
Nina: "I can set this up for you. The framework supports voice
       transcription natively — once installed, a record button
       appears in the dashboard and WhatsApp voice notes get
       transcribed automatically.

       I need to pick a provider for the actual transcription.
       Do you have a preference for cloud vs local? Any budget
       constraints?"
User: "Cloud is fine, I have a Deepgram account"
Nina: spawns capability-builder with the template as spec
Builder: writes CAPABILITY.md + transcribe.sh following the contract
Nina: "Done. Record button should be visible now. Try it."
```

### Nina's Reference Document

A notebook reference file (`notebook/reference/capabilities.md`) gives Nina permanent awareness:

1. She has a capability system — folders in `.my_agent/capabilities/`
2. Before building, check `skills/capability-templates/` for a template
3. If a template exists → follow it exactly → native UI/channel benefits
4. If no template exists → use generic CAPABILITY.md conventions → works, but no automatic reactions
5. She has a builder agent (`capability-builder`) that does the actual file creation
6. Secrets go in `.env`, managed via Settings → Secrets
7. She should NEVER just explain how to set things up — she should DO it

---

## Why This Matters

### Separation of Concerns

| Responsibility | Owner |
|---------------|-------|
| Which types exist, what contracts they follow | Framework developers (us) |
| What the UI does for each type | Framework developers (us) |
| Which provider to use, how to implement the script | Agent (Nina) + user |
| Actually writing the scripts and testing them | Builder agent |

Framework developers design the integration points. The agent fills them in. Users get native-feeling features without understanding the framework.

### Extensibility for All Users

Every my_agent user runs Claude. The builder agent is Opus. Any user can say "I want voice" or "I want image generation" and their agent builds it — following the same templates, producing the same script contracts, getting the same UI reactions.

Users with different machines, budgets, and privacy preferences get different implementations (Deepgram vs faster-whisper vs Groq) but the same framework integration.

### New Types Are Easy to Add

Adding a new well-known type requires:
1. Framework code: add the UI/channel reaction (e.g., "when `calendar-sync` is available, show calendar widget")
2. Template: write `skills/capability-templates/calendar-sync.md` with the script contract
3. Done — any agent can now build a calendar sync capability

---

## Open Questions

1. **Template discovery:** Should the brainstorming skill explicitly glob for templates, or should Nina's reference doc list them? Glob is self-updating; explicit list is faster to read.

2. **Template versioning:** When we update a template (e.g., change the script contract), existing installed capabilities break. Do we need a version field? Or is "rebuild the capability" acceptable?

3. **Custom types:** Users will want capabilities that aren't well-known types. The generic builder handles this, but should there be a way for users to create their own templates? (Probably not for v1.)

4. **Template location:** `skills/capability-templates/` is proposed. Alternative: `docs/capability-templates/` or `packages/core/capability-templates/`. The key constraint is that the brain needs to read them at runtime.

---

*This proposal addresses the M9-S4 finding that the agent lacked awareness of its own extension framework. The templates formalize the contract between framework design and agent execution.*
