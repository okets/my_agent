# M7-S6: System Automations + Calendar-as-Timeline

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert work-loop jobs to automation manifests (user + system automations), add a built-in handler registry for system automation execution, remove WorkLoopScheduler, and rewire the calendar UI to use the timeline API.

**Architecture:**

System automations use built-in TypeScript handler functions instead of SDK sessions. The AutomationExecutor checks for a `handler` field in the automation manifest; if present, it calls the registered built-in function directly. User automations continue to run as SDK sessions.

| Entity | Location | Editable | Deletable | Example |
|--------|----------|----------|-----------|---------|
| System automation | `{agentDir}/automations/` | No (hidden, protected) | No | `system-daily-summary.md` |
| User automation | `{agentDir}/automations/` | Yes | Yes | `debrief.md` |

**Key decisions:**
- **No system spaces.** System automations call built-in handler functions, not space scripts
- **Handler registry** in AutomationExecutor maps `handler: "debrief-prep"` to TypeScript functions in `packages/dashboard/src/scheduler/jobs/`
- **One-at-a-time hatching.** Each automation manifest is written independently; AutomationSyncService picks up whatever exists. No transaction/rollback needed
- **Keep FullCalendar.** Just swap the event source from `/api/work-loop/events` to `/api/timeline` and convert response to FC event format
- **Automation detail tab** shows job history as a timeline (reuses existing timeline list component pattern, filtered to one automation)
- All 5 work-loop jobs converted: debrief, daily-summary, weekly-review, weekly-summary, monthly-summary

**Spec:** `docs/superpowers/specs/2026-03-22-m7-spaces-automations-jobs.md`

**Depends on:** S1-S5 (spaces, automations, triggers, cleanup)

---

## Task 1: Add `system` flag to Automation types + DB

**Files:**
- Modify: `packages/core/src/spaces/automation-types.ts`
- Modify: `packages/dashboard/src/conversations/db.ts`

- [ ] Step 1: Add `system?: boolean` to `AutomationManifest` interface in `automation-types.ts`
- [ ] Step 2: Add `handler?: string` to `AutomationManifest` interface — this is the built-in handler key (e.g. `"debrief-prep"`, `"daily-summary"`)
- [ ] Step 3: Add `system INTEGER DEFAULT 0` column to `automations` table in db.ts (migration pattern)
- [ ] Step 4: Add `handler TEXT` column to `automations` table in db.ts
- [ ] Step 5: Update `upsertAutomation()` to handle `system` and `handler` fields
- [ ] Step 6: Update `listAutomations()` to accept `excludeSystem?: boolean` filter
- [ ] Step 7: Verify build: `npx tsc --noEmit`

**Commit:** `feat(m7-s6): add system flag and handler field to Automation types + DB schema`

---

## Task 2: Hide system automations from dashboard + MCP

**Files:**
- Modify: `packages/dashboard/src/state/state-publisher.ts`
- Modify: `packages/dashboard/src/mcp/automation-server.ts`
- Modify: `packages/core/src/prompt.ts`

- [ ] Step 1: `_getAutomationSnapshots()` in StatePublisher — filter out `system: true` automations from the widget broadcast
- [ ] Step 2: `list_automations` MCP tool — exclude system automations from results
- [ ] Step 3: `create_automation` MCP tool — reject `system: true` in input (user can't create system automations)
- [ ] Step 4: `loadAutomationHints()` in prompt.ts — exclude system automations from brain hints (they're infrastructure, brain doesn't need to know)
- [ ] Step 5: Verify build

**Commit:** `feat(m7-s6): hide system automations from dashboard widget and MCP tools`

---

## Task 3: Handler registry in AutomationExecutor

**Files:**
- Modify: `packages/dashboard/src/automations/automation-executor.ts`
- Create: `packages/dashboard/src/scheduler/jobs/handler-registry.ts`

This is the core mechanism: a registry that maps handler keys to built-in TypeScript functions. When AutomationExecutor encounters a manifest with a `handler` field, it calls the registered function instead of spawning an SDK session.

- [ ] Step 1: Create `handler-registry.ts` with the registry type and registration:
```typescript
export type BuiltInHandler = (ctx: {
  agentDir: string;
  db: ConversationDatabase;
  jobId: string;
}) => Promise<{ success: boolean; work: string; deliverable: string | null }>;

const handlers = new Map<string, BuiltInHandler>();

export function registerHandler(key: string, handler: BuiltInHandler): void {
  handlers.set(key, handler);
}

export function getHandler(key: string): BuiltInHandler | undefined {
  return handlers.get(key);
}
```
- [ ] Step 2: Register existing job functions as handlers:
  - `"debrief-prep"` → logic from `scheduler/jobs/debrief-prep.ts`
  - `"daily-summary"` → logic from `scheduler/jobs/daily-summary.ts`
  - `"weekly-review"` → logic from `scheduler/jobs/weekly-review.ts`
  - `"weekly-summary"` → logic from `scheduler/jobs/weekly-summary.ts`
  - `"monthly-summary"` → logic from `scheduler/jobs/monthly-summary.ts`
- [ ] Step 3: In `AutomationExecutor.execute()`, add handler check before the SDK session path:
```typescript
const handlerKey = automation.manifest.handler;
if (handlerKey) {
  const handler = getHandler(handlerKey);
  if (!handler) throw new Error(`Unknown handler: ${handlerKey}`);
  return handler({ agentDir: this.config.agentDir, db: this.config.db, jobId: job.id });
}
// ...existing SDK session logic
```
- [ ] Step 4: Verify build + write unit test for handler dispatch

**Commit:** `feat(m7-s6): add built-in handler registry to AutomationExecutor`

---

## Task 4: Create user automation template — `debrief.md`

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
handler: debrief-prep
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

1. Read assembled notebook context (summaries, daily logs, properties, staged facts, calendar)
2. Write a briefing to notebook/operations/current-state.md with sections:
   - Today — current events, deadlines, plans
   - This Week Ahead — upcoming milestones
   - This Month Ahead — bigger picture
   - Yesterday — key events
   - Past 7 Days — weekly highlights
   - Past 30 Days — monthly highlights
3. Only include sections with data. Skip empty sections.
4. Hard cap: 3000 characters.
5. After generating: update fact staging counters.
```

- [ ] Step 2: Wire into hatching flow — when hatching completes, copy template to `{agentDir}/automations/debrief.md` with user's preferred schedule time

**Commit:** `feat(m7-s6): create debrief user automation template`

---

## Task 5: Create system automation templates

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
handler: daily-summary
model: haiku
notify: none
autonomy: full
once: false
created: {{created_date}}
---

# Daily Summary

Compress today's daily log into a structured summary.

## Instructions

1. Read today's daily log
2. Summarize into sections: Key Events, Decisions Made, Open Items
3. Write to notebook/summaries/daily/YYYY-MM-DD.md
4. Only include sections with data.
```

- [ ] Step 2: `system-weekly-review.md` (system: true, handler: `weekly-review`, cron: `0 20 * * 0`, status: disabled)
- [ ] Step 3: `system-weekly-summary.md` (system: true, handler: `weekly-summary`, cron: `0 21 * * 0`, status: disabled)
- [ ] Step 4: `system-monthly-summary.md` (system: true, handler: `monthly-summary`, cron: `0 22 1 * *`, status: disabled)

**Commit:** `feat(m7-s6): create system automation templates (daily-summary, weekly-review, weekly/monthly-summary)`

---

## Task 6: Extract timezone utility

**Files:**
- Create: `packages/dashboard/src/utils/timezone.ts`
- Modify: `packages/dashboard/src/automations/automation-scheduler.ts`

- [ ] Step 1: Extract `getResolvedTimezone()` and `isValidTimezone()` from `work-patterns.ts` into `utils/timezone.ts`
- [ ] Step 2: Update `AutomationScheduler` to use the timezone utility for cron evaluation
- [ ] Step 3: Verify build

**Commit:** `refactor(m7-s6): extract timezone utility from work-patterns`

---

## Task 7: Remove WorkLoopScheduler

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

**NOTE:** The handler functions registered in Task 3 must be refactored to be standalone (no dependency on WorkLoopScheduler or query-model imports) before this deletion. The `handler-registry.ts` file created in Task 3 retains the needed logic; these files are now dead code.

- [ ] Step 1: Grep for all imports of WorkLoopScheduler, work-patterns, query-model, job handlers
- [ ] Step 2: Remove from app.ts — delete WorkLoopScheduler construction, start, stop
- [ ] Step 3: Remove work-loop route registration from server.ts
- [ ] Step 4: Delete all files listed above (keep `scheduler/jobs/handler-registry.ts` and `scheduler/event-handler.ts`)
- [ ] Step 5: Remove `work_loop_runs` table creation from db.ts
- [ ] Step 6: Add `DROP TABLE IF EXISTS work_loop_runs` migration
- [ ] Step 7: Delete work-loop test files
- [ ] Step 8: Grep for orphaned references — fix any remaining imports
- [ ] Step 9: Verify build + full test suite

**Commit:** `chore(m7-s6): remove WorkLoopScheduler and all work-loop infrastructure`

---

## Task 8: Swap calendar data source to timeline API

**Files:**
- Modify: `packages/dashboard/public/js/calendar.js`

Keep FullCalendar as-is. Only change the event source.

- [ ] Step 1: In `calendar.js`, replace `/api/work-loop/events` event source with `/api/timeline`:
  - Fetch from `/api/timeline?before=&after=` for the visible date range
  - Convert timeline `pastJobs` to FullCalendar event format: `{ id, title: automationName, start, end, color, extendedProps: { jobId, status } }`
  - Convert timeline `futureRuns` to FullCalendar event format: `{ title: automationName, start, color: "#22d3ee", extendedProps: { projected: true } }`
- [ ] Step 2: Update event colors to match timeline status colors (green=completed, red=failed, amber=needs_review, blue=running, cyan=scheduled)
- [ ] Step 3: Update event click handling — clicking a job opens the automation detail tab (not the old work-loop detail)
- [ ] Step 4: Remove work-loop job detail tab (`openWorkLoopTab`, `loadWorkLoopJobDetail`) from `app.js` if present
- [ ] Step 5: Verify calendar loads with automation jobs and projected future runs

**Commit:** `feat(m7-s6): swap calendar event source from work-loop to timeline API`

---

## Task 9: Automation detail tab — job history timeline

**Files:**
- Modify: `packages/dashboard/public/index.html`
- Modify: `packages/dashboard/public/js/app.js`
- Modify: `packages/dashboard/src/routes/automations.ts` (or `timeline.ts`)

Add a job history section to the automation detail tab that displays as a timeline list, reusing the existing timeline list component pattern filtered to a single automation.

- [ ] Step 1: Add API endpoint or query parameter: `GET /api/timeline?automationId=<id>` — filter timeline jobs to a specific automation
- [ ] Step 2: In `db.ts`, update `getTimelineJobs()` to accept optional `automationId` filter
- [ ] Step 3: In the automation detail tab HTML (`index.html`), add a "Job History" section below the existing automation info
- [ ] Step 4: Render job history as a vertical timeline list:
  - Each entry shows: timestamp, status badge (colored dot), duration, deliverable preview
  - Reuse the same timeline list styling already used in the main timeline view
  - Sort by most recent first
- [ ] Step 5: In `app.js`, when the automation detail tab opens, fetch `/api/timeline?automationId=<id>&limit=20`
- [ ] Step 6: Verify the timeline renders correctly for automations with and without job history

**Commit:** `feat(m7-s6): add job history timeline to automation detail tab`

---

## Task 10: Update settings UI

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

## Task 11: Hatching flow — create automations on first hatch

**Files:**
- Modify: `packages/dashboard/src/hatching/logic.ts`

Write each automation manifest file independently. AutomationSyncService picks up whatever exists. No transaction or rollback needed.

- [ ] Step 1: After hatching completes, write automation templates one-at-a-time to `{agentDir}/automations/`:
  - `debrief.md` (user automation, schedule from hatching preferences)
  - `system-daily-summary.md` (system, active)
  - `system-weekly-review.md` (system, disabled by default)
  - `system-weekly-summary.md` (system, disabled by default)
  - `system-monthly-summary.md` (system, disabled by default)
- [ ] Step 2: Replace `{{created_date}}` placeholder with current date in each file
- [ ] Step 3: If user specified a debrief time during hatching, update the cron expression in `debrief.md`
- [ ] Step 4: AutomationSyncService picks up each file as it appears — no explicit sync trigger needed

**Commit:** `feat(m7-s6): create automation manifests during hatching`

---

## Task 12: Protect system automations from modification

**Files:**
- Modify: `packages/dashboard/src/automations/automation-manager.ts`
- Modify: `packages/dashboard/src/routes/automations.ts`

- [ ] Step 1: `AutomationManager.update()` — reject if automation has `system: true`
- [ ] Step 2: `AutomationManager.disable()` — reject if system
- [ ] Step 3: `PATCH /api/automations/:id` — return 403 for system automations
- [ ] Step 4: `DELETE /api/automations/:id` — return 403 for system automations
- [ ] Step 5: Add tests for protection

**Commit:** `feat(m7-s6): protect system automations from modification and deletion`

---

## Task 13: Final verification

- [ ] Step 1: TypeScript clean (both packages): `npx tsc --noEmit`
- [ ] Step 2: Full test suite passes
- [ ] Step 3: Grep for orphaned work-loop references
- [ ] Step 4: Restart dashboard, verify:
  - Automations widget shows user automations only
  - System automations run on schedule via built-in handlers (check jobs table)
  - Calendar shows automation jobs from timeline API + projected future runs
  - Automation detail tab shows job history as timeline
  - Settings show automation schedules (user editable, system read-only)
  - Debrief fires and delivers via ConversationInitiator
- [ ] Step 5: Verify system automations in agent.db have `system = 1` and `handler` populated

**Commit:** `test(m7-s6): final verification — system automations + calendar rewired`

---

## Summary

| # | Task | Scope |
|---|------|-------|
| 1 | System flag + handler on Automation types + DB | Types, schema |
| 2 | Hide system automations | StatePublisher, MCP, prompt |
| 3 | Handler registry in AutomationExecutor | Built-in handler dispatch |
| 4 | User automation: debrief | Template + hatching |
| 5 | System automations | 4 templates + hatching |
| 6 | Timezone utility | Extract from work-patterns |
| 7 | Remove WorkLoopScheduler | Delete files, routes, DB table |
| 8 | Calendar data source swap | FullCalendar → timeline API |
| 9 | Automation detail job timeline | Job history in detail tab |
| 10 | Settings UI | Automation schedule editor |
| 11 | Hatching flow | Create automations on hatch |
| 12 | Protect system automations | Reject modifications |
| 13 | Final verification | Build, tests, runtime |

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Existing hatched agents lose work-loop jobs on upgrade | High | Migration: on startup, if work-patterns.md exists but automations don't, auto-create automation manifests from it |
| Handler functions depend on deleted imports after Task 7 | Medium | Task 3 must refactor handler logic to be standalone before Task 7 deletes the originals |
| Fact staging increment depends on debrief running | Low | Built-in debrief-prep handler handles it; if user deletes debrief automation, facts just don't get incremented (acceptable) |
| Calendar event format mismatch | Low | Simple adapter — timeline response is well-typed, FullCalendar event format is documented |
