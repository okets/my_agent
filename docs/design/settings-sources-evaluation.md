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

## Summary

| Question | Answer |
|----------|--------|
| Should we use settingSources now? | No — too little overlap, risk of conflicts |
| What should prompt.ts keep? | Everything — memory, calendar, skills, identity |
| What could settingSources add? | CLAUDE.md auto-loading (minor benefit, conflict risk) |
| When to revisit? | S2 Session Rewrite |
