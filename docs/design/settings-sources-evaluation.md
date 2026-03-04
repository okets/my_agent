# settingSources Evaluation

> **Sprint:** M6.5-S1 (SDK Enhancement)
> **Author:** Opus (overnight mode)
> **Date:** 2026-02-27

---

## What settingSources Does

The Agent SDK's `settingSources` option controls which filesystem-based settings are loaded automatically by the Claude Code process:

```typescript
settingSources?: ('user' | 'project' | 'local')[]
```

| Source | Path | What it loads |
|--------|------|---------------|
| `user` | `~/.claude/settings.json` | Global user settings (model prefs, permissions) |
| `project` | `.claude/settings.json` + `CLAUDE.md` | Project-level settings and instructions |
| `local` | `.claude/settings.local.json` | Machine-specific overrides |

**When omitted or empty:** No filesystem settings are loaded (SDK isolation mode). The brain currently operates in this mode.

**Must include `'project'`** to load CLAUDE.md files automatically.

---

## What prompt.ts Currently Does

`assembleSystemPrompt()` manually constructs the system prompt from:

1. **Brain files** (`CLAUDE.md`, `memory/core/identity.md`, `contacts.md`, `preferences.md`) — always loaded
2. **Notebook reference** (`notebook/reference/*.md`) — with fallback to legacy runtime files
3. **Notebook operations** (`notebook/operations/*.md`) — standing orders, external comms rules
4. **Daily logs** (`notebook/daily/{today,yesterday}.md`) — recent context
5. **Calendar context** — passed in from CalendarScheduler
6. **Scheduled task context** — triggered tasks from CalendarScheduler
7. **Skills content** — API docs, channel docs, notebook docs (full content for specific skills)
8. **Skill command descriptions** — one-line summaries for all available skills

The assembled prompt is passed to `createBrainQuery()` as `options.systemPrompt`.

---

## Overlap Analysis

| Feature | prompt.ts | settingSources | Notes |
|---------|-----------|----------------|-------|
| CLAUDE.md loading | Yes (manual read) | Yes (`'project'`) | Direct overlap |
| Skill loading | Yes (custom logic) | No | Skills have custom 3-level hierarchy |
| Notebook/memory content | Yes (custom logic) | No | Highly custom, not a settings file |
| Calendar context | Yes (injected at query time) | No | Dynamic, per-query |
| Identity/personality | Yes (brain files) | No | Private `.my_agent/` data |
| Settings.json | No | Yes | We don't use settings.json |

---

## What settingSources Can Replace

**Potentially replaceable:**
- `CLAUDE.md` loading — but only the framework's root `CLAUDE.md`, not the private `.my_agent/brain/CLAUDE.md`

**Cannot replace:**
- Notebook content (reference, operations, daily logs) — these are agent-specific memory, not project settings
- Calendar context — dynamic, injected per query
- Skill loading — custom 3-level hierarchy (framework, brain, per-task)
- Identity/personality — private `.my_agent/` data, not a project setting
- Token-budget-aware truncation — `MAX_NOTEBOOK_CHARS`, `MAX_REFERENCE_TOTAL_CHARS`

---

## Recommendation

### Do NOT adopt settingSources in S1. Evaluate in S2.

**Rationale:**

1. **Minimal overlap:** Only `CLAUDE.md` loading overlaps, and our `CLAUDE.md` lives in `.my_agent/brain/`, not the project root's `.claude/` convention.

2. **Custom logic is essential:** prompt.ts does far more than load settings — it assembles a rich context from 7+ sources with truncation, fallbacks, and dynamic injection. settingSources can't replace this.

3. **SDK isolation is valuable:** Running without settingSources means the brain's behavior is fully controlled by our code, not by whatever files exist in `.claude/`. This prevents unexpected behavior from user-installed settings.

4. **Risk of double-loading:** If we enable `settingSources: ['project']`, the SDK would load CLAUDE.md natively AND we'd still load our own brain files. This could cause duplicate or conflicting instructions.

### S2 Simplification Plan

In Sprint S2 (Session Rewrite), evaluate whether to:

1. **Move CLAUDE.md to project root** — If we want the SDK to load it natively, we'd need `.claude/CLAUDE.md` at the project root. This conflicts with our `.my_agent/` private brain directory.

2. **Use `appendSystemPrompt`** — The SDK supports `systemPrompt: { type: 'preset', preset: 'claude_code', append: '...' }` which appends to Claude Code's default prompt. This could replace our manual prompt assembly IF we want Claude Code's default prompt as the base.

3. **Hybrid approach** — Keep prompt.ts for memory/calendar/skills, but use `settingSources: ['project']` to load the framework's root CLAUDE.md. This would require careful deduplication.

**Recommended path for S2:** Keep prompt.ts as the primary prompt assembly, but experiment with `appendSystemPrompt` for injecting our assembled content on top of Claude Code defaults.

---

## Summary (M6.5-S1 — February 2026)

| Question | Answer |
|----------|--------|
| Should we use settingSources now? | No — too little overlap, risk of conflicts |
| What should prompt.ts keep? | Everything — memory, calendar, skills, identity |
| What could settingSources add? | CLAUDE.md auto-loading (minor benefit, conflict risk) |
| When to revisit? | S2 Session Rewrite |

---

## Revision: M6.8 Skills Architecture (March 2026)

> **Date:** 2026-03-04
> **Context:** Skills architecture design session. Adopting Agent Skills Standard (SKILL.md with YAML frontmatter) and SDK native skill discovery. Re-evaluating `settingSources` specifically for skill loading.

### What Changed

The Agent SDK now has native skill support:
- `settingSources: ['project']` auto-discovers skills from `{cwd}/.claude/skills/`
- The built-in `Skill` tool enables progressive disclosure (metadata at startup, full content on demand)
- The Agent Skills Standard (YAML frontmatter) is an industry standard adopted by OpenAI, Google, Microsoft, GitHub, Cursor

We need `settingSources` for skill discovery. The original concerns about CLAUDE.md double-loading still apply, but the skill-specific value proposition now outweighs the risks.

### Resolution: Enable `settingSources: ['project']` for Skills Only

**Configuration:**
```typescript
{
  systemPrompt: assembledPrompt,        // prompt.ts owns identity, memory, calendar
  settingSources: ['project'],          // SDK discovers skills from cwd
  allowedTools: [..., 'Skill'],         // Enable native Skill tool
  cwd: agentDir                         // .my_agent/ — contains .claude/skills/
}
```

**Why this works (no double-loading):**
1. `cwd` is `.my_agent/`, which has NO `CLAUDE.md` at its root
2. Brain's CLAUDE.md lives at `.my_agent/brain/CLAUDE.md` — SDK doesn't scan subdirectories
3. The project root CLAUDE.md is at `/home/nina/my_agent/CLAUDE.md` — outside cwd
4. SDK loads skills from `.my_agent/.claude/skills/` — no conflict with prompt.ts

**Key constraint: `['project']` only, NEVER `['user']`.**
- `['user']` loads `~/.claude/skills/` — the developer's personal Claude Code skills
- These contain instructions for human coding sessions (commit formatters, PR reviewers, etc.)
- Loading them into the brain agent causes invisible behavioral conflicts

### Validation Required

Before implementation, validate:
1. Does SDK load CLAUDE.md when using a custom string `systemPrompt` (not `claude_code` preset)?
2. Does SDK walk up parent directories from `cwd` looking for CLAUDE.md?
3. Are skills in `{cwd}/.claude/skills/` discovered correctly with custom `systemPrompt`?

See task: "Validate settingSources behavior with custom systemPrompt"

### What prompt.ts Keeps

| Content | Owner | Why |
|---------|-------|-----|
| Identity, personality, operating rules | prompt.ts (from `brain/CLAUDE.md`) | Custom to this agent, not a "project setting" |
| Notebook (reference, operations, daily logs) | prompt.ts | Dynamic, token-budget-managed |
| Calendar context | prompt.ts | Injected per-query |
| Memory summaries | prompt.ts | Dynamic |
| Skill content | **SDK** (via `settingSources`) | Progressive disclosure, scales to 100+ skills |

### Previous Decision Status

The M6.5-S1 recommendation ("do not adopt settingSources") remains correct for general settings loading. This revision applies specifically to skill discovery via `settingSources: ['project']`. The two can coexist: SDK handles skill discovery, prompt.ts handles everything else.

### References

- [Skills Architecture Gaps](../ideas/skills-architecture-gaps.md) — 14 gaps, 8 risks identified
- [BMAD Skills Integration](../ideas/bmad-skills-integration.md) — Community skill compatibility
- [Skills Roadmap Integration](../ideas/skills-roadmap-integration.md) — M6.8 milestone proposal
- Agent SDK Skills docs: `platform.claude.com/docs/en/agent-sdk/skills`
