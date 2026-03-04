# Skills Architecture: Roadmap Integration Proposal

> **Status:** Proposal — Pending CTO review
> **Created:** 2026-03-04
> **Author:** Roadmap Expert (skills-design-review team)
> **Companion docs:**
> - [ROADMAP.md](../ROADMAP.md) — source of truth for milestones
> - [design.md](../design.md) — architecture overview (Section 5: Skill System)
> - [settings-sources-evaluation.md](../design/settings-sources-evaluation.md) — SDK settingSources analysis
> - [two-agent-architecture.md](two-agent-architecture.md) — Conversation Nina + Working Agents
> - [two-agent-roadmap-impact.md](two-agent-roadmap-impact.md) — milestone impact analysis

---

## Executive Summary

The Claude Agent SDK now has native skill support: YAML-frontmatter `SKILL.md` files, the `settingSources` option that auto-discovers skills from `.claude/skills/`, and the built-in `Skill` tool for user-invocable skills. Our current skill system is manually assembled via `prompt.ts` and uses a flat markdown format without frontmatter metadata. This proposal embeds a skills architecture upgrade into the roadmap — aligning with SDK conventions, enabling the two-agent architecture's skill needs, and preparing for community skill sharing.

**Recommendation:** Create a new milestone **M6.8: Skills Architecture** after M6.7 (Two-Agent Refactor) and before M6.6 (Agentic Lifecycle, refocused). This is a natural fit because:
1. M6.7 establishes the two-agent model (Conversation Nina + Working Agents) which creates divergent skill needs
2. Skills architecture must be solid before M6.6 defines how ongoing responsibilities use skills
3. It is lower risk and lower effort than M6.7, making it a good stabilization point

---

## Current State

### What Exists Today

**Three-level skill hierarchy** (design.md Section 5):

| Level | Location | Purpose | Loaded by |
|-------|----------|---------|-----------|
| Framework | `packages/core/skills/` | Hatching commands (`/my-agent:identity`, etc.) | `prompt.ts` auto-discovery |
| Brain | `.my_agent/brain/skills/` | Agent-specific (channels, task-api, notebook) | `prompt.ts` auto-discovery |
| Project | Per-task `.claude/skills/` | Task-specific (debugging, code-review) | Not yet implemented |

**Current format:** Plain markdown files (e.g., `# /my-agent:identity\n\nDescription...`). No YAML frontmatter, no structured metadata.

**Current loading:** `prompt.ts` scans skill directories, loads content into system prompt. Skills are injected as full text for specific skills and one-line command summaries for all available skills.

**settingSources evaluation (M6.5-S1):** Concluded "do not adopt" — overlap was minimal because our prompt assembly does far more than settings loading. This remains correct for general settings, but the skill-specific aspect of `settingSources` deserves separate evaluation.

### What the SDK Offers

The Agent SDK has evolved to include native skill support:

1. **YAML frontmatter on SKILL.md files** — Structured metadata (name, description, tools required, etc.) that the SDK can parse and use for skill selection
2. **`settingSources: ['project']`** — Auto-discovers and loads skills from `.claude/skills/` directories based on `cwd`
3. **`Skill` tool** — Built-in tool that invokes user-defined skills by name, expanding the skill's full prompt into the conversation
4. **`cwd`-based skill selection** — Skills load from the working directory's `.claude/skills/`, enabling per-context skill sets

These features mean the SDK can handle skill discovery and loading natively, potentially simplifying our `prompt.ts`.

---

## What Needs to Change

### 1. SKILL.md Format: YAML Frontmatter Adoption

**Current:** Plain markdown, command name in heading.

**Target:** Agent Skills Standard format with YAML frontmatter.

```markdown
---
name: identity
description: Re-run the identity setup step
tools: []
invocable: true        # User can invoke via /my-agent:identity
context: conversation  # vs "worker" — which agent type uses this
---

# Identity Setup

Re-run the identity setup step. Updates your name, purpose, and key contacts.
...
```

**Why:** Structured metadata enables:
- SDK-native skill discovery (no custom scanning code)
- Conversation vs Worker skill filtering (see below)
- Tool requirements per skill
- Community skill compatibility

**Effort:** Low. Existing skills are simple markdown. Adding frontmatter is mechanical.

### 2. Skill Directory Restructuring

**Current:**
```
packages/core/skills/     → Framework skills (hatching commands)
.my_agent/brain/skills/   → Brain skills (channels, task-api, notebook)
```

**Target:** Align with SDK conventions while preserving the three-level hierarchy:

```
packages/core/skills/                    → Framework skills (shipped with repo)
.my_agent/.claude/skills/                → Brain skills (SDK auto-discovers from cwd)
.my_agent/tasks/{task}/.claude/skills/   → Per-task skills (working agents via cwd)
```

**Key insight:** The SDK's `settingSources: ['project']` loads skills from `{cwd}/.claude/skills/`. By setting `cwd` correctly for each agent type, we get automatic skill loading:

| Agent | cwd | Skills loaded |
|-------|-----|---------------|
| Conversation Nina | `.my_agent/` | Brain skills from `.my_agent/.claude/skills/` |
| Working Agent | `.my_agent/tasks/{task}/` | Task-specific skills from task folder's `.claude/skills/` |

**Migration:** Move `.my_agent/brain/skills/*.md` to `.my_agent/.claude/skills/*/SKILL.md`. One-time, reversible.

### 3. Conversation vs Worker Skill Split

The two-agent architecture creates two distinct agent roles with different skill needs:

| Skill Category | Conversation Nina | Working Agent |
|----------------|-------------------|---------------|
| Channel management | Yes | No (delivers via tools) |
| Task creation | Yes | No |
| Memory tools guide | Yes | Yes (shared) |
| Notebook editing | Yes | Yes (shared) |
| Task-api reference | Yes | No |
| Debugging | No | Yes (per-task) |
| Code review | No | Yes (per-task) |
| Ad-hoc template | No | Yes |
| Project template | No | Yes |

**Implementation:** The `context` frontmatter field (`conversation` | `worker` | `shared`) controls which skills load for each agent type. `prompt.ts` (or SDK auto-loading) filters based on agent context.

### 4. Personality / Skills / Rules Separation

The current system conflates three concerns in `brain/CLAUDE.md`:

| Concern | Current Location | Target Location |
|---------|-----------------|-----------------|
| Identity & personality | `brain/CLAUDE.md` | `brain/CLAUDE.md` (unchanged) |
| Operational skills | Mixed in CLAUDE.md + skills/ | `.claude/skills/` exclusively |
| Operating rules | `brain/CLAUDE.md` + notebook | `brain/CLAUDE.md` (rules stay, skills move out) |

**Goal:** `CLAUDE.md` defines WHO the agent is and HOW it operates. Skills define WHAT it can do. Clean separation means skills can be added/removed without touching identity.

### 5. Growing Skill Pool Architecture

Skills should grow over time. Three sources:

| Source | Mechanism | Example |
|--------|-----------|---------|
| **Framework** | Ships with repo updates | Task management, memory, communication |
| **User-created** | Brain creates via conversations | "Draft customer emails in formal tone" |
| **Community** | Manual installation (future: skill registry) | BMAD methodology, industry-specific workflows |

**Community skill support** is a future-facing capability. For now, the architecture should not block it — skills must be self-contained SKILL.md files with frontmatter metadata, installable by copying into `.claude/skills/`.

### 6. BMAD Technique Library

BMAD (Business/Market Analysis and Design) is a methodology framework that provides structured techniques for common business and development workflows. It organizes complex processes into reusable skill templates.

**Relevance to my_agent:**
- Task templates (`task_templates/`) already define HOW working agents operate by type
- BMAD techniques could enhance these templates with proven methodologies
- Example: A "project" template could reference a BMAD "requirements analysis" technique

**Integration point:** BMAD techniques map to skills that working agents can load for specific task types. This is a natural extension of the per-task skill system — the task template references which BMAD skills to load.

**Timing:** After the core skills architecture is solid. BMAD adoption is an enhancement, not a prerequisite.

---

## Roadmap Integration

### Option A: New Milestone M6.8 (Recommended)

Insert **M6.8: Skills Architecture** after M6.7 and before M6.6 (refocused):

```
M6.5 (done) → M6.7 (Two-Agent Refactor) → M6.8 (Skills Architecture) → M6.6 (Agentic Lifecycle) → M7 → M8 → ...
```

**Rationale:**
- M6.7 establishes the two-agent model. Skills architecture builds on it.
- M6.6's ongoing responsibilities need skills to define their procedures.
- M7's coding projects need per-task skill loading to work.
- Effort is moderate (3 sprints), lower risk than M6.7.

**Sprint breakdown:**

| Sprint | Name | Scope |
|--------|------|-------|
| S1 | Skill Format + Migration | YAML frontmatter standard, migrate existing skills, update `prompt.ts` to parse frontmatter, validate skill loading unchanged |
| S2 | SDK Integration + cwd Routing | Evaluate `settingSources: ['project']` for skill loading, implement cwd-based skill routing (Conversation Nina vs Working Agent), per-task skill assignment in task templates |
| S3 | Validation + Documentation | E2E tests for skill loading in both agent contexts, skill authoring guide, community skill installation path, BMAD technique library evaluation |

### Option B: Fold into M6.7 as Additional Sprint

Add S6 to M6.7:

```
M6.7-S1: Task Folder Infrastructure
M6.7-S2: Working Agent Spawn
M6.7-S3: Orchestrator + Calendar
M6.7-S4: DB Index + Migration
M6.7-S5: E2E Validation
M6.7-S6: Skills Architecture   ← NEW
```

**Pros:** Skills are closely tied to the two-agent model. Building them together avoids a second stabilization phase.
**Cons:** M6.7 is already a 5-sprint foundational refactor. Adding scope increases risk.

### Option C: Distribute Across Existing Milestones

- YAML frontmatter + migration → ad-hoc sprint (pre-M6.7)
- cwd routing + SDK integration → M6.7-S2 (Working Agent Spawn)
- BMAD + community skills → Future Wishlist

**Pros:** No new milestone. Changes land where they're needed.
**Cons:** No cohesive validation. Skills architecture is piecemeal.

### Recommendation: Option A

A standalone M6.8 gives skills a proper design-test-validate cycle without bloating M6.7. The two-agent refactor (M6.7) can proceed with the current skill system, and M6.8 upgrades it afterward. This follows the project's established pattern: foundation first, then alignment.

---

## Updated Dependency Graph

```
M6.5 SDK Alignment (done)
        │
        ▼
M6.7 Two-Agent Refactor (NEW — foundational)
        │
        ▼
M6.8 Skills Architecture (NEW — alignment)
        │
        ▼
M6.6 Agentic Lifecycle (refocused — uses skills for responsibilities)
        │
  ┌─────┼─────┐
  ▼     ▼     ▼
 M7    M8    M9
              │
              ▼
             M10
```

**Why M6.8 before M6.6:**
- M6.6's `work-patterns.md` and ongoing responsibilities are essentially skills (procedures that define what to do). The skills architecture should be in place before defining how responsibilities load their procedures.
- M6.6's fact extraction and context refresher don't depend on skills, but the hatching step for `work-patterns.md` benefits from the skill format standard.

---

## Design Spec Required

Before M6.8 sprints begin, a design spec should be written at `docs/design/skills-architecture.md` covering:

1. SKILL.md format specification (YAML frontmatter fields, required vs optional)
2. Skill directory conventions (framework, brain, per-task)
3. SDK integration strategy (`settingSources` vs custom loading vs hybrid)
4. Conversation vs Worker skill filtering mechanism
5. Skill installation/removal protocol
6. Community skill compatibility requirements
7. BMAD technique integration pattern
8. Migration plan from current format

---

## Impact on Existing Roadmap Items

| Milestone | Impact | Notes |
|-----------|--------|-------|
| M6.7 Two-Agent Refactor | None | Proceeds with current skill system. Working agents get skills via system prompt. |
| M6.6 Agentic Lifecycle | Enhanced | Responsibilities and procedures align with skill format. `work-patterns.md` hatching step can reference skill conventions. |
| M7 Coding Projects | Simplified | Per-task skills for coding (debugging, code-review, testing) load automatically via cwd. No custom wiring needed. |
| M8 Operations Dashboard | Minor | Skill browser view (list installed skills, toggle active). Low priority but natural addition. |
| M9/M10 | None | Channel skills already exist; no change needed. |

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| SDK `settingSources` doesn't fit our prompt assembly model | Medium | High | Hybrid approach: SDK loads skills, `prompt.ts` loads everything else. The M6.5-S1 evaluation already explored this boundary. |
| YAML frontmatter breaks existing skill loading | Low | Medium | Migration sprint validates all existing skills load correctly with new format. Backward compatibility: frontmatter is optional initially. |
| Two-agent skill split creates maintenance burden | Medium | Low | `shared` context tag avoids duplication. Most skills are either conversation-only or task-specific. |
| BMAD integration adds complexity without clear value | Low | Low | BMAD is evaluation-only in S3. No commitment until validated against real task templates. |
| Community skills introduce security risks | Medium | Medium | Skills are markdown instructions, not executable code. They influence behavior but don't run code directly. Standard review before installation. |

---

## Relationship to Ideas Backlog

This proposal should be added to the ROADMAP.md Ideas Backlog table. If approved, it moves to a design spec and then to milestone definition.

| Idea | Status | Path |
|------|--------|------|
| Skills Architecture | Proposal | [ideas/skills-roadmap-integration.md](ideas/skills-roadmap-integration.md) |

---

*Created: 2026-03-04*
*Author: Roadmap Expert (skills-design-review team)*
