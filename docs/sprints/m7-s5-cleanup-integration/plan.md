# M7-S5: Cleanup + Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Spaces/Automations/Jobs into the headless App layer (service namespaces, events, StatePublisher). Redesign the Home tab to a 2x2 grid with timeline. Add timeline future projection from cron. Remove the entire old task system -- files, DB tables, routes, UI, stores, imports.

**Architecture:** Three concerns, strictly ordered: (A) Backend integration -- AppSpaceService + AppAutomationService namespaces, App events, StatePublisher wiring, App.create() initialization of S1-S4 services. (B) UI -- Home tab 2x2 grid, stacked mobile cards, Alpine stores for spaces/automations/jobs, WebSocket handlers, timeline with future projection. (C) Cleanup -- delete all old task system files, remove all imports/references, drop DB tables, remove UI code.

**Tech Stack:** TypeScript, Alpine.js, Tailwind CSS (CDN), Fastify, SQLite (better-sqlite3), WebSocket, cron-parser

**Spec reference:** `docs/superpowers/specs/2026-03-22-m7-spaces-automations-jobs.md` (sections: App Integration, Dashboard UI Changes, Migration)

**Depends on:** S1 (Spaces), S2 (Tool Spaces), S3 (Automations), S4 (Triggers + Governance)

---

## File Structure

### New Files
- `packages/dashboard/src/spaces/app-space-service.ts` -- AppSpaceService namespace
- `packages/dashboard/src/automations/app-automation-service.ts` -- AppAutomationService namespace

### Modified Files
- `packages/dashboard/src/app-events.ts` -- Add space/automation/job events
- `packages/dashboard/src/app.ts` -- Add service namespaces, init S1-S4 services, remove AppTaskService
- `packages/dashboard/src/state/state-publisher.ts` -- Replace task publishing with spaces/automations/jobs
- `packages/dashboard/src/server.ts` -- Remove task decorators, add automation decorators, remove task route import
- `packages/dashboard/src/index.ts` -- Remove task service wiring
- `packages/dashboard/src/ws/protocol.ts` -- Remove TaskSnapshot, add SpaceSnapshot/AutomationSnapshot/JobSnapshot
- `packages/dashboard/public/js/stores.js` -- Remove tasks store, add spaces/automations/jobs stores
- `packages/dashboard/public/js/ws-client.js` -- Remove state:tasks handler, add state:spaces/automations/jobs
- `packages/dashboard/public/js/app.js` -- Remove all task methods/state, add spaces/automations timeline
- `packages/dashboard/public/js/mobile.js` -- Update for stacked compact cards
- `packages/dashboard/public/index.html` -- Remove task widgets/detail/create form, add 2x2 Home grid
- `packages/dashboard/src/conversations/db.ts` -- Drop tasks/task_conversations/tasks_fts/task_embedding_map tables
- `packages/dashboard/src/conversations/post-response-hooks.ts` -- Remove TaskManager dependency (uses AutomationManager from S3/S4)
- `packages/dashboard/src/scheduler/work-loop-scheduler.ts` -- Remove TaskManager dependency for debrief (use AutomationJobService)
- `packages/dashboard/src/scheduler/event-handler.ts` -- Adapt to use AutomationJobService instead of TaskManager
- `packages/dashboard/src/routes/debug.ts` -- Remove task API documentation, update with automation API docs

### Deleted Files
- `packages/dashboard/src/tasks/task-manager.ts` -- replaced by AutomationManager (S3)
- `packages/dashboard/src/tasks/task-processor.ts` -- replaced by AutomationProcessor (S3)
- `packages/dashboard/src/tasks/task-executor.ts` -- replaced by AutomationExecutor (S3)
- `packages/dashboard/src/tasks/task-scheduler.ts` -- replaced by AutomationScheduler (S3)
- `packages/dashboard/src/tasks/task-search-service.ts` -- replaced by automation search
- `packages/dashboard/src/tasks/log-storage.ts` -- replaced by AutomationJobService JSONL (S3)
- `packages/dashboard/src/tasks/working-nina-prompt.ts` -- moved to automations/ in S3
- `packages/dashboard/src/tasks/delivery-executor.ts` -- moved to automations/ in S3
- `packages/dashboard/src/tasks/index.ts` -- barrel file for deleted module
- `packages/dashboard/src/mcp/task-tools-server.ts` -- replaced by automation-server.ts (S3)
- `packages/dashboard/src/routes/tasks.ts` -- replaced by automation routes (S3)
- `packages/core/src/tasks/types.ts` -- replaced by spaces/types.ts (S1)

### Unchanged
- `packages/dashboard/src/scheduler/work-patterns.ts` -- isDue() stays, coexists with cron
- `packages/dashboard/src/agent/conversation-initiator.ts` -- reused as-is
- CalendarScheduler, WorkLoopScheduler (memory maintenance), ConversationManager

---

## Part A: Backend Integration

### Task 1: App Event Types for Spaces, Automations, Jobs

**Files:**
- Modify: `packages/dashboard/src/app-events.ts`

- [ ] **Step 1: Add new event types to AppEventMap**

The new events follow the same `[entity]` tuple pattern as existing events.

```typescript
// Add to AppEventMap in app-events.ts

import type { Space, Automation, Job } from "../spaces/types.js"; // S1 types

// Space mutations
"space:created": [space: Space];
"space:updated": [space: Space];
"space:deleted": [spaceName: string];

// Automation mutations
"automation:created": [automation: Automation];
"automation:updated": [automation: Automation];
"automation:triggered": [automation: Automation, job: Job];

// Job lifecycle
"job:started": [job: Job];
"job:completed": [job: Job];
"job:failed": [job: Job];
"job:needs_review": [job: Job];
```

- [ ] **Step 2: Remove old task event types**

Delete these lines from `AppEventMap`:

```typescript
// DELETE these:
"task:created": [task: Task];
"task:updated": [task: Task];
"task:deleted": [taskId: string];
```

Remove the `import type { Task } from "@my-agent/core"` import.

**Test:** `npx tsc --noEmit` -- should compile with S1-S4 types available.

**Commit:** `feat(m7-s5): add space/automation/job events, remove task events from AppEventMap`

---

### Task 2: AppSpaceService Namespace

**Files:**
- Create: `packages/dashboard/src/spaces/app-space-service.ts`

- [ ] **Step 1: Create AppSpaceService**

Follows the same thin-wrapper pattern as AppTaskService (delegates reads, emits events on mutations).

```typescript
// packages/dashboard/src/spaces/app-space-service.ts

import type { App } from "../app.js";
// SpaceManager from S1: filesystem CRUD + DB index
import type { SpaceManager } from "./space-manager.js";
import type { Space } from "@my-agent/core";

export class AppSpaceService {
  constructor(
    private manager: SpaceManager,
    private app: App,
  ) {}

  // Read-through
  list(filter?: Parameters<SpaceManager["list"]>[0]) {
    return this.manager.list(filter);
  }
  findByName(name: string) {
    return this.manager.findByName(name);
  }

  // Mutations -- emit events
  create(input: Parameters<SpaceManager["create"]>[0]): Space {
    const space = this.manager.create(input);
    this.app.emit("space:created", space);
    return space;
  }

  update(name: string, changes: Parameters<SpaceManager["update"]>[1]): void {
    this.manager.update(name, changes);
    const space = this.manager.findByName(name);
    if (space) this.app.emit("space:updated", space);
  }

  delete(name: string): void {
    this.manager.delete(name);
    this.app.emit("space:deleted", name);
  }
}
```

**Commit:** `feat(m7-s5): add AppSpaceService namespace`

---

### Task 3: AppAutomationService Namespace

**Files:**
- Create: `packages/dashboard/src/automations/app-automation-service.ts`

- [ ] **Step 1: Create AppAutomationService**

```typescript
// packages/dashboard/src/automations/app-automation-service.ts

import type { App } from "../app.js";
import type { AutomationManager } from "./automation-manager.js";
import type { AutomationJobService } from "./automation-job-service.js";
import type { AutomationProcessor } from "./automation-processor.js";
import type { Automation, Job } from "@my-agent/core";

export class AppAutomationService {
  constructor(
    private manager: AutomationManager,
    private jobService: AutomationJobService,
    private processor: AutomationProcessor,
    private app: App,
  ) {}

  // Read-through
  list(filter?: Parameters<AutomationManager["list"]>[0]) {
    return this.manager.list(filter);
  }
  findById(id: string) {
    return this.manager.findById(id);
  }
  listJobs(automationId: string) {
    return this.jobService.listJobs(automationId);
  }

  // Mutations -- emit events
  create(input: Parameters<AutomationManager["create"]>[0]): Automation {
    const automation = this.manager.create(input);
    this.app.emit("automation:created", automation);
    return automation;
  }

  update(id: string, changes: Parameters<AutomationManager["update"]>[1]): void {
    this.manager.update(id, changes);
    const automation = this.manager.findById(id);
    if (automation) this.app.emit("automation:updated", automation);
  }

  async fire(id: string, context?: Record<string, unknown>): Promise<Job> {
    const automation = this.manager.findById(id);
    if (!automation) throw new Error(`Automation ${id} not found`);
    const job = this.jobService.createJob(id, context);
    this.app.emit("automation:triggered", automation, job);
    // Fire-and-forget execution
    this.processor.executeAndDeliver(automation, job).catch((err) => {
      console.error(`[AppAutomationService] Job ${job.id} failed:`, err);
    });
    return job;
  }

  async resume(jobId: string, userInput: string): Promise<Job> {
    const job = await this.processor.resumeJob(jobId, userInput);
    return job;
  }
}
```

**Commit:** `feat(m7-s5): add AppAutomationService namespace`

---

### Task 4: Wire Services into App.create()

**Files:**
- Modify: `packages/dashboard/src/app.ts`

This is the largest backend task. The App class needs to:
1. Remove all TaskManager/TaskProcessor/TaskExecutor/TaskScheduler/TaskSearchService initialization
2. Add SpaceSyncService, AutomationSyncService, AutomationScheduler, WatchTriggerService, AutomationProcessor initialization
3. Replace `AppTaskService` with `AppSpaceService` + `AppAutomationService`
4. Update shutdown() to stop new services

- [ ] **Step 1: Remove old task system imports**

Delete these imports from `app.ts`:

```typescript
// DELETE:
import {
  TaskManager,
  TaskLogStorage,
  TaskExecutor,
  TaskProcessor,
  TaskScheduler,
  TaskSearchService,
} from "./tasks/index.js";
import { createTaskToolsServer } from "./mcp/task-tools-server.js";
import type { Task, CreateTaskInput } from "@my-agent/core";
```

- [ ] **Step 2: Remove AppTaskService class**

Delete the entire `AppTaskService` class (lines 91-134) and its type alias:

```typescript
// DELETE:
type TaskUpdateChanges = Parameters<TaskManager["update"]>[1];
export class AppTaskService { ... }
```

- [ ] **Step 3: Remove old task properties from App class**

Delete from the class body:

```typescript
// DELETE these properties:
tasks!: AppTaskService;
taskManager: TaskManager | null = null;
logStorage: TaskLogStorage | null = null;
taskExecutor: TaskExecutor | null = null;
taskProcessor: TaskProcessor | null = null;
taskScheduler: TaskScheduler | null = null;
taskSearchService: TaskSearchService | null = null;
```

- [ ] **Step 4: Add new service imports and properties**

```typescript
// ADD imports:
import { AppSpaceService } from "./spaces/app-space-service.js";
import { AppAutomationService } from "./automations/app-automation-service.js";
// S1-S4 services:
import { SpaceSyncService } from "./spaces/space-sync-service.js";
import { AutomationSyncService } from "./automations/automation-sync-service.js";
import { AutomationScheduler } from "./automations/automation-scheduler.js";
import { AutomationProcessor } from "./automations/automation-processor.js";
import { AutomationJobService } from "./automations/automation-job-service.js";
import { AutomationManager } from "./automations/automation-manager.js";
import { AutomationExecutor } from "./automations/automation-executor.js";
import { WatchTriggerService } from "./automations/watch-trigger-service.js";
import { SpaceManager } from "./spaces/space-manager.js";

// ADD properties to App class:
spaces!: AppSpaceService;
automations!: AppAutomationService;

spaceManager: SpaceManager | null = null;
spaceSyncService: SpaceSyncService | null = null;
automationManager: AutomationManager | null = null;
automationSyncService: AutomationSyncService | null = null;
automationScheduler: AutomationScheduler | null = null;
automationProcessor: AutomationProcessor | null = null;
automationJobService: AutomationJobService | null = null;
automationExecutor: AutomationExecutor | null = null;
watchTriggerService: WatchTriggerService | null = null;
```

- [ ] **Step 5: Replace task system init block in App.create()**

Remove the entire `// -- Task system --` block (lines ~452-504). Replace with:

```typescript
    // -- Spaces + Automations system (M7) --
    if (hatched) {
      const db = app.conversationManager.getDb();

      // SpaceManager + SpaceSyncService
      app.spaceManager = new SpaceManager(db, agentDir);
      app.spaceSyncService = new SpaceSyncService({
        agentDir,
        db,
        spaceManager: app.spaceManager,
      });
      await app.spaceSyncService.start();

      // AutomationManager + AutomationSyncService
      app.automationManager = new AutomationManager(db, agentDir);
      app.automationJobService = new AutomationJobService(agentDir);

      app.automationSyncService = new AutomationSyncService({
        agentDir,
        db,
        automationManager: app.automationManager,
      });
      await app.automationSyncService.start();

      // AutomationExecutor (extends TaskExecutor pattern)
      app.automationExecutor = new AutomationExecutor({
        automationManager: app.automationManager,
        jobService: app.automationJobService,
        spaceManager: app.spaceManager,
        agentDir,
        db: app.conversationManager.getConversationDb(),
        get mcpServers() {
          return getSharedMcpServers() ?? undefined;
        },
        hooks: createHooks("task", { agentDir }),
      });

      app.notificationService = new NotificationService();

      // AutomationProcessor (adapts TaskProcessor pattern)
      app.automationProcessor = new AutomationProcessor({
        automationManager: app.automationManager,
        executor: app.automationExecutor,
        jobService: app.automationJobService,
        conversationManager: app.conversationManager,
        connectionRegistry: connectionRegistry ?? new ConnectionRegistry(),
        transportManager: app.transportManager,
        notificationService: app.notificationService,
        get conversationInitiator() {
          return app.conversationInitiator ?? null;
        },
        onJobMutated: () => {
          // Emit job events -- handled by service namespace
        },
      });

      // AutomationScheduler (cron evaluation)
      app.automationScheduler = new AutomationScheduler({
        automationManager: app.automationManager,
        jobService: app.automationJobService,
        processor: app.automationProcessor,
        pollIntervalMs: 60_000,
      });
      app.automationScheduler.start();

      // WatchTriggerService (chokidar on external paths)
      app.watchTriggerService = new WatchTriggerService({
        automationManager: app.automationManager,
        jobService: app.automationJobService,
        processor: app.automationProcessor,
        spaceManager: app.spaceManager,
      });
      await app.watchTriggerService.start();

      // Notification events
      app.notificationService.on("notification", (event) => {
        app.emit("notification:created", event.notification);
      });

      // Post-response hooks (updated in S4 to use AutomationManager)
      app.postResponseHooks = new PostResponseHooks({
        automationManager: app.automationManager,
        log: (msg) => console.log(msg),
        logError: (err, msg) => console.error(msg, err),
      });

      // SyncService events -> cache invalidation + watchers
      app.automationSyncService.on("sync", () => {
        getPromptBuilder()?.invalidateCache();
        app.watchTriggerService?.refresh();
      });
      app.spaceSyncService.on("sync", () => {
        getPromptBuilder()?.invalidateCache();
      });

      console.log("Spaces + Automations system initialized");
    }
```

- [ ] **Step 6: Remove old TaskSearch init block**

Delete the `// -- TaskSearch (M6.9-S5) --` block (lines ~867-905).

- [ ] **Step 7: Remove old Task-tools MCP server block**

Delete the `// -- Task-tools MCP server --` block (lines ~907-922). The automation-server.ts MCP server was already registered in S3.

- [ ] **Step 8: Replace service namespace wiring**

Replace:
```typescript
if (app.taskManager) {
  app.tasks = new AppTaskService(app.taskManager, app);
}
```

With:
```typescript
if (app.spaceManager) {
  app.spaces = new AppSpaceService(app.spaceManager, app);
}
if (app.automationManager && app.automationJobService && app.automationProcessor) {
  app.automations = new AppAutomationService(
    app.automationManager,
    app.automationJobService,
    app.automationProcessor,
    app,
  );
}
```

- [ ] **Step 9: Update shutdown()**

Replace task scheduler stop with automation services:

```typescript
// DELETE:
if (this.taskScheduler) {
  this.taskScheduler.stop();
  console.log("Task scheduler stopped.");
}

// ADD:
if (this.automationScheduler) {
  this.automationScheduler.stop();
  console.log("Automation scheduler stopped.");
}
if (this.watchTriggerService) {
  await this.watchTriggerService.stop();
  console.log("Watch trigger service stopped.");
}
if (this.spaceSyncService) {
  this.spaceSyncService.stop();
}
if (this.automationSyncService) {
  this.automationSyncService.stop();
}
```

**Test:** `npx tsc --noEmit` -- verify compilation.

**Commit:** `feat(m7-s5): wire spaces/automations into App.create(), remove task system init`

---

### Task 5: StatePublisher -- Replace Tasks with Spaces/Automations/Jobs

**Files:**
- Modify: `packages/dashboard/src/state/state-publisher.ts`

- [ ] **Step 1: Remove task-related code**

Remove:
- `import type { TaskManager } from "../tasks/index.js"`
- `import type { Task } from "@my-agent/core"`
- `toTaskSnapshot()` function
- `TaskSnapshot` import from protocol
- `taskManager` from StatePublisherOptions and class properties
- `publishTasks()` method
- `_broadcastTasks()` method
- `tasksTimer` property
- Task section from `publishAllTo()`
- Task event subscriptions from `subscribeToApp()`

- [ ] **Step 2: Add spaces/automations/jobs publishing**

```typescript
import type { SpaceManager } from "../spaces/space-manager.js";
import type { AutomationManager } from "../automations/automation-manager.js";
import type { AutomationJobService } from "../automations/automation-job-service.js";
import type { SpaceSnapshot, AutomationSnapshot, JobSnapshot } from "../ws/protocol.js";

// Add to StatePublisherOptions:
spaceManager: SpaceManager | null;
automationManager: AutomationManager | null;
jobService: AutomationJobService | null;

// Add properties:
private spaceManager: SpaceManager | null;
private automationManager: AutomationManager | null;
private jobService: AutomationJobService | null;
private spacesTimer: ReturnType<typeof setTimeout> | null = null;
private automationsTimer: ReturnType<typeof setTimeout> | null = null;
private jobsTimer: ReturnType<typeof setTimeout> | null = null;
```

- [ ] **Step 3: Add publish methods**

```typescript
publishSpaces(): void {
  if (this.spacesTimer) clearTimeout(this.spacesTimer);
  this.spacesTimer = setTimeout(() => {
    this.spacesTimer = null;
    this._broadcastSpaces();
  }, DEBOUNCE_MS);
}

publishAutomations(): void {
  if (this.automationsTimer) clearTimeout(this.automationsTimer);
  this.automationsTimer = setTimeout(() => {
    this.automationsTimer = null;
    this._broadcastAutomations();
  }, DEBOUNCE_MS);
}

publishJobs(): void {
  if (this.jobsTimer) clearTimeout(this.jobsTimer);
  this.jobsTimer = setTimeout(() => {
    this.jobsTimer = null;
    this._broadcastJobs();
  }, DEBOUNCE_MS);
}
```

- [ ] **Step 4: Update subscribeToApp()**

```typescript
subscribeToApp(app: import("../app.js").App): void {
  // Replace task:* with space/automation/job events
  app.on("space:created", () => this.publishSpaces());
  app.on("space:updated", () => this.publishSpaces());
  app.on("space:deleted", () => this.publishSpaces());

  app.on("automation:created", () => this.publishAutomations());
  app.on("automation:updated", () => this.publishAutomations());
  app.on("automation:triggered", () => {
    this.publishAutomations();
    this.publishJobs();
  });

  app.on("job:started", () => this.publishJobs());
  app.on("job:completed", () => this.publishJobs());
  app.on("job:failed", () => this.publishJobs());
  app.on("job:needs_review", () => this.publishJobs());

  // Keep existing subscriptions
  app.on("conversation:created", () => this.publishConversations());
  app.on("conversation:updated", () => this.publishConversations());
  app.on("conversation:deleted", () => this.publishConversations());
  app.on("calendar:changed", () => this.publishCalendar());
  app.on("memory:changed", () => this.publishMemory());
  app.on("skills:changed", () => {
    this.registry.broadcastToAll({ type: "state:skills", timestamp: Date.now() });
  });
}
```

- [ ] **Step 5: Update publishAllTo() for initial connect**

Replace the tasks section with spaces + automations + jobs sections:

```typescript
// Spaces
if (this.spaceManager) {
  const spaces = this.spaceManager.list();
  const payload = JSON.stringify({
    type: "state:spaces",
    spaces: spaces.map(toSpaceSnapshot),
    timestamp,
  });
  if (socket.readyState === 1) socket.send(payload);
}

// Automations
if (this.automationManager) {
  const automations = this.automationManager.list();
  const payload = JSON.stringify({
    type: "state:automations",
    automations: automations.map(toAutomationSnapshot),
    timestamp,
  });
  if (socket.readyState === 1) socket.send(payload);
}

// Jobs (recent, for timeline)
if (this.jobService) {
  const jobs = this.jobService.getRecentJobs(50);
  const payload = JSON.stringify({
    type: "state:jobs",
    jobs: jobs.map(toJobSnapshot),
    timestamp,
  });
  if (socket.readyState === 1) socket.send(payload);
}
```

- [ ] **Step 6: Add broadcast helpers and snapshot converters**

```typescript
function toSpaceSnapshot(space: Space): SpaceSnapshot {
  return {
    name: space.name,
    tags: space.tags,
    runtime: space.runtime,
    entry: space.entry,
    path: space.path,
    description: space.description,
  };
}

function toAutomationSnapshot(automation: Automation): AutomationSnapshot {
  return {
    id: automation.id,
    name: automation.name,
    status: automation.status,
    triggerConfig: automation.triggerConfig,
    spaces: automation.spaces,
    model: automation.model,
    notify: automation.notify,
    once: automation.once,
    created: automation.created,
  };
}

function toJobSnapshot(job: Job): JobSnapshot {
  return {
    id: job.id,
    automationId: job.automationId,
    status: job.status,
    created: job.created,
    completed: job.completed,
    summary: job.summary,
    context: job.context,
  };
}
```

- [ ] **Step 7: Update StatePublisher constructor in app.ts**

```typescript
// In App.create(), replace:
app.statePublisher = new StatePublisher({
  connectionRegistry,
  taskManager: app.taskManager,
  conversationManager: app.conversationManager,
  getCalendarClient: () => { ... },
});

// With:
app.statePublisher = new StatePublisher({
  connectionRegistry,
  spaceManager: app.spaceManager,
  automationManager: app.automationManager,
  jobService: app.automationJobService,
  conversationManager: app.conversationManager,
  getCalendarClient: () => { ... },
});
```

**Test:** `npx tsc --noEmit` -- verify compilation. Start server, connect WS, verify `state:spaces`, `state:automations`, `state:jobs` messages arrive on connect.

**Commit:** `feat(m7-s5): StatePublisher publishes spaces/automations/jobs instead of tasks`

---

### Task 6: WebSocket Protocol Types

**Files:**
- Modify: `packages/dashboard/src/ws/protocol.ts`

- [ ] **Step 1: Remove TaskSnapshot interface**

Delete the `TaskSnapshot` interface and the `state:tasks` message type from the union.

- [ ] **Step 2: Add new snapshot interfaces**

```typescript
export interface SpaceSnapshot {
  name: string;
  tags?: string[];
  runtime?: string;
  entry?: string;
  path?: string;
  description?: string;
}

export interface AutomationSnapshot {
  id: string;
  name: string;
  status: string;
  triggerConfig: unknown[];
  spaces?: string[];
  model?: string;
  notify?: string;
  once?: boolean;
  created: string;
}

export interface JobSnapshot {
  id: string;
  automationId: string;
  status: string;
  created: string;
  completed?: string;
  summary?: string;
  context?: Record<string, unknown>;
}
```

- [ ] **Step 3: Add new state message types to the union**

```typescript
| { type: "state:spaces"; spaces: SpaceSnapshot[]; timestamp: number }
| { type: "state:automations"; automations: AutomationSnapshot[]; timestamp: number }
| { type: "state:jobs"; jobs: JobSnapshot[]; timestamp: number }
```

**Commit:** `feat(m7-s5): add spaces/automations/jobs WebSocket protocol types`

---

### Task 7: End-to-End Trigger Verification

**Files:**
- No new files -- manual verification using existing debug API

- [ ] **Step 1: Verify schedule trigger end-to-end**

Create a test automation with a 1-minute schedule via the debug API. Wait 60s. Query jobs for the automation. Verify a job with status "completed" or "running" exists.

- [ ] **Step 2: Verify manual trigger end-to-end**

Use the debug API to call `fire_automation` for the test automation. Verify a 200 response with a job ID.

- [ ] **Step 3: Verify watch trigger end-to-end**

Create an automation with a watch trigger pointing to a test directory. Touch a file in the watched directory. Verify a job is created within the debounce window.

- [ ] **Step 4: Verify channel trigger end-to-end**

Send a message matching an automation hint via the dashboard chat. Verify PostResponseHooks matches and fires the automation. Verify a job is created and completed.

- [ ] **Step 5: Clean up test automations**

**Commit:** `test(m7-s5): end-to-end verification of all 4 trigger types`

---

## Part B: UI -- Home Tab Redesign

### Task 8: Alpine Stores for Spaces, Automations, Jobs

**Files:**
- Modify: `packages/dashboard/public/js/stores.js`

- [ ] **Step 1: Remove tasks store, add new stores**

Replace the entire file:

```javascript
document.addEventListener("alpine:init", () => {
  Alpine.store("spaces", {
    items: [],
    loading: false,
  });

  Alpine.store("automations", {
    items: [],
    loading: false,
  });

  Alpine.store("jobs", {
    items: [],
    loading: false,
  });

  Alpine.store("calendar", {
    events: [],
    configs: [],
  });

  Alpine.store("conversations", {
    items: [],
    serverCurrentId: null,
  });

  Alpine.store("memory", {
    stats: null,
    loading: false,
  });

  // 'connected' | 'reconnecting' | 'offline'
  Alpine.store("connection", {
    status: "connected",
  });
});
```

**Commit:** `feat(m7-s5): replace tasks Alpine store with spaces/automations/jobs stores`

---

### Task 9: WebSocket Client -- New State Handlers

**Files:**
- Modify: `packages/dashboard/public/js/ws-client.js`

- [ ] **Step 1: Remove state:tasks handler**

Delete the `case "state:tasks":` block (lines ~44-48).

- [ ] **Step 2: Add new state handlers**

Add after the `state:calendar` handler:

```javascript
case "state:spaces":
  if (Alpine.store("spaces")) {
    Alpine.store("spaces").items = data.spaces || [];
    Alpine.store("spaces").loading = false;
  }
  break;
case "state:automations":
  if (Alpine.store("automations")) {
    Alpine.store("automations").items = data.automations || [];
    Alpine.store("automations").loading = false;
  }
  break;
case "state:jobs":
  if (Alpine.store("jobs")) {
    Alpine.store("jobs").items = data.jobs || [];
    Alpine.store("jobs").loading = false;
  }
  break;
```

**Commit:** `feat(m7-s5): WebSocket client handles state:spaces/automations/jobs`

---

### Task 10: Home Tab -- Desktop 2x2 Grid

**Files:**
- Modify: `packages/dashboard/public/index.html`

- [ ] **Step 1: Remove old task Home widget**

Find and delete the task widget section in the Home tab. This includes:
- The "New task" button (`@click="openCreateTaskForm()"`)
- The task list rendering
- The task status badges in the timeline that reference `item.itemType === 'task'`

- [ ] **Step 2: Remove Create Task Form modal**

Delete the entire create task form modal HTML.

- [ ] **Step 3: Remove Task Detail Tab**

Delete the entire `<!-- Task Detail Tab (M5-S6) -->` template block (~lines 3522-3777).

- [ ] **Step 4: Add 2x2 Home grid**

Replace the old task widget area with:

```html
<!-- Home: 2x2 Summary Grid -->
<div class="grid grid-cols-2 gap-3 mb-4">
  <!-- Spaces Card -->
  <div class="glass-strong rounded-lg p-3 cursor-pointer hover:border-white/15 transition-colors"
       @click="openSpacesBrowser()">
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs text-white/50 uppercase tracking-wider">Spaces</span>
      <span class="text-xs text-white/40"
            x-text="$store.spaces.items.length"></span>
    </div>
    <div class="text-sm text-white/80 truncate"
         x-text="$store.spaces.items.slice(0,3).map(s => s.name).join(', ') || 'No spaces'">
    </div>
  </div>

  <!-- Automations Card -->
  <div class="glass-strong rounded-lg p-3 cursor-pointer hover:border-white/15 transition-colors"
       @click="openAutomationsBrowser()">
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs text-white/50 uppercase tracking-wider">Automations</span>
      <span class="text-xs text-white/40"
            x-text="$store.automations.items.filter(a => a.status === 'active').length + ' active'"></span>
    </div>
    <div class="text-sm text-white/80 truncate"
         x-text="getAutomationSummary()">
    </div>
  </div>

  <!-- Notebook Card -->
  <div class="glass-strong rounded-lg p-3 cursor-pointer hover:border-white/15 transition-colors"
       @click="openNotebookTab()">
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs text-white/50 uppercase tracking-wider">Notebook</span>
      <span class="text-xs text-white/40"
            x-text="($store.memory.stats?.filesIndexed || 0) + ' files'"></span>
    </div>
    <div class="text-sm text-white/80">Memory &amp; Knowledge</div>
  </div>

  <!-- Conversations Card -->
  <div class="glass-strong rounded-lg p-3 cursor-pointer hover:border-white/15 transition-colors"
       @click="openConversationsBrowser()">
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs text-white/50 uppercase tracking-wider">Conversations</span>
      <span class="text-xs text-white/40"
            x-text="$store.conversations.items.length + ' recent'"></span>
    </div>
    <div class="text-sm text-white/80 truncate"
         x-text="$store.conversations.items[0]?.title || 'No conversations'">
    </div>
  </div>
</div>
```

- [ ] **Step 5: Update Timeline to show jobs instead of tasks**

Replace timeline item rendering to use job data:

```html
<!-- Timeline items now source from $store.jobs -->
<template x-for="item in getTimelineItems()" :key="item.id">
  <div class="flex items-start gap-3 py-2 px-3 rounded-lg hover:bg-white/5 cursor-pointer transition-colors"
       @click="openTimelineItem(item)">
    <!-- Status dot -->
    <div class="mt-1.5 w-2 h-2 rounded-full flex-shrink-0"
         :class="{
           'bg-green-400': item.status === 'completed',
           'bg-red-400': item.status === 'failed',
           'bg-amber-400': item.status === 'needs_review',
           'bg-blue-400 animate-pulse': item.status === 'running',
           'bg-blue-400/50': item.isFuture,
           'bg-purple-400': item.itemType === 'calendar',
         }"></div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <span class="text-xs text-white/40" x-text="item.timeLabel"></span>
        <!-- Trigger badge -->
        <span class="text-[9px] px-1 py-px rounded"
              :class="{
                'bg-blue-500/15 text-blue-400': item.triggerType === 'schedule',
                'bg-green-500/15 text-green-400': item.triggerType === 'channel',
                'bg-amber-500/15 text-amber-400': item.triggerType === 'watch',
                'bg-violet-500/15 text-violet-400': item.triggerType === 'manual',
                'bg-purple-500/15 text-purple-400': item.itemType === 'calendar',
              }"
              x-text="item.triggerType || item.itemType"
              x-show="item.triggerType || item.itemType === 'calendar'"></span>
      </div>
      <div class="text-sm text-white/80 truncate" x-text="item.title"></div>
      <div class="text-xs text-white/40 truncate" x-text="item.summary" x-show="item.summary"></div>
    </div>
  </div>
</template>
```

**Commit:** `feat(m7-s5): Home tab 2x2 grid + job-based timeline, remove task UI`

---

### Task 11: Mobile Layout -- Stacked Compact Cards

**Files:**
- Modify: `packages/dashboard/public/js/mobile.js`
- Modify: `packages/dashboard/public/index.html` (mobile section)

- [ ] **Step 1: Update mobile Home to stacked compact cards**

Replace task references in the mobile Home with stacked cards matching the spec:

```html
<!-- Mobile: Stacked compact cards -->
<div class="space-y-2 px-3 pt-3">
  <template x-for="widget in ['spaces','automations','notebook','conversations']" :key="widget">
    <div class="glass-strong rounded-lg p-3 flex items-center justify-between"
         @click="expandMobileWidget(widget)">
      <div class="flex items-center gap-2">
        <span class="text-sm text-white/80 capitalize" x-text="widget"></span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs text-white/40" x-text="getMobileWidgetCount(widget)"></span>
        <svg class="w-4 h-4 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>
      </div>
    </div>
  </template>
</div>
```

- [ ] **Step 2: Remove task popover/detail from mobile**

Delete any mobile task detail rendering (the `type === "task"` case in `openPopoverWithFocus`).

- [ ] **Step 3: Fix Space detail tab mobile layout**

The split-panel layout (256px file tree + content) doesn't work on mobile — property panel clips and text truncates. Fix:
- On viewports < 640px (`sm:` breakpoint), stack panels vertically: file tree on top (collapsible), content below
- Or use a drawer/replace pattern: tapping a file replaces the tree view with content + a back button
- Ensure I/O contract badges, maintenance pills, and DECISIONS.md preview all render without horizontal overflow
- This applies to all Space detail content added in S1 and S2

**Commit:** `feat(m7-s5): mobile Home uses stacked compact cards for spaces/automations`

---

### Task 12: app.js -- Replace Task Code with Spaces/Automations/Jobs

**Files:**
- Modify: `packages/dashboard/public/js/app.js`

- [ ] **Step 1: Remove all task-related state**

Delete from the `data()` return object:

```javascript
// DELETE:
tasks: [],
tasksLoading: false,
tasksFilter: { status: null, type: null },
showCreateTaskForm: false,
createTaskForm: { ... },
channelHelpTasks: {},
```

- [ ] **Step 2: Remove task store watcher**

Delete the `Alpine.store("tasks")` watcher block in `init()`.

- [ ] **Step 3: Remove all task methods**

Delete these methods entirely (lines ~4113-4609):
- `loadTasks()`
- `getFilteredTasks()`
- `getRunningTasks()`
- `openTaskTab(task)`
- `getCurrentTask()`
- `completeTask(taskId)`
- `deleteTask(taskId)`
- `openCreateTaskForm()`
- `closeCreateTaskForm()`
- `createTask()`
- `loadTaskConversations(taskId)`
- `loadTaskLog(taskId)`
- `setTaskFilter(key, value)`
- `clearTaskFilters()`
- `hasChannelHelpTask(channelId)`
- `createChannelHelpTask(channelId, ...)`

- [ ] **Step 4: Remove task WebSocket event handlers**

Delete the `case "task:created"` / `"task:updated"` / `"task:completed"` / `"task:deleted"` / `"task:delivery_update"` / `"state:tasks"` cases from the WebSocket message handler.

- [ ] **Step 5: Replace getTimelineItems() with job-based implementation**

```javascript
getTimelineItems() {
  const now = new Date();
  const items = [];

  // Past jobs from store
  const jobs = Alpine.store("jobs")?.items || [];
  for (const job of jobs) {
    const jobTime = new Date(job.completed || job.created);
    const automations = Alpine.store("automations")?.items || [];
    const automation = automations.find(a => a.id === job.automationId);

    // Determine trigger type from first trigger config
    const triggerType = automation?.triggerConfig?.[0]?.type || "manual";

    items.push({
      id: `job-${job.id}`,
      itemType: "job",
      title: automation?.name || job.automationId,
      summary: job.summary,
      time: jobTime,
      timeLabel: this.formatTimeLabel(jobTime),
      status: job.status,
      triggerType,
      isPast: jobTime < now,
      isFuture: false,
      job,
    });
  }

  // Future projected runs (server sends these as jobs with status "scheduled")
  // Already included in the jobs array from state:jobs

  // Calendar events (keep existing logic, remove taskId filtering)
  const events = Alpine.store("calendar")?.events || [];
  for (const event of events) {
    const eventTime = new Date(event.start);
    items.push({
      id: `cal-${event.id}`,
      itemType: "calendar",
      title: event.title,
      time: eventTime,
      timeLabel: this.formatTimeLabel(eventTime),
      isPast: eventTime < now,
      isFuture: eventTime >= now,
    });
  }

  // Sort chronologically
  items.sort((a, b) => a.time - b.time);
  return items;
},
```

- [ ] **Step 6: Add helper methods for new widgets**

```javascript
getAutomationSummary() {
  const automations = Alpine.store("automations")?.items || [];
  const active = automations.filter(a => a.status === "active");
  if (active.length === 0) return "No active automations";
  const jobs = Alpine.store("jobs")?.items || [];
  const lastJob = jobs[0];
  if (lastJob) {
    const elapsed = this.formatRelativeTime(new Date(lastJob.created));
    return `Last fired: ${elapsed}`;
  }
  return `${active.length} active`;
},

openSpacesBrowser() {
  // Open spaces browser tab (full list view)
  this.openTab({ id: "spaces-browser", type: "spaces", title: "Spaces", data: {} });
},

openAutomationsBrowser() {
  this.openTab({ id: "automations-browser", type: "automations", title: "Automations", data: {} });
},

openConversationsBrowser() {
  this.openTab({ id: "conversations-browser", type: "conversations", title: "Conversations", data: {} });
},

getMobileWidgetCount(widget) {
  switch (widget) {
    case "spaces": return Alpine.store("spaces")?.items?.length || 0;
    case "automations": {
      const items = Alpine.store("automations")?.items || [];
      return items.filter(a => a.status === "active").length + " active";
    }
    case "notebook": return (Alpine.store("memory")?.stats?.filesIndexed || 0) + " files";
    case "conversations": return (Alpine.store("conversations")?.items?.length || 0) + " recent";
    default: return "";
  }
},

expandMobileWidget(widget) {
  // Open popover with widget details on mobile
  Alpine.store("mobile")?.expandChat?.("peek");
},

openTimelineItem(item) {
  if (item.itemType === "job" && item.job) {
    // Open parent automation detail tab
    const automation = Alpine.store("automations")?.items?.find(
      a => a.id === item.job.automationId
    );
    if (automation) {
      this.openAutomationTab(automation);
    }
  } else if (item.itemType === "calendar") {
    this.openCalendarEventDetails(item);
  }
},

openAutomationTab(automation) {
  const tabId = `automation-${automation.id}`;
  const existing = this.openTabs.find(t => t.id === tabId);
  if (existing) {
    this.activeTab = tabId;
    return;
  }
  this.openTab({
    id: tabId,
    type: "automation",
    title: automation.name,
    data: { automation },
  });
},
```

**Test:** Start dashboard, verify Home tab renders 2x2 grid. Verify timeline shows jobs and calendar events.

**Commit:** `feat(m7-s5): app.js -- replace all task code with spaces/automations/jobs`

---

### Task 13: Timeline Future Projection (Server-Side)

**Files:**
- Modify: `packages/dashboard/src/state/state-publisher.ts`

- [ ] **Step 1: Add future projected runs to jobs broadcast**

When broadcasting jobs, also evaluate active automation cron expressions and include projected future runs:

```typescript
private async _broadcastJobs(): Promise<void> {
  if (!this.jobService || !this.automationManager) return;

  const recentJobs = this.jobService.getRecentJobs(50);
  const futureJobs = await this.projectFutureRuns(7); // next 7 days

  this.registry.broadcastToAll({
    type: "state:jobs",
    jobs: [
      ...recentJobs.map(toJobSnapshot),
      ...futureJobs,
    ],
    timestamp: Date.now(),
  });
}

private async projectFutureRuns(days: number): Promise<JobSnapshot[]> {
  if (!this.automationManager) return [];

  const now = new Date();
  const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const projected: JobSnapshot[] = [];

  const automations = this.automationManager.list({ status: "active" });
  for (const automation of automations) {
    const scheduleTriggers = (automation.triggerConfig || [])
      .filter((t: any) => t.type === "schedule" && t.cron);

    for (const trigger of scheduleTriggers) {
      try {
        const { parseExpression } = await import("cron-parser");
        const interval = parseExpression(trigger.cron, {
          currentDate: now,
          endDate: until,
          tz: trigger.timezone,
        });

        let count = 0;
        while (interval.hasNext() && count < 10) {
          const next = interval.next();
          projected.push({
            id: `projected-${automation.id}-${next.getTime()}`,
            automationId: automation.id,
            status: "scheduled",
            created: next.toISOString(),
            summary: `Projected: ${automation.name}`,
          });
          count++;
        }
      } catch {
        // Invalid cron -- skip
      }
    }
  }

  return projected;
}
```

The client already handles `isFuture` items with the `bg-blue-400/50` dot style from Task 10, differentiating them from past jobs.

**Test:** Create an automation with `cron: "0 9 * * *"` (daily 9am). Verify timeline shows blue-dotted future items for the next 7 days.

**Commit:** `feat(m7-s5): timeline shows projected future automation runs from cron`

---

### Task 13b: Run Directory Retention Cleanup

**Files:**
- Modify: `packages/dashboard/src/automations/automation-job-service.ts`
- Modify: `packages/dashboard/src/app.ts`

Job run directories at `.my_agent/automations/.runs/{name}/{job-id}/` accumulate over time. Default retention: 7 days. Jobs with `status: needs_review` retain their run directory until resolved. `once: true` automations retain indefinitely.

- [ ] **Step 1: Add `pruneExpiredRunDirs()` to AutomationJobService**

```typescript
async pruneExpiredRunDirs(retentionDays = 7): Promise<number> {
  const runsDir = path.join(this.automationsDir, '.runs');
  if (!fs.existsSync(runsDir)) return 0;

  let pruned = 0;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  for (const automationDir of fs.readdirSync(runsDir)) {
    const automationRunsPath = path.join(runsDir, automationDir);
    for (const jobDir of fs.readdirSync(automationRunsPath)) {
      const jobRunPath = path.join(automationRunsPath, jobDir);
      const stat = fs.statSync(jobRunPath);
      if (stat.mtimeMs > cutoff) continue;

      // Check if job is needs_review — don't prune
      const job = this.findJobById(jobDir);
      if (job?.status === 'needs_review') continue;

      // Check if parent automation is once:true — don't prune
      const automation = this.manager.findById(automationDir);
      if (automation?.once) continue;

      fs.rmSync(jobRunPath, { recursive: true });
      pruned++;
    }
  }
  return pruned;
}
```

- [ ] **Step 2: Run on app startup and daily**

Wire into `App.create()` after AutomationJobService init:

```typescript
// Prune expired run directories on startup
await automationJobService.pruneExpiredRunDirs();

// Schedule daily cleanup (piggyback on WorkLoopScheduler's 60s poll — check once per day)
```

Or add to the AutomationScheduler's poll loop as a daily side-task.

- [ ] **Step 3: Test**

Create a run directory with mtime > 7 days ago. Verify it gets pruned. Create one with `needs_review` status. Verify it's kept.

**Commit:** `feat(m7-s5): run directory retention cleanup (7-day default)`

---

## Part C: Cleanup -- Full Removal of Old Task System

### Task 14: Delete Task Module Files

**Files to delete:**
- `packages/dashboard/src/tasks/task-manager.ts`
- `packages/dashboard/src/tasks/task-processor.ts`
- `packages/dashboard/src/tasks/task-executor.ts`
- `packages/dashboard/src/tasks/task-scheduler.ts`
- `packages/dashboard/src/tasks/task-search-service.ts`
- `packages/dashboard/src/tasks/log-storage.ts`
- `packages/dashboard/src/tasks/index.ts`
- `packages/dashboard/src/mcp/task-tools-server.ts`
- `packages/dashboard/src/routes/tasks.ts`
- `packages/core/src/tasks/types.ts`

- [ ] **Step 1: Delete all files listed above**

Note: `task-extractor.ts` was renamed to `automation-extractor.ts` in S4 and moved to `automations/`. `delivery-executor.ts` and `working-nina-prompt.ts` are shared utilities used by AutomationExecutor — move them to `packages/dashboard/src/automations/` and update imports. Do NOT delete them.

- [ ] **Step 2: Remove tasks/ directory if empty**

If `task-extractor.ts` was moved in S4, the directory should be empty and can be removed.

**Commit:** `chore(m7-s5): delete old task system files`

---

### Task 15: Remove All Task Imports and References

**Files:**
- Modify: `packages/dashboard/src/server.ts`
- Modify: `packages/dashboard/src/index.ts`
- Modify: `packages/dashboard/src/conversations/post-response-hooks.ts`
- Modify: `packages/dashboard/src/scheduler/work-loop-scheduler.ts`
- Modify: `packages/dashboard/src/scheduler/event-handler.ts`
- Modify: `packages/dashboard/src/routes/debug.ts`
- Modify: `packages/core/src/lib.ts`

- [ ] **Step 1: Clean up server.ts**

Remove:
- `import { registerTaskRoutes } from "./routes/tasks.js"`
- `import type { TaskManager, TaskLogStorage, TaskProcessor, TaskScheduler } from "./tasks/index.js"`
- `taskManager`, `logStorage`, `taskProcessor`, `taskScheduler` from the `FastifyInstance` declaration
- `fastify.decorate("taskManager", null)`, `fastify.decorate("logStorage", null)`, etc.
- `await registerTaskRoutes(fastify)` route registration

Add automation decorators if not already present from S3.

- [ ] **Step 2: Clean up index.ts**

Remove:
- `server.taskManager = app.taskManager`
- `server.taskProcessor = app.taskProcessor`
- `server.taskScheduler = app.taskScheduler`
- `server.taskSearchService = app.taskSearchService`

Replace with automation service wiring.

- [ ] **Step 3: Clean up post-response-hooks.ts**

This file was already updated in S4 to use AutomationManager. Verify no TaskManager references remain. The `import type { TaskManager }` and `PostResponseHooksDeps.taskManager` should be gone, replaced with AutomationManager.

- [ ] **Step 4: Clean up work-loop-scheduler.ts**

Replace TaskManager dependency with AutomationJobService for debrief:

Remove:
- `import type { TaskManager } from "../tasks/task-manager.js"`
- `taskManager?: TaskManager | null` from config
- `this.taskManager` usage

Add:
- `import type { AutomationJobService } from "../automations/automation-job-service.js"`
- `jobService?: AutomationJobService | null` to config

Update debrief logic (~line 735):
- Replace `this.taskManager.getCompletedForDebrief(lastRun)` with `this.jobService?.getCompletedJobsForDebrief(lastRun) || []`

- [ ] **Step 5: Clean up event-handler.ts**

The calendar event handler creates tasks from CalDAV events. Update to create automation jobs instead:

Remove:
- `import { TaskManager, TaskLogStorage, TaskExecutor } from "../tasks/index.js"`
- `import type { CreateTaskInput } from "../tasks/index.js"`

Add:
- `import type { AutomationManager } from "../automations/automation-manager.js"`
- `import type { AutomationJobService } from "../automations/automation-job-service.js"`
- `import type { AutomationProcessor } from "../automations/automation-processor.js"`

Update `createEventHandler()` config and implementation to use `automationJobService.createJob()` instead of `taskManager.create()` / `taskManager.findOrCreateForOccurrence()`.

- [ ] **Step 6: Clean up debug.ts**

Remove the tasks API documentation section (~lines 360-514). Remove the `/task-tools/create_task` and `/task-tools/search_tasks` debug endpoints (~lines 932-1050). Replace with automation API documentation.

- [ ] **Step 7: Clean up core lib.ts exports**

Remove:
- `export { createTaskServer } from './mcp/index.js'`
- `export type { ScheduledTaskContext } from './prompt.js'`

Verify `Task`, `TaskStatus`, `TaskType`, `CreateTaskInput`, etc. are no longer exported from core. If `prompt.ts` still references `ScheduledTaskContext`, update it to use the new types.

- [ ] **Step 8: Clean up test files**

Delete or update:
- `packages/dashboard/src/tests/e2e-immediate-task.ts`
- `packages/dashboard/src/tests/e2e-scheduled-task.ts`

Update:
- `packages/dashboard/src/tests/run-e2e.ts` -- remove task test imports (`testImmediateTask`, `testScheduledTask`)

- [ ] **Step 9: Verify no remaining task references**

Run a comprehensive search across both packages. Expected: no results.

```
grep -rn "TaskManager\|TaskProcessor\|TaskExecutor\|TaskScheduler\|task-manager\|task-processor\|task-executor\|task-tools-server\|AppTaskService\|createTaskToolsServer\|registerTaskRoutes" packages/dashboard/src/ packages/core/src/ --include="*.ts"
```

**Test:** `npx tsc --noEmit` -- must compile clean.

**Commit:** `chore(m7-s5): remove all task imports and references across codebase`

---

### Task 16: Drop Task Database Tables

**Files:**
- Modify: `packages/dashboard/src/conversations/db.ts`

- [ ] **Step 1: Remove task table creation from initialize()**

Delete these table creation blocks from `initialize()`:

```sql
-- tasks table (~line 178)
CREATE TABLE IF NOT EXISTS tasks (...)

-- task_conversations junction table (~line 269)
CREATE TABLE IF NOT EXISTS task_conversations (...)

-- task_conversations indexes (~lines 279-286)
CREATE INDEX IF NOT EXISTS idx_task_conversations_task ON task_conversations(task_id)
CREATE INDEX IF NOT EXISTS idx_task_conversations_conv ON task_conversations(conversation_id)

-- tasks_fts virtual table (~line 291)
CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(...)

-- task_embedding_map table (~line 299)
CREATE TABLE IF NOT EXISTS task_embedding_map (...)
```

- [ ] **Step 2: Add migration to drop existing tables**

Add after the remaining table creation section:

```typescript
// M7-S5: Drop legacy task tables
this.db.exec(`
  DROP TABLE IF EXISTS task_embedding_map;
  DROP TABLE IF EXISTS tasks_fts;
  DROP TABLE IF EXISTS task_conversations;
  DROP TABLE IF EXISTS tasks;
`);
```

- [ ] **Step 3: Remove task-related methods from ConversationDatabase**

Search for and delete any methods that reference task tables:
- `getTaskSdkSessionId(taskId)`
- `updateTaskSdkSessionId(taskId, sessionId)`
- Any other methods operating on `tasks` or `task_conversations` tables

**Test:** Start the server. Verify no SQLite errors. Run `SELECT name FROM sqlite_master WHERE type='table'` on agent.db and confirm tasks, task_conversations, tasks_fts, task_embedding_map are absent.

**Commit:** `chore(m7-s5): drop legacy task DB tables from agent.db`

---

### Task 17: Remove Old Task Directories from .my_agent

**This is a runtime cleanup, not a code change.**

- [ ] **Step 1: Document the directories to be removed**

The spec says to delete:
- `.my_agent/tasks/` -- old task workspace directory
- `.my_agent/inbox/` -- old inbox (replaced by `once: true` automations)
- `.my_agent/projects/` -- old projects (replaced by spaces with external paths)
- `.my_agent/ongoing/` -- old ongoing (replaced by automations with schedule/watch triggers)

These are private directories (gitignored). They should be cleaned up at runtime, not in the repo.

- [ ] **Step 2: Add startup cleanup to App.create()**

```typescript
// M7-S5: Clean up legacy task directories
if (hatched) {
  const legacyDirs = ["tasks", "inbox", "projects", "ongoing"];
  for (const dir of legacyDirs) {
    const dirPath = join(agentDir, dir);
    if (fs.existsSync(dirPath)) {
      console.log(`[M7-S5] Legacy directory found: ${dir}/ -- preserved for manual review`);
      // Note: Not auto-deleting. CTO reviews and removes manually.
    }
  }
}
```

**Commit:** `chore(m7-s5): log legacy task directories for manual cleanup`

---

### Task 18: Final Verification

- [ ] **Step 1: TypeScript compilation**

```
cd packages/dashboard && npx tsc --noEmit
cd packages/core && npx tsc --noEmit
```

Expected: clean compilation, no errors.

- [ ] **Step 2: Grep for orphaned references**

Backend search:
```
grep -rn "task-manager\|task-processor\|task-executor\|task-scheduler\|task-tools-server\|task-search-service\|log-storage\|TaskManager\|TaskProcessor\|TaskExecutor\|TaskScheduler\|TaskSearchService\|TaskLogStorage\|AppTaskService\|createTaskToolsServer\|registerTaskRoutes" packages/dashboard/src/ packages/core/src/ --include="*.ts"
```

Frontend search:
```
grep -rn "loadTasks\|openTaskTab\|getCurrentTask\|completeTask\|deleteTask\|createTask\|tasksFilter\|channelHelpTask\|state:tasks\|task-detail\|showCreateTaskForm" packages/dashboard/public/ --include="*.js" --include="*.html"
```

Expected: no results for either search.

- [ ] **Step 3: Start server and verify**

Start with `cd packages/dashboard && npm run dev`. Verify:
1. Server starts without errors
2. Dashboard loads, Home tab shows 2x2 grid
3. Timeline shows jobs and calendar events
4. WebSocket receives state:spaces, state:automations, state:jobs
5. No "task" references in console output (except legacy log messages)

- [ ] **Step 4: Restart dashboard service**

```
systemctl --user restart nina-dashboard.service
```

**Commit:** `test(m7-s5): final verification -- clean compile, no orphaned references`

---

## Summary

| Part | Tasks | Concern |
|------|-------|---------|
| **A: Backend** | 1-7 | App events, service namespaces, StatePublisher, E2E verification |
| **B: UI** | 8-13 | Alpine stores, WS handlers, 2x2 Home grid, timeline, future projection |
| **C: Cleanup** | 14-18 | Delete files, remove imports, drop tables, final verification |

**Execution order:** A1-A6 (types + namespaces + App wiring + StatePublisher) -> B8-B12 (stores + UI) -> A7 (E2E verify) -> C14-C16 (delete + cleanup + DB) -> B13 (future projection) -> C17-C18 (runtime cleanup + final verify)

**Files deleted:** 12 TypeScript files + 4 DB tables + references in ~15 modified files

**Files created:** 2 (AppSpaceService, AppAutomationService)
