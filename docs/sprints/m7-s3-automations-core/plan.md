# M7-S3: Automations Core -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the full automations pipeline: automation manifests on disk, JSONL job lifecycle, executor + processor (extending existing Task system patterns), cron-based scheduler, MCP tools for brain interaction, per-automation concurrency, and automation hints in the brain system prompt. Plus the UI: automations home widget, browser tab, detail tab, timeline redesign, and chat tag injection.

**Architecture:** Automations are standing instructions stored as markdown files in `.my_agent/automations/`. `AutomationSyncService` (from S1's `FileWatcher`) watches these files and indexes them into the `automations` table in agent.db. When triggered (by cron schedule, manual fire, or channel match), `AutomationJobService` creates a job entry in a per-automation JSONL file and an ephemeral run directory. `AutomationExecutor` extends the `TaskExecutor` pattern (SDK session, prompt assembly, deliverables). `AutomationProcessor` adapts `TaskProcessor` (delivery, notification). `AutomationScheduler` polls every 60s, evaluates cron expressions. MCP tools (`automation-server.ts`) let the brain create/fire/list/resume automations. A dynamic block in the brain's system prompt gives automation awareness.

**Tech Stack:** TypeScript, Claude Agent SDK, cron-parser (npm), better-sqlite3, JSONL, Alpine.js + Tailwind CSS (CDN), Fastify WebSocket

**Spec reference:** `docs/superpowers/specs/2026-03-22-m7-spaces-automations-jobs.md` -- sections: Automations, Jobs, Execution Pipeline, Brain Integration, Dashboard UI Changes (S3 scope)

**Baseline:** All existing tests must pass at every commit.

**Depends on S1 + S2 providing:**
- `FileWatcher` utility in `packages/core/src/sync/file-watcher.ts`
- `SpaceSyncService` in `packages/dashboard/src/spaces/space-sync-service.ts`
- Space types in `packages/core/src/spaces/types.ts` (Space interface)
- `spaces` table in agent.db (via `db.ts` migration)
- `list_spaces`, `create_space` MCP tools working
- SPACE.md manifest format with I/O contracts, maintenance rules

---

## File Structure

### New Files
- `packages/core/src/spaces/automation-types.ts` -- Automation, Job, AutomationManifest, TriggerConfig interfaces
- `packages/dashboard/src/automations/automation-sync-service.ts` -- watches `.my_agent/automations/*.md`, syncs to agent.db
- `packages/dashboard/src/automations/automation-job-service.ts` -- JSONL lifecycle (create, update, query jobs)
- `packages/dashboard/src/automations/automation-executor.ts` -- extends TaskExecutor pattern
- `packages/dashboard/src/automations/automation-processor.ts` -- adapts TaskProcessor pattern
- `packages/dashboard/src/automations/automation-scheduler.ts` -- cron-parser evaluation, polls every 60s
- `packages/dashboard/src/automations/automation-manager.ts` -- manifest CRUD (filesystem + DB)
- `packages/dashboard/src/automations/index.ts` -- barrel exports
- `packages/dashboard/src/mcp/automation-server.ts` -- MCP tools: create_automation, fire_automation, list_automations, resume_job
- `packages/dashboard/tests/unit/automations/automation-types.test.ts`
- `packages/dashboard/tests/unit/automations/automation-job-service.test.ts`
- `packages/dashboard/tests/unit/automations/automation-sync-service.test.ts`
- `packages/dashboard/tests/unit/automations/automation-executor.test.ts`
- `packages/dashboard/tests/unit/automations/automation-processor.test.ts`
- `packages/dashboard/tests/unit/automations/automation-scheduler.test.ts`
- `packages/dashboard/tests/unit/automations/automation-manager.test.ts`
- `packages/dashboard/tests/unit/mcp/automation-server.test.ts`

### Modified Files
- `packages/core/src/spaces/index.ts` -- re-export automation types
- `packages/core/src/index.ts` -- re-export automation types
- `packages/dashboard/src/conversations/db.ts` -- add `automations` + `jobs` tables (migration)
- `packages/dashboard/src/app.ts` -- add AutomationSyncService, AutomationScheduler, AutomationProcessor init; add `app.automations` service namespace
- `packages/dashboard/src/app-events.ts` -- add automation + job events
- `packages/core/src/prompt.ts` -- add automation hints dynamic block in `assembleSystemPrompt()`
- `packages/dashboard/src/agent/system-prompt-builder.ts` -- cache invalidation on automation sync, chat tag injection
- `packages/dashboard/src/agent/session-manager.ts` -- register automation-server MCP
- `packages/dashboard/src/state/state-publisher.ts` -- subscribe to automation/job events, broadcast state:automations + state:jobs
- `packages/dashboard/public/index.html` -- automations home widget, browser tab, detail tab, timeline redesign
- `packages/dashboard/public/js/app.js` -- Alpine automations store, timeline store
- `packages/dashboard/public/js/stores.js` -- automations + jobs stores
- `packages/dashboard/public/js/ws-client.js` -- handle state:automations, state:jobs messages

### Unchanged
- `packages/dashboard/src/tasks/` -- entire task system preserved, coexists
- `packages/dashboard/src/scheduler/work-loop-scheduler.ts` -- memory maintenance, NOT modified
- `packages/dashboard/src/scheduler/work-patterns.ts` -- `isDue()` reused via import, NOT modified
- `packages/dashboard/src/mcp/task-tools-server.ts` -- preserved alongside automation-server

---

## Task 1: Automation + Job Type Definitions

**Files:**
- Create: `packages/core/src/spaces/automation-types.ts`
- Modify: `packages/core/src/spaces/index.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/dashboard/tests/unit/automations/automation-types.test.ts`

- [ ] **Step 1: Define core interfaces**

```typescript
// packages/core/src/spaces/automation-types.ts

export interface TriggerConfig {
  type: "schedule" | "channel" | "watch" | "manual";
  /** Cron expression for schedule triggers */
  cron?: string;
  /** Hint keywords for channel triggers */
  hint?: string;
  /** Watch path (resolved from space or absolute) */
  path?: string;
  /** Space name for watch triggers */
  space?: string;
  /** File events to watch (default: ["add"]) */
  events?: string[];
  /** Use polling for NAS/SMB (default: false) */
  polling?: boolean;
  /** Polling interval in ms (default: 5000) */
  interval?: number;
}

export interface AutomationDeliveryAction {
  channel: "whatsapp" | "email" | "dashboard";
  content?: string;
  status?: "pending" | "completed" | "failed";
}

export interface AutomationManifest {
  name: string;
  status: "active" | "disabled";
  trigger: TriggerConfig[];
  spaces?: string[];
  model?: string;
  notify?: "immediate" | "debrief" | "none";
  persist_session?: boolean;
  autonomy?: "full" | "cautious" | "review";
  once?: boolean;
  delivery?: AutomationDeliveryAction[];
  created: string;
}

export interface Automation {
  /** ID derived from filename (without .md) */
  id: string;
  /** Parsed manifest */
  manifest: AutomationManifest;
  /** Absolute path to the .md file */
  filePath: string;
  /** Markdown body (instructions) */
  instructions: string;
  /** When last indexed */
  indexedAt: string;
}

export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "needs_review";

export interface Job {
  id: string;
  automationId: string;
  status: JobStatus;
  created: string;
  completed?: string;
  summary?: string;
  context?: Record<string, unknown>;
  sdk_session_id?: string;
  run_dir?: string;
}
```

- [ ] **Step 2: Re-export from barrel files**

Add to `packages/core/src/spaces/index.ts`:
```typescript
export * from './automation-types.js'
```

Add to `packages/core/src/index.ts`:
```typescript
export type {
  Automation, AutomationManifest, TriggerConfig,
  Job, JobStatus, AutomationDeliveryAction,
} from './spaces/index.js'
```

- [ ] **Step 3: Write type validation tests**

Test that the type interfaces compile correctly. Verify `TriggerConfig` discriminated union works. Verify `JobStatus` literal union. Use `satisfies` checks.

**Test command:** `cd packages/dashboard && npx vitest run tests/unit/automations/automation-types.test.ts`
**Expected:** All assertions pass.

**Commit:** `feat(m7-s3): add Automation and Job type definitions`

---

## Task 2: agent.db Schema -- Automations + Jobs Tables

**Files:**
- Modify: `packages/dashboard/src/conversations/db.ts`
- Create: `packages/dashboard/tests/unit/automations/db-schema.test.ts`

- [ ] **Step 1: Add automations table migration**

In `ConversationDatabase.initialize()`, after the existing task tables, add:

```typescript
// M7-S3: Automations table (derived from automation .md files)
this.db.exec(`
  CREATE TABLE IF NOT EXISTS automations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    trigger_config TEXT NOT NULL,
    spaces TEXT,
    model TEXT,
    notify TEXT DEFAULT 'debrief',
    persist_session INTEGER DEFAULT 0,
    autonomy TEXT DEFAULT 'full',
    once INTEGER DEFAULT 0,
    delivery TEXT,
    created TEXT NOT NULL,
    indexed_at TEXT NOT NULL
  );
`);

this.db.exec(`
  CREATE INDEX IF NOT EXISTS idx_automations_status
  ON automations(status);
`);
```

- [ ] **Step 2: Add jobs table migration**

```typescript
// M7-S3: Jobs table (derived from JSONL files, for timeline queries)
this.db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL,
    status TEXT NOT NULL,
    created TEXT NOT NULL,
    completed TEXT,
    summary TEXT,
    context TEXT,
    sdk_session_id TEXT,
    run_dir TEXT,
    FOREIGN KEY (automation_id) REFERENCES automations(id)
  );
`);

this.db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_automation ON jobs(automation_id);`);
this.db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created);`);
this.db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);`);
```

- [ ] **Step 3: Add CRUD helpers to ConversationDatabase**

```typescript
// Automation CRUD
upsertAutomation(automation: {
  id: string; name: string; status: string;
  triggerConfig: string; spaces?: string;
  model?: string; notify?: string;
  persistSession?: boolean; autonomy?: string;
  once?: boolean; delivery?: string;
  created: string; indexedAt: string;
}): void

deleteAutomation(id: string): void

listAutomations(filter?: { status?: string }): Array<{...}>

getAutomation(id: string): {...} | null

// Job CRUD
upsertJob(job: {
  id: string; automationId: string; status: string;
  created: string; completed?: string;
  summary?: string; context?: string;
  sdkSessionId?: string; runDir?: string;
}): void

listJobs(filter?: {
  automationId?: string; status?: string;
  since?: string; limit?: number;
}): Array<{...}>

getJob(id: string): {...} | null
```

- [ ] **Step 4: Write schema tests**

Test: table creation on fresh DB, upsertAutomation, listAutomations with status filter, upsertJob, listJobs with automation filter, foreign key enforced, index existence.

**Test command:** `cd packages/dashboard && npx vitest run tests/unit/automations/db-schema.test.ts`
**Expected:** All CRUD operations work. FK from jobs to automations enforced.

**Commit:** `feat(m7-s3): add automations + jobs tables to agent.db`

---

## Task 3: AutomationJobService -- JSONL Lifecycle

**Files:**
- Create: `packages/dashboard/src/automations/automation-job-service.ts`
- Create: `packages/dashboard/tests/unit/automations/automation-job-service.test.ts`

- [ ] **Step 1: Implement job JSONL read/write**

```typescript
export class AutomationJobService {
  constructor(
    private automationsDir: string,
    private db: ConversationDatabase,
  ) {}

  /** Create a new job. Appends to {automationId}.jsonl, inserts into agent.db, creates run dir. */
  createJob(automationId: string, context?: Record<string, unknown>): Job

  /** Update job status + fields. Reads JSONL, replaces matching line, writes back, updates agent.db. */
  updateJob(jobId: string, updates: Partial<Pick<Job, "status" | "completed" | "summary" | "sdk_session_id">>): Job

  /** Query jobs from agent.db (fast). */
  listJobs(filter?: { automationId?: string; status?: string; since?: string; limit?: number }): Job[]

  /** Get single job by ID. */
  getJob(jobId: string): Job | null

  /** Get the JSONL file path for an automation. */
  getJsonlPath(automationId: string): string

  /** Create ephemeral run directory: .my_agent/automations/.runs/{automationId}/{jobId}/ */
  private createRunDir(automationId: string, jobId: string): string

  /** Re-index all JSONL files into agent.db (for rebuild from disk). */
  async reindexAll(): Promise<number>
}
```

Job IDs use format `job-{randomUUID()}`.

- [ ] **Step 2: JSONL format**

Each line is a complete JSON object (not a diff). The JSONL file is the source of truth. agent.db `jobs` table is derived.

```jsonl
{"id":"job-01ABC","automationId":"file-invoices","created":"2026-03-22T14:30:00Z","status":"completed","completed":"2026-03-22T14:30:05Z","summary":"Filed Uber receipt to Q1-2026/","context":{"trigger":"channel"}}
```

- [ ] **Step 3: Run directory lifecycle**

`createRunDir()` creates `.my_agent/automations/.runs/{automationId}/{jobId}/` with a `CLAUDE.md` containing:
```markdown
# Automation Run: {automation name}
Job ID: {jobId}
Automation: {automationId}
Started: {timestamp}

Use this directory for scratch files. Write status-report.md when complete.
```

- [ ] **Step 4: Write tests**

Test: createJob appends to JSONL + inserts into DB, updateJob modifies both, listJobs filters work, run dir created with CLAUDE.md, reindexAll rebuilds from disk.

**Test command:** `cd packages/dashboard && npx vitest run tests/unit/automations/automation-job-service.test.ts`
**Expected:** All JSONL + DB operations verified.

**Commit:** `feat(m7-s3): implement AutomationJobService with JSONL lifecycle`

---

## Task 4: AutomationManager -- Manifest CRUD

**Files:**
- Create: `packages/dashboard/src/automations/automation-manager.ts`
- Create: `packages/dashboard/tests/unit/automations/automation-manager.test.ts`

- [ ] **Step 1: Implement manifest filesystem operations**

```typescript
import { readFrontmatter, writeFrontmatter } from "../metadata/frontmatter.js";

export class AutomationManager {
  constructor(
    private automationsDir: string,
    private db: ConversationDatabase,
  ) {}

  /** Create a new automation manifest file + index into agent.db. */
  create(input: {
    name: string;
    instructions: string;
    manifest: Partial<AutomationManifest>;
  }): Automation

  /** Read an automation from disk (parse frontmatter + body). */
  read(id: string): Automation | null

  /** Update an automation manifest (merge frontmatter fields). */
  update(id: string, changes: Partial<AutomationManifest>): Automation

  /** Disable an automation (set status: disabled). */
  disable(id: string): void

  /** List automations from agent.db. */
  list(filter?: { status?: string }): Automation[]

  /** Get by ID from agent.db. */
  findById(id: string): Automation | null

  /** Scan disk and sync all automation files to agent.db. */
  async syncAll(): Promise<number>
}
```

- [ ] **Step 2: Filename convention**

Automation ID = filename without `.md` extension, kebab-cased. `"File Invoices"` becomes `file-invoices.md` and ID `file-invoices`.

```typescript
function nameToId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
```

- [ ] **Step 3: Write tests**

Test: create writes .md with correct frontmatter, read parses back, update merges fields, disable sets status, list filters by status, syncAll indexes all files, nameToId kebab conversion.

**Test command:** `cd packages/dashboard && npx vitest run tests/unit/automations/automation-manager.test.ts`
**Expected:** Filesystem + DB round-trip verified.

**Commit:** `feat(m7-s3): implement AutomationManager for manifest CRUD`

---

## Task 5: AutomationSyncService -- File Watcher

**Files:**
- Create: `packages/dashboard/src/automations/automation-sync-service.ts`
- Create: `packages/dashboard/tests/unit/automations/automation-sync-service.test.ts`

- [ ] **Step 1: Implement sync service using FileWatcher**

```typescript
import { FileWatcher } from "@my-agent/core";
import { EventEmitter } from "node:events";

export class AutomationSyncService extends EventEmitter {
  private fileWatcher: FileWatcher;
  private manager: AutomationManager;

  constructor(config: {
    automationsDir: string;
    manager: AutomationManager;
  }) {
    super();
    this.manager = config.manager;
    this.fileWatcher = new FileWatcher({
      watchDir: config.automationsDir,
      pattern: "*.md",
      debounceMs: 1500,
      usePolling: false,
    });
  }

  async start(): Promise<void> {
    // Full sync on startup
    const count = await this.manager.syncAll();
    console.log(`[AutomationSync] Indexed ${count} automation(s) on startup`);

    // Watch for changes
    this.fileWatcher.on("changed", async (filePath) => {
      const id = path.basename(filePath, ".md");
      const automation = this.manager.read(id);
      if (automation) {
        this.emit("automation:updated", automation);
      }
    });

    this.fileWatcher.on("removed", (filePath) => {
      const id = path.basename(filePath, ".md");
      this.manager.disable(id);
      this.emit("automation:removed", id);
    });

    await this.fileWatcher.start();
  }

  async stop(): Promise<void> {
    await this.fileWatcher.stop();
  }
}
```

- [ ] **Step 2: Emit events for downstream consumers**

Events: `automation:updated`, `automation:removed`. Consumers:
- SystemPromptBuilder.invalidateCache() -- brain sees updated automation hints
- AutomationScheduler re-reads schedules
- StatePublisher broadcasts to dashboard

- [ ] **Step 3: Write tests**

Test: startup full sync indexes files, file change triggers re-index + event, file removal triggers disable + event. Use temp directory with fixture .md files.

**Test command:** `cd packages/dashboard && npx vitest run tests/unit/automations/automation-sync-service.test.ts`
**Expected:** Sync events fire correctly.

**Commit:** `feat(m7-s3): implement AutomationSyncService with FileWatcher`

---

## Task 6: AutomationExecutor -- Core Execution

**Files:**
- Create: `packages/dashboard/src/automations/automation-executor.ts`
- Create: `packages/dashboard/tests/unit/automations/automation-executor.test.ts`

- [ ] **Step 1: Define AutomationExecutorConfig**

```typescript
export interface AutomationExecutorConfig {
  automationManager: AutomationManager;
  jobService: AutomationJobService;
  agentDir: string;
  db: ConversationDatabase;
  mcpServers?: Options["mcpServers"];
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
}
```

- [ ] **Step 2: Implement run() method**

Follow TaskExecutor.run() pattern (lines 160-277 of task-executor.ts):

```typescript
export class AutomationExecutor {
  async run(
    automation: Automation,
    job: Job,
    triggerContext?: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    // 1. Update job status to running via jobService.updateJob()
    // 2. Filter skills by WORKER_TOOLS (reuse filterSkillsByTools)
    // 3. Load prior context if persist_session
    // 4. Build system prompt: buildWorkingNinaPrompt() + automation context
    // 5. Call createBrainQuery() with:
    //    - model = automation.manifest.model ?? brainConfig.model
    //    - tools = WORKER_TOOLS
    //    - cwd = job.run_dir
    //    - resume = stored session ID (if persist_session or needs_review continuation)
    //    - hooks, mcpServers, settingSources, additionalDirectories
    // 6. Iterate brain query, collect response, capture session ID
    // 7. Extract deliverable via extractDeliverable()
    // 8. Update job JSONL (completed/failed/needs_review + summary)
    // 9. Store session ID if persist_session or needs_review
    // 10. Return ExecutionResult { success, work, deliverable, error }
  }
}
```

- [ ] **Step 3: Build automation-specific system prompt sections**

```typescript
private buildAutomationContext(
  automation: Automation,
  spaces: Space[],
  triggerContext?: Record<string, unknown>,
): string {
  const sections: string[] = [];

  // Automation instructions
  sections.push(
    `## Automation: ${automation.manifest.name}\n\n${automation.instructions}`
  );

  // Space manifests + I/O contracts
  for (const space of spaces) {
    let spaceSection = `### Space: ${space.name}\n`;
    if (space.description) spaceSection += space.description + "\n";
    if (space.io) {
      spaceSection += `\nI/O Contract:\n\`\`\`json\n${JSON.stringify(space.io, null, 2)}\n\`\`\`\n`;
    }
    if (space.maintenance) {
      spaceSection += `\nMaintenance Rules:\n${JSON.stringify(space.maintenance, null, 2)}\n`;
    }
    sections.push(spaceSection);
  }

  // Trigger context
  if (triggerContext) {
    sections.push(
      `## Trigger Context\n\`\`\`json\n${JSON.stringify(triggerContext, null, 2)}\n\`\`\``
    );
  }

  // Autonomy instructions
  sections.push(
    this.getAutonomyInstructions(automation.manifest.autonomy ?? "full")
  );

  return sections.join("\n\n");
}
```

- [ ] **Step 4: Implement autonomy-level prompt instructions**

```typescript
private getAutonomyInstructions(
  level: "full" | "cautious" | "review",
): string {
  switch (level) {
    case "full":
      return [
        "## Autonomy: Full",
        "Decide everything. Execute without asking.",
        "Log decisions in your status report.",
      ].join("\n");
    case "cautious":
      return [
        "## Autonomy: Cautious",
        "Execute most actions independently.",
        "For irreversible decisions (deleting files, sending external",
        "communications, spending money), stop and mark this job as",
        "needs_review with a clear question.",
      ].join("\n");
    case "review":
      return [
        "## Autonomy: Review",
        "Produce a plan only. Do NOT execute any actions.",
        "Write your proposed plan in the deliverable.",
        "Mark this job as needs_review.",
        "A human will approve before execution proceeds.",
      ].join("\n");
  }
}
```

- [ ] **Step 5: Session resumption for persist_session and needs_review**

Reuse the TaskExecutor pattern for SDK session resumption:
- Check for stored session ID in job JSONL `sdk_session_id` field
- If found, try resume path first, fall back to fresh
- Store new session ID in job + sidecar file `.my_agent/automations/.sessions/{automationId}.json`

- [ ] **Step 6: Reuse existing infrastructure**

Import and reuse from task-executor.ts:
- `extractDeliverable()` for `<deliverable>` tag extraction
- `validateDeliverable()` for delivery validation
- Channel constraints: reproduce `getChannelConstraints()` pattern (not exported from task-executor.ts, inline locally)
- `buildWorkingNinaPrompt()` for base system prompt
- `WORKER_TOOLS` constant (define locally or export from task-executor.ts)
- `filterSkillsByTools()` / `cleanupSkillFilters()` from @my-agent/core

- [ ] **Step 7: Write tests**

Test: run() creates brain query with correct model, autonomy instructions injected, space manifests included, trigger context passed, deliverable extracted, job JSONL updated on completion, session ID stored when persist_session=true.

Use mocked `createBrainQuery` (return async iterable with canned response).

**Test command:** `cd packages/dashboard && npx vitest run tests/unit/automations/automation-executor.test.ts`
**Expected:** Full execution lifecycle verified.

**Commit:** `feat(m7-s3): implement AutomationExecutor with prompt assembly`

---

## Task 7: AutomationProcessor -- Delivery + Notification

**Files:**
- Create: `packages/dashboard/src/automations/automation-processor.ts`
- Create: `packages/dashboard/tests/unit/automations/automation-processor.test.ts`

- [ ] **Step 1: Define AutomationProcessorConfig**

```typescript
export interface AutomationProcessorConfig {
  automationManager: AutomationManager;
  executor: AutomationExecutor;
  jobService: AutomationJobService;
  conversationManager: ConversationManager;
  connectionRegistry: ConnectionRegistry;
  transportManager?: TransportManager | null;
  notificationService?: NotificationService | null;
  conversationInitiator?: {
    alert(prompt: string): Promise<boolean>;
    initiate(options?: { firstTurnPrompt?: string }): Promise<unknown>;
  } | null;
  onJobMutated?: () => void;
}
```

- [ ] **Step 2: Implement executeAndDeliver()**

Follow TaskProcessor.executeAndDeliver() pattern (lines 101-169):

```typescript
async executeAndDeliver(
  automation: Automation,
  triggerContext?: Record<string, unknown>,
): Promise<void> {
  // 1. Create job via jobService
  const job = this.jobService.createJob(automation.id, triggerContext);

  // 2. Execute via executor
  const result = await this.executor.run(automation, job, triggerContext);

  // 3. If delivery actions in manifest, execute via DeliveryExecutor
  //    Adapt Task shape to pass delivery actions from manifest
  if (automation.manifest.delivery?.length && result.deliverable) {
    // Construct a Task-like object for DeliveryExecutor compatibility
    // or extract the delivery logic directly
  }

  // 4. Notify based on manifest.notify
  await this.handleNotification(automation, job, result);

  // 5. If once: true, disable automation after success
  if (automation.manifest.once && result.success) {
    this.automationManager.disable(automation.id);
  }

  // 6. Emit App events (via onJobMutated callback)
  this.onJobMutated?.();
}
```

- [ ] **Step 3: Implement notification handling**

```typescript
private async handleNotification(
  automation: Automation,
  job: Job,
  result: ExecutionResult,
): Promise<void> {
  const notify = automation.manifest.notify ?? "debrief";
  const ci = this.getConversationInitiator();

  if (notify === "immediate" && ci) {
    const prompt = result.success
      ? `Automation "${automation.manifest.name}" completed. Job ${job.id}. Summary: ${result.work?.slice(0, 500)}.`
      : `Automation "${automation.manifest.name}" failed. Error: ${result.error}`;
    const alerted = await ci.alert(prompt);
    if (!alerted) {
      await ci.initiate({ firstTurnPrompt: `[SYSTEM: ${prompt}]` });
    }
  }

  // needs_review always alerts immediately
  if (job.status === "needs_review" && ci) {
    const prompt = `Automation "${automation.manifest.name}" needs your review. Job ${job.id}. Question: ${job.summary}. Use resume_job to respond.`;
    const alerted = await ci.alert(prompt);
    if (!alerted) {
      await ci.initiate({ firstTurnPrompt: `[SYSTEM: ${prompt}]` });
    }
  }
}
```

- [ ] **Step 4: Per-automation concurrency semaphore**

```typescript
private runningJobs = new Map<string, Promise<void>>();

async fire(
  automation: Automation,
  context?: Record<string, unknown>,
): Promise<void> {
  const existing = this.runningJobs.get(automation.id);
  if (existing) {
    console.warn(
      `[AutomationProcessor] Skipping ${automation.id} -- already running`
    );
    return;
  }

  const promise = this.executeAndDeliver(automation, context).finally(() => {
    this.runningJobs.delete(automation.id);
  });
  this.runningJobs.set(automation.id, promise);
  await promise;
}
```

- [ ] **Step 5: Write tests**

Test: fire() creates job + executes, delivery actions executed, notify=immediate triggers alert, needs_review triggers alert, concurrency semaphore prevents double-fire, once=true disables automation after.

**Test command:** `cd packages/dashboard && npx vitest run tests/unit/automations/automation-processor.test.ts`
**Expected:** Full lifecycle verified.

**Commit:** `feat(m7-s3): implement AutomationProcessor with delivery + notification`

---

## Task 8: AutomationScheduler -- Cron Evaluation

**Files:**
- Create: `packages/dashboard/src/automations/automation-scheduler.ts`
- Create: `packages/dashboard/tests/unit/automations/automation-scheduler.test.ts`

- [ ] **Step 1: Install cron-parser**

```bash
cd packages/dashboard && npm install cron-parser
```

- [ ] **Step 2: Implement scheduler**

```typescript
import { CronExpressionParser } from "cron-parser";
import { resolveTimezone } from "../utils/timezone.js";

export interface AutomationSchedulerConfig {
  db: Database.Database;
  processor: AutomationProcessor;
  automationManager: AutomationManager;
  jobService: AutomationJobService;
  agentDir: string;
  pollIntervalMs?: number;
}

export class AutomationScheduler {
  private interval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(private config: AutomationSchedulerConfig) {}

  async start(): Promise<void> {
    this.isRunning = true;
    this.interval = setInterval(
      () => this.checkDue(),
      this.config.pollIntervalMs ?? 60_000,
    );
    // Check immediately
    await this.checkDue();
    console.log(
      `[AutomationScheduler] Started, polling every ${(this.config.pollIntervalMs ?? 60_000) / 1000}s`
    );
  }

  async stop(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
    this.isRunning = false;
  }

  private async checkDue(): Promise<void> {
    if (!this.isRunning) return;

    const tz = await resolveTimezone(this.config.agentDir);
    const now = new Date();

    // Query active automations with schedule triggers
    const automations = this.config.automationManager.list({ status: "active" });

    for (const automation of automations) {
      const scheduleTriggers = automation.manifest.trigger.filter(
        (t) => t.type === "schedule"
      );
      for (const trigger of scheduleTriggers) {
        if (!trigger.cron) continue;
        if (this.isCronDue(trigger.cron, automation.id, now, tz)) {
          // Fire-and-forget: processor handles concurrency
          this.config.processor
            .fire(automation, { trigger: "schedule" })
            .catch((err) =>
              console.error(
                `[AutomationScheduler] Failed to fire ${automation.id}:`,
                err
              )
            );
        }
      }
    }
  }

  private isCronDue(
    cron: string,
    automationId: string,
    now: Date,
    tz: string,
  ): boolean {
    try {
      const interval = CronExpressionParser.parse(cron, {
        tz,
        currentDate: now,
      });
      const prev = interval.prev().toDate();
      // Check if last cron tick is after the most recent job for this automation
      const lastJob = this.config.jobService.listJobs({
        automationId,
        limit: 1,
      })[0];
      if (!lastJob) return true; // Never ran
      return prev > new Date(lastJob.created);
    } catch {
      console.warn(
        `[AutomationScheduler] Invalid cron for ${automationId}: ${cron}`
      );
      return false;
    }
  }
}
```

- [ ] **Step 3: Implement getNextRuns() for timeline projection**

```typescript
/** Project future runs for active schedule automations. */
getNextRuns(
  count: number = 10,
): Array<{ automationId: string; name: string; nextRun: Date }> {
  const automations = this.config.automationManager.list({ status: "active" });
  const runs: Array<{
    automationId: string;
    name: string;
    nextRun: Date;
  }> = [];

  for (const automation of automations) {
    for (const trigger of automation.manifest.trigger) {
      if (trigger.type !== "schedule" || !trigger.cron) continue;
      try {
        const interval = CronExpressionParser.parse(trigger.cron, {
          currentDate: new Date(),
        });
        runs.push({
          automationId: automation.id,
          name: automation.manifest.name,
          nextRun: interval.next().toDate(),
        });
      } catch {
        /* skip invalid */
      }
    }
  }

  return runs
    .sort((a, b) => a.nextRun.getTime() - b.nextRun.getTime())
    .slice(0, count);
}
```

- [ ] **Step 4: Write tests**

Test: isCronDue returns true when cron matches and no prior job, returns false when recent job exists, handles timezone, handles invalid cron gracefully, getNextRuns projects correctly, start/stop lifecycle.

**Test command:** `cd packages/dashboard && npx vitest run tests/unit/automations/automation-scheduler.test.ts`
**Expected:** Cron evaluation and scheduling verified.

**Commit:** `feat(m7-s3): implement AutomationScheduler with cron-parser`

---

## Task 9: Barrel Exports

**Files:**
- Create: `packages/dashboard/src/automations/index.ts`

- [ ] **Step 1: Create barrel file**

```typescript
// packages/dashboard/src/automations/index.ts
export { AutomationManager } from "./automation-manager.js";
export { AutomationJobService } from "./automation-job-service.js";
export { AutomationExecutor } from "./automation-executor.js";
export type { AutomationExecutorConfig } from "./automation-executor.js";
export { AutomationProcessor } from "./automation-processor.js";
export type { AutomationProcessorConfig } from "./automation-processor.js";
export { AutomationScheduler } from "./automation-scheduler.js";
export type { AutomationSchedulerConfig } from "./automation-scheduler.js";
export { AutomationSyncService } from "./automation-sync-service.js";
```

**Commit:** `chore(m7-s3): add automations barrel exports`

---

## Task 10: MCP Tools -- automation-server.ts

**Files:**
- Create: `packages/dashboard/src/mcp/automation-server.ts`
- Create: `packages/dashboard/tests/unit/mcp/automation-server.test.ts`

- [ ] **Step 1: Implement create_automation tool**

Follow `createTaskTool` pattern from task-tools-server.ts:

```typescript
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export interface AutomationServerDeps {
  automationManager: AutomationManager;
  processor: AutomationProcessor;
  jobService: AutomationJobService;
}

const createAutomationTool = tool(
  "create_automation",
  "Create a new automation (standing instruction). Use when the user wants recurring work, file watching, or a substantial one-off task. The automation manifest is saved to disk and indexed.",
  {
    name: z.string().describe("Human-readable name"),
    instructions: z.string().describe(
      "What to do when triggered -- full context, the worker cannot see this conversation"
    ),
    trigger: z.array(z.object({
      type: z.enum(["schedule", "channel", "watch", "manual"]),
      cron: z.string().optional().describe("Cron expression for schedule triggers"),
      hint: z.string().optional().describe("Comma-separated keywords for channel matching"),
      path: z.string().optional().describe("Watch path"),
      space: z.string().optional().describe("Space name for watch triggers"),
    })).describe("When to fire this automation"),
    spaces: z.array(z.string()).optional().describe("Referenced space names"),
    model: z.string().optional().describe("Model override (haiku/sonnet/opus)"),
    notify: z.enum(["immediate", "debrief", "none"]).optional(),
    autonomy: z.enum(["full", "cautious", "review"]).optional(),
    once: z.boolean().optional().describe("true = fire once and auto-disable"),
    delivery: z.array(z.object({
      channel: z.enum(["whatsapp", "email", "dashboard"]),
      content: z.string().optional(),
    })).optional(),
  },
  async (args) => {
    // Create manifest via AutomationManager, return success with ID
  }
);
```

- [ ] **Step 2: Implement fire_automation tool**

```typescript
const fireAutomationTool = tool(
  "fire_automation",
  "Trigger an automation immediately. Use when the user says 'run X now' or after creating a once:true automation.",
  {
    automationId: z.string().describe("Automation ID (filename without .md)"),
    context: z.record(z.unknown()).optional().describe("Trigger context/payload"),
  },
  async (args) => {
    // Look up automation, call processor.fire(), return job ID
  }
);
```

- [ ] **Step 3: Implement list_automations tool**

```typescript
const listAutomationsTool = tool(
  "list_automations",
  "List active automations with optional filtering. Use to discover available automations before firing or to answer 'what automations do I have?'",
  {
    status: z.enum(["active", "disabled", "all"]).optional(),
    search: z.string().optional().describe("Search term for name/instructions"),
  },
  async (args) => {
    // Query AutomationManager.list(), format results
  }
);
```

- [ ] **Step 4: Implement resume_job tool**

```typescript
const resumeJobTool = tool(
  "resume_job",
  "Resume a needs_review job with the user's response. The worker's SDK session will be restored with the user's input.",
  {
    jobId: z.string().describe("Job ID to resume"),
    userResponse: z.string().describe("The user's answer to the review question"),
  },
  async (args) => {
    // 1. Get job from jobService
    // 2. Verify status is needs_review
    // 3. Get automation from automationManager
    // 4. Resume via executor with stored SDK session ID + userResponse as prompt
    // 5. Return result
  }
);
```

- [ ] **Step 5: Create the MCP server**

```typescript
export function createAutomationServer(deps: AutomationServerDeps) {
  return createSdkMcpServer({
    name: "automation-tools",
    tools: [
      createAutomationTool,
      fireAutomationTool,
      listAutomationsTool,
      resumeJobTool,
    ],
  });
}
```

- [ ] **Step 6: Write tests**

Test each tool: create_automation creates file + returns ID, fire_automation triggers processor, list_automations returns formatted list, resume_job resumes with session. Test error cases: unknown automation, job not in needs_review state.

**Test command:** `cd packages/dashboard && npx vitest run tests/unit/mcp/automation-server.test.ts`
**Expected:** All 4 tools verified.

**Commit:** `feat(m7-s3): implement automation-server.ts MCP tools`

---

## Task 11: Automation Hints in Brain System Prompt

**Files:**
- Modify: `packages/core/src/prompt.ts`
- Modify: `packages/dashboard/src/agent/system-prompt-builder.ts`

- [ ] **Step 1: Add loadAutomationHints() to prompt.ts**

Add after the `loadDailyLogs()` function. Since prompt.ts is in core and doesn't have DB access, read directly from the automations directory using `readFrontmatter()`:

```typescript
/**
 * Load active automation hints for brain system prompt.
 * Reads from .my_agent/automations/*.md frontmatter.
 * Returns compact format: ~50 chars per automation.
 * At 50+ automations, returns pull-model instruction.
 */
export async function loadAutomationHints(
  agentDir: string,
): Promise<string | null> {
  const automationsDir = path.join(agentDir, 'automations')
  if (!existsSync(automationsDir)) return null

  let mdFiles: string[]
  try {
    const files = await readdir(automationsDir)
    mdFiles = files.filter(f => f.endsWith('.md')).sort()
  } catch {
    return null
  }

  if (mdFiles.length === 0) return null
  if (mdFiles.length > 50) {
    return '## Active Automations\n\nYou have 50+ automations. Use the list_automations tool to search and discover them.'
  }

  const lines: string[] = [
    '## Active Automations',
    '',
    'You have these standing instructions. When a user\'s message matches one, call fire_automation().',
    '',
  ]

  for (const file of mdFiles) {
    try {
      const { data } = readFrontmatter(path.join(automationsDir, file))
      if (data.status !== 'active') continue
      const name = data.name ?? file.replace('.md', '')
      const triggers = (data.trigger ?? [])
      const hints = triggers
        .filter((t: any) => t.type === 'channel' && t.hint)
        .map((t: any) => t.hint)
        .join(', ')
      const triggerTypes = [
        ...new Set(triggers.map((t: any) => t.type)),
      ].join(', ')
      const spaces = (data.spaces ?? []).join(', ')
      let line = `- ${name} (${triggerTypes}`
      if (hints) line += `, hints: ${hints}`
      line += ')'
      if (spaces) line += ` -> ${spaces}`
      lines.push(line)
    } catch {
      // Skip malformed files
    }
  }

  return lines.length > 4 ? lines.join('\n') : null
}
```

- [ ] **Step 2: Integrate into assembleSystemPrompt()**

In `assembleSystemPrompt()`, after the always-on skills loading (around line 513), add:

```typescript
// Load automation hints for brain awareness (M7-S3)
const automationHints = await loadAutomationHints(agentDir)
if (automationHints) {
  sections.push(automationHints)
}
```

- [ ] **Step 3: Wire cache invalidation in app.ts**

In `app.ts`, wire AutomationSyncService events to invalidate the prompt cache:

```typescript
automationSyncService.on("automation:updated", () => {
  getPromptBuilder()?.invalidateCache();
});
automationSyncService.on("automation:removed", () => {
  getPromptBuilder()?.invalidateCache();
});
```

This follows the existing pattern (memory sync -> cache invalidation).

- [ ] **Step 4: Write test for loadAutomationHints**

Test: returns null for empty dir, formats active automations, skips disabled, shows pull model message at 50+, skips malformed files.

**Test command:** `cd packages/core && npx vitest run tests/unit/prompt-automation-hints.test.ts`
**Expected:** Hint generation verified.

**Commit:** `feat(m7-s3): add automation hints dynamic block to brain system prompt`

---

## Task 12: App Events -- Automation + Job Types

**Files:**
- Modify: `packages/dashboard/src/app-events.ts`

- [ ] **Step 1: Add automation and job events**

Import the types and extend AppEventMap:

```typescript
import type { Automation, Job } from "@my-agent/core";

// Add to AppEventMap interface:

  // Automation mutations
  "automation:created": [automation: Automation];
  "automation:updated": [automation: Automation];
  "automation:deleted": [automationId: string];

  // Job lifecycle
  "job:created": [job: Job];
  "job:started": [job: Job];
  "job:completed": [job: Job];
  "job:failed": [job: Job];
  "job:needs_review": [job: Job];
```

**Commit:** `feat(m7-s3): add automation + job events to AppEventMap`

---

## Task 13: AppAutomationService Namespace

**Files:**
- Modify: `packages/dashboard/src/app.ts`

- [ ] **Step 1: Create AppAutomationService class**

Follow `AppTaskService` pattern (app.ts lines 91-134):

```typescript
export class AppAutomationService {
  constructor(
    private manager: AutomationManager,
    private processor: AutomationProcessor,
    private jobService: AutomationJobService,
    private app: App,
  ) {}

  // Read-through
  list(filter?: { status?: string }) {
    return this.manager.list(filter);
  }
  findById(id: string) {
    return this.manager.findById(id);
  }
  listJobs(filter?: Parameters<AutomationJobService["listJobs"]>[0]) {
    return this.jobService.listJobs(filter);
  }
  getJob(id: string) {
    return this.jobService.getJob(id);
  }

  // Mutations -- emit events
  create(input: Parameters<AutomationManager["create"]>[0]): Automation {
    const automation = this.manager.create(input);
    this.app.emit("automation:created", automation);
    return automation;
  }

  async fire(
    id: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    const automation = this.manager.findById(id);
    if (!automation) throw new Error(`Automation ${id} not found`);
    await this.processor.fire(automation, context);
  }

  async resume(jobId: string, userInput: string): Promise<void> {
    // Resume a needs_review job via executor
  }
}
```

- [ ] **Step 2: Add to App class properties**

```typescript
// Service namespace (event-emitting wrapper)
automations!: AppAutomationService;

// Internal service instances
automationManager: AutomationManager | null = null;
automationJobService: AutomationJobService | null = null;
automationExecutor: AutomationExecutor | null = null;
automationProcessor: AutomationProcessor | null = null;
automationScheduler: AutomationScheduler | null = null;
automationSyncService: AutomationSyncService | null = null;
```

**Commit:** `feat(m7-s3): add AppAutomationService namespace to App`

---

## Task 14: App.create() -- Service Initialization

**Files:**
- Modify: `packages/dashboard/src/app.ts`

- [ ] **Step 1: Initialize automation services**

Add after the task system initialization block (around line 505) and before WorkLoopScheduler (line 590):

```typescript
// -- Automation system (M7-S3) --
if (hatched) {
  const automationsDir = join(agentDir, "automations");
  const convDb = app.conversationManager.getConversationDb();

  app.automationManager = new AutomationManager(automationsDir, convDb);
  app.automationJobService = new AutomationJobService(automationsDir, convDb);

  app.automationExecutor = new AutomationExecutor({
    automationManager: app.automationManager,
    jobService: app.automationJobService,
    agentDir,
    db: convDb,
    get mcpServers() {
      return getSharedMcpServers() ?? undefined;
    },
    hooks: createHooks("task", { agentDir }),
  });

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
  });

  // Sync service -- watch automation manifests
  app.automationSyncService = new AutomationSyncService({
    automationsDir,
    manager: app.automationManager,
  });

  // Wire sync events to prompt cache invalidation + App events
  app.automationSyncService.on("automation:updated", (automation) => {
    getPromptBuilder()?.invalidateCache();
    app.emit("automation:updated", automation);
  });
  app.automationSyncService.on("automation:removed", (id) => {
    getPromptBuilder()?.invalidateCache();
    app.emit("automation:deleted", id);
  });

  await app.automationSyncService.start();

  // Scheduler -- cron-based triggers
  app.automationScheduler = new AutomationScheduler({
    db: app.conversationManager.getDb(),
    processor: app.automationProcessor,
    automationManager: app.automationManager,
    jobService: app.automationJobService,
    agentDir,
    pollIntervalMs: 60_000,
  });
  await app.automationScheduler.start();

  // Service namespace
  app.automations = new AppAutomationService(
    app.automationManager,
    app.automationProcessor,
    app.automationJobService,
    app,
  );

  console.log("Automation system initialized (sync + scheduler)");
}
```

- [ ] **Step 2: Register automation-server MCP in session-manager.ts**

In `initMcpServers()`, add the automation tools server. Use a lazy getter pattern to avoid circular initialization:

```typescript
// Add parameter to initMcpServers or use getter pattern:
if (automationDeps) {
  servers["automation-tools"] = createAutomationServer(automationDeps);
}
```

Update `initMcpServers()` to accept automation dependencies.

- [ ] **Step 3: Add shutdown logic**

Wherever graceful shutdown is handled, add:

```typescript
await app.automationScheduler?.stop();
await app.automationSyncService?.stop();
```

**Commit:** `feat(m7-s3): wire automation services into App.create()`

---

## Task 15: StatePublisher -- Automation + Job Broadcasting

**Files:**
- Modify: `packages/dashboard/src/state/state-publisher.ts`
- Modify: `packages/dashboard/src/ws/protocol.ts`

- [ ] **Step 1: Add automation/job snapshot types to protocol.ts**

```typescript
export interface AutomationSnapshot {
  id: string;
  name: string;
  status: string;
  triggerTypes: string[];
  spaces: string[];
  model?: string;
  notify?: string;
  autonomy?: string;
  once?: boolean;
  lastFiredAt?: string;
  jobCount: number;
}

export interface JobSnapshot {
  id: string;
  automationId: string;
  automationName: string;
  status: string;
  created: string;
  completed?: string;
  summary?: string;
  triggerType?: string;
}
```

- [ ] **Step 2: Add state publishing methods**

```typescript
// In StatePublisher, add automationManager + jobService as constructor deps:

publishAutomations(): void {
  // List automations, convert to snapshots, broadcast
  this.broadcastDebounced("state:automations", { automations: snapshots });
}

publishJobs(): void {
  // List recent jobs (limit 50), convert to snapshots, broadcast
  this.broadcastDebounced("state:jobs", { jobs: snapshots });
}
```

- [ ] **Step 3: Subscribe to automation/job events**

In `subscribeToApp()`:

```typescript
app.on("automation:created", () => this.publishAutomations());
app.on("automation:updated", () => this.publishAutomations());
app.on("automation:deleted", () => this.publishAutomations());
app.on("job:created", () => this.publishJobs());
app.on("job:completed", () => this.publishJobs());
app.on("job:failed", () => this.publishJobs());
app.on("job:needs_review", () => this.publishJobs());
```

- [ ] **Step 4: Include in initial state push**

When a new WebSocket client connects, include automations and jobs in the full state snapshot (alongside tasks, conversations, calendar).

**Commit:** `feat(m7-s3): add automation + job state broadcasting`

---

## Task 16: REST API Routes -- Automations + Jobs

**Files:**
- Create: `packages/dashboard/src/routes/automations.ts`
- Modify: `packages/dashboard/src/server.ts`

- [ ] **Step 1: Add automation routes**

```typescript
// GET /api/automations -- list automations
// GET /api/automations/:id -- get automation detail + recent jobs
// POST /api/automations/:id/fire -- fire an automation
// GET /api/automations/:id/jobs -- list jobs for automation
// GET /api/jobs -- list all jobs (timeline query, supports ?since= and ?limit=)
// GET /api/jobs/:id -- get job detail
// POST /api/jobs/:id/resume -- resume a needs_review job (body: { userResponse })
// GET /api/automations/next-runs -- projected future runs
```

All routes use `fastify.app.automations.*` for mutations (event emission).

- [ ] **Step 2: Register routes in server.ts**

Add after existing task routes registration.

**Commit:** `feat(m7-s3): add automation + job REST API routes`

---

## Task 17: WebSocket Client -- Automation State Handling

**Files:**
- Modify: `packages/dashboard/public/js/ws-client.js`
- Modify: `packages/dashboard/public/js/stores.js`

- [ ] **Step 1: Add automations + jobs stores**

In `stores.js`, add Alpine stores:

```javascript
Alpine.store("automations", {
  items: [],
  loading: true,
  update(automations) {
    this.items = automations;
    this.loading = false;
  },
});

Alpine.store("jobs", {
  items: [],
  loading: true,
  update(jobs) {
    this.items = jobs;
    this.loading = false;
  },
});
```

- [ ] **Step 2: Handle state:automations and state:jobs in ws-client.js**

In the WebSocket message handler switch:

```javascript
case "state:automations":
  Alpine.store("automations").update(msg.automations);
  break;
case "state:jobs":
  Alpine.store("jobs").update(msg.jobs);
  break;
```

**Commit:** `feat(m7-s3): add automations + jobs Alpine stores + WebSocket handlers`

---

## Task 18: Automations Home Widget

**Files:**
- Modify: `packages/dashboard/public/index.html`

- [ ] **Step 1: Add automations widget to the 2x2 grid**

Position: top-right in the home grid (Spaces top-left, Automations top-right, Notebook bottom-left, Conversations bottom-right).

Follow Tokyo Night design language: glass-strong panels, subtle borders, slate text hierarchy.

```html
<!-- Automations Widget -->
<div class="glass-strong rounded-xl p-4 cursor-pointer
            hover:border-violet-500/30 transition-all"
     @click="openTab('automations-browser')">
  <div class="flex items-center justify-between mb-2">
    <h3 class="text-sm font-medium text-slate-300">Automations</h3>
    <span class="text-xs text-slate-500"
          x-text="$store.automations.items.filter(a => a.status === 'active').length + ' active'">
    </span>
  </div>
  <div class="text-xs text-slate-400">
    <template x-if="$store.automations.items.length > 0">
      <span x-text="'Last fired: ' + relativeTime(
        $store.jobs.items[0]?.created
      )"></span>
    </template>
    <template x-if="$store.automations.items.length === 0">
      <span>No automations yet</span>
    </template>
  </div>
</div>
```

**Commit:** `feat(m7-s3): add automations home widget`

---

## Task 19: Automations Browser Tab

**Files:**
- Modify: `packages/dashboard/public/index.html`
- Modify: `packages/dashboard/public/js/app.js`

- [ ] **Step 1: Add automations-browser tab HTML**

Full list with search/filter. Each row shows:
- Automation name + status pill (active: green, disabled: slate)
- Trigger type icons (clock for schedule, message for channel, eye for watch, hand for manual)
- Referenced spaces as chips
- Last fired date (relative)
- Job count

Design: glass-strong cards, hover border transition, status pills following the standard color scheme (green for active, slate for disabled).

- [ ] **Step 2: Add tab registration in app.js**

Register `automations-browser` in the tab system. Add `openTab('automations-browser')` handler. Add search filter logic (filter by name substring).

**Commit:** `feat(m7-s3): add automations browser tab`

---

## Task 20: Automation Detail Tab

**Files:**
- Modify: `packages/dashboard/public/index.html`
- Modify: `packages/dashboard/public/js/app.js`

- [ ] **Step 1: Add automation-detail tab HTML with two variants**

**Recurring automation (active):**
- Header: name, status pill, "Fire now" button (violet ghost), "Disable" button
- Triggers section: cards with trigger type + config
- Configuration: space chips (clickable -> open space tab), model selector (dropdown), notify toggle pills (immediate / debrief / none), autonomy toggle pills (full / cautious / review)
- Instructions: left-bordered rule items (2px left border, accent-blue/20)
- Job history: chronological list with status dots, dates, summaries

**One-off automation (once: true, completed/disabled):**
- Header: name, "completed" status pill, "Run again" button
- Result card front and center (latest job summary, duration, model)
- Configuration below (secondary)
- Original request (instructions)

- [ ] **Step 2: Implement fireAutomation() in app.js**

```javascript
async fireAutomation(id) {
  const response = await fetch(`/api/automations/${id}/fire`, {
    method: 'POST',
  });
  if (!response.ok) {
    console.error('Failed to fire automation');
  }
}
```

- [ ] **Step 3: Job history list within detail tab**

Show jobs chronologically with:
- Status dot: green (completed), red (failed), amber (needs_review), blue (running)
- Relative timestamp
- Summary text (one line)
- Trigger badge (schedule/channel/watch/manual) using the standard badge pattern:
  `<span class="text-[9px] px-1 py-px rounded bg-blue-500/15 text-blue-400">schedule</span>`

**Commit:** `feat(m7-s3): add automation detail tab with recurring + one-off variants`

---

## Task 21: Timeline Redesign -- Jobs Instead of Tasks

**Files:**
- Modify: `packages/dashboard/public/index.html`
- Modify: `packages/dashboard/public/js/app.js`

- [ ] **Step 1: Replace task timeline with job timeline**

The timeline now shows:
- Past jobs (from `$store.jobs.items`, reverse chronological)
- NOW marker (horizontal rule with "NOW" label)
- Future projected runs (from `/api/automations/next-runs` endpoint)
- Calendar events (existing)

Order: chronological (past-to-future).

- [ ] **Step 2: Job card rendering**

Each job card shows:
- Time (relative for today: "2h ago", absolute for older: "Mar 22")
- Parent automation name (clickable -> automation detail tab)
- Trigger badge: schedule (clock), channel (message), watch (eye), one-off (sparkle)
- Summary text (one line, truncated)
- Status dot color: green (completed), red (failed), amber (needs_review), blue (running/scheduled), violet (calendar)

- [ ] **Step 3: Running jobs get pulsing blue dot**

Apply `animate-pulse` class to the status dot for running jobs.

- [ ] **Step 4: Needs review jobs get amber highlight**

Add `border-l-2 border-amber-400` to needs_review jobs. Show the review question as summary text.

- [ ] **Step 5: Compute timelineItems as merged array**

In app.js, compute a merged timeline array from jobs + projected runs + calendar events, sorted chronologically with a NOW marker inserted at the current time position.

**Commit:** `feat(m7-s3): redesign timeline to show jobs with trigger badges`

---

## Task 22: Chat Tag Injection for Automations

**Files:**
- Modify: `packages/dashboard/src/agent/system-prompt-builder.ts`

- [ ] **Step 1: Add active automation context to session metadata**

When the user is viewing an automation detail tab, inject context into the brain's system prompt (same pattern as `activeTaskContext` at line 124 of system-prompt-builder.ts):

In the `BuildContext` interface, add:
```typescript
activeAutomationContext?: {
  automationId: string;
  name: string;
} | null;
```

In the `build()` method, add after the activeTaskContext block:
```typescript
if (context.activeAutomationContext) {
  dynamicParts.push(
    `[Active Automation View]\n` +
    `The user is viewing automation: "${context.activeAutomationContext.name}" ` +
    `(${context.activeAutomationContext.automationId})\n` +
    `If they ask about "this automation" or want changes, use the automation tools.\n` +
    `[End Active Automation View]`
  );
}
```

- [ ] **Step 2: Wire tab context from WebSocket**

The dashboard sends the active tab context via WebSocket. Add automation tab tracking to the existing pattern (wherever activeTaskContext is populated from WS messages, add the same for activeAutomationContext).

**Commit:** `feat(m7-s3): add automation chat tag injection to system prompt`

---

## Task 23: Initial State Push on WebSocket Connect

**Files:**
- Modify: `packages/dashboard/src/state/state-publisher.ts`

- [ ] **Step 1: Include automations and jobs in initial state push**

When a new WebSocket client connects, the StatePublisher pushes full state snapshots. Add automations and jobs to the initial push alongside existing entities (tasks, conversations, calendar):

```typescript
// In publishFullState() or the onConnect handler:
this.publishAutomations();
this.publishJobs();
```

**Commit:** `feat(m7-s3): include automations + jobs in initial WebSocket state push`

---

## Task 24: Integration Test -- Full Automation Lifecycle

**Files:**
- Create: `packages/dashboard/tests/integration/automation-lifecycle.test.ts`

- [ ] **Step 1: Test: create automation -> fire -> job completes -> notification**

```typescript
test("full automation lifecycle: create -> fire -> complete -> notify", async () => {
  // 1. Write automation manifest to disk (tmp dir)
  // 2. AutomationSyncService indexes it
  // 3. Fire via processor
  // 4. Verify job JSONL entry
  // 5. Verify agent.db job row
  // 6. Verify notification triggered (mock ConversationInitiator)
});
```

- [ ] **Step 2: Test: once=true automation auto-disables**

```typescript
test("once:true automation auto-disables after completion", async () => {
  // Create automation with once: true
  // Fire it
  // Verify automation status changed to "disabled" in manifest
  // Verify job completed
});
```

- [ ] **Step 3: Test: concurrent fire blocked by semaphore**

```typescript
test("concurrent fire blocked by per-automation semaphore", async () => {
  // Fire automation (with slow mock executor)
  // Immediately fire again
  // Verify second fire skipped with warning
  // Verify only one job created
});
```

- [ ] **Step 4: Test: scheduler triggers cron-due automation**

```typescript
test("scheduler triggers automation when cron is due", async () => {
  // Create automation with schedule trigger (cron: every minute)
  // Ensure no prior jobs exist
  // Call checkDue()
  // Verify job created via processor
});
```

**Test command:** `cd packages/dashboard && npx vitest run tests/integration/automation-lifecycle.test.ts`
**Expected:** All lifecycle scenarios pass.

**Commit:** `test(m7-s3): add automation lifecycle integration tests`

---

## Task 25: Restart Dashboard Service

After all changes are committed and tests pass, restart the dashboard service so the running instance picks up the new code:

```bash
systemctl --user restart nina-dashboard.service
```

Verify the automations system initializes correctly in the logs:

```bash
journalctl --user -u nina-dashboard.service --no-pager -n 30
```

Expected log lines:
- `[AutomationSync] Indexed N automation(s) on startup`
- `Automation system initialized (sync + scheduler)`

**This is a manual verification step, not a commit.**

---

## Summary

| Task | Description | Est. |
|------|-------------|------|
| 1 | Automation + Job type definitions | 3 min |
| 2 | agent.db schema (automations + jobs tables) | 5 min |
| 3 | AutomationJobService (JSONL lifecycle) | 5 min |
| 4 | AutomationManager (manifest CRUD) | 5 min |
| 5 | AutomationSyncService (FileWatcher) | 4 min |
| 6 | AutomationExecutor (core execution) | 5 min |
| 7 | AutomationProcessor (delivery + notification) | 5 min |
| 8 | AutomationScheduler (cron-parser) | 5 min |
| 9 | Barrel exports | 2 min |
| 10 | MCP tools (automation-server.ts) | 5 min |
| 11 | Automation hints in brain system prompt | 4 min |
| 12 | App events (automation + job types) | 2 min |
| 13 | AppAutomationService namespace | 3 min |
| 14 | App.create() service initialization | 5 min |
| 15 | StatePublisher (automation + job broadcasting) | 4 min |
| 16 | REST API routes (automations + jobs) | 4 min |
| 17 | WebSocket client (stores + handlers) | 3 min |
| 18 | Automations home widget | 3 min |
| 19 | Automations browser tab | 4 min |
| 20 | Automation detail tab (recurring + one-off) | 5 min |
| 21 | Timeline redesign (jobs, badges, status dots) | 5 min |
| 22 | Chat tag injection for automations | 3 min |
| 23 | Initial state push on WS connect | 2 min |
| 24 | Integration test (full lifecycle) | 5 min |
| 25 | Restart + verify | 2 min |
| **Total** | | **~100 min** |
