# M1: Basic Nina (CLI) — Design Document

> **Status:** Approved
> **Date:** 2026-02-12
> **Session:** Hanan (PM/Architect) + Claude Code (Tech Lead)
> **Milestone:** M1 of my_agent roadmap

---

## Goal

Get Nina's brain running as an Agent SDK session, speaking via CLI, with personality and memory created through an interactive hatching process.

**Success criteria:**
- `npm run brain` starts a conversation with Nina
- Nina knows who she is and responds in character
- First run triggers hatching questionnaire
- User can refine personality/rules anytime via commands

---

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| SDK approach | Direct Agent SDK (V2 session API) | Minimal code, matches design doc, production-ready |
| CLI modes | REPL (default) + single-shot | Flexibility for interactive and scripted use |
| Memory migration | None — fresh start | Hatching creates new memories, cleaner than importing |
| Skill location | `packages/core/skills/` (core) + `skills/` (generic, later) | Core skills ship with package, generic skills separate |
| System prompt | Assembled from multiple files | CLAUDE.md + memory/core/* files concatenated |
| Skill invocation | Explicit `/commands` + autonomous | User control + Nina intelligence combined |

---

## Project Structure

```
packages/core/
├── src/
│   ├── index.ts          # Entry point, CLI arg parsing
│   ├── brain.ts          # Session creation, conversation loop
│   ├── hatching.ts       # First-run questionnaire flow
│   ├── config.ts         # Load personality + memory files
│   └── types.ts          # Shared types
├── skills/
│   ├── personality/SKILL.md
│   ├── operating-rules/SKILL.md
│   └── hatching/SKILL.md
├── package.json
└── tsconfig.json

skills/                        # Generic framework skills (M3+)
└── (task-management, memory-management, etc.)

.my_agent/                     # Created by hatching (gitignored, separate repo)
├── brain/
│   ├── CLAUDE.md              # Personality
│   └── memory/core/
│       ├── identity.md        # User info (from hatching)
│       ├── contacts.md        # Key people
│       └── preferences.md     # User preferences
├── config.yaml                # Model, paths
└── .hatched                   # Marker file
```

---

## CLI Interface

```bash
# REPL mode (default)
npm run brain
> Hello Nina
Nina: Hey! What's up?

# Single-shot mode
npm run brain "What time is it?"
Nina: [response]

# First run (no .hatched file)
npm run brain
Nina: Hi! I'm Nina. Let's get to know each other...
      [minimal questions]
      Want to complete full setup now, or continue later?
      Run /my-agent:personality or /my-agent:operating-rules anytime.
```

---

## Hatching Flow

1. First `npm run brain` detects no `.my_agent/` or no `.hatched` marker
2. Nina creates `.my_agent/` directory structure
3. Asks minimum questions:
   - What's your name?
   - What do you need help with?
   - Any key contacts? (can skip)
4. Offers: "Complete full setup now, or continue later?"
5. If later: tells user about `/my-agent:personality` and `/my-agent:operating-rules`
6. Writes `memory/core/identity.md`, creates `.hatched` marker
7. Nina is ready to use with sensible defaults

---

## System Prompt Assembly

```typescript
const systemPrompt = [
  readFile('brain/CLAUDE.md'),              // Personality first
  '## User Context',
  readFile('brain/memory/core/identity.md'),
  readFile('brain/memory/core/contacts.md'),
  readFile('brain/memory/core/preferences.md'),
].join('\n\n')
```

---

## Sprints

### Sprint 1: Foundation
- TypeScript project setup in `packages/core/`
- Agent SDK V2 session integration
- Basic REPL loop (no personality yet)
- **Deliverable:** `npm run brain` works, echoes responses

### Sprint 2: Personality & Memory
- Load `brain/CLAUDE.md` as system prompt
- Load `memory/core/*` files into context
- `config.yaml` for paths and model selection
- **Deliverable:** Nina knows who she is, responds in character

### Sprint 3: Hatching & Skills
- First-run detection (`.hatched` marker)
- Hatching questionnaire flow
- `/my-agent:personality` skill
- `/my-agent:operating-rules` skill
- **Deliverable:** Full M1 complete

**Dependencies:** Sprint 1 → Sprint 2 → Sprint 3 (sequential)

---

## Team Structure (Lean Mode)

| Role | Responsibility | Model |
|------|----------------|-------|
| **Tech Lead** (main session) | Plans, coordinates, surfaces to PM | Sonnet |
| **Developer** (subagent) | Implements features, writes tests | Sonnet/Haiku |
| **Reviewer** (subagent) | Code review, security check | Haiku |

**Human roles:**
- **PM (Hanan):** Approves sprint plans, prioritizes
- **Architect (Hanan):** Approves major design decisions

---

## Quality & Safety

| Practice | Implementation |
|----------|----------------|
| Linting | ESLint + Prettier |
| Type safety | Strict TypeScript |
| Testing | Vitest (as needed) |
| Review gate | Reviewer agent before commits |
| Guardrails | `.guardrails` patterns + pre-commit hook |

**Reviewer checklist:**
1. Does it compile?
2. Do tests pass?
3. Any security issues?
4. Matches sprint plan?

---

## Sprint Tracking

```
docs/sprints/
├── m1-s1-foundation/
│   ├── plan.md        # Tasks, decisions, acceptance criteria
│   ├── progress.md    # Daily updates, blockers
│   └── review.md      # Sprint review (at end)
├── m1-s2-personality/
└── m1-s3-hatching/
```

**Workflow:**
1. Sprint start: Tech Lead creates plan.md, PM approves
2. During: Team updates progress.md, surfaces blockers
3. Sprint end: review.md written, deliverable demoed, PM accepts

---

## Repositories

| Repo | Visibility | Contents |
|------|------------|----------|
| okets/my_agent | Public | Framework code |
| okets/nina-brain | Private | `.my_agent/` contents |

Commits from: Your agent's configured git identity

---

## Token Efficiency

- Single main session (Tech Lead holds context)
- Subagents for isolated implementation blocks
- Reviewer only invoked before commits
- Sprint folders hold context in files, not tokens
- Haiku for simple tasks

---

## Open Questions (Resolved)

All major decisions resolved during brainstorming. No blockers identified.

---

*Design approved: 2026-02-12*
