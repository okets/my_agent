# M9-S6: The Real Test (Retry)

> **Milestone:** M9 — Capability System
> **Design spec:** [capability-system.md](../../design/capability-system.md)
> **Prerequisites:** M9-S5 (templates, test harness, brain awareness)
> **Status:** Planned
> **Date:** 2026-04-03
> **Context:** S4 failed because Nina lacked awareness and contracts. S5 fixed the infrastructure. S6 retests with the full system in place.

---

## Goal

Delete all capabilities and have Nina create real ones from scratch — using the templates, test harness, and brainstorming skill. The system isn't done until the agent can reliably self-extend end-to-end, with the framework's test harness validating every capability.

---

## Tasks

### STT — Nina Creates From Scratch

| # | Task | Details |
|---|------|---------|
| 1 | Verify clean state | No capabilities installed. Record button hidden. Prompt shows "No capabilities installed" footer |
| 2 | Request STT | "I want you to understand voice messages." Verify: brainstorming skill fires (not generic advice), Nina reads `audio-to-text.md` template, presents framework benefits, asks provider preference |
| 3 | Nina builds STT | Builder spawns, writes transcribe.sh following template contract, runs framework test harness, iterates until test passes |
| 4 | Verify test harness | Registry ran test on activation → capability marked `healthy` with latency. System prompt shows `audio-to-text [healthy, Xs]` |
| 5 | Verify STT end-to-end | Dashboard: record audio → transcribed. WhatsApp: send voice note → transcribed. Brain responds to transcribed text |

### TTS — Nina Creates From Scratch

| # | Task | Details |
|---|------|---------|
| 6 | Request TTS | "I want you to respond with voice." Same flow — brainstorming skill, template, builder, test harness |
| 7 | Verify TTS end-to-end | Dashboard: voice response with audio player. WhatsApp: voice note reply |

### Composite Request

| # | Task | Details |
|---|------|---------|
| 8 | Test "I want voice" | Single request triggers both STT + TTS via `_bundles.md`. Both built, both pass test harness |

### Self-Healing

| # | Task | Details |
|---|------|---------|
| 9 | Break a capability | Intentionally corrupt transcribe.sh. Verify: next voice note fails → error surfaces in chat → registry marks `degraded` |
| 10 | Brain self-heals | Brain sees degraded status → spawns builder with error context → builder fixes script → test passes → `healthy` again |

### Activation Validation

| # | Task | Details |
|---|------|---------|
| 11 | Remove API key | Delete from Settings → capability `unavailable` → record button disappears |
| 12 | Add bad key | Add invalid key → test runs on activation → `degraded: 401 Unauthorized` → brain tells user key doesn't work |
| 13 | Add good key | Add valid key → test passes → `healthy` → record button appears → voice works |

### Documentation

| # | Task | Files | Details |
|---|------|-------|---------|
| 14 | Update CLAUDE.md | `CLAUDE.md` | Ensure capability section reflects templates, test harness, and the "we build sockets, agent builds plugs" model |

---

## Iteration Rule

**Fix the process, not the instance.** When the builder fails, only modify generic process instructions in the builder prompt or brainstorming skill — never add provider-specific hints. Opus researches providers on its own. If a fix only helps the current provider, it's a hint, not a process improvement.

---

## Success Criteria

The milestone is complete when:

1. Brainstorming skill fires on capability requests (not generic advice)
2. Nina reads the template and follows its contract
3. Builder produces scripts that pass the framework's test harness
4. STT and TTS work end-to-end on dashboard and WhatsApp
5. Composite "I want voice" builds both capabilities
6. Degraded capability triggers self-healing (builder fixes, test passes)
7. Activation validation catches bad keys before first real request
8. No provider-specific hints in the builder prompt
9. Medium mirroring works (voice in → voice out)

---

## Traceability Matrix

| Design Spec Section | Requirement | Task(s) |
|---------------------|-------------|---------|
| Principles §2 | Agent builds its own skills | 3, 6 |
| Principles §7 | Scripts are the universal adapter | 3, 6 (builder chooses provider) |
| Implementation Phase 4 | Agent creates real capabilities | 2-7 |
| Implementation Phase 4 | Iterate until reliable | 3, 6 (iteration rule) |
| Well-Known Types | audio-to-text across channels | 5 |
| Well-Known Types | text-to-audio across channels | 7 |
| Medium Mirroring | Voice in → voice out | 5, 7 |
| Secrets Management | Remove key → unavailable → add key → available | 11-13 |
| Error Handling | Errors surface, never silently drop | 9 |
| Trust Model | Builder tests before declaring done | 3, 4 |
| Templates Proposal | Templates define script contract | 2, 3, 6 |
| Templates Proposal | Multi-capability bundles | 8 |
| Adversary §6 | Validation-on-activation | 12, 13 |
| Adversary §7 | Agent acts, doesn't explain | 2 |
| Adversary §9 | Error recovery loop | 9, 10 |

---

## Deliverables

- Real STT capability (agent-authored, test-harness validated)
- Real TTS capability (agent-authored, test-harness validated)
- Verified self-healing loop
- Verified activation validation
- Sprint review with E2E verification
