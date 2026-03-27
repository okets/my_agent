# Plan: Debrief Worker Architecture

> **Status:** Superseded by M7-S8 sprint plan (2026-03-27)
> **Superseded by:** `docs/sprints/m7-s8-debrief-workers/plan.md`
> **Branch:** `feat/debrief-workers`
>
> This was the earlier draft. The S8 sprint plan is the authoritative version.
> Key differences: S8 adds WhatsApp message split fix, brain mediator framing verification,
> conversation voice verification, and a natural recreation validation process.

## Problem

The debrief system has three design flaws:

1. **Hardcoded handler** — `debrief-prep` is a TypeScript function that reads fixed notebook paths. When the user asks Nina to "add Thailand news to the brief," Nina can't modify the handler. She updated standing orders instead, which the handler doesn't read.

2. **No worker→debrief pipeline** — `notify: "debrief"` exists as a value but nothing collects debrief-queued results. Workers produce summaries, but no collector assembles them into a brief.

3. **User-created automations lose their manifest** — The `daily-summary` automation was created via chat (`create_automation`), stored only in DB, with no `.md` manifest file on disk. This is a triage issue: if the DB is rebuilt from markdown (our core principle), this automation vanishes.

## Current Architecture

```
[Daily log + Summaries + Properties + Calendar]
    → debrief-prep handler (hardcoded TypeScript, no LLM tools)
    → current-state.md (notebook context for system prompt)
    → request_debrief MCP tool (returns cached or fresh)
    → Conversation Nina presents it + does live web searches inline (slow, blocks chat)

Separate user-created automation (DB only, no manifest):
    daily-summary (SDK agent, 9 AM, has web access, notify: debrief)
    → Fetches news, AQI, events via WebSearch
    → Writes to notebook summaries

System automation (has manifest):
    system-daily-summary (handler, 11 PM, no web, notify: none)
    → Compresses yesterday's daily log into summaries/daily/{date}.md
```

## Target Architecture

```
Workers (scheduled, agent-based, instruction files, full tool access):
  ├── thailand-news      (daily before debrief, notify: debrief)
  ├── chiang-mai-aqi     (daily before debrief, notify: debrief)
  ├── chiang-mai-events  (weekly, notify: debrief)
  ├── project-status     (daily before debrief, reads ROADMAP.md, notify: debrief)
  └── test-watcher       (6h, runs tests, notify: debrief, escalates via needs_review on new failures)

Notebook Context (keep as handler — no LLM needed):
  └── debrief-context    (daily, reads summaries/properties/calendar/staged-knowledge)
                          Produces: current-state.md (unchanged contract)

Debrief Reporter (new system job):
  └── Scheduled, defaults to 8:00 AM, configurable
      → Runs debrief-context handler (notebook assembly)
      → Queries completed debrief-pending jobs since last report
      → Reads worker outputs from run_dir/status-report.md
      → Assembles full brief
      → Delivers via notify: immediate (WhatsApp/web)

On-demand (unchanged):
  └── request_debrief MCP tool — Conversation Nina can trigger anytime
```

## Key Design Decisions

### D1: Keep `current-state.md` production as a handler

Notebook context assembly (summaries, properties, calendar, staged knowledge) is file concatenation — no LLM needed. Rename handler from `debrief-prep` to `debrief-context`. Remove the `runDebriefPrep()` LLM call. **Write context directly.** System prompt builder continues reading `current-state.md` unchanged.

### D2: Workers are instruction-based automations with full tool access

Workers use the agent execution path: markdown instructions + full tools (including WebSearch, WebFetch). Nina can create them via `create_automation`. User says "add X to the brief" → Nina creates a worker with `notify: "debrief"`.

**Fix required:** Add `WebSearch` and `WebFetch` to `WORKER_TOOLS` in `automation-executor.ts`.

### D3: Debrief Reporter is a new system job

A scheduled automation (default 8:00 AM, configurable) that:
1. Runs `debrief-context` handler to refresh `current-state.md`
2. Queries jobs: `SELECT * FROM jobs JOIN automations WHERE automations.notify = 'debrief' AND jobs.status = 'completed' AND jobs.completed > :lastDebrief`
3. Reads each worker's `{run_dir}/status-report.md` (falls back to `summary` column)
4. Assembles the full brief as structured sections
5. Has `notify: immediate` so the brief is delivered to the user

This replaces the current `debrief-prep` handler as the user-facing brief.

### D4: Worker outputs live in run_dir

Current `summary` column is capped at 500 chars. Worker results need more. Workers write their full output to `{run_dir}/status-report.md`. The collector reads from there. No schema change needed. Run dirs are pruned after 7 days — safe margin for daily collection.

### D5: Escalation via `needs_review` (already exists)

Workers with `autonomy: full` can still escalate by emitting `needs_review` in their response. The automation processor already handles this: `needs_review` **always alerts immediately** regardless of the automation's `notify` setting. Conversation Nina presents it, user responds, worker session resumes.

For the test-watcher: instructions say "If a NEW test failure appears (not the known authSource issue), mark as needs_review with the failure details. Routine passes go to debrief."

### D6: Worker scheduling — run before debrief reporter

Workers must complete before the debrief reporter fires:
- Workers: 1 hour before debrief (e.g., `0 7 * * *` if debrief is at 8 AM)
- Debrief reporter: configurable (default `0 8 * * *`)
- Collector tolerates missing reports gracefully (shows what's available)

### D7: Fix manifest persistence for user-created automations

`create_automation` MCP tool currently writes to DB only. Must also write a `.md` manifest file to `.my_agent/automations/{id}.md` with frontmatter + instructions body. This ensures markdown-is-source-of-truth: if DB is rebuilt, user-created automations survive.

**Also:** Migrate the orphaned `daily-summary` automation — create its missing manifest from DB state before deleting and replacing with the new workers.

## Implementation Tasks

### Task 1: Fix `create_automation` to write manifest files

- In automation MCP server (`mcp/automation-server.ts`), after `automationManager.create()`, also write a `.md` file with YAML frontmatter + instructions body
- Migrate orphaned `daily-summary`: extract its config from DB, create manifest, then disable it (replaced by new workers)
- **Risk:** Low. Additive — doesn't break existing automations.

### Task 2: Add WebSearch/WebFetch to WORKER_TOOLS

- Update `WORKER_TOOLS` in `automation-executor.ts` to include `WebSearch` and `WebFetch`
- **Risk:** Low. Grants workers web access they already need.

### Task 3: Rename `debrief-prep` → `debrief-context`, simplify

- Rename handler in `handler-registry.ts`
- Remove the `runDebriefPrep()` LLM call — write assembled context directly to `current-state.md`
- Keep all notebook reading logic (summaries, properties, calendar, staged knowledge)
- Update `debrief.md` manifest: `handler: debrief-context`, `notify: none` (no longer user-facing)
- **Risk:** Low. Same code, simplified.

### Task 4: Add debrief collector query

- Add `getDebriefPendingJobs(since: string)` to `ConversationDatabase`
- Query: completed jobs since `since` where automation's notify = "debrief"
- Return: job ID, automation name, summary, run_dir, completed timestamp
- **Risk:** Low. New DB method, no schema change.

### Task 5: Create debrief reporter system job

- New handler `debrief-reporter` in `handler-registry.ts`:
  1. Run `debrief-context` handler (refresh `current-state.md`)
  2. Call `getDebriefPendingJobs()` with last reporter run time
  3. Read `{run_dir}/status-report.md` for each job (fallback to summary)
  4. Assemble brief: notebook context + worker sections
  5. Return assembled brief as deliverable
- New manifest `debrief-reporter.md`: `handler: debrief-reporter`, `cron: "0 8 * * *"`, `notify: immediate`, `system: true`
- Update existing `debrief.md`: change to `notify: none`, keep running for `current-state.md` updates
- **Risk:** Medium. New handler + integration with collector. Test thoroughly.

### Task 6: Update `request_debrief` MCP tool

- Use the same collector logic as the reporter (share the function)
- Returns assembled brief on-demand when Conversation Nina calls it
- **Risk:** Low. Same data, different trigger.

### Task 7: Create seed worker automations

Markdown files in `.my_agent/automations/`:

- `thailand-news.md` — Daily Thai/CM news from local sources, English summaries
- `chiang-mai-aqi.md` — Daily AQI from aqicn.org with health advisories
- `chiang-mai-events.md` — Weekly time-bound events (shows, festivals, fairs)
- `project-status.md` — Daily, reads `docs/ROADMAP.md`, summarizes sprint state

Each: `notify: debrief`, `autonomy: full`, cron 1 hour before debrief reporter.

- **Risk:** Low. New markdown files.

### Task 8: Update test-watcher

- Change `notify` from `immediate` to `debrief`
- Update instructions: "Escalate via needs_review if a NEW failure appears. Routine passes go to debrief."
- **Risk:** Low.

### Task 9: Disable orphaned `daily-summary`

- After seed workers are running and verified, disable the orphaned `daily-summary` automation
- Keep `system-daily-summary` (11 PM log compression) — it serves a different purpose
- **Risk:** Low. Replaced by individual workers.

### Task 10: Update standing orders

- "Add X to the brief" = create a worker automation with `notify: debrief`
- Remove stale guidance about hardcoded debrief
- **Risk:** None.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Workers not completing before reporter | Brief misses data | Stagger crons. Collector shows what's available, doesn't fail on missing |
| Run_dir pruning deletes worker output | Collector can't read results | Pruning is 7 days. Brief is daily. Safe margin |
| Breaking `current-state.md` contract | System prompt builder loses context | Task 3 preserves output unchanged. Reporter calls context handler first |
| WebSearch failures in workers | Empty brief section | Workers write "No data available". Conversation Nina skips gracefully |
| Orphaned automation pattern repeats | Future user automations lost on DB rebuild | Task 1 fixes `create_automation` to always write manifest files |
| Reporter assembles stale data | User sees yesterday's news | Worker crons run 1h before reporter. Collector filters by completion time |

## Execution Order

```
Task 1  (fix create_automation manifest persistence)
Task 2  (add WebSearch/WebFetch to WORKER_TOOLS)
Task 3  (rename/simplify debrief-context handler)
Task 4  (DB collector query)
Task 5  (debrief reporter system job)     — depends on 3, 4
Task 6  (update request_debrief MCP tool) — depends on 4
Task 7  (seed worker automations)         — depends on 2
Task 8  (update test-watcher)
Task 9  (disable orphaned daily-summary)  — depends on 7 verified
Task 10 (standing orders)
```

Tasks 1-4 can be parallelized. Tasks 5-6 depend on 3+4. Tasks 7-8 depend on 2. Task 9 is last.
