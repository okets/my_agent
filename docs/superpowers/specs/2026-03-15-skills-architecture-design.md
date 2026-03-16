# M6.8 Skills Architecture — Design Spec

> **Status:** Draft
> **Author:** CTO + Claude
> **Date:** 2026-03-15
> **Depends on:** M6.7 (two-agent refactor), M6.9 (knowledge lifecycle)

---

## Summary

Nina gets a skills system. Skills are markdown files discovered by the Agent SDK, shown in the dashboard notebook, tagged in chat when active, and Nina can create new ones herself. This milestone establishes the infrastructure, seeds operational skills, and enables self-creating skills — turning Nina from a static assistant into a learning system.

---

## Core Decisions

These were resolved during brainstorming and are not open for debate:

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **AGENTS.md convention** — rename Nina's `brain/CLAUDE.md` to `brain/AGENTS.md` | Clean ownership boundary. `CLAUDE.md` = SDK territory. `AGENTS.md` = my_agent territory. Invisible to SDK, no exclusion hacks needed for identity files. |
| 2 | **`settingSources: ['project']` + `cwd: .my_agent/`** — validated | SDK discovers skills from `.my_agent/.claude/skills/`. `claudeMdExcludes: ['**/CLAUDE.md']` blocks all CLAUDE.md loading. Developer skills moved to `~/.claude/skills/` (user-level) so they don't leak into Nina. **Validated via live SDK testing.** |
| 3 | **Single skill pool** — `.my_agent/.claude/skills/` | Flat structure (SDK requirement — no subdirectories). System vs user-generated distinguished by `origin` field in frontmatter. Both agents share the same pool. |
| 4 | **No cwd changes** | Conversation Nina keeps `cwd: .my_agent/`. Working Nina keeps `cwd: taskDir`. Working Nina uses `additionalDirectories: [agentDir]` to inherit skills. **Validated via live SDK testing.** |
| 5a | **Developer skills at user-level** | Sprint skills (`start-sprint`, `whats-next`, etc.) move from `.claude/skills/` to `~/.claude/skills/`. Claude Code discovers them. Nina can't (`settingSources: ['project']` only, no `'user'`). |
| 5 | **No skill overflow problem** | SDK injects only names + descriptions (~80 chars each). Full content loads on invocation. Budget is 2% of context window (~20K chars for 1M context). 50 skills ≈ 4K chars. Room for hundreds. |
| 6 | **System vs user-generated** — only meaningful distinction | No conversation/worker labels. System skills are invisible infrastructure. User-generated skills are visible and manageable. |
| 7 | **Skills portable between Claude Code and Agent SDK** | Same SKILL.md format, same tools. Only gap: `allowed-tools` frontmatter is ignored in SDK (tool access is session-level). |

---

## Architecture

### File Ownership Boundary

```
CLAUDE.md files → Claude Code territory (developer instructions, not loaded for Nina)
AGENTS.md files → my_agent territory (Nina's identity, loaded by our code)
SKILL.md files  → SDK discovers via additionalDirectories
```

### System Prompt Assembly

Identity/memory/calendar assembly is unchanged. Skill loading moves from `prompt.ts` to the SDK:

| Concern | Who loads it | Mechanism |
|---------|-------------|-----------|
| Nina's identity, memory, calendar, rules | Our code (`prompt.ts` / `SystemPromptBuilder`) | `assembleSystemPrompt()` reads `brain/AGENTS.md` + notebook + properties |
| Always-on behavioral guidance | Our code (`prompt.ts`) | `conversation-role.md` and `notebook.md` content inlined into system prompt (not SDK skills — Nina needs these before invoking anything) |
| Skills | SDK | `settingSources: ['project']` + `cwd: .my_agent/` discovers `.my_agent/.claude/skills/*/SKILL.md` |
| CLAUDE.md files | Not loaded for Nina | `claudeMdExcludes: ['**/CLAUDE.md']` blocks all CLAUDE.md |
| Developer skills | Claude Code only | Moved to `~/.claude/skills/` — invisible to Nina (`settingSources` has no `'user'`) |

### SDK Configuration

```typescript
const queryOptions: Options = {
  systemPrompt: resolvedSystemPrompt,
  settingSources: ['project'],
  settings: {
    claudeMdExcludes: ['**/CLAUDE.md'],
  },
  allowedTools: [...existingTools, 'Skill'],
  cwd: agentDir,                              // .my_agent/
  // ...existing options
}
```

> **✅ Validated via live SDK testing (2026-03-15).** Confirmed:
> - `settingSources: ['project']` + `cwd: .my_agent/` discovers skills from `.my_agent/.claude/skills/`
> - `claudeMdExcludes: ['**/CLAUDE.md']` blocks all CLAUDE.md content
> - Developer skills at `~/.claude/skills/` are invisible to Nina (no `'user'` in `settingSources`)
> - Skills must be flat under `.claude/skills/<name>/SKILL.md` (no subdirectory nesting)
> - Symlinks work transparently

### Skill Discovery Flow

```
Session starts
  ├── SDK scans {cwd}/.claude/skills/ (.my_agent/.claude/skills/)
  ├── Reads YAML frontmatter (name, description) from each SKILL.md
  ├── Injects skill list into context (names + descriptions only)
  └── Full SKILL.md content loads on-demand when Skill tool is invoked

During conversation:
  ├── LLM reads skill descriptions
  ├── Decides relevance based on current context
  ├── Invokes Skill tool → full content loaded
  └── Dashboard shows tag for user-generated skills
```

---

## AGENTS.md Migration

Rename Nina's identity file and update all references:

| Current | New |
|---------|-----|
| `.my_agent/brain/CLAUDE.md` | `.my_agent/brain/AGENTS.md` |

### Files to update

**AGENTS.md rename:**
- `packages/core/src/prompt.ts:15` — `BRAIN_FILES` array (`{ rel: 'CLAUDE.md' }` → `AGENTS.md`)
- `packages/core/src/hatching/logic.ts:157,168` — `claudeMdPath` references
- `packages/core/src/hatching/logic.ts` + `hatching/index.ts` — BOTH copies of `createDirectoryStructure()` (add `.claude/skills/`, stop creating `brain/skills/`)
- `packages/core/src/hatching/steps/personality.ts:69,78` — template copy target + log message
- `packages/core/src/hatching/steps/operating-rules.ts` — comment references

**Safety hooks and debug routes:**
- `packages/core/src/hooks/safety.ts:80-85` — infrastructure guard patterns (`brain/CLAUDE.md` → `brain/AGENTS.md`, add `.claude/skills/` system skill protection)
- `packages/dashboard/src/routes/debug.ts:228-237` — personality component reads `brain/CLAUDE.md`
- `packages/dashboard/src/routes/debug.ts:376-395` — skill listing reads from old locations
- `packages/dashboard/src/routes/admin.ts:133-136` — unhatch deletes `brain/CLAUDE.md`

**SDK config plumbing:**
- `packages/core/src/brain.ts` — add `settingSources`, `settings`, `additionalDirectories` to `BrainSessionOptions` and `createBrainQuery` pass-through
- `packages/dashboard/src/ws/session-manager.ts:318-326` — add `settingSources`, `settings`, `cwd: agentDir` to Conversation Nina options
- `packages/dashboard/src/tasks/task-executor.ts:410,476-485` — add `additionalDirectories: [agentDir]`, `settingSources`, `settings` to BOTH `buildFreshQuery` and `buildResumeQuery`
- `packages/dashboard/src/ws/chat-handler.ts:25-66` — `expandSkillCommand` reads from old `FRAMEWORK_SKILLS_DIR`, must update for new skill location

**Tests:**
- All test files referencing `brain/CLAUDE.md` or `brain/skills/`
- `packages/dashboard/tests/system-prompt-builder.test.ts` — cache behavior tests
- `packages/dashboard/tests/context-foundation.test.ts`
- `packages/core/tests/hooks/infrastructure-guard.test.ts:31-38`

### What stays as CLAUDE.md

- `/home/nina/my_agent/CLAUDE.md` — developer guide (for Claude Code, not Nina)
- `packages/dashboard/CLAUDE.md` — dashboard dev instructions
- Any future per-package CLAUDE.md files for developers

---

## Skill Format Standard

Every skill follows the SDK convention. Skills must be flat (no subdirectories for grouping — SDK limitation validated via testing):

```
.my_agent/.claude/skills/
├── memory-behavior/SKILL.md       # origin: system
├── scheduling/SKILL.md            # origin: system
├── knowledge-curation/SKILL.md    # origin: system
├── customer-support/SKILL.md      # origin: user (created by Nina)
└── ...

Each skill directory:
<skill-name>/
├── SKILL.md           # Main instructions (required)
├── templates/         # Optional supporting files
├── data/              # Optional reference data (CSVs, etc.)
└── examples/          # Optional examples
```

### SKILL.md Frontmatter

```yaml
---
name: skill-name
description: One-line description — used by SDK for discovery and by notebook for search
origin: system | user-generated
---

# Skill content (markdown)

Instructions for the LLM when this skill is invoked.
```

- **`name`** — human-readable skill name
- **`description`** — keyword-rich, specific. This is what the LLM reads to decide relevance. Quality matters.
- **`origin`** — `system` skills ship with my_agent and are not shown as tags. `user` skills are created by Nina or the user and appear as toggleable tags in chat. Frontmatter is authoritative (no directory-based grouping — SDK requires flat structure).

Optional frontmatter fields from the SDK spec (`allowed-tools`, `disable-model-invocation`, etc.) are supported but not required.

---

## Always-On vs On-Demand Content

Not everything can be an on-demand skill. Some content must be in the system prompt every turn because Nina needs it before she can decide to invoke anything.

### Always-on (stays in `assembleSystemPrompt()`)

| Content | Current location | Why always-on |
|---------|-----------------|---------------|
| **conversation-role.md** | `packages/core/skills/conversation-role.md` (via `SKILL_CONTENT_FILES`) | Defines Nina's role as conversation layer. She needs to know she delegates work before she knows to invoke a task-triage skill. |
| **notebook.md** (memory behavior) | `.my_agent/brain/skills/notebook.md` (via `SKILL_CONTENT_FILES`) | When to recall/remember. Nina needs this every turn, not on-demand. |

These are **not skills** — they are operating instructions. They stay in `prompt.ts` / `assembleSystemPrompt()`, loaded alongside identity, notebook, and properties. They move to `brain/` (alongside AGENTS.md) so `assembleSystemPrompt()` can load them directly.

### On-demand (become SDK skills)

Everything else becomes an on-demand skill discovered by the SDK.

---

## Seed Skills

Extract from hardcoded logic into SKILL.md files:

### Operational Skills (origin: system)

| Skill | Current location | What it teaches Nina |
|-------|-----------------|---------------------|
| **knowledge-curation** | Morning brief prompt template + `manage_staged_knowledge` MCP tool | When to propose permanent facts, how to phrase proposals, enrichment questions |
| **morning-sequence** | Hardcoded in work loop TypeScript | What to cover in morning brief: temporal context, pending knowledge, daily priorities |
| **task-triage** | Standing orders | When to create a task vs answer directly. Judgment criteria for routing. |
| **scheduling** | `packages/core/skills/calendar/SKILL.md` | How to create/manage calendar entries via API |

### Hatching Skills (origin: system)

These already exist as framework skills and migrate as-is:

| Skill | Current location |
|-------|-----------------|
| **identity** | `packages/core/skills/identity/SKILL.md` |
| **personality** | `packages/core/skills/personality/SKILL.md` |
| **operating-rules** | `packages/core/skills/operating-rules/SKILL.md` |
| **auth** | `packages/core/skills/auth/SKILL.md` |

---

## Self-Creating Skills (Responsibilities)

Nina authors skills from experience. This is the most transformative feature of M6.8.

**UX principle:** In conversation, these are called **responsibilities**, not skills. The user says "I want you to handle customer support" — that's a responsibility. Nina uses brainstorming and elicitation to understand the responsibility fully before creating anything. The word "skill" is an implementation detail the user never sees.

### Flow

```
User defines a responsibility
  ├── Nina brainstorms: asks clarifying questions, elicits rules and constraints
  ├── Nina proposes the responsibility back: "Here's what I understand..."
  ├── User confirms or refines
  ├── Nina creates skill via MCP tool: create_skill(name, description, content)
  │   └── MCP tool writes to .my_agent/.claude/skills/<name>/SKILL.md (origin: user)
  ├── Dashboard shows new entry in notebook skills section immediately
  └── Skill is discoverable by SDK on next query (SDK re-scans filesystem each call)
```

### Other Triggers

| Trigger | Example | Result |
|---------|---------|--------|
| **Correction** | "Don't offer refunds without asking me" | Updates existing skill |
| **Lesson learned** | Task failed because of X | Skill updated to prevent X |
| **Pattern recognition** | Nina notices repeated behavior | Proposes a responsibility to the user |

> **Implementation note:** Skill creation is an MCP tool (`create_skill`, `update_skill`, `delete_skill`) — not the `Write` built-in tool. This keeps the tool boundary clean and allows validation (e.g., preventing name collisions with system skills).
>
> **Session visibility:** Skills are re-discovered on every `query()` call, including resumed sessions. A skill created by Conversation Nina is visible to a Working Nina session on its next resume — no restart needed.

### Skill Updates

When Nina receives a correction related to an existing skill:

1. Nina identifies the relevant skill via description matching
2. Updates the SKILL.md content with the new rule/correction
3. Existing skill — no new file, just an edit

### Conversation-Driven Skill Management

Users manage Working Nina skills through conversation with Conversation Nina:

- "How do you handle customer support?" → Nina explains the skill
- "Add a rule: always CC me on refund decisions" → Nina updates the skill
- "Stop doing the thing where you..." → Nina updates or disables the skill

---

## Dashboard UI

### Notebook Skills Section

Skills appear as a section in the notebook UI, alongside reference docs and operational files.

**Source:** Reads from `.my_agent/.claude/skills/` directory. Distinguishes system vs user by `origin` frontmatter field.

**Features:**

- Browse all skills (system and user-generated)
- View skill content (SKILL.md rendered as markdown)
- Search skills (indexed by notebook's existing search)
- **User-generated skills:** edit, delete, toggle on/off globally
- **System skills:** view only (not editable/deletable)

**Global toggle:** Disabling a skill globally prevents it from being discovered by the SDK. Implementation: add `disable-model-invocation: true` to the skill's YAML frontmatter. The SDK honors this field and excludes the skill from the context list. The notebook UI toggles this field via the MCP tool.

---

## Curated Skill Library

M6.8 ships with a curated set of third-party skills adapted for Nina.

### From Superpowers

Skills that work in any conversational/analytical context:

| Skill | Adaptation needed |
|-------|-------------------|
| **brainstorming** | Minimal — strip visual companion (M6.10 concern), keep question flow |
| **systematic-debugging** | None — procedural, persona-free |
| **writing-plans** | Minimal — adapt file paths |

### From BMAD

Procedural skills and technique libraries:

| Asset | Adaptation needed |
|-------|-------------------|
| **Elicitation techniques** (50 methods, CSV) | None — reference data, loaded silently |
| **Brainstorming techniques** (50 methods, CSV) | None — reference data, loaded silently |
| **review-pr** | Strip BMAD persona, keep procedure |
| **root-cause-analysis** | Strip BMAD persona, keep procedure |

### Adaptation Rules

- **Strip personas.** BMAD skills have hardcoded agent names (Mary, John). Remove all persona references. Nina's personality comes from hatching, not skills.
- **Keep procedures.** The step-by-step workflows are the value. Preserve them.
- **CSV as reference data.** Technique libraries go in `data/` subdirectory inside the skill. Loaded on demand, never announced by name to the user.

---

## Migration Plan

### What moves where

```
BEFORE (M6.7):
├── .claude/skills/                → developer skills (start-sprint, whats-next, etc.)
├── packages/core/skills/          → framework skills (identity, personality, etc.)
├── .my_agent/brain/skills/        → brain skills (notebook.md)
├── .my_agent/brain/CLAUDE.md      → Nina's identity
└── prompt.ts                      → loads everything manually

AFTER (M6.8):
├── ~/.claude/skills/              → developer skills (moved to user-level)
│   ├── start-sprint/SKILL.md
│   ├── start-overnight-sprint/SKILL.md
│   ├── start-trip-sprint/SKILL.md
│   ├── trip-review/SKILL.md
│   └── whats-next/SKILL.md
├── .my_agent/.claude/skills/      → ALL Nina skills (SDK discovers, flat)
│   ├── memory-behavior/SKILL.md   ← migrated from brain/skills/notebook.md (origin: system)
│   ├── knowledge-curation/SKILL.md ← extracted from prompt template (origin: system)
│   ├── morning-sequence/SKILL.md  ← extracted from work loop (origin: system)
│   ├── task-triage/SKILL.md       ← extracted from standing orders (origin: system)
│   ├── scheduling/SKILL.md        ← migrated from core/skills/calendar/ (origin: system)
│   ├── identity/SKILL.md          ← migrated from core/skills/identity/ (origin: system)
│   ├── personality/SKILL.md       ← migrated from core/skills/personality/ (origin: system)
│   ├── operating-rules/SKILL.md   ← migrated from core/skills/operating-rules/ (origin: system)
│   ├── auth/SKILL.md              ← migrated from core/skills/auth/ (origin: system)
│   ├── brainstorming/SKILL.md     ← curated from superpowers (origin: system)
│   ├── debugging/SKILL.md         ← curated from superpowers (origin: system)
│   └── (user-generated skills appear here over time, origin: user)
├── .my_agent/brain/AGENTS.md      → Nina's identity (renamed)
├── .my_agent/brain/conversation-role.md  → always-on (moved from core/skills/)
├── .my_agent/brain/notebook.md    → always-on (moved from brain/skills/)
└── prompt.ts                      → loads identity + always-on content, on-demand skills removed
```

### What changes in brain.ts

- Add `settingSources: ['project']` to query options
- Add `settings: { claudeMdExcludes: ['**/CLAUDE.md'] }` to query options
- Add `'Skill'` to `allowedTools`
- Conversation Nina: `cwd` stays as `.my_agent/` (skill discovery works directly)
- Working Nina: `cwd` stays as `taskDir`, add `additionalDirectories: [agentDir]` for skill discovery (no breaking changes). **Fallback:** if `additionalDirectories` does not trigger skill discovery reliably, symlink `.my_agent/.claude/skills/` into each task directory's `.claude/skills/` at task creation time (in `TaskExecutor.createTaskDir()` or equivalent). Test both approaches in S1 Phase 2.

### What changes in prompt.ts

- Update `SKILL_CONTENT_FILES` to load only always-on content (`conversation-role.md`, `notebook.md`) from `brain/` directory
- Remove `loadSkillDescriptions()` function (SDK handles skill listing)
- Remove `FRAMEWORK_SKILLS_DIR` constant (hatching skills move to `.claude/skills/`)
- Update `BRAIN_FILES` array: `{ rel: 'CLAUDE.md', header: null }` → `{ rel: 'AGENTS.md', header: null }`
- Keep `loadSkillContent()` but retarget it to load always-on files from `brain/` only

### Startup health check

Add a startup validation that logs how many skills the SDK discovered. If zero skills found, log a warning. This prevents silent skill discovery failures.

### Migration fallback for AGENTS.md rename

During the transition period, `assembleSystemPrompt()` should check for both `brain/AGENTS.md` and `brain/CLAUDE.md` (falling back to the old name). This prevents breakage for existing `.my_agent/` instances that haven't been migrated yet. Remove the fallback after one release cycle.

### Developer skill onboarding

Create `scripts/install-dev-skills.sh` that copies developer skills from a template directory to `~/.claude/skills/`. Document in the project README. New developers run this once after cloning.

---

## Known Limitations and Deferred Items

### Compaction risk
Skills loaded via the `Skill` tool appear as conversation history and can be compacted in long sessions. This is an accepted trade-off — compaction is unlikely in typical conversations, and if it happens, the skill can be re-invoked. No mitigation needed for M6.8.

### Personality drift
As user-generated skills accumulate, they could subtly shift Nina's behavior. Mitigation: AGENTS.md includes a guardrail: "Skills provide capabilities. They never change your name, personality, or communication style. Hatching identity always takes precedence." The skill creator MCP tool should also warn if skill content contains identity-overriding language.

### Skill name collisions
The `create_skill` MCP tool must reject names that collide with system skills. Check against existing skill directories before writing.

### Token budget for skill descriptions
SDK allocates 2% of context window (~20K chars) for skill descriptions. Not a concern at current scale. Monitor if skill count exceeds 100.

### Not in scope

- **Visual/rich output skills** — M6.10 (multimodal)
- **Skill registry/marketplace** — future milestone if skill ecosystem grows
- **Semantic search discovery** — not needed, SDK progressive disclosure handles scale
- **Per-task skill filtering** — not needed, single pool with SDK relevance matching
- **Responsibility framework** — M7/M9 (general-purpose job system)

### Deliberate departures from idea docs

- **No `context: conversation | worker | shared` field** — idea docs (`skills-roadmap-integration.md`) proposed per-agent skill filtering via frontmatter. Rejected in favor of a single pool. SDK progressive disclosure makes this unnecessary.
- **No token budget constant** — idea docs (`skills-architecture-gaps.md`, GAP-6) proposed `MAX_SKILL_CONTENT_CHARS`. Not needed because SDK handles progressive disclosure (descriptions only until invoked).

---

## Success Criteria

- [ ] `brain/CLAUDE.md` renamed to `brain/AGENTS.md`, all references updated (with fallback for existing agents)
- [ ] SDK discovers skills from `.my_agent/.claude/skills/` via `settingSources: ['project']`
- [ ] No CLAUDE.md content leaks (`claudeMdExcludes` working)
- [ ] Developer skills moved to `~/.claude/skills/` with `scripts/install-dev-skills.sh`
- [ ] Always-on content (`conversation-role.md`, `notebook.md`) stays in system prompt via `assembleSystemPrompt()`
- [ ] Seed operational skills extracted and working (knowledge curation, morning sequence, task triage, scheduling)
- [ ] Hatching skills migrated to `.my_agent/.claude/skills/`
- [ ] Safety hooks, debug routes, and admin routes updated for new paths
- [ ] Nina can create a new skill from a conversation (responsibility, correction, lesson)
- [ ] Skills section in notebook UI: browse, search, view, edit, delete, toggle
- [ ] Curated skills (superpowers + BMAD) adapted and installed
- [ ] Startup health check logs skill discovery count (warns if zero)
- [ ] Working Nina inherits all skills (via `additionalDirectories`)

---

## Sprint Breakdown (Suggested)

| Sprint | Name | Scope |
|--------|------|-------|
| **S1** | AGENTS.md Rename | Rename `brain/CLAUDE.md` → `brain/AGENTS.md`. Update all references (hatching, safety hooks, debug routes, admin routes, tests). Fallback: check both filenames during transition. Validate brain still works. No SDK changes. |
| **S2** | SDK Skill Discovery | Enable `settingSources: ['project']`, `claudeMdExcludes`, `Skill` tool, `additionalDirectories`. Move developer skills to `~/.claude/skills/` + `scripts/install-dev-skills.sh`. Migrate existing skills to `.my_agent/.claude/skills/`. Update prompt.ts (keep always-on content, remove on-demand skill loading). Startup health check. Frontmatter standard. |
| **S3** | Seed Skills | Extract operational skills from hardcoded logic: knowledge curation, morning sequence, task triage, scheduling. **E2E test each one** — verify Nina's behavior is unchanged. Even if it slows development. |
| **S4** | Curated Library | Adapt Superpowers skills (brainstorming, debugging, writing-plans). Adapt BMAD skills (elicitation/brainstorming techniques, review-pr, root-cause-analysis). Strip personas, keep procedures. |
| **S5** | Skill Creator | MCP tools (`create_skill`, `update_skill`, `delete_skill`). Responsibility flow: brainstorming + elicitation before creating. Corrections and lessons update existing skills. |
| **S6** | Dashboard UI + Validation | Notebook skills section (browse, search, view, edit, delete, toggle). Full E2E validation of the complete system. |

---

---

## Risk Register

From deep-dive analysis (roadmap expert + codebase expert, 2026-03-16).

### Resolved in this spec

| Risk | Resolution |
|------|-----------|
| Always-on content disappears when removing `loadSkillContent()` | `conversation-role.md` and `notebook.md` stay always-on in `assembleSystemPrompt()`. Only on-demand skills move to SDK. |
| Safety hooks / debug routes hardcode `brain/CLAUDE.md` | Full file list added to "Files to update" section |
| No fallback if SDK discovery fails | Startup health check logs skill count, warns if zero |
| Developer skills become unversioned | `scripts/install-dev-skills.sh` for onboarding |
| Existing agents break on AGENTS.md rename | Fallback: check both filenames during transition |
| S1 does too much | Split into Phase 1 (rename + validate) and Phase 2 (SDK migration) |
| `chat-handler.ts` breaks for `/my-agent:*` commands | Added to file list |
| Two copies of `createDirectoryStructure` | Both listed for update |
| `SessionManager` never sets cwd | Added to plumbing changes |

### Accepted risks

| Risk | Severity | Why accepted |
|------|----------|-------------|
| Compaction drops skill content in long sessions | MEDIUM | Unlikely in typical conversations, skill can be re-invoked |
| Personality drift via skill accumulation | LOW | AGENTS.md guardrail + MCP tool validation |
| No skill content auditing for prompt injection | LOW | Single-user deployment, brain runs with `bypassPermissions` regardless |
| No skill versioning | LOW | Not needed until community skills arrive |

### Deferred to future milestones

| Risk | Deferred to | Reason |
|------|-------------|--------|
| M6.10 needs multimodal routing hooks | M6.10 design phase | Frontmatter is extensible (YAML), add `output-type` field when needed |
| M7 needs per-task skill filtering | M7 design phase | Single pool works now, revisit when coding project skills are designed |
| Community skill installation/validation | Future milestone | No ecosystem yet, premature to design |
| Skill conflict detection (contradictory instructions) | Monitor | Not a problem at current skill count |

---

*Design approved: 2026-03-16*
*Brainstorming session: CTO + Claude — SDK validation, AGENTS.md convention, single skill pool, self-creating skills*
*Risk analysis: 2026-03-16 — roadmap expert + codebase expert deep dive*
