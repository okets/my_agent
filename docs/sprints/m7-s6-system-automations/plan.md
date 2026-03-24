# M7-S6: System Automations + Calendar-as-Timeline

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert work-loop jobs to automation manifests (user + system automations), add system spaces for infrastructure scripts, remove WorkLoopScheduler, and rewire the calendar UI to use the timeline API.

**Architecture:**

Three categories of entity get the `system: true` flag:

| Entity | Location | Editable | Deletable | Example |
|--------|----------|----------|-----------|---------|
| System space | `spaces/` (repo root) | No (framework code) | No | `system-debrief-tools/` |
| System automation | `{agentDir}/automations/` | No (hidden, protected) | No | `system-daily-summary.md` |
| User automation | `{agentDir}/automations/` | Yes | Yes | `debrief.md` |

**Key decisions:**
- System spaces ship with the repo at `spaces/`, alongside `skills/` and `plugins/`
- SpaceSyncService watches both `spaces/` (repo) and `{agentDir}/spaces/` (user), marks repo spaces as `system: true`
- Working Nina reads/writes notebook files directly via tools — no special handler needed
- Fact staging side effects (attempt counter increment) become a system space script
- Calendar view rewired to timeline API — past shows jobs, future shows projected cron runs
- All 5 work-loop jobs converted: debrief, daily-summary, weekly-review, weekly-summary, monthly-summary

**Spec:** `docs/superpowers/specs/2026-03-22-m7-spaces-automations-jobs.md`

**Depends on:** S1-S5 (spaces, automations, triggers, cleanup)

---

## Task 1: Add `system` flag to Space and Automation types

**Files:**
- Modify: `packages/core/src/spaces/types.ts`
- Modify: `packages/core/src/spaces/automation-types.ts`
- Modify: `packages/dashboard/src/conversations/db.ts`

- [ ] Step 1: Add `system?: boolean` to `SpaceManifest` and `Space` interfaces in `types.ts`
- [ ] Step 2: Add `system?: boolean` to `AutomationManifest` interface in `automation-types.ts`
- [ ] Step 3: Add `system INTEGER DEFAULT 0` column to `spaces` table in db.ts (migration pattern)
- [ ] Step 4: Add `system INTEGER DEFAULT 0` column to `automations` table in db.ts
- [ ] Step 5: Update `upsertSpace()` and `upsertAutomation()` to handle `system` field
- [ ] Step 6: Update `listSpaces()` and `listAutomations()` to accept `excludeSystem?: boolean` filter
- [ ] Step 7: Verify build: `npx tsc --noEmit`

**Commit:** `feat(m7-s6): add system flag to Space and Automation types + DB schema`

---

## Task 2: Hide system entities from dashboard + MCP

**Files:**
- Modify: `packages/dashboard/src/state/state-publisher.ts`
- Modify: `packages/dashboard/src/mcp/space-tools-server.ts`
- Modify: `packages/dashboard/src/mcp/automation-server.ts`
- Modify: `packages/core/src/prompt.ts`

- [ ] Step 1: `_getAutomationSnapshots()` in StatePublisher — filter out `system: true` automations from the widget broadcast
- [ ] Step 2: `list_spaces` MCP tool — exclude system spaces from results
- [ ] Step 3: `list_automations` MCP tool — exclude system automations from results
- [ ] Step 4: `create_automation` MCP tool — reject `system: true` in input (user can't create system automations)
- [ ] Step 5: `loadAutomationHints()` in prompt.ts — exclude system automations from brain hints (they're infrastructure, brain doesn't need to know)
- [ ] Step 6: Verify build

**Commit:** `feat(m7-s6): hide system entities from dashboard widget and MCP tools`

---

## Task 3: SpaceSyncService — watch repo `spaces/` directory

**Files:**
- Modify: `packages/dashboard/src/app.ts`

- [ ] Step 1: Create a second SpaceSyncService instance for repo spaces:
```typescript
const repoSpacesDir = join(process.cwd(), "spaces");
if (existsSync(repoSpacesDir)) {
  const repoSpaceSync = new SpaceSyncService({
    spacesDir: repoSpacesDir,
    onSpaceChanged: (payload) => {
      db.upsertSpace({ ...payload, system: true });
      app.emit("space:updated", { ...payload, system: true });
    },
    onSpaceDeleted: (name) => {
      db.deleteSpace(name);
      app.emit("space:deleted", name);
    },
  });
  await repoSpaceSync.fullSync();
  await repoSpaceSync.start();
}
```
- [ ] Step 2: Ensure user spaces (from `{agentDir}/spaces/`) are NOT marked as system
- [ ] Step 3: Add graceful stop for repo space sync in App.destroy()
- [ ] Step 4: Verify build

**Commit:** `feat(m7-s6): watch repo spaces/ directory for system spaces`

---

## Task 4: Create system space — `system-debrief-tools`

**Files:**
- Create: `spaces/system-debrief-tools/SPACE.md`
- Create: `spaces/system-debrief-tools/src/assemble-context.ts`
- Create: `spaces/system-debrief-tools/src/increment-facts.ts`
- Create: `spaces/system-debrief-tools/package.json`

The context assembly script that the debrief automation references. Extracts logic from `scheduler/jobs/debrief-prep.ts` and `scheduler/work-loop-scheduler.ts:handleDebriefPrep()`.

- [ ] Step 1: Create `SPACE.md` manifest:
```yaml
---
name: system-debrief-tools
tags: [system, debrief]
system: true
runtime: node
entry: src/assemble-context.ts
io:
  input:
    agentDir: string
  output:
    context: stdout
maintenance:
  on_failure: alert
  log: DECISIONS.md
created: 2026-03-24
---

# System Debrief Tools

Assembles notebook context for debrief generation. Reads daily logs, summaries,
properties, staged facts, and calendar context. Also handles fact staging
side effects (attempt counter increment).
```

- [ ] Step 2: Create `src/assemble-context.ts` — port context assembly logic from `handleDebriefPrep()`:
  - Read yesterday's daily summary
  - Read weekly/monthly summaries
  - Read today's daily log
  - Read user info
  - Read properties + detect stale ones
  - Read staged facts + format them
  - Read calendar context (if available)
  - Output assembled context as JSON to stdout

- [ ] Step 3: Create `src/increment-facts.ts` — port fact staging logic:
  - Read all staged fact files from `knowledge/extracted/`
  - Increment attempt counters
  - Write updated files back
  - Output count of incremented facts

- [ ] Step 4: Create `package.json` with `tsx` as dev dependency for TypeScript execution
- [ ] Step 5: Test: `cd spaces/system-debrief-tools && npx tsx src/assemble-context.ts '{"agentDir": "{agentDir}"}'`

**Commit:** `feat(m7-s6): create system-debrief-tools space with context assembly scripts`

---

## Task 5: Create system space — `system-summary-tools`

**Files:**
- Create: `spaces/system-summary-tools/SPACE.md`
- Create: `spaces/system-summary-tools/src/daily-summary.ts`
- Create: `spaces/system-summary-tools/src/weekly-summary.ts`
- Create: `spaces/system-summary-tools/src/monthly-summary.ts`
- Create: `spaces/system-summary-tools/src/weekly-review.ts`
- Create: `spaces/system-summary-tools/package.json`

Port logic from `scheduler/jobs/daily-summary.ts`, `weekly-summary.ts`, `monthly-summary.ts`, `weekly-review.ts`.

- [ ] Step 1: Create `SPACE.md` manifest (system: true, runtime: node)
- [ ] Step 2: Port `daily-summary.ts` — reads daily log, outputs raw content for LLM summarization
- [ ] Step 3: Port `weekly-summary.ts` — reads last 7 daily summaries, outputs for compression
- [ ] Step 4: Port `monthly-summary.ts` — reads weekly summaries, outputs for compression
- [ ] Step 5: Port `weekly-review.ts` — reads knowledge/reference files, outputs review actions
- [ ] Step 6: Create `package.json`
- [ ] Step 7: Test each script

**Commit:** `feat(m7-s6): create system-summary-tools space with summary scripts`

---

## Task 6: Create user automation — `debrief.md`

**Files:**
- Create template: `packages/dashboard/src/hatching/templates/debrief-automation.md`

This is the user-facing debrief automation. Created during hatching, fully editable by the user.

- [ ] Step 1: Create the automation manifest template:
```yaml
---
name: Debrief
status: active
trigger:
  - type: schedule
    cron: "0 8 * * *"
spaces: [system-debrief-tools]
model: sonnet
notify: immediate
autonomy: full
once: false
created: {{created_date}}
---

# Debrief

Generate a daily briefing by reading notebook context and presenting a summary
of past activity and upcoming plans.

## Instructions

1. Run the system-debrief-tools space to assemble notebook context
2. Read the assembled context from stdout
3. Write a briefing to notebook/operations/current-state.md with sections:
   - Today — current events, deadlines, plans
   - This Week Ahead — upcoming milestones
   - This Month Ahead — bigger picture
   - Yesterday — key events
   - Past 7 Days — weekly highlights
   - Past 30 Days — monthly highlights
4. Only include sections with data. Skip empty sections.
5. Hard cap: 3000 characters.
6. After generating: run increment-facts.ts to update fact staging counters
```

- [ ] Step 2: Wire into hatching flow — when hatching completes, copy template to `{agentDir}/automations/debrief.md` with user's preferred schedule time

**Commit:** `feat(m7-s6): create debrief user automation template`

---

## Task 7: Create system automations

**Files:**
- Create template: `packages/dashboard/src/hatching/templates/system-daily-summary.md`
- Create template: `packages/dashboard/src/hatching/templates/system-weekly-review.md`
- Create template: `packages/dashboard/src/hatching/templates/system-weekly-summary.md`
- Create template: `packages/dashboard/src/hatching/templates/system-monthly-summary.md`

- [ ] Step 1: `system-daily-summary.md`:
```yaml
---
name: Daily Summary
status: active
system: true
trigger:
  - type: schedule
    cron: "0 23 * * *"
spaces: [system-summary-tools]
model: haiku
notify: none
autonomy: full
once: false
created: {{created_date}}
---

# Daily Summary

Compress today's daily log into a structured summary.

## Instructions

1. Run system-summary-tools daily-summary.ts to read today's log
2. Summarize into sections: Key Events, Decisions Made, Open Items
3. Write to notebook/summaries/daily/YYYY-MM-DD.md
4. Only include sections with data.
```

- [ ] Step 2: `system-weekly-review.md` (system: true, cron: `0 20 * * 0`, status: disabled)
- [ ] Step 3: `system-weekly-summary.md` (system: true, cron: `0 21 * * 0`, status: disabled)
- [ ] Step 4: `system-monthly-summary.md` (system: true, cron: `0 22 1 * *`, status: disabled)
- [ ] Step 5: Wire into hatching — copy all system automation templates to `{agentDir}/automations/` on hatch

**Commit:** `feat(m7-s6): create system automation templates (daily-summary, weekly-review, weekly/monthly-summary)`

---

## Task 8: Extract timezone utility

**Files:**
- Create: `packages/dashboard/src/utils/timezone.ts`
- Modify: `packages/dashboard/src/automations/automation-scheduler.ts`

- [ ] Step 1: Extract `getResolvedTimezone()` and `isValidTimezone()` from `work-patterns.ts` into `utils/timezone.ts`
- [ ] Step 2: Update `AutomationScheduler` to use the timezone utility for cron evaluation
- [ ] Step 3: Verify build

**Commit:** `refactor(m7-s6): extract timezone utility from work-patterns`

---

## Task 9: Remove WorkLoopScheduler

**Files:**
- Delete: `packages/dashboard/src/scheduler/work-loop-scheduler.ts`
- Delete: `packages/dashboard/src/scheduler/work-patterns.ts`
- Delete: `packages/dashboard/src/scheduler/query-model.ts`
- Delete: `packages/dashboard/src/scheduler/jobs/debrief-prep.ts`
- Delete: `packages/dashboard/src/scheduler/jobs/daily-summary.ts`
- Delete: `packages/dashboard/src/scheduler/jobs/weekly-review.ts`
- Delete: `packages/dashboard/src/scheduler/jobs/weekly-summary.ts`
- Delete: `packages/dashboard/src/scheduler/jobs/monthly-summary.ts`
- Modify: `packages/dashboard/src/app.ts` — remove WorkLoopScheduler init
- Modify: `packages/dashboard/src/server.ts` — remove work-loop route registration
- Delete: `packages/dashboard/src/routes/work-loop.ts`
- Delete: `packages/dashboard/src/routes/work-patterns-settings.ts`

- [ ] Step 1: Grep for all imports of WorkLoopScheduler, work-patterns, query-model, job handlers
- [ ] Step 2: Remove from app.ts — delete WorkLoopScheduler construction, start, stop
- [ ] Step 3: Remove work-loop route registration from server.ts
- [ ] Step 4: Delete all files listed above
- [ ] Step 5: Remove `work_loop_runs` table creation from db.ts
- [ ] Step 6: Add `DROP TABLE IF EXISTS work_loop_runs` migration
- [ ] Step 7: Delete work-loop test files
- [ ] Step 8: Grep for orphaned references — fix any remaining imports
- [ ] Step 9: Verify build + full test suite

**Commit:** `chore(m7-s6): remove WorkLoopScheduler and all work-loop infrastructure`

---

## Task 10: Rewire calendar UI to timeline API

**Files:**
- Modify: `packages/dashboard/public/js/calendar.js`
- Modify: `packages/dashboard/public/js/app.js`
- Modify: `packages/dashboard/public/index.html`

- [ ] Step 1: In `calendar.js`, replace `/api/work-loop/events` event source with `/api/timeline`:
  - Past events: fetch from `/api/timeline?before=&after=` for the visible date range
  - Future events: fetch from `/api/timeline/future?hours=N`
  - Convert timeline items to FullCalendar event format
- [ ] Step 2: Remove `showSystemEvents` toggle — system automations are hidden, user automation jobs always show
- [ ] Step 3: Update event click handling — clicking a job opens the automation detail tab (not the old work-loop detail)
- [ ] Step 4: Remove work-loop job detail tab (`openWorkLoopTab`, `loadWorkLoopJobDetail`) from app.js
- [ ] Step 5: Remove work-loop patterns widget from settings or dashboard
- [ ] Step 6: Update calendar event colors to match timeline status colors (green=completed, red=failed, amber=needs_review, blue=running, cyan=scheduled)
- [ ] Step 7: Verify calendar loads with automation jobs and projected future runs

**Commit:** `feat(m7-s6): rewire calendar UI to timeline API`

---

## Task 11: Update settings UI

**Files:**
- Modify: `packages/dashboard/public/index.html`
- Modify: `packages/dashboard/public/js/app.js`

- [ ] Step 1: Remove work-patterns settings section from settings tab
- [ ] Step 2: Replace with automation schedule settings:
  - List user automations with their cron schedules
  - Allow editing cron via PATCH `/api/automations/:id` (update trigger config)
  - Show system automations as read-only info
- [ ] Step 3: Keep model preference in existing settings (the debrief automation's model field is user-editable)

**Commit:** `feat(m7-s6): replace work-patterns settings with automation schedule editor`

---

## Task 12: Hatching flow — create automations on first hatch

**Files:**
- Modify: `packages/dashboard/src/hatching/logic.ts`

- [ ] Step 1: After hatching completes, copy automation templates to `{agentDir}/automations/`:
  - `debrief.md` (user automation, schedule from hatching preferences)
  - `system-daily-summary.md` (system, active)
  - `system-weekly-review.md` (system, disabled by default)
  - `system-weekly-summary.md` (system, disabled by default)
  - `system-monthly-summary.md` (system, disabled by default)
- [ ] Step 2: Replace `{{created_date}}` placeholder with current date
- [ ] Step 3: If user specified a debrief time during hatching, update the cron expression
- [ ] Step 4: Ensure AutomationSyncService picks up the new files

**Commit:** `feat(m7-s6): create automation manifests during hatching`

---

## Task 13: Protect system entities from modification

**Files:**
- Modify: `packages/dashboard/src/automations/automation-manager.ts`
- Modify: `packages/dashboard/src/routes/automations.ts`
- Modify: `packages/dashboard/src/routes/spaces.ts`

- [ ] Step 1: `AutomationManager.update()` — reject if automation has `system: true`
- [ ] Step 2: `AutomationManager.disable()` — reject if system
- [ ] Step 3: `PATCH /api/automations/:id` — return 403 for system automations
- [ ] Step 4: `PATCH /api/spaces/:name` — return 403 for system spaces
- [ ] Step 5: `DELETE` operations — reject for system entities
- [ ] Step 6: Add tests for protection

**Commit:** `feat(m7-s6): protect system spaces and automations from modification`

---

## Task 14: Final verification

- [ ] Step 1: TypeScript clean (both packages)
- [ ] Step 2: Full test suite passes
- [ ] Step 3: Grep for orphaned work-loop references
- [ ] Step 4: Restart dashboard, verify:
  - Automations widget shows user automations only
  - System automations run on schedule (check jobs table)
  - Calendar shows automation jobs + projected runs
  - Settings show automation schedules
  - Debrief fires and delivers via ConversationInitiator
- [ ] Step 5: Verify system spaces indexed in agent.db with `system = 1`

**Commit:** `test(m7-s6): final verification — system automations + calendar rewired`

---

## Summary

| # | Task | Scope |
|---|------|-------|
| 1 | System flag on types + DB | Types, schema |
| 2 | Hide system entities | StatePublisher, MCP, prompt |
| 3 | SpaceSyncService dual-dir | App wiring |
| 4 | System space: debrief-tools | Context assembly scripts |
| 5 | System space: summary-tools | Summary/review scripts |
| 6 | User automation: debrief | Template + hatching |
| 7 | System automations | 4 templates + hatching |
| 8 | Timezone utility | Extract from work-patterns |
| 9 | Remove WorkLoopScheduler | Delete files, routes, DB table |
| 10 | Calendar → timeline | UI rewire |
| 11 | Settings UI | Automation schedule editor |
| 12 | Hatching flow | Create automations on hatch |
| 13 | Protect system entities | Reject modifications |
| 14 | Final verification | Build, tests, runtime |

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| System space scripts need `tsx` runtime | Medium | Add as devDependency, or compile to JS |
| Existing hatched agents lose work-loop jobs on upgrade | High | Migration: on startup, if work-patterns.md exists but automations don't, auto-create automation manifests from it |
| Calendar FullCalendar integration is tightly coupled | Medium | Reuse existing timeline API, just convert to FC event format |
| Fact staging increment depends on debrief running | Low | System debrief-tools script handles it; if user deletes debrief, facts just don't get incremented (acceptable) |
