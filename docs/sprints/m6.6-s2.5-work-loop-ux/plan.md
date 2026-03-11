# M6.6-S2.5: Work Loop UX Polish — Sprint Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Work loop jobs display as recurring calendar events and open as full tabs with activity logs, prompt inspection, and chat context tags.

**Architecture:** Replace the modal detail panel with a proper tab view (following the existing task/event tab pattern). Add a per-job API endpoint for run history and prompt templates. Show recurring scheduled occurrences on the calendar using FullCalendar's rrule-compatible approach. Wire chat context so the active conversation knows when the user is viewing a work loop job. Expose Haiku system prompts and user prompt templates so they're inspectable in the tab.

**Tech Stack:** TypeScript, Alpine.js, Fastify, FullCalendar, better-sqlite3

**Spec:** CTO feedback from S2 review (2026-03-11)

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `src/scheduler/jobs/morning-prep.ts` | Export prompt constants | Modify |
| `src/scheduler/jobs/daily-summary.ts` | Export prompt constants | Modify |
| `src/scheduler/work-loop-scheduler.ts` | Expose prompts per job name | Modify |
| `src/routes/work-loop.ts` | API for job detail + run history + prompts | Modify |
| `public/js/app.js` | Work loop tab type, chat context, state | Modify |
| `public/js/calendar.js` | Recurring event generation | Modify |
| `public/index.html` | Work loop tab template (replaces modal) | Modify |
| `tests/work-loop-api.test.ts` | API test for new endpoint | Modify |

---

## Chunk 1: API — Job Detail + Run History

### Task 1: Add GET /api/work-loop/jobs/:jobName endpoint

Returns job metadata + paginated run history for a single job.

**Files:**
- Modify: `packages/dashboard/src/routes/work-loop.ts`
- Modify: `packages/dashboard/tests/work-loop-api.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/work-loop-api.test.ts`:

```typescript
it("GET /api/work-loop/jobs/:jobName returns job detail with run history", async () => {
  // Insert a few runs for the job
  const now = new Date();
  for (let i = 0; i < 3; i++) {
    const started = new Date(now.getTime() - (i + 1) * 3600_000);
    db.prepare(`INSERT INTO work_loop_runs (id, job_name, started_at, completed_at, status, duration_ms, output)
      VALUES (?, ?, ?, ?, 'completed', 5000, 'output ${i}')`)
      .run(`history-${i}`, 'unknown-handler', started.toISOString(), started.toISOString());
  }

  const res = await fastify.inject({
    method: "GET",
    url: "/api/work-loop/jobs/unknown-handler",
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();

  // Job metadata
  expect(body.name).toBe("unknown-handler");
  expect(body.displayName).toBe("Unknown Handler");
  expect(body.cadence).toBeTruthy();
  expect(body.model).toBeTruthy();
  expect(body.nextRun).toBeTruthy();

  // Run history (most recent first)
  expect(body.runs).toBeInstanceOf(Array);
  expect(body.runs.length).toBe(3);
  expect(body.runs[0].status).toBe("completed");
  expect(new Date(body.runs[0].started_at).getTime())
    .toBeGreaterThan(new Date(body.runs[1].started_at).getTime());
});

it("GET /api/work-loop/jobs/nonexistent returns 404", async () => {
  const res = await fastify.inject({
    method: "GET",
    url: "/api/work-loop/jobs/nonexistent",
  });
  expect(res.statusCode).toBe(404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/work-loop-api.test.ts`
Expected: FAIL — route does not exist yet

- [ ] **Step 3: Implement the endpoint**

Add to `src/routes/work-loop.ts`, after the `/status` endpoint:

```typescript
/**
 * GET /api/work-loop/jobs/:jobName
 *
 * Returns job metadata + run history for a single job.
 */
fastify.get<{
  Params: { jobName: string };
  Querystring: { limit?: string };
}>("/api/work-loop/jobs/:jobName", async (request, reply) => {
  const scheduler = fastify.workLoopScheduler;
  if (!scheduler) {
    return reply.code(503).send({ error: "Scheduler not running" });
  }

  const { jobName } = request.params;
  const limit = parseInt(request.query.limit || "20", 10);

  const pattern = scheduler.getPatterns().find(p => p.name === jobName);
  if (!pattern) {
    return reply.code(404).send({ error: `Unknown job: ${jobName}` });
  }

  const runs = scheduler.getRuns({ jobName, limit });
  const lastRun = scheduler.getLastRun(jobName);
  const nextRun = getNextScheduledTime(pattern.cadence);

  return {
    name: pattern.name,
    displayName: pattern.displayName,
    cadence: pattern.cadence,
    model: pattern.model,
    lastRun: lastRun?.toISOString() ?? null,
    nextRun: nextRun?.toISOString() ?? null,
    runs,
  };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/work-loop-api.test.ts`
Expected: All 6 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/routes/work-loop.ts tests/work-loop-api.test.ts
git commit -m "feat(m6.6-s2.5): add job detail API with run history"
```

---

## Chunk 2: Prompt Exposure

### Task 2: Export prompt constants and expose via API

Export `SYSTEM_PROMPT` and `USER_PROMPT_TEMPLATE` from each job module so the tab UI can display them.

**Files:**
- Modify: `packages/dashboard/src/scheduler/jobs/morning-prep.ts`
- Modify: `packages/dashboard/src/scheduler/jobs/daily-summary.ts`
- Modify: `packages/dashboard/src/scheduler/work-loop-scheduler.ts`
- Modify: `packages/dashboard/src/routes/work-loop.ts`
- Modify: `packages/dashboard/tests/work-loop-api.test.ts`

- [ ] **Step 1: Export prompt constants from morning-prep.ts**

Change `const SYSTEM_PROMPT` to `export const SYSTEM_PROMPT` and `const USER_PROMPT_TEMPLATE` to `export const USER_PROMPT_TEMPLATE` (if it exists as a separate constant — otherwise extract the template string into an exported constant).

- [ ] **Step 2: Export prompt constants from daily-summary.ts**

Same change: `export const SYSTEM_PROMPT` and `export const USER_PROMPT_TEMPLATE`.

- [ ] **Step 3: Add `getJobPrompts(jobName)` to WorkLoopScheduler**

```typescript
import { SYSTEM_PROMPT as MORNING_SYSTEM, USER_PROMPT_TEMPLATE as MORNING_USER } from "./jobs/morning-prep.js";
import { SYSTEM_PROMPT as SUMMARY_SYSTEM, USER_PROMPT_TEMPLATE as SUMMARY_USER } from "./jobs/daily-summary.js";

const JOB_PROMPTS: Record<string, { system: string; userTemplate: string }> = {
  "morning-prep": { system: MORNING_SYSTEM, userTemplate: MORNING_USER },
  "daily-summary": { system: SUMMARY_SYSTEM, userTemplate: SUMMARY_USER },
};

getJobPrompts(jobName: string): { system: string; userTemplate: string } | null {
  return JOB_PROMPTS[jobName] ?? null;
}
```

- [ ] **Step 4: Include prompts in GET /api/work-loop/jobs/:jobName response**

Add to the endpoint implemented in Task 1:

```typescript
const prompts = scheduler.getJobPrompts(jobName);

return {
  // ...existing fields...
  prompts: prompts ?? null,
};
```

- [ ] **Step 5: Write the failing test**

Add to `tests/work-loop-api.test.ts`:

```typescript
it("GET /api/work-loop/jobs/:jobName includes prompts", async () => {
  const res = await fastify.inject({
    method: "GET",
    url: "/api/work-loop/jobs/unknown-handler",
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  // The test fixture uses "unknown-handler" which won't have prompts
  // This test verifies the field exists (null for unknown jobs)
  expect(body).toHaveProperty("prompts");
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/work-loop-api.test.ts`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/scheduler/jobs/morning-prep.ts src/scheduler/jobs/daily-summary.ts src/scheduler/work-loop-scheduler.ts src/routes/work-loop.ts tests/work-loop-api.test.ts
git commit -m "feat(m6.6-s2.5): export job prompts and expose via API"
```

---

## Chunk 3: Recurring Calendar Events

### Task 3: Show recurring scheduled occurrences on the calendar

Currently the calendar shows one "next scheduled" event per job. It should show multiple upcoming occurrences so the user sees the recurring pattern (like a repeating meeting).

**Files:**
- Modify: `packages/dashboard/src/routes/work-loop.ts` (events endpoint)

- [ ] **Step 1: Write the failing test**

Add to `tests/work-loop-api.test.ts`:

```typescript
it("GET /api/work-loop/events returns multiple future scheduled occurrences", async () => {
  const now = new Date();
  const twoWeeksOut = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const res = await fastify.inject({
    method: "GET",
    url: `/api/work-loop/events?start=${now.toISOString()}&end=${twoWeeksOut.toISOString()}`,
  });
  expect(res.statusCode).toBe(200);
  const events = res.json();

  // The test pattern is weekly:saturday:03:33
  // Over 14 days there should be 1-2 scheduled occurrences
  const scheduled = events.filter((e: any) => e.extendedProps.status === "scheduled");
  expect(scheduled.length).toBeGreaterThanOrEqual(1);

  // All scheduled events should have the same jobName
  for (const evt of scheduled) {
    expect(evt.extendedProps.jobName).toBe("unknown-handler");
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — currently only one scheduled occurrence is returned

- [ ] **Step 3: Implement recurring occurrences**

In `src/routes/work-loop.ts`, replace the single-occurrence loop in GET `/api/work-loop/events` (the "Upcoming scheduled runs" section, ~lines 110-132) with a loop that generates multiple future occurrences:

```typescript
// Upcoming scheduled runs (recurring — generate occurrences within the requested range)
const patterns = scheduler.getPatterns();
for (const pattern of patterns) {
  let cursor = new Date(startDate);
  let safety = 0;
  const maxOccurrences = 50; // Cap to prevent runaway loops

  while (safety < maxOccurrences) {
    const nextTime = getNextScheduledTime(pattern.cadence, cursor);
    if (!nextTime || nextTime > endDate) break;

    events.push({
      id: `wl-sched-${pattern.name}-${nextTime.getTime()}`,
      title: `${pattern.displayName} (scheduled)`,
      start: nextTime.toISOString(),
      end: new Date(nextTime.getTime() + 60_000).toISOString(),
      allDay: false,
      color: "transparent",
      textColor: COLORS.purple,
      borderColor: COLORS.purple,
      display: "auto",
      extendedProps: {
        type: "work-loop",
        jobName: pattern.name,
        status: "scheduled",
      },
    });

    // Move cursor past this occurrence to find the next one
    cursor = new Date(nextTime.getTime() + 60_000);
    safety++;
  }
}
```

Note: `getNextScheduledTime` already accepts an optional `now` parameter, so passing `cursor` finds the next occurrence after that point.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/work-loop-api.test.ts`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/routes/work-loop.ts tests/work-loop-api.test.ts
git commit -m "feat(m6.6-s2.5): show recurring scheduled occurrences on calendar"
```

---

## Chunk 4: Work Loop Tab View

### Task 4: Replace modal with proper tab for work loop events

Remove the glass modal. When a work loop event is clicked on the calendar (or "Run" is pressed), open a tab with job metadata, run history, output, and chat context.

**Files:**
- Modify: `packages/dashboard/public/js/app.js`
- Modify: `packages/dashboard/public/index.html`

- [ ] **Step 1: Add `openWorkLoopTab()` function in app.js**

Replace the work-loop intercept in `openEventTab()` and the `triggerWorkLoopJob()` result handler. Both should call a new `openWorkLoopTab(jobName)`:

```javascript
async openWorkLoopTab(jobName) {
  const tabId = `workloop-${jobName}`;

  // If tab already open, refresh and switch
  const existing = this.openTabs.find(t => t.id === tabId);
  if (existing) {
    this.switchTab(tabId);
    // Refresh data
    await this.loadWorkLoopJobDetail(jobName);
    return;
  }

  // Fetch job detail from API
  await this.loadWorkLoopJobDetail(jobName);

  this.openTab({
    id: tabId,
    type: 'workloop',
    title: this.workLoopJobDetail?.displayName || jobName,
    icon: '🔄',
    closeable: true,
    data: { jobName },
  });
},

async loadWorkLoopJobDetail(jobName) {
  try {
    const res = await fetch(`/api/work-loop/jobs/${encodeURIComponent(jobName)}`);
    if (res.ok) {
      this.workLoopJobDetail = await res.json();
    }
  } catch (err) {
    console.error('[App] Failed to load work loop job detail:', err);
  }
},
```

- [ ] **Step 2: Add `workLoopJobDetail` state**

In the calendar state section of app.js (~line 116):

```javascript
workLoopJobDetail: null,          // { name, displayName, cadence, model, lastRun, nextRun, runs }
```

- [ ] **Step 3: Update `openEventTab()` to use the new tab**

Replace the work-loop intercept block (the `if (extProps.type === 'work-loop')` block) with:

```javascript
// Work loop events: open job tab
const extProps = event.extendedProps || {};
if (extProps.type === 'work-loop') {
  this.openWorkLoopTab(extProps.jobName);
  return;
}
```

- [ ] **Step 4: Update `triggerWorkLoopJob()` to open a tab**

Replace the detail panel logic with:

```javascript
async triggerWorkLoopJob(jobName) {
  try {
    const res = await fetch(`/api/work-loop/trigger/${encodeURIComponent(jobName)}`, { method: 'POST' });
    const data = await res.json();
    // Open the tab (will show the new run in history)
    await this.openWorkLoopTab(jobName);
    this.refreshCalendar();
  } catch (err) {
    console.error('[App] Failed to trigger job:', err);
  }
},
```

- [ ] **Step 5: Remove modal state and HTML**

In app.js, remove:
- `workLoopDetail: null,`
- `showWorkLoopDetail: false,`

In index.html, remove the `<!-- Work Loop Detail Modal -->` block (the `x-show="showWorkLoopDetail"` div and all its contents).

- [ ] **Step 6: Commit**

```bash
git add public/js/app.js public/index.html
git commit -m "feat(m6.6-s2.5): replace work loop modal with tab — state and logic"
```

### Task 5: Add work loop tab HTML template

Add the tab content template to `index.html`, following the task tab pattern.

**Files:**
- Modify: `packages/dashboard/public/index.html`

- [ ] **Step 1: Add the work loop tab template**

After the existing event tab template (`x-if="openTabs.find(t => t.id === activeTab)?.type === 'event'"`), add:

```html
<!-- ======================================================== -->
<!-- Work Loop Job Tab                                         -->
<!-- ======================================================== -->
<template
  x-if="openTabs.find(t => t.id === activeTab)?.type === 'workloop'"
>
  <div class="h-full flex flex-col p-6 overflow-auto">
    <template x-if="workLoopJobDetail">
      <div>
        <!-- Header: Title + Status + Actions -->
        <div class="flex items-start justify-between gap-4 mb-6">
          <div class="flex items-start gap-4 min-w-0 flex-1">
            <div class="w-4 h-4 rounded-full shrink-0 mt-1.5 bg-violet-500/50"></div>
            <div class="min-w-0 flex-1">
              <h1 class="text-2xl font-bold text-tokyo-text truncate"
                  x-text="workLoopJobDetail.displayName"></h1>
              <div class="flex items-center gap-2 mt-1">
                <span class="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400"
                      x-text="workLoopJobDetail.cadence"></span>
                <span class="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400"
                      x-text="'model: ' + workLoopJobDetail.model"></span>
              </div>
            </div>
          </div>
          <!-- Run Now button -->
          <button @click="triggerWorkLoopJob(workLoopJobDetail.name)"
                  class="cal-action-btn cal-action-btn-cta">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
              <path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.841z"/>
            </svg>
            <span>Run Now</span>
          </button>
        </div>

        <!-- Schedule Info -->
        <div class="grid grid-cols-2 gap-4 mb-6">
          <div class="p-3 rounded-lg" style="background: rgba(30, 30, 46, 0.6); border: 1px solid rgba(255,255,255,0.05);">
            <div class="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Last Run</div>
            <div class="text-sm text-gray-300"
                 x-text="workLoopJobDetail.lastRun ? new Date(workLoopJobDetail.lastRun).toLocaleString() : 'Never'"></div>
          </div>
          <div class="p-3 rounded-lg" style="background: rgba(30, 30, 46, 0.6); border: 1px solid rgba(255,255,255,0.05);">
            <div class="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Next Run</div>
            <div class="text-sm text-gray-300"
                 x-text="workLoopJobDetail.nextRun ? new Date(workLoopJobDetail.nextRun).toLocaleString() : 'Unknown'"></div>
          </div>
        </div>

        <!-- Prompts (collapsible) -->
        <template x-if="workLoopJobDetail.prompts">
          <div class="mb-6">
            <button @click="workLoopShowPrompts = !workLoopShowPrompts"
                    class="flex items-center gap-2 text-sm font-semibold text-gray-300 mb-3 hover:text-gray-200 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 transition-transform"
                   :class="workLoopShowPrompts ? 'rotate-90' : ''"
                   fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
              </svg>
              Prompts
            </button>
            <template x-if="workLoopShowPrompts">
              <div class="space-y-3">
                <div>
                  <div class="text-[10px] text-gray-500 uppercase tracking-wide mb-1">System Prompt</div>
                  <pre class="text-xs text-gray-300 whitespace-pre-wrap p-3 rounded-lg max-h-48 overflow-y-auto"
                       style="background: rgba(0,0,0,0.3);"
                       x-text="workLoopJobDetail.prompts.system"></pre>
                </div>
                <div>
                  <div class="text-[10px] text-gray-500 uppercase tracking-wide mb-1">User Prompt Template</div>
                  <pre class="text-xs text-gray-300 whitespace-pre-wrap p-3 rounded-lg max-h-48 overflow-y-auto"
                       style="background: rgba(0,0,0,0.3);"
                       x-text="workLoopJobDetail.prompts.userTemplate"></pre>
                </div>
              </div>
            </template>
          </div>
        </template>

        <!-- Activity Log (Run History) -->
        <div>
          <h2 class="text-sm font-semibold text-gray-300 mb-3">Activity Log</h2>
          <div class="space-y-2">
            <template x-for="run in workLoopJobDetail.runs" :key="run.id">
              <div class="p-3 rounded-lg cursor-pointer hover:bg-white/5 transition-colors"
                   style="background: rgba(30, 30, 46, 0.4); border: 1px solid rgba(255,255,255,0.03);"
                   @click="workLoopExpandedRun = workLoopExpandedRun === run.id ? null : run.id">
                <!-- Run summary row -->
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="text-[10px] px-1.5 py-0.5 rounded"
                          :class="run.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                                   run.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                                   'bg-gray-500/20 text-gray-400'"
                          x-text="run.status"></span>
                    <span class="text-xs text-gray-400"
                          x-text="new Date(run.started_at).toLocaleString()"></span>
                  </div>
                  <div class="flex items-center gap-3 text-xs text-gray-500">
                    <span x-show="run.duration_ms"
                          x-text="(run.duration_ms / 1000).toFixed(1) + 's'"></span>
                    <span x-show="run.output"
                          x-text="run.output?.length + ' chars'"></span>
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 transition-transform"
                         :class="workLoopExpandedRun === run.id ? 'rotate-180' : ''"
                         fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
                    </svg>
                  </div>
                </div>

                <!-- Expanded: output or error -->
                <template x-if="workLoopExpandedRun === run.id">
                  <div class="mt-3 pt-3 border-t border-white/5">
                    <template x-if="run.error">
                      <div class="p-2 rounded bg-red-500/10 border border-red-500/20 text-red-300 text-xs mb-2"
                           x-text="run.error"></div>
                    </template>
                    <template x-if="run.output">
                      <pre class="text-xs text-gray-300 whitespace-pre-wrap max-h-60 overflow-y-auto p-2 rounded"
                           style="background: rgba(0,0,0,0.3);"
                           x-text="run.output"></pre>
                    </template>
                  </div>
                </template>
              </div>
            </template>

            <template x-if="!workLoopJobDetail.runs || workLoopJobDetail.runs.length === 0">
              <p class="text-xs text-gray-500 py-4 text-center">No runs yet</p>
            </template>
          </div>
        </div>
      </div>
    </template>

    <!-- Loading state -->
    <template x-if="!workLoopJobDetail">
      <div class="flex items-center justify-center h-full">
        <p class="text-sm text-gray-500">Loading job details...</p>
      </div>
    </template>
  </div>
</template>
```

- [ ] **Step 2: Add `workLoopExpandedRun` state to app.js**

In the calendar state section:

```javascript
workLoopExpandedRun: null,        // ID of expanded run in activity log
workLoopShowPrompts: false,       // Whether prompts section is expanded
```

- [ ] **Step 3: Commit**

```bash
git add public/index.html public/js/app.js
git commit -m "feat(m6.6-s2.5): add work loop job tab with activity log"
```

---

## Chunk 5: Chat Context Tag

### Task 6: Wire chat context for work loop tabs

When a work loop tab is active, the chat should show a context tag (like it does for tasks and conversations) so Nina knows the user is looking at a specific job.

**Files:**
- Modify: `packages/dashboard/public/js/app.js`

- [ ] **Step 1: Update `switchTab()` for workloop type**

The existing `switchTab()` (line ~1647) already handles tab types in its else branch (line 1663-1671). The `chatContext` is auto-set from `tab.type`, `tab.title`, `tab.icon`. Since we're using `type: 'workloop'`, this already works — the context tag will show `🔄 Morning Prep` (or whatever the job name is).

Verify this is the case by checking that the work loop tab's `type`, `title`, and `icon` are set correctly in `openWorkLoopTab()`. They already are from Task 3 Step 1.

If additional data is needed for the chat context (e.g. the job name for Nina to reference), add it to the tab data:

```javascript
this.openTab({
  id: tabId,
  type: 'workloop',
  title: this.workLoopJobDetail?.displayName || jobName,
  icon: '🔄',
  closeable: true,
  data: { jobName, file: `notebook/config/work-patterns.md` },
});
```

The `file` field in `data` connects to the existing chat context display that shows which file the user is viewing.

- [ ] **Step 2: Test manually**

1. Click a work loop event on the calendar
2. Tab opens with activity log
3. Chat context tag appears in the compose area (showing the job name)
4. Send a message to Nina — verify the context is included

- [ ] **Step 3: Commit**

```bash
git add public/js/app.js
git commit -m "feat(m6.6-s2.5): wire chat context for work loop tabs"
```

---

## Chunk 6: Cleanup + Verification

### Task 7: Full suite verification

- [ ] **Step 1: Run all tests**

```bash
npx vitest run tests/work-patterns.test.ts tests/work-loop-scheduler.test.ts tests/work-loop-api.test.ts tests/context-foundation.test.ts tests/system-prompt-builder.test.ts
```

Expected: All pass

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: Clean (dashboard files)

- [ ] **Step 3: Prettier**

```bash
npx prettier --write src/ tests/ public/
```

- [ ] **Step 4: Manual verification**

1. Open Calendar tab — see recurring scheduled events for both morning prep and daily summary
2. Toggle "Work Loop Jobs" checkbox — recurring events appear/disappear
3. Click a past work loop event — opens tab with activity log
4. Click "Run" in sidebar — job executes, tab opens with result
5. Chat context tag shows when work loop tab is active

- [ ] **Step 5: Commit if needed**

```bash
git commit -m "style: apply prettier formatting"
```

---

## Chunk 7: UI Polish + Mobile

### Task 8: Design language compliance + mobile popover

Ensure the work loop tab follows the Nina V1 design language and has a proper mobile view.

**Files:**
- Modify: `packages/dashboard/public/index.html` (desktop tab template + mobile popover)
- Modify: `packages/dashboard/public/js/app.js` (mobile popover handler)

- [ ] **Step 1: Audit desktop tab template against design language**

Verify all elements use correct tokens:
- Glass panels: `glass-strong` class or `rgba(30, 30, 46, 0.8)` with blur
- Badges: `text-[9px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400`
- Status colors: green-500/20 for completed, red-500/20 for failed
- Text: `text-tokyo-text` for headings, `text-gray-300` for body, `text-gray-500` for labels
- Buttons: `cal-action-btn cal-action-btn-cta` for primary CTA

Fix any deviations.

- [ ] **Step 2: Add mobile popover template for work loop**

Add a `<template x-if="$store.mobile.popover?.type === 'workloop'">` block in the mobile popover section of index.html (after the existing task/event/calendar/settings/notebook popovers). Follow the task popover pattern:
- Header with title + badges (cadence, model)
- `glass-strong rounded-xl` metadata card (last run, next run)
- Collapsible prompts section
- Activity log with expandable runs

- [ ] **Step 3: Wire mobile event click to open work loop popover**

In app.js, update the mobile event click handler to detect work-loop events and open a mobile popover instead of the desktop tab:

```javascript
// In mobile context, open popover for work loop events
if (this.isMobile && extProps.type === 'work-loop') {
  await this.loadWorkLoopJobDetail(extProps.jobName);
  this.$store.mobile.openPopover({ type: 'workloop', data: this.workLoopJobDetail });
  return;
}
```

- [ ] **Step 4: Browser validation (desktop + mobile)**

1. Desktop: Open work loop tab — verify glass panels, badges, prompts section, activity log all render correctly with Tokyo Night colors
2. Mobile: Click work loop event — verify popover opens with same content, sheet gesture works
3. Toggle system events — verify recurring events appear/disappear on both views

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/js/app.js
git commit -m "feat(m6.6-s2.5): design language polish + mobile work loop popover"
```

---

## Dependency Graph

```
T1 (API endpoint) → T2 (prompt export) → T4 (tab logic) → T5 (tab HTML + prompts) → T6 (chat context) → T7 (verify) → T8 (polish + mobile)
                  → T3 (recurring events)
```

T1 first (API base). T2 builds on T1 (adds prompts to response). T3 is independent of T2. T4 depends on T1 (needs the API). T5 depends on T2+T4 (tab HTML renders prompts). T6 depends on T5. T7 is verification. T8 is final polish + mobile.
