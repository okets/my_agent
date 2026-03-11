# M6.6 S1+S2 Gap Closure Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all gaps identified in M6.6 S1 (Context Foundation) and S2 (Work Loop Scheduler) against the design spec.

**Architecture:** Fix one missing feature (notebook-last-updated timestamp), add dashboard UI for work loop visibility (sidebar toggle, event detail panel, Run Now button), and write all E2E tests specified in the design doc but never implemented.

**Tech Stack:** TypeScript, Vitest, Alpine.js, Fastify, FullCalendar, better-sqlite3

**Spec:** `docs/superpowers/specs/2026-03-11-memory-perfection-design.md`

---

## Chunk 1: S1 Gap — Notebook Last Updated Timestamp

### Task 1: Add "Notebook last updated" to temporal context

The spec (1.2) requires three timestamps in the temporal context block:
- Current time ✓ (already implemented)
- Session started ✓ (already implemented)
- Notebook last updated ✗ (missing)

**How:** `MemoryDb.getStatus()` returns `lastSync` (ISO string). The `SystemPromptBuilder` needs access to the memory DB to read this. Pass it via the existing `initPromptBuilder()` wiring in `index.ts`.

**Files:**
- Modify: `packages/dashboard/src/agent/system-prompt-builder.ts`
- Modify: `packages/dashboard/src/agent/session-manager.ts` (initPromptBuilder signature)
- Modify: `packages/dashboard/src/index.ts` (pass memoryDb reference)
- Test: `packages/dashboard/tests/system-prompt-builder.test.ts` (new)

- [ ] **Step 1: Write failing test — temporal context includes notebook last updated**

```typescript
// tests/system-prompt-builder.test.ts
import { describe, it, expect } from "vitest";
import { SystemPromptBuilder } from "../src/agent/system-prompt-builder.js";

// We can't easily test the full build() without a real agentDir,
// but we CAN test that the temporal context block is correctly assembled.
// For this, we test the builder with a mock getNotebookLastUpdated function.

describe("SystemPromptBuilder temporal context", () => {
  it("includes notebook last updated when available", async () => {
    // This test verifies the output format of build() contains
    // "Notebook last updated" in the dynamic block.
    // Full integration test below uses real file system.
  });
});
```

Note: The real test needs a hatched agent dir. See Task 2 for E2E tests that cover this properly.

- [ ] **Step 2: Add `getNotebookLastUpdated` callback to BuilderConfig**

In `system-prompt-builder.ts`, add an optional callback:

```typescript
export interface BuilderConfig {
  brainDir: string;
  agentDir: string;
  getNotebookLastUpdated?: () => string | null;
}
```

In `build()`, add after the session start line (line 72):

```typescript
const notebookUpdated = this.config.getNotebookLastUpdated?.();
if (notebookUpdated) {
  // Insert before [End Temporal Context]
}
```

Update the temporal context block to conditionally include the third line.

- [ ] **Step 3: Wire in index.ts — pass memoryDb.getStatus().lastSync**

In `initPromptBuilder()` call (index.ts ~line 101), pass the callback:

```typescript
initPromptBuilder(brainDir, agentDir, {
  getNotebookLastUpdated: () => memoryDb?.getStatus().lastSync ?? null,
});
```

Update `initPromptBuilder` signature in `session-manager.ts` to accept and forward the option.

- [ ] **Step 4: Run `npx tsc --noEmit` — verify clean**

- [ ] **Step 5: Commit**

```
feat(m6.6-s1): add notebook-last-updated to temporal context
```

---

## Chunk 2: S1 E2E Tests

### Task 2: S1 E2E tests from spec

The spec defines 5 E2E tests. All need a temp agent dir with notebook structure.

**Files:**
- Create: `packages/dashboard/tests/context-foundation.test.ts`

- [ ] **Step 1: Write test file with all 5 spec tests**

```typescript
// tests/context-foundation.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SystemPromptBuilder } from "../src/agent/system-prompt-builder.js";

function createTempAgentDir(): string { /* ... */ }

describe("S1: Context Foundation", () => {
  // Test 1: current-state.md injected into prompt
  it("injects current-state.md content into system prompt", async () => {
    // Write synthetic current-state.md to notebook/operations/
    // Build prompt, verify content appears
  });

  // Test 2: Temporal context present with today's date
  it("includes temporal context with current date", async () => {
    // Build prompt, verify [Temporal Context] block with today's date
  });

  // Test 3: notebook.md skill loaded (verify via assembleSystemPrompt)
  it("loads notebook.md skill into system prompt", async () => {
    // Requires brain/skills/notebook.md to exist
    // Build prompt, verify skill content appears
  });

  // Test 4: Stale data doesn't persist after update
  it("reflects updated content after cache invalidation", async () => {
    // Build prompt (caches), update file, invalidateCache(), rebuild
    // Verify new content appears
  });

  // Test 5: Empty operations/ is safe
  it("assembles prompt without errors when operations/ is empty", async () => {
    // Don't create current-state.md, build prompt
    // Verify no errors, prompt assembles
  });
});
```

- [ ] **Step 2: Run tests, verify they fail for the right reasons**

Run: `npx vitest run tests/context-foundation.test.ts`

- [ ] **Step 3: Fix any implementation issues discovered by tests**

- [ ] **Step 4: Run tests, verify all pass**

- [ ] **Step 5: Commit**

```
test(m6.6-s1): add E2E tests for context foundation
```

---

## Chunk 3: S2 Gap — Heartbeat Retry Verification

### Task 3: Test that failed jobs retry on next poll

The spec says "Heartbeat retry: failed jobs stay due until they succeed." Current implementation: `getLastRun()` only considers `status = 'completed'`, so failed jobs have no last run → always due. This is correct behavior — just needs a test.

**Files:**
- Modify: `packages/dashboard/tests/work-loop-scheduler.test.ts`

- [ ] **Step 1: Write failing test for heartbeat retry**

Add to the existing `describeWithApi` block:

```typescript
it("failed job retries on next check (heartbeat retry)", async () => {
  // 1. Write patterns with a job that has an unknown handler (will fail)
  // 2. Trigger it — should fail
  // 3. Verify getLastRun returns null (only completed runs count)
  // 4. This means isDue will return true on next poll — job stays due
});
```

This test doesn't need Haiku — it uses an unknown job handler that fails immediately.

- [ ] **Step 2: Run test, verify it passes (tests existing behavior)**

- [ ] **Step 3: Commit**

```
test(m6.6-s2): verify heartbeat retry for failed jobs
```

---

## Chunk 4: S2 Gap — Restart Persistence Test

### Task 4: Test that scheduler persists last run across restarts

Spec E2E test #5: "Run a job, restart scheduler, check lastRun — job not re-triggered before next cadence."

**Files:**
- Modify: `packages/dashboard/tests/work-loop-scheduler.test.ts`

- [ ] **Step 1: Write restart persistence test**

Add to `describeWithApi` block:

```typescript
it("persists lastRun across scheduler restart", async () => {
  // 1. Create scheduler, trigger morning-prep
  // 2. Stop scheduler
  // 3. Create NEW scheduler with same DB
  // 4. Verify getLastRun("morning-prep") returns the previous run time
  // 5. Verify isDue returns false (already ran today)
}, HAIKU_TIMEOUT);
```

- [ ] **Step 2: Run test, verify it passes**

- [ ] **Step 3: Commit**

```
test(m6.6-s2): verify restart persistence of lastRun
```

---

## Chunk 5: S2 Gap — API Route Tests

### Task 5: Test work loop API routes

Spec E2E tests #7 and #8: calendar API returns events, manual trigger API works.

These tests need a running Fastify server. Use `fastify.inject()` for in-process HTTP testing (no real server needed).

**Files:**
- Create: `packages/dashboard/tests/work-loop-api.test.ts`
- Modify: `packages/dashboard/src/server.ts` (may need to export createServer for testing)

- [ ] **Step 1: Write API route tests**

```typescript
// tests/work-loop-api.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";

describe("Work Loop API", () => {
  // Test: GET /api/work-loop/status returns scheduler info
  it("GET /api/work-loop/status returns running status and patterns", async () => {
    // inject GET /api/work-loop/status
    // Verify: { running: true, patterns: [...], recentRuns: [...] }
  });

  // Test: GET /api/work-loop/events returns FullCalendar format
  it("GET /api/work-loop/events returns FullCalendar-compatible events", async () => {
    // Trigger a job first, then GET events
    // Verify: array of { id, title, start, end, color, extendedProps.type === "work-loop" }
  });

  // Test: POST /api/work-loop/trigger/:jobName triggers job
  it("POST /api/work-loop/trigger/morning-prep returns job output", async () => {
    // inject POST /api/work-loop/trigger/morning-prep
    // Verify: { success: true, run: { status: "completed", output: "..." } }
  });

  // Test: POST /api/work-loop/trigger/unknown returns 400
  it("POST /api/work-loop/trigger/unknown returns 400", async () => {
    // inject POST /api/work-loop/trigger/nonexistent
    // Verify: 400 with error message
  });
});
```

- [ ] **Step 2: Set up test harness with Fastify inject**

Create a minimal server with `createServer()`, wire WorkLoopScheduler, use `server.inject()` for HTTP calls. Temp agent dir for isolation.

- [ ] **Step 3: Run tests, verify they pass**

Run: `node --env-file=.env npx vitest run tests/work-loop-api.test.ts`

- [ ] **Step 4: Commit**

```
test(m6.6-s2): add API route tests for work loop endpoints
```

---

## Chunk 6: S2 Gap — Dashboard UI

### Task 6: Calendar sidebar toggle for system events

Spec (2.8): "Toggle to show/hide system events (calendar sidebar checkbox, default: visible)"

**Files:**
- Modify: `packages/dashboard/public/index.html` (~line 3683, between calendars list and New Task button)
- Modify: `packages/dashboard/public/js/app.js` (add `showSystemEvents` state)
- Modify: `packages/dashboard/public/js/calendar.js` (filter work-loop events based on toggle)

- [ ] **Step 1: Add `showSystemEvents` state to Alpine app**

In `app.js`, add to the calendar component's data:
```javascript
showSystemEvents: true,
```

- [ ] **Step 2: Add sidebar toggle HTML**

After the calendars list, before "New Task" button in `index.html`:

```html
<!-- System Events Toggle -->
<div>
  <h3 class="text-xs font-semibold text-tokyo-muted uppercase tracking-wide mb-2">System</h3>
  <label class="flex items-center gap-2 cursor-pointer text-sm text-gray-300 hover:text-white">
    <input type="checkbox" x-model="showSystemEvents" @change="refreshCalendar()"
           class="rounded border-white/20 bg-white/5 text-violet-500 focus:ring-violet-500/30">
    <span class="w-2 h-2 rounded-full" style="background: #cba6f7"></span>
    Work Loop Jobs
  </label>
</div>
```

- [ ] **Step 3: Wire toggle to FullCalendar event source visibility**

In `calendar.js`, the work-loop event source needs conditional inclusion. Modify `initCalendar` to accept a `showSystemEvents` option and use it in the event source's `success` callback or by dynamically adding/removing the source.

Simpler approach: use FullCalendar's `eventSourceSuccess` or pass `extraParams` that the API can filter, OR use client-side filtering via `eventDidMount` to hide/show events with `extendedProps.type === "work-loop"`.

- [ ] **Step 4: Test manually — toggle checkbox, verify events appear/disappear**

- [ ] **Step 5: Commit**

```
feat(m6.6-s2): add sidebar toggle for work loop system events
```

### Task 7: Event click detail panel for work loop events

Spec (2.8): "Clicking a system event shows job output in a detail panel"

**Files:**
- Modify: `packages/dashboard/public/index.html` (add detail panel markup)
- Modify: `packages/dashboard/public/js/app.js` (add click handler state + logic)

- [ ] **Step 1: Add work loop event detail state**

In `app.js` calendar component:
```javascript
workLoopDetail: null,  // { jobName, status, output, error, duration, startedAt }
showWorkLoopDetail: false,
```

- [ ] **Step 2: Add click handler for work loop events**

In the `eventClick` handler in `app.js`, check if the clicked event has `extendedProps.type === "work-loop"`. If so, populate `workLoopDetail` and show the panel instead of the normal event detail.

- [ ] **Step 3: Add detail panel HTML**

Glass-strong panel (following design language) that shows:
- Job name (title)
- Status badge (completed=green, failed=red)
- Duration
- Output (pre-formatted, scrollable)
- Error message (if failed)
- Close button

Position: modal overlay or slide-in panel, consistent with existing UI patterns.

- [ ] **Step 4: Test manually — click a work loop event on calendar, verify detail shows**

- [ ] **Step 5: Commit**

```
feat(m6.6-s2): add detail panel for work loop calendar events
```

### Task 8: "Run Now" button for manual job triggers

Spec (2.9): Dashboard "Run now" button.

**Files:**
- Modify: `packages/dashboard/public/index.html` (add button to sidebar or detail panel)
- Modify: `packages/dashboard/public/js/app.js` (add trigger function)

- [ ] **Step 1: Add `triggerWorkLoopJob()` function**

In `app.js`:
```javascript
async triggerWorkLoopJob(jobName) {
  const res = await fetch(`/api/work-loop/trigger/${jobName}`, { method: 'POST' });
  const data = await res.json();
  if (data.success) {
    // Show success notification, refresh calendar
    this.refreshCalendar();
  } else {
    // Show error
  }
}
```

- [ ] **Step 2: Add "Run Now" buttons to sidebar**

Under the "System" section, list each job pattern with a run button:

```html
<template x-for="job in workLoopPatterns" :key="job.name">
  <div class="flex items-center justify-between">
    <span class="text-xs text-gray-400" x-text="job.displayName"></span>
    <button @click="triggerWorkLoopJob(job.name)"
            class="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 hover:bg-violet-500/25">
      Run
    </button>
  </div>
</template>
```

- [ ] **Step 3: Fetch job patterns on calendar load**

Add to calendar initialization:
```javascript
async loadWorkLoopPatterns() {
  const res = await fetch('/api/work-loop/status');
  const data = await res.json();
  this.workLoopPatterns = data.patterns || [];
}
```

- [ ] **Step 4: Test manually — click Run, verify job executes and calendar updates**

- [ ] **Step 5: Commit**

```
feat(m6.6-s2): add Run Now buttons for work loop jobs
```

---

## Chunk 7: S2 Gap — System Prompt Injection Test

### Task 9: Verify current-state.md appears in assembled system prompt

Spec E2E test #6: "Trigger morning prep → inspect assembled prompt → prompt contains morning prep output."

This test proves the full pipeline: morning prep writes file → cache invalidates → next prompt build includes it.

**Files:**
- Modify: `packages/dashboard/tests/work-loop-scheduler.test.ts` OR add to `tests/context-foundation.test.ts`

- [ ] **Step 1: Write E2E test**

```typescript
it("morning prep output appears in assembled system prompt", async () => {
  // 1. Create temp agent dir with brain/ structure
  // 2. Trigger morning-prep (writes current-state.md)
  // 3. Use assembleSystemPrompt() or SystemPromptBuilder.build()
  // 4. Verify output contains the morning prep content
}, HAIKU_TIMEOUT);
```

- [ ] **Step 2: Run test, verify it passes**

- [ ] **Step 3: Commit**

```
test(m6.6-s2): verify morning prep output in assembled system prompt
```

---

## Final Verification

### Task 10: Full test suite + TypeScript check

- [ ] **Step 1: Run all tests**

```bash
node --env-file=.env npx vitest run tests/
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Prettier**

```bash
npx prettier --write src/ tests/ public/
```

- [ ] **Step 4: Final commit if needed**

---

## Gap Coverage Matrix

| Spec Requirement | Task | Status |
|-----------------|------|--------|
| S1 1.2: Notebook last updated timestamp | Task 1 | Planned |
| S1 E2E #1: current-state.md injected | Task 2 | Planned |
| S1 E2E #2: Temporal context with date | Task 2 | Planned |
| S1 E2E #3: notebook.md skill loaded | Task 2 | Planned |
| S1 E2E #4: Stale data doesn't persist | Task 2 | Planned |
| S1 E2E #5: Empty operations/ is safe | Task 2 | Planned |
| S2 2.1: Heartbeat retry | Task 3 | Planned |
| S2 E2E #5: Restart persistence | Task 4 | Planned |
| S2 E2E #7: Calendar API returns events | Task 5 | Planned |
| S2 E2E #8: Manual trigger API | Task 5 | Planned |
| S2 2.8: Sidebar toggle | Task 6 | Planned |
| S2 2.8: Event click detail panel | Task 7 | Planned |
| S2 2.9: Run Now button | Task 8 | Planned |
| S2 E2E #6: current-state.md in prompt | Task 9 | Planned |
| Full suite verification | Task 10 | Planned |
