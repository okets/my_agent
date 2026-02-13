# Sprint M1-S3: Hatching & Skills

> **Status:** In Progress
> **Sprint:** 3 of 3 for Milestone 1
> **Date:** 2026-02-13

---

## Goal

Modular first-run hatching experience that creates .my_agent/, walks users through setup steps, and provides `/my-agent:*` commands for re-running any step later.

---

## Tasks

- [ ] **T1: Hatching orchestrator + directory creation**
  - Create `src/hatching/index.ts` — orchestrates hatching steps
  - In index.ts, before starting brain: check if .my_agent/ exists
  - If not: run hatching flow
  - Create .my_agent/ directory structure: brain/, brain/memory/core/, brain/skills/
  - Run required steps in sequence: identity → personality
  - Offer optional steps: operating-rules
  - "Complete full setup now, or continue later?"
  - If later: list available `/my-agent:*` commands
  - Write .hatched marker, generate minimal config.yaml
  - Drop into REPL after hatching

- [ ] **T2: Identity step**
  - Create `src/hatching/steps/identity.ts`
  - Interactive Q&A via readline:
    1. "What's your name?"
    2. "What do you mainly need help with?"
    3. "Any key contacts I should know about?" (skippable)
  - Writes brain/memory/core/identity.md
  - Writes brain/memory/core/contacts.md (if contacts provided)
  - Can re-run via `/my-agent:identity`

- [ ] **T3: Personality step**
  - Create `src/hatching/steps/personality.ts`
  - Reads archetype files from defaults/personalities/
  - Presents numbered menu: Partner, Butler, Hacker, Operator, Coach, Academic, Write your own
  - Shows short description for each
  - User picks one → copies to brain/CLAUDE.md
  - "Write your own" → copies custom.md template, tells user to edit it
  - Can re-run via `/my-agent:personality`

- [ ] **T4: Operating rules step**
  - Create `src/hatching/steps/operating-rules.ts`
  - Interactive Q&A:
    1. Autonomy level (1-10 or descriptive choices)
    2. What should always be escalated?
    3. Communication style preferences
  - Appends operating rules section to brain/CLAUDE.md
  - Can re-run via `/my-agent:operating-rules`

- [ ] **T5: Skill files + command recognition**
  - Create SKILL.md files:
    - packages/core/skills/identity/SKILL.md
    - packages/core/skills/personality/SKILL.md
    - packages/core/skills/operating-rules/SKILL.md
  - Update prompt.ts to load skills into system prompt
  - Brain recognizes `/my-agent:*` patterns and triggers appropriate step
  - Each skill describes what it does and invokes its hatching step

---

## Decisions (Pre-Resolved)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Hatching trigger | .my_agent/ directory missing | Simplest detection |
| Architecture | Modular steps in src/hatching/steps/ | Extensible for future channels, etc. |
| Personality selection | Menu of 7 archetypes + custom | Per brainstorming decision |
| Skill format | Markdown SKILL.md files | Same as Claude Code skills |
| Skill invocation | /command in chat + autonomous | Per design approval |

---

## Open Questions

None.

---

## Acceptance Criteria

- [ ] Fresh install: `npm run brain` creates .my_agent/ and runs hatching
- [ ] Identity step: asks name, purpose, contacts (skippable)
- [ ] Personality step: shows archetypes, user picks one → written to brain/CLAUDE.md
- [ ] Operating rules: offered but skippable during hatching
- [ ] After hatching, drops into working REPL with chosen personality
- [ ] Second run: skips hatching, goes straight to brain
- [ ] `/my-agent:personality` in chat triggers personality selection
- [ ] `/my-agent:identity` in chat re-runs identity step

---

## Proposed Team

| Agent | Role | Tasks | Model |
|-------|------|-------|-------|
| Tech Lead | Coordinate, review | All oversight | Sonnet |
| Developer | Implement T1-T5 | All tasks | Sonnet |

---

## Blockers

None — builds on Sprint 1 + 2 deliverables.

---

*Awaiting PM approval to begin.*
