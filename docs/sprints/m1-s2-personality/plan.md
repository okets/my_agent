# Sprint M1-S2: Personality & Memory

> **Status:** In Progress
> **Sprint:** 2 of 3 for Milestone 1
> **Date:** 2026-02-13

---

## Goal

Nina loads her personality and memory files into the system prompt, responds in character.

---

## Tasks

- [ ] **T1: System prompt assembly**
  - Create `src/prompt.ts` — reads and assembles system prompt from brain files
  - Assembly order: CLAUDE.md → identity.md → contacts.md → preferences.md
  - Gracefully handle missing files (skip if not found)
  - Pass assembled prompt to `createBrainSession()`

- [ ] **T2: Update brain.ts to accept system prompt**
  - Modify `createBrainSession()` to accept systemPrompt option
  - Pass to Agent SDK `unstable_v2_createSession({ model, systemPrompt })`

- [ ] **T3: Config loading from config.yaml**
  - Update `src/config.ts` to parse YAML config file
  - Add `yaml` dependency
  - Config specifies: model, brain directory path, memory paths
  - Fall back to defaults if no config.yaml exists
  - Create stub `.my_agent/config.yaml`

- [ ] **T4: Write default brain/CLAUDE.md**
  - Write a sensible default personality for new agents in `packages/core/defaults/`
  - This is the fallback if no .my_agent/brain/CLAUDE.md exists
  - Generic, not Nina-specific (framework code is public)

---

## Decisions (Pre-Resolved)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| System prompt type | Custom string (not preset) | Full control over personality |
| Config format | YAML | Readable, matches design doc |
| Missing files | Skip gracefully | Not all memory files exist yet |
| Default personality | Generic in framework | Nina-specific stays in .my_agent/ |

---

## Open Questions

None.

---

## Acceptance Criteria

- [ ] `npm run brain "Who are you?"` responds with personality from CLAUDE.md
- [ ] System prompt includes content from all existing memory/core/* files
- [ ] Missing memory files are skipped without error
- [ ] config.yaml controls model selection
- [ ] Without .my_agent/, uses default personality from packages/core/defaults/

---

## Proposed Team

| Agent | Role | Tasks | Model |
|-------|------|-------|-------|
| Tech Lead | Coordinate, review | All oversight | Sonnet |
| Developer | Implement T1-T4 | T1, T2, T3, T4 | Sonnet |

---

## Blockers

None — builds on Sprint 1 deliverables.

---

*Awaiting PM approval to begin.*
