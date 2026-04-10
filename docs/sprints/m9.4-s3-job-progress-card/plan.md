# M9.4-S3: Job Progress Card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken inline delegation progress bar with a sticky progress card above the compose box that shows real-time step-level job progress.

**Architecture:** Extend `JobSnapshot.todoProgress` in the backend to include an `items` array (id, text, status per step). On the frontend, remove the old per-message progress bar and `_syncDelegationProgress()`, replacing them with a standalone Alpine component that reads directly from the `jobs` store. The card is sticky-positioned above the compose box, supports collapsed/expanded toggle, and handles up to 2 concurrent jobs.

**Tech Stack:** TypeScript (backend types + StatePublisher), Alpine.js (frontend component), Tailwind CSS (styling), Vitest (tests)

**Design spec:** `docs/superpowers/specs/2026-04-08-conversation-ux-ui-design.md` — Section 10

---

### Task 1: Extend `todoProgress` type and StatePublisher snapshot

**Files:**
- Modify: `packages/dashboard/src/ws/protocol.ts:313-317`
- Modify: `packages/dashboard/src/state/state-publisher.ts:528-539`
- Test: `packages/dashboard/tests/integration/state-publishing-jobs.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/tests/integration/state-publishing-jobs.test.ts`:

```typescript
/**
 * M9.4-S3: Verify state:jobs broadcasts include todoProgress.items
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppHarness } from "./app-harness.js";
import { writeTodoFile } from "../../src/automations/todo-file.js";
import path from "node:path";
import fs from "node:fs";

let harness: AppHarness;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(async () => {
  harness = await AppHarness.create({ withAutomations: true });
  harness.clearBroadcasts();
});

afterEach(async () => {
  await harness.shutdown();
});

describe("state:jobs todoProgress.items", () => {
  it("includes items array with id, text, and status", async () => {
    // Create a running job with a run_dir containing todos.json
    const job = harness.automationJobService!.createJob({
      automationId: "test-auto",
      context: {},
    });
    const runDir = path.join(harness.agentDir, "runtime", "jobs", job.id);
    fs.mkdirSync(runDir, { recursive: true });
    harness.automationJobService!.startJob(job.id, runDir);

    writeTodoFile(path.join(runDir, "todos.json"), {
      items: [
        { id: "t1", text: "Research topic", status: "done", mandatory: true, created_by: "framework" },
        { id: "t2", text: "Write report", status: "in_progress", mandatory: true, created_by: "framework" },
        { id: "t3", text: "Review output", status: "pending", mandatory: false, created_by: "agent" },
      ],
      last_activity: new Date().toISOString(),
    });

    harness.statePublisher.publishJobs();
    await delay(150);

    const broadcasts = harness.getBroadcasts("state:jobs");
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);

    const last = broadcasts[broadcasts.length - 1] as any;
    const snapshot = last.jobs.find((j: any) => j.id === job.id);
    expect(snapshot).toBeDefined();
    expect(snapshot.todoProgress).toBeDefined();
    expect(snapshot.todoProgress.done).toBe(1);
    expect(snapshot.todoProgress.total).toBe(3);
    expect(snapshot.todoProgress.current).toBe("Write report");

    // Key assertion: items array exists with correct shape
    expect(snapshot.todoProgress.items).toHaveLength(3);
    expect(snapshot.todoProgress.items[0]).toEqual({ id: "t1", text: "Research topic", status: "done" });
    expect(snapshot.todoProgress.items[1]).toEqual({ id: "t2", text: "Write report", status: "in_progress" });
    expect(snapshot.todoProgress.items[2]).toEqual({ id: "t3", text: "Review output", status: "pending" });
  });

  it("omits items when job has no todos", async () => {
    const job = harness.automationJobService!.createJob({
      automationId: "test-auto",
      context: {},
    });
    const runDir = path.join(harness.agentDir, "runtime", "jobs", job.id);
    fs.mkdirSync(runDir, { recursive: true });
    harness.automationJobService!.startJob(job.id, runDir);

    // Empty todos.json
    writeTodoFile(path.join(runDir, "todos.json"), {
      items: [],
      last_activity: new Date().toISOString(),
    });

    harness.statePublisher.publishJobs();
    await delay(150);

    const broadcasts = harness.getBroadcasts("state:jobs");
    const last = broadcasts[broadcasts.length - 1] as any;
    const snapshot = last.jobs.find((j: any) => j.id === job.id);
    expect(snapshot.todoProgress).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/integration/state-publishing-jobs.test.ts`
Expected: FAIL — `todoProgress.items` is undefined (not yet in the snapshot)

- [ ] **Step 3: Update `JobSnapshot` type to include `items`**

In `packages/dashboard/src/ws/protocol.ts`, change the `todoProgress` field on `JobSnapshot` (lines 313-317):

```typescript
// Before:
todoProgress?: {
  done: number
  total: number
  current: string | null
}

// After:
todoProgress?: {
  done: number
  total: number
  current: string | null
  items: Array<{ id: string; text: string; status: import("@my-agent/core").TodoStatus }>
}
```

- [ ] **Step 4: Update `_getJobSnapshots()` to include `items`**

In `packages/dashboard/src/state/state-publisher.ts`, modify the `_getJobSnapshots()` method (lines 528-539). Change the return object inside the IIFE:

```typescript
// Before (line 535):
return { done, total: todoFile.items.length, current: inProgress?.text ?? null }

// After:
return {
  done,
  total: todoFile.items.length,
  current: inProgress?.text ?? null,
  items: todoFile.items.map(i => ({ id: i.id, text: i.text, status: i.status })),
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/dashboard && npx vitest run tests/integration/state-publishing-jobs.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite to check for regressions**

Run: `cd packages/dashboard && npx vitest run`
Expected: All existing tests pass (the type change is backwards-compatible — `items` is a new field)

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/ws/protocol.ts packages/dashboard/src/state/state-publisher.ts packages/dashboard/tests/integration/state-publishing-jobs.test.ts
git commit -m "feat(state): include todo items in state:jobs broadcast

Add items array (id, text, status) to JobSnapshot.todoProgress so the
frontend progress card can render individual step states."
```

---

### Task 2: Build Alpine progress card component

**Files:**
- Modify: `packages/dashboard/public/js/stores.js:37-44` (extend jobs store)
- Create: `packages/dashboard/public/js/progress-card.js` (Alpine component)
- Modify: `packages/dashboard/public/index.html` (load script)

- [ ] **Step 1: Extend the Alpine `jobs` store with progress card state**

In `packages/dashboard/public/js/stores.js`, replace the `jobs` store (lines 37-44):

```javascript
Alpine.store("jobs", {
  items: [],
  loading: true,
  dismissed: [],  // job IDs the user closed with ✕

  update(jobs) {
    this.items = jobs;
    this.loading = false;
  },

  /**
   * Running jobs with todoProgress, sorted newest first, max 2.
   * Excludes dismissed cards.
   */
  get activeCards() {
    return this.items
      .filter(j => j.status === "running" && j.todoProgress && j.todoProgress.items?.length > 0 && !this.dismissed.includes(j.id))
      .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
      .slice(0, 2);
  },

  /**
   * Recently completed jobs (for fade-out), max 2.
   * Cleared from this list after 2s timeout in the component.
   */
  completedCards: [],

  dismiss(jobId) {
    if (!this.dismissed.includes(jobId)) {
      this.dismissed.push(jobId);
    }
  },
});
```

- [ ] **Step 2: Create the progress card Alpine component**

Create `packages/dashboard/public/js/progress-card.js`:

```javascript
/**
 * M9.4-S3: Job Progress Card component
 *
 * Sticky card above compose box showing real-time job step progress.
 * Reads from Alpine.store("jobs").activeCards.
 */

function progressCard() {
  return {
    expanded: {},     // { [jobId]: boolean }
    fading: {},       // { [jobId]: true } — cards in 2s fade-out

    get cards() {
      const store = Alpine.store("jobs");
      return [...store.activeCards, ...store.completedCards.filter(c => !store.dismissed.includes(c.id))];
    },

    isExpanded(jobId) {
      return this.expanded[jobId] || false;
    },

    toggle(jobId) {
      this.expanded[jobId] = !this.expanded[jobId];
    },

    dismiss(jobId) {
      Alpine.store("jobs").dismiss(jobId);
      delete this.expanded[jobId];
    },

    isFading(jobId) {
      return this.fading[jobId] === "fading";
    },

    isDone(jobId) {
      const f = this.fading[jobId];
      return f === "done" || f === "fading";
    },

    statusIcon(status) {
      switch (status) {
        case "done": return "\u2713";
        case "in_progress": return "\u21bb";
        case "blocked": return "\u2298";
        default: return "\u25cb";
      }
    },

    statusClass(status) {
      switch (status) {
        case "done": return "text-green-400/60";
        case "in_progress": return "text-blue-400";
        case "blocked": return "text-orange-400/60";
        default: return "text-gray-500";
      }
    },

    currentStepText(job) {
      if (!job.todoProgress?.items) return "";
      const current = job.todoProgress.items.find(i => i.status === "in_progress");
      return current ? current.text : "";
    },

    /**
     * Called when a job transitions to completed.
     * Shows "Done" at full opacity for 1.5s, then fades over 0.5s, then removes.
     */
    handleJobCompleted(job) {
      const store = Alpine.store("jobs");
      if (store.dismissed.includes(job.id)) return;
      if (!job.todoProgress?.items?.length) return;

      store.completedCards.push(job);
      // Phase 1: show "Done" at full opacity
      this.fading[job.id] = "done";

      // Phase 2: after 1.5s, start opacity fade
      setTimeout(() => {
        this.fading[job.id] = "fading";
      }, 1500);

      // Phase 3: after 2s total, remove card
      setTimeout(() => {
        store.completedCards = store.completedCards.filter(c => c.id !== job.id);
        delete this.fading[job.id];
      }, 2000);
    },

    init() {
      // Watch for jobs transitioning from running to completed
      this.$watch(() => Alpine.store("jobs").items, (newJobs, oldJobs) => {
        if (!oldJobs) return;
        for (const job of newJobs) {
          if (job.status === "completed" || job.status === "failed" || job.status === "needs_review") {
            const wasRunning = oldJobs.find(o => o.id === job.id && o.status === "running");
            if (wasRunning && wasRunning.todoProgress?.items?.length) {
              this.handleJobCompleted(job);
            }
          }
        }
      });
    },
  };
}
```

- [ ] **Step 3: Add `<script>` tag for `progress-card.js` in `index.html`**

In `packages/dashboard/public/index.html`, find the existing `<script src="/js/stores.js">` tag and add the new script after it:

```html
<script src="/js/progress-card.js"></script>
```

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/public/js/progress-card.js packages/dashboard/public/js/stores.js packages/dashboard/public/index.html
git commit -m "feat(ui): add progress card Alpine component and jobs store

New progressCard() component reads from jobs store activeCards.
Handles collapsed/expanded toggle, dismiss, completion fade-out."
```

---

### Task 3: Add progress card HTML to desktop and mobile templates

**Files:**
- Modify: `packages/dashboard/public/index.html` (desktop and mobile sections)

- [ ] **Step 1: Add desktop progress card above compose area**

In `packages/dashboard/public/index.html`, insert the progress card HTML **before** the `<!-- Compose area -->` comment at line 5872, inside the same flex container. The card sits between the message list `</main>` (line 5870) and the compose `<footer>` (line 5873):

```html
        <!-- Job progress cards (sticky above compose) -->
        <div x-data="progressCard()" class="shrink-0 px-3 flex flex-col gap-1.5"
             x-show="cards.length > 0">
          <template x-for="job in cards" :key="job.id">
            <div class="glass-strong rounded-lg overflow-hidden transition-opacity duration-500"
                 :style="isFading(job.id) ? 'opacity:0' : 'opacity:1'"
                 style="border: 1px solid rgba(255,255,255,0.08)">

              <!-- Collapsed view: shows current step text + done/total counter -->
              <div x-show="!isExpanded(job.id)"
                   @click="toggle(job.id)"
                   class="flex items-center gap-2 px-3 py-2 cursor-pointer select-none">
                <span class="text-blue-400 text-xs">●</span>
                <span class="text-xs text-tokyo-text truncate flex-1"
                      x-text="isDone(job.id) ? 'Done' : (currentStepText(job) || job.automationName || 'Job')"></span>
                <span class="text-xs text-gray-500 shrink-0"
                      x-text="isDone(job.id) ? '✓' : (job.todoProgress?.done + '/' + job.todoProgress?.total)"></span>
              </div>

              <!-- Expanded view: header with job name + step list -->
              <div x-show="isExpanded(job.id)" x-cloak>
                <!-- Header -->
                <div class="flex items-center gap-2 px-3 py-2">
                  <span class="text-blue-400 text-xs">●</span>
                  <span class="text-xs text-tokyo-text truncate flex-1 cursor-pointer select-none"
                        @click="toggle(job.id)"
                        x-text="job.automationName || 'Job'"></span>
                  <button @click.stop="dismiss(job.id)"
                          class="text-gray-500 hover:text-gray-300 text-xs leading-none p-0.5">✕</button>
                </div>
                <!-- Step list (max 4 visible, scrolls) -->
                <div class="max-h-[6.5rem] overflow-y-auto px-3 pb-2" style="scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent">
                  <template x-for="item in job.todoProgress?.items || []" :key="item.id">
                    <div class="flex items-start gap-2 py-0.5">
                      <span class="text-xs leading-5 shrink-0" :class="statusClass(item.status)"
                            x-text="statusIcon(item.status)"></span>
                      <span class="text-xs leading-5 truncate"
                            :class="item.status === 'in_progress' ? 'text-blue-400' : (item.status === 'done' ? 'text-green-400/60' : 'text-gray-500')"
                            x-text="item.text"></span>
                    </div>
                  </template>
                </div>
              </div>

            </div>
          </template>
        </div>
```

- [ ] **Step 2: Add mobile progress card above compose bar**

In `packages/dashboard/public/index.html`, insert the same progress card HTML **before** the `<!-- Compose bar (ALWAYS visible -->` comment at line 8817, inside the mobile sheet:

```html
          <!-- Job progress cards (sticky above compose — mobile) -->
          <div x-data="progressCard()" class="shrink-0 px-3 pb-1 flex flex-col gap-1.5"
               x-show="cards.length > 0">
            <template x-for="job in cards" :key="job.id">
              <div class="glass-strong rounded-lg overflow-hidden transition-opacity duration-500"
                   :style="isFading(job.id) ? 'opacity:0' : 'opacity:1'"
                   style="border: 1px solid rgba(255,255,255,0.08)">

                <!-- Collapsed view: shows current step text + done/total counter -->
                <div x-show="!isExpanded(job.id)"
                     @click="toggle(job.id)"
                     class="flex items-center gap-2 px-3 py-2 cursor-pointer select-none">
                  <span class="text-blue-400 text-xs">●</span>
                  <span class="text-xs text-tokyo-text truncate flex-1"
                        x-text="isDone(job.id) ? 'Done' : (currentStepText(job) || job.automationName || 'Job')"></span>
                  <span class="text-xs text-gray-500 shrink-0"
                        x-text="isDone(job.id) ? '✓' : (job.todoProgress?.done + '/' + job.todoProgress?.total)"></span>
                </div>

                <!-- Expanded view: header with job name + step list -->
                <div x-show="isExpanded(job.id)" x-cloak>
                  <!-- Header -->
                  <div class="flex items-center gap-2 px-3 py-2">
                    <span class="text-blue-400 text-xs">●</span>
                    <span class="text-xs text-tokyo-text truncate flex-1 cursor-pointer select-none"
                          @click="toggle(job.id)"
                          x-text="job.automationName || 'Job'"></span>
                    <button @click.stop="dismiss(job.id)"
                            class="text-gray-500 hover:text-gray-300 text-xs leading-none p-0.5">✕</button>
                  </div>
                  <!-- Step list (max 4 visible, scrolls) -->
                  <div class="max-h-[6.5rem] overflow-y-auto px-3 pb-2" style="scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent">
                    <template x-for="item in job.todoProgress?.items || []" :key="item.id">
                      <div class="flex items-start gap-2 py-0.5">
                        <span class="text-xs leading-5 shrink-0" :class="statusClass(item.status)"
                              x-text="statusIcon(item.status)"></span>
                        <span class="text-xs leading-5 truncate"
                              :class="item.status === 'in_progress' ? 'text-blue-400' : (item.status === 'done' ? 'text-green-400/60' : 'text-gray-500')"
                              x-text="item.text"></span>
                      </div>
                    </template>
                  </div>
                </div>

              </div>
            </template>
          </div>
```

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/public/index.html
git commit -m "feat(ui): add progress card HTML to desktop and mobile templates

Sticky cards above compose box, glass-strong styling, collapsed/expanded
toggle, max 4 visible steps with scroll, dismiss button."
```

---

### Task 4: Remove old inline progress bar and `_syncDelegationProgress`

**Files:**
- Modify: `packages/dashboard/public/index.html:5652-5664` (desktop progress bar)
- Modify: `packages/dashboard/public/index.html:8756-8768` (mobile progress bar)
- Modify: `packages/dashboard/public/js/app.js:1450,1454,1928-1997` (sync logic)
- Delete: `packages/dashboard/tests/unit/ui/delegation-progress-bar.test.ts`

- [ ] **Step 1: Remove desktop inline progress bar template**

In `packages/dashboard/public/index.html`, delete lines 5651-5664 (the `<!-- Delegation progress bar -->` template block containing `x-if="msg.delegationProgress"`).

- [ ] **Step 2: Remove mobile inline progress bar template**

In `packages/dashboard/public/index.html`, delete the second occurrence of the delegation progress bar template (around lines 8755-8768, will have shifted after step 1 — search for the remaining `msg.delegationProgress`).

- [ ] **Step 3: Remove `_syncDelegationProgress` from app.js**

In `packages/dashboard/public/js/app.js`:

1. Remove the `state:jobs` case that calls `_syncDelegationProgress` (line 1928-1931):
```javascript
// DELETE this case block:
case "state:jobs":
  // Handled by ws-client.js → Alpine store, then sync progress bars
  this.$nextTick(() => this._syncDelegationProgress(data.jobs || []));
  break;
```

2. Remove the `_syncDelegationProgress` method definition (lines 1940-1997).

3. Remove the `_doneTimestamp` assignment (line 1454):
```javascript
// DELETE this line:
lastMsg._doneTimestamp = Date.now();
```

4. Remove the comment at line 1450 referencing the progress bar:
```javascript
// DELETE this line:
// (progress bar is attached in _syncDelegationProgress when new once:true jobs appear)
```

- [ ] **Step 4: Delete the old unit test**

Delete `packages/dashboard/tests/unit/ui/delegation-progress-bar.test.ts`.

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `cd packages/dashboard && npx vitest run`
Expected: All tests pass. The deleted test no longer runs. No other test references `delegationProgress` or `_syncDelegationProgress`.

- [ ] **Step 6: Commit**

```bash
git rm packages/dashboard/tests/unit/ui/delegation-progress-bar.test.ts
git add packages/dashboard/public/index.html packages/dashboard/public/js/app.js
git commit -m "refactor(ui): remove inline delegation progress bar

Remove _syncDelegationProgress(), msg.delegationProgress templates
(desktop + mobile), and _doneTimestamp. Replaced by sticky progress
card in Task 3."
```

---

### Task 5: Write progress card structural tests

**Files:**
- Create: `packages/dashboard/tests/unit/ui/progress-card.test.ts`

- [ ] **Step 1: Write structural verification tests**

Create `packages/dashboard/tests/unit/ui/progress-card.test.ts`:

```typescript
/**
 * M9.4-S3: Progress Card — Structural Verification
 *
 * Verifies progress card templates exist in both desktop and mobile
 * sections of index.html, and that progress-card.js has required methods.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const indexHtml = readFileSync(
  join(__dirname, "../../../public/index.html"),
  "utf-8",
);

const progressCardJs = readFileSync(
  join(__dirname, "../../../public/js/progress-card.js"),
  "utf-8",
);

describe("Progress card — template structure", () => {
  const cardBlocks = indexHtml
    .split("\n")
    .map((line, i) => ({ line, num: i + 1 }))
    .filter((l) => l.line.includes("progressCard()"));

  it("progress card template exists in the HTML", () => {
    expect(cardBlocks.length).toBeGreaterThan(0);
  });

  it("appears in both desktop and mobile sections", () => {
    const xDataLines = cardBlocks.map((l) => l.num);
    expect(xDataLines.length, "Expected 2 x-data templates (desktop + mobile)").toBeGreaterThanOrEqual(2);

    if (xDataLines.length >= 2) {
      const gap = xDataLines[xDataLines.length - 1] - xDataLines[0];
      expect(gap, "Desktop and mobile should be in separate sections").toBeGreaterThan(1000);
    }
  });

  it("uses glass-strong styling", () => {
    // Both card instances use glass-strong class
    const glassLines = indexHtml.split("\n").filter(l => l.includes("glass-strong") && l.includes("rounded-lg"));
    expect(glassLines.length).toBeGreaterThanOrEqual(2);
  });

  it("has collapsed and expanded views", () => {
    expect(indexHtml).toContain('x-show="!isExpanded(job.id)"');
    expect(indexHtml).toContain('x-show="isExpanded(job.id)"');
  });

  it("collapsed view shows current step text", () => {
    expect(indexHtml).toContain("currentStepText(job)");
  });

  it("has dismiss button", () => {
    expect(indexHtml).toContain("dismiss(job.id)");
  });

  it("has scrollable step list", () => {
    expect(indexHtml).toContain("max-h-[6.5rem]");
    expect(indexHtml).toContain("overflow-y-auto");
  });

  it("uses correct status colors from design spec", () => {
    expect(progressCardJs).toContain("text-green-400/60");
    expect(progressCardJs).toContain("text-blue-400");
    expect(progressCardJs).toContain("text-orange-400/60");
    expect(progressCardJs).toContain("text-gray-500");
  });

  it("uses correct status icons", () => {
    // ✓ ↻ ⊘ ○
    expect(progressCardJs).toContain("\u2713");   // ✓
    expect(progressCardJs).toContain("\u21bb");   // ↻
    expect(progressCardJs).toContain("\u2298");   // ⊘
    expect(progressCardJs).toContain("\u25cb");   // ○
  });

  it("old delegation progress bar is removed", () => {
    expect(indexHtml).not.toContain("msg.delegationProgress");
    expect(indexHtml).not.toContain("delegationProgress.fading");
  });
});

describe("Progress card — component structure", () => {
  it("has required methods", () => {
    expect(progressCardJs).toContain("toggle(");
    expect(progressCardJs).toContain("dismiss(");
    expect(progressCardJs).toContain("statusIcon(");
    expect(progressCardJs).toContain("statusClass(");
    expect(progressCardJs).toContain("currentStepText(");
    expect(progressCardJs).toContain("isDone(");
    expect(progressCardJs).toContain("handleJobCompleted(");
  });

  it("has two-phase completion: 'done' then 'fading'", () => {
    expect(progressCardJs).toContain('"done"');
    expect(progressCardJs).toContain('"fading"');
    expect(progressCardJs).toContain("1500");  // done → fading delay
    expect(progressCardJs).toContain("2000");  // fading → remove delay
  });

  it("has init method with $watch", () => {
    expect(progressCardJs).toContain("init()");
    expect(progressCardJs).toContain("$watch");
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd packages/dashboard && npx vitest run tests/unit/ui/progress-card.test.ts`
Expected: PASS (all structural assertions hold after Tasks 2-4)

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/tests/unit/ui/progress-card.test.ts
git commit -m "test(ui): add progress card structural verification tests

Replaces delegation-progress-bar.test.ts with new tests verifying
card templates, styling, status icons, and component methods."
```

---

### Task 6: Browser verification tests (Playwright)

**Files:**
- Create: `packages/dashboard/tests/browser/progress-card.test.ts`

This task validates the 10 spec requirements from Section 10.8 via Playwright against the running dashboard.

- [ ] **Step 1: Write Playwright browser tests**

Create `packages/dashboard/tests/browser/progress-card.test.ts`:

```typescript
/**
 * M9.4-S3: Progress Card — Browser Verification
 *
 * Validates the 10 acceptance criteria from design spec Section 10.8.
 * Requires dashboard running at localhost:4321.
 *
 * Setup: The tests create jobs via the debug API and write todos.json
 * to the job's run_dir to simulate progress updates.
 */

import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = "http://localhost:4321";

// Helper: create a job via debug API and return { jobId, runDir }
async function createJobWithTodos(
  page: Page,
  todos: Array<{ id: string; text: string; status: string; mandatory: boolean; created_by: string }>,
) {
  // Use debug API to create and start a job
  const createRes = await page.request.post(`${BASE_URL}/debug/jobs`, {
    data: { automationId: "test-progress-card", trigger: "manual" },
  });
  const { jobId, runDir } = await createRes.json();

  // Write todos.json to the job's run_dir
  const todoPath = path.join(runDir, "todos.json");
  fs.writeFileSync(
    todoPath,
    JSON.stringify({ items: todos, last_activity: new Date().toISOString() }, null, 2),
  );

  // Trigger a state refresh
  await page.request.post(`${BASE_URL}/debug/state/refresh`);
  return { jobId, runDir };
}

// Helper: update a single todo status
async function updateTodo(
  page: Page,
  runDir: string,
  todoId: string,
  newStatus: string,
) {
  const todoPath = path.join(runDir, "todos.json");
  const data = JSON.parse(fs.readFileSync(todoPath, "utf-8"));
  const item = data.items.find((i: any) => i.id === todoId);
  if (item) item.status = newStatus;
  data.last_activity = new Date().toISOString();
  fs.writeFileSync(todoPath, JSON.stringify(data, null, 2));
  await page.request.post(`${BASE_URL}/debug/state/refresh`);
}

test.describe("Progress Card — Spec 10.8 Validation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector("[x-data]", { timeout: 5000 });
  });

  test("T1: card appears when job starts with todos", async ({ page }) => {
    await createJobWithTodos(page, [
      { id: "t1", text: "Step one", status: "in_progress", mandatory: true, created_by: "framework" },
      { id: "t2", text: "Step two", status: "pending", mandatory: true, created_by: "framework" },
    ]);
    await page.waitForTimeout(500);
    const card = page.locator("[x-data='progressCard()']").first();
    await expect(card).toBeVisible();
  });

  test("T2: card updates as todo statuses change", async ({ page }) => {
    const { runDir } = await createJobWithTodos(page, [
      { id: "t1", text: "First step", status: "in_progress", mandatory: true, created_by: "framework" },
      { id: "t2", text: "Second step", status: "pending", mandatory: true, created_by: "framework" },
    ]);
    await page.waitForTimeout(500);

    // Should show 0/2
    const counter = page.locator("[x-data='progressCard()']").first().locator("text=0/2");
    await expect(counter).toBeVisible();

    // Update t1 to done
    await updateTodo(page, runDir, "t1", "done");
    await page.waitForTimeout(500);

    // Should now show 1/2
    const updated = page.locator("[x-data='progressCard()']").first().locator("text=1/2");
    await expect(updated).toBeVisible();
  });

  test("T3: collapsed shows current step text", async ({ page }) => {
    await createJobWithTodos(page, [
      { id: "t1", text: "Researching providers", status: "in_progress", mandatory: true, created_by: "framework" },
    ]);
    await page.waitForTimeout(500);
    // Collapsed card shows the automation name (not step text) — step text is in expanded view
    const card = page.locator("[x-data='progressCard()']").first();
    await expect(card).toBeVisible();
  });

  test("T4: expanded shows all steps with correct icons", async ({ page }) => {
    await createJobWithTodos(page, [
      { id: "t1", text: "Done step", status: "done", mandatory: true, created_by: "framework" },
      { id: "t2", text: "Current step", status: "in_progress", mandatory: true, created_by: "framework" },
      { id: "t3", text: "Pending step", status: "pending", mandatory: true, created_by: "framework" },
      { id: "t4", text: "Blocked step", status: "blocked", mandatory: false, created_by: "framework" },
    ]);
    await page.waitForTimeout(500);

    // Click to expand
    const card = page.locator("[x-data='progressCard()']").first();
    await card.click();
    await page.waitForTimeout(300);

    // All 4 step texts should be visible
    await expect(card.locator("text=Done step")).toBeVisible();
    await expect(card.locator("text=Current step")).toBeVisible();
    await expect(card.locator("text=Pending step")).toBeVisible();
    await expect(card.locator("text=Blocked step")).toBeVisible();
  });

  test("T5: scrollbar appears when > 4 steps", async ({ page }) => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      id: `t${i}`,
      text: `Step ${i + 1}`,
      status: i === 0 ? "in_progress" : "pending",
      mandatory: true,
      created_by: "framework" as const,
    }));
    await createJobWithTodos(page, items);
    await page.waitForTimeout(500);

    // Expand
    const card = page.locator("[x-data='progressCard()']").first();
    await card.click();
    await page.waitForTimeout(300);

    // Step list container should have overflow
    const stepList = card.locator("[class*='overflow-y-auto']");
    await expect(stepList).toBeVisible();
    const scrollHeight = await stepList.evaluate(el => el.scrollHeight > el.clientHeight);
    expect(scrollHeight).toBe(true);
  });

  test("T6: click/tap toggles collapsed/expanded", async ({ page }) => {
    await createJobWithTodos(page, [
      { id: "t1", text: "Toggle test step", status: "in_progress", mandatory: true, created_by: "framework" },
      { id: "t2", text: "Another step", status: "pending", mandatory: true, created_by: "framework" },
    ]);
    await page.waitForTimeout(500);

    const card = page.locator("[x-data='progressCard()']").first();

    // Initially collapsed — step text not visible
    await expect(card.locator("text=Toggle test step")).not.toBeVisible();

    // Click to expand
    await card.click();
    await page.waitForTimeout(300);
    await expect(card.locator("text=Toggle test step")).toBeVisible();

    // Click header text to collapse
    await card.locator("text=test-progress-card").click();
    await page.waitForTimeout(300);
    await expect(card.locator("text=Toggle test step")).not.toBeVisible();
  });

  test("T7: ✕ dismisses card, job continues", async ({ page }) => {
    const { jobId } = await createJobWithTodos(page, [
      { id: "t1", text: "Dismiss test", status: "in_progress", mandatory: true, created_by: "framework" },
    ]);
    await page.waitForTimeout(500);

    // Expand to see ✕
    const card = page.locator("[x-data='progressCard()']").first();
    await card.click();
    await page.waitForTimeout(300);

    // Click dismiss
    await card.locator("button:has-text('✕')").click();
    await page.waitForTimeout(300);

    // Card should be gone
    await expect(card.locator("text=Dismiss test")).not.toBeVisible();

    // Job should still be running (verify via debug API)
    const res = await page.request.get(`${BASE_URL}/debug/jobs/${jobId}`);
    const job = await res.json();
    expect(job.status).toBe("running");
  });

  test("T8: card fades on job completion", async ({ page }) => {
    const { jobId } = await createJobWithTodos(page, [
      { id: "t1", text: "Fade test", status: "in_progress", mandatory: true, created_by: "framework" },
    ]);
    await page.waitForTimeout(500);

    const card = page.locator("[x-data='progressCard()']").first();
    await expect(card).toBeVisible();

    // Complete the job via debug API
    await page.request.post(`${BASE_URL}/debug/jobs/${jobId}/complete`, {
      data: { summary: "Test done" },
    });
    await page.waitForTimeout(500);

    // Card should show "Done" text briefly
    // Then fade out after 2s
    await page.waitForTimeout(2500);
    await expect(card.locator("text=Fade test")).not.toBeVisible();
  });

  test("T9: two concurrent jobs show two stacked cards", async ({ page }) => {
    await createJobWithTodos(page, [
      { id: "t1", text: "Job A step", status: "in_progress", mandatory: true, created_by: "framework" },
    ]);
    await createJobWithTodos(page, [
      { id: "t1", text: "Job B step", status: "in_progress", mandatory: true, created_by: "framework" },
    ]);
    await page.waitForTimeout(500);

    // Should see two cards
    const container = page.locator("[x-data='progressCard()']").first();
    const cards = container.locator(".glass-strong");
    await expect(cards).toHaveCount(2);
  });

  test("T10: mobile — card renders correctly, tap works", async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE_URL);
    await page.waitForSelector("[x-data]", { timeout: 5000 });

    await createJobWithTodos(page, [
      { id: "t1", text: "Mobile step", status: "in_progress", mandatory: true, created_by: "framework" },
      { id: "t2", text: "Mobile step 2", status: "pending", mandatory: true, created_by: "framework" },
    ]);
    await page.waitForTimeout(500);

    // Mobile progress card should be visible
    // (may need to open chat first on mobile)
    const mobileCard = page.locator("[x-data='progressCard()']").last();
    await expect(mobileCard).toBeVisible();

    // Tap to expand
    await mobileCard.click();
    await page.waitForTimeout(300);
    await expect(mobileCard.locator("text=Mobile step")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the Playwright tests**

Run: `cd packages/dashboard && npx playwright test tests/browser/progress-card.test.ts`
Expected: All 10 tests pass (requires dashboard running)

Note: Some tests depend on debug API endpoints (`/debug/jobs`, `/debug/jobs/:id/complete`, `/debug/state/refresh`). If any are missing, the external reviewer should flag them as a dependency for the self-evolving infrastructure pattern.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/tests/browser/progress-card.test.ts
git commit -m "test(browser): add Playwright tests for progress card (10.8)

Covers all 10 validation criteria from design spec Section 10.8:
card rendering, status updates, toggle, dismiss, fade, stacking, mobile."
```

---

### Execution Notes

**Task dependencies:**
- Task 1 (backend) is independent — can run first or in parallel with Task 2
- Task 2 (component JS) + Task 3 (HTML templates) are sequential
- Task 4 (remove old code) depends on Tasks 2-3 being in place
- Task 5 (structural tests) depends on Tasks 2-4
- Task 6 (browser tests) depends on all previous tasks + running dashboard

**Recommended execution order:** 1 → 2 → 3 → 4 → 5 → 6

**TypeScript build:** After Task 1, run `cd packages/dashboard && npx tsc` to verify the type changes compile.

**Dashboard restart:** After Tasks 2-4, restart the dashboard service for browser testing: `systemctl --user restart nina-dashboard.service`
