# Sprint M1-S1: Foundation

> **Status:** In Progress
> **Sprint:** 1 of 3 for Milestone 1
> **Date:** 2026-02-12

---

## Goal

Set up the TypeScript project and get a basic Agent SDK conversation loop working.

---

## Tasks

- [ ] **T1: Project setup**
  - Initialize `packages/core/` with package.json, tsconfig.json
  - Add dependencies: `@anthropic-ai/claude-agent-sdk`, `typescript`
  - Add dev dependencies: `tsx`, `@types/node`
  - Configure scripts: `build`, `brain`, `dev`

- [ ] **T2: Basic brain module**
  - Create `src/index.ts` — entry point with CLI arg parsing
  - Create `src/brain.ts` — Agent SDK session creation
  - Implement REPL loop (readline-based)
  - Implement single-shot mode (message from argv)

- [ ] **T3: Configuration foundation**
  - Create `src/config.ts` — placeholder for config loading
  - Create `src/types.ts` — shared TypeScript types
  - Stub `.my_agent/config.yaml` structure (paths, model)

- [ ] **T4: Development tooling**
  - ESLint + Prettier configuration
  - npm scripts for lint/format
  - .gitignore updates for build artifacts

---

## Decisions (Pre-Resolved)

| Decision | Choice | Reference |
|----------|--------|-----------|
| SDK API | V2 session API (`unstable_v2_createSession`) | Design doc |
| CLI interface | Both REPL and single-shot | Design doc |
| Model | claude-sonnet-4-5-20250929 (default) | Design doc |
| Package manager | npm | Project convention |

---

## Open Questions

None — all decisions resolved in design phase.

---

## Acceptance Criteria

- [ ] `npm run brain` starts a REPL, accepts input, shows response
- [ ] `npm run brain "Hello"` runs single message, exits
- [ ] Session maintains context across REPL turns
- [ ] Code compiles without TypeScript errors
- [ ] Linter passes with no errors

---

## Proposed Team

| Agent | Role | Tasks | Model |
|-------|------|-------|-------|
| Tech Lead | Coordinate, create files, review | All oversight | Sonnet |
| Developer | Implement T1-T4 | T1, T2, T3, T4 | Sonnet |

**Note:** Reviewer agent deferred — Sprint 1 has low security risk (no external I/O yet).

**Estimated effort:** ~1 session, low token usage (mostly file creation).

---

## Blockers

None identified.

---

*Awaiting PM approval to begin.*
