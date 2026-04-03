# M9-S4: The Real Test

> **Milestone:** M9 — Capability System
> **Design spec:** [capability-system.md](../../design/capability-system.md)
> **Implementation plan:** [2026-04-01-capability-system.md](../../plans/2026-04-01-capability-system.md)
> **Status:** Planned

---

## Goal

Delete the dummy capabilities and have Nina create real ones from scratch. This is the validation gate — the system isn't done until the agent can reliably self-extend end-to-end. Also finalize documentation and roadmap.

## Prerequisites

- M9-S3 complete (WhatsApp voice, skill generation system)

## Tasks

### STT — Delete and Recreate

| # | Task | Details |
|---|------|---------|
| 38 | Delete dummy STT | Remove `.my_agent/capabilities/stt-dummy/`. Verify: record button disappears from dashboard, WhatsApp stops transcribing voice notes, brain prompt no longer lists `audio-to-text` |
| 39 | Ask Nina to create real STT | Conversation: "I want you to understand voice messages." Nina activates brainstorming skill → researches options → asks about budget/privacy/latency → picks provider → spawns builder → builder writes CAPABILITY.md + scripts + config.yaml → tests scripts → fixes errors → capability appears in registry. **Iterate until it works end-to-end** |
| 40 | Verify STT end-to-end | Send voice note on WhatsApp → gets transcribed with real provider. Record audio in dashboard → gets transcribed. Brain responds to transcribed text correctly |

### TTS — Delete and Recreate

| # | Task | Details |
|---|------|---------|
| 41 | Ask Nina to create real TTS | Conversation: "I want you to respond with voice." Same flow as STT. Iterate until it works |
| 42 | Verify TTS end-to-end | Send voice note on WhatsApp → get voice response back. Record in dashboard → get audio playback. Voice quality is acceptable |

### Integration Verification

| # | Task | Details |
|---|------|---------|
| 43 | Verify medium mirroring | Text message → text response. Voice message → voice response. Consistent across dashboard and WhatsApp |
| 43b | Verify secrets flow | Remove API key from `.env` → capability goes `unavailable` → brain tells user it needs configuration → add key via Settings UI → capability goes `available` → voice works again |
| 43c | Verify error resilience | Break a capability script intentionally → verify error surfaces in chat (not silent drop) → fix script → verify recovery |

### Documentation

| # | Task | Files | Details |
|---|------|-------|---------|
| 46 | Update CLAUDE.md | `CLAUDE.md` | Add capabilities section: directory convention (`.my_agent/capabilities/`), CAPABILITY.md format, well-known types, `config.yaml` conventions, how to add capabilities manually, how to ask the agent to create one |

## Iteration Rule

**Fix the process, not the instance.** When the builder agent fails during iteration, only modify generic process instructions in the builder prompt — never add provider-specific hints (API endpoints, auth patterns, output formats). Opus can research those on its own. If a prompt fix only helps the current provider, it's a hint, not a process improvement. The goal is a builder that succeeds on *any* capability, not one that's been coached to pass a specific test.

Examples of valid prompt fixes:
- "Validate script output is valid JSON before reporting success"
- "After writing a script, run `chmod +x` on it"
- "Create a test input and run the script before reporting done"

Examples of invalid prompt fixes (hints):
- "Deepgram uses Token auth in the Authorization header"
- "Use `audio/ogg` mimetype for WhatsApp voice notes"
- "Kokoro outputs WAV, convert to OGG with ffmpeg"

## Success Criteria

The milestone is complete when:

1. Nina can create a working STT capability from a single user request
2. Nina can create a working TTS capability from a single user request
3. Dashboard record button and audio player work with real providers
4. WhatsApp voice notes transcribe and voice replies synthesize
5. Medium mirroring works (voice in → voice out)
6. Secrets management works end-to-end (add/remove/unavailable flow)
7. Errors surface to the user, never silently drop
8. CLAUDE.md documents the capability system

## Traceability Matrix

| Design Spec Section | Requirement | Task(s) |
|---------------------|-------------|---------|
| Principles §2 | Agent builds its own skills | 39, 41 |
| Implementation Phase 4 | Delete dummy STT, Nina creates real one | 38, 39 |
| Implementation Phase 4 | Iterate until reliable end-to-end | 39, 41 |
| Implementation Phase 4 | Repeat for TTS | 41 |
| Well-Known Types | audio-to-text works across dashboard + WhatsApp | 40 |
| Well-Known Types | text-to-audio works across dashboard + WhatsApp | 42 |
| Medium Mirroring | Voice in → voice out | 43 |
| Secrets Management > Flow When Key Missing | Remove key → unavailable → add key → available | 43b |
| Error Handling | Errors surface, never silently drop | 43c |
| Non-Goals | No provider-specific hints in builder prompt | Iteration Rule |
| Implementation Phase 6 | Update CLAUDE.md with capability conventions | 46 |

## Deliverables

- Real STT capability (agent-authored)
- Real TTS capability (agent-authored)
- CLAUDE.md updated with capability conventions
- Sprint review with E2E verification
