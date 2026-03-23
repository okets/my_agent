# M7-S4: Triggers + HITL — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire WatchTriggerService for filesystem-based automation triggers (polling mode for NAS/SMB), extend PostResponseHooks + Haiku extraction for channel-triggered automations, add media staging, connect `needs_review` to ConversationInitiator, and implement SDK session resumption for human-in-the-loop flows. Redesign the timeline UI to show jobs with status dots, trigger badges, NOW marker, and future projected runs.

**Architecture:** WatchTriggerService uses chokidar with polling mode, reads watch triggers from agent.db, maintains a path-to-automationId map, debounces rapid file events by space. Channel triggers extend the existing `extractTaskFromMessage()` Haiku prompt with active automation hints. `needs_review` status wires into ConversationInitiator.alert() with initiate() fallback. SDK session resumption uses the existing `createBrainQuery({ resume })` pattern already proven in TaskExecutor.

**Tech Stack:** chokidar (already a dependency via `@my-agent/core`), Agent SDK session resumption, Haiku extraction, Alpine.js + Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-03-22-m7-spaces-automations-jobs.md`

**Depends on:** S1 (FileWatcher, SpaceSyncService, agent.db spaces table), S2 (tool spaces, I/O contracts), S3 (AutomationSyncService, AutomationJobService, AutomationExecutor, AutomationProcessor, AutomationScheduler, automation-server MCP tools, agent.db automations+jobs tables).

---

## Chunk 1: WatchTriggerService (Tasks 1-5)

### Task 1: WatchTriggerService — Types + Test Shell

Define the WatchTriggerService interface and write failing tests.

**Files:**
- Create: `packages/dashboard/src/automations/watch-trigger-service.ts`
- Create: `packages/dashboard/tests/automations/watch-trigger-service.test.ts`

- [ ] **Step 1: Define types and class skeleton**

```typescript
// packages/dashboard/src/automations/watch-trigger-service.ts

import { EventEmitter } from "node:events";
import type { FSWatcher } from "chokidar";

export interface WatchTriggerConfig {
  automationId: string;
  path: string;         // external path to watch
  events?: string[];    // ["add", "change", "unlink"] — defaults to ["add", "change"]
  polling?: boolean;    // usePolling for NAS/SMB — defaults to true
  interval?: number;    // polling interval ms — defaults to 5000
}

export interface WatchEvent {
  automationIds: string[];
  files: string[];
  event: string;        // "add" | "change" | "unlink"
  timestamp: string;
}

export interface WatchTriggerServiceDeps {
  /** Read watch triggers from agent.db */
  getWatchTriggers: () => WatchTriggerConfig[];
  /** Fire an automation job with context */
  fireAutomation: (automationId: string, context: Record<string, unknown>) => Promise<void>;
  log: (msg: string) => void;
  logError: (err: unknown, msg: string) => void;
}

export class WatchTriggerService extends EventEmitter {
  private deps: WatchTriggerServiceDeps;
  private watchers = new Map<string, FSWatcher>();          // path → watcher
  private pathToAutomations = new Map<string, string[]>();  // path → automationId[]
  private pendingEvents = new Map<string, { files: string[]; event: string; timer: NodeJS.Timeout }>();
  private debounceDurationMs: number;
  private mountRetryAttempts = new Map<string, number>();   // path → retry count

  constructor(deps: WatchTriggerServiceDeps, debounceDurationMs = 5000) {
    super();
    this.deps = deps;
    this.debounceDurationMs = debounceDurationMs;
  }

  /** Start watching all configured paths */
  async start(): Promise<void> { /* Task 2 */ }

  /** Stop all watchers */
  async stop(): Promise<void> { /* Task 2 */ }

  /** Re-sync watchers when automation manifests change */
  async sync(): Promise<void> { /* Task 3 */ }

  /** Handle file event with space-level debouncing */
  private handleFileEvent(watchPath: string, filePath: string, event: string): void { /* Task 4 */ }

  /** Handle watcher error (mount failure) */
  private handleWatcherError(watchPath: string, error: Error): void { /* Task 5 */ }
}
```

- [ ] **Step 2: Write failing tests**

```typescript
// packages/dashboard/tests/automations/watch-trigger-service.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WatchTriggerService } from "../../src/automations/watch-trigger-service.js";

describe("WatchTriggerService", () => {
  it("registers watchers for all configured watch triggers on start()", async () => {
    // ...
  });

  it("maps multiple automations to the same path", async () => {
    // ...
  });

  it("debounces rapid file events within 5s window into one job", async () => {
    // ...
  });

  it("fires automation with batched file list after debounce", async () => {
    // ...
  });

  it("tears down stale watchers and registers new ones on sync()", async () => {
    // ...
  });

  it("retries with backoff on mount failure", async () => {
    // ...
  });

  it("alerts via ConversationInitiator on persistent mount failure", async () => {
    // ...
  });
});
```

**Test command:** `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/automations/watch-trigger-service.test.ts`

**Expected:** All tests fail (class methods are stubs).

**Commit:** `test(m7-s4): failing tests for WatchTriggerService`

---

### Task 2: WatchTriggerService — start() and stop()

Implement watcher registration and teardown.

**Files:**
- Edit: `packages/dashboard/src/automations/watch-trigger-service.ts`

- [ ] **Step 1: Implement start()**

Read watch triggers from agent.db via `deps.getWatchTriggers()`. For each trigger config:
1. Build the `pathToAutomations` map (path -> automationId[])
2. Create a chokidar watcher with `usePolling: config.polling ?? true` and `interval: config.interval ?? 5000`
3. Register event handlers for configured events (default: `["add", "change"]`)
4. Store watcher in `this.watchers` map keyed by path

```typescript
async start(): Promise<void> {
  const triggers = this.deps.getWatchTriggers();
  if (triggers.length === 0) {
    this.deps.log("[WatchTriggerService] No watch triggers configured");
    return;
  }

  // Build path → automationId[] map
  for (const trigger of triggers) {
    const existing = this.pathToAutomations.get(trigger.path) ?? [];
    existing.push(trigger.automationId);
    this.pathToAutomations.set(trigger.path, existing);
  }

  // Create one watcher per unique path
  const { watch } = await import("chokidar");
  const uniquePaths = [...new Set(triggers.map(t => t.path))];

  for (const watchPath of uniquePaths) {
    // Find the config for this path (use first trigger's polling settings)
    const config = triggers.find(t => t.path === watchPath)!;
    const events = config.events ?? ["add", "change"];

    const watcher = watch(watchPath, {
      persistent: true,
      ignoreInitial: true,
      usePolling: config.polling ?? true,
      interval: config.interval ?? 5000,
    });

    for (const event of events) {
      watcher.on(event, (filePath: string) => {
        this.handleFileEvent(watchPath, filePath, event);
      });
    }
    watcher.on("error", (error: Error) => {
      this.handleWatcherError(watchPath, error);
    });

    this.watchers.set(watchPath, watcher);
    this.deps.log(`[WatchTriggerService] Watching: ${watchPath} (polling: ${config.polling ?? true})`);
  }
}
```

- [ ] **Step 2: Implement stop()**

```typescript
async stop(): Promise<void> {
  for (const [path, watcher] of this.watchers) {
    await watcher.close();
    this.deps.log(`[WatchTriggerService] Stopped watching: ${path}`);
  }
  this.watchers.clear();
  this.pathToAutomations.clear();

  // Clear pending debounce timers
  for (const pending of this.pendingEvents.values()) {
    clearTimeout(pending.timer);
  }
  this.pendingEvents.clear();
  this.mountRetryAttempts.clear();
}
```

**Test command:** `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/automations/watch-trigger-service.test.ts`

**Expected:** start/stop tests pass, debounce tests still fail.

**Commit:** `feat(m7-s4): WatchTriggerService start/stop with chokidar polling`

---

### Task 3: WatchTriggerService — Dynamic sync()

Re-sync watchers when automation manifests change (called from AutomationSyncService events).

**Files:**
- Edit: `packages/dashboard/src/automations/watch-trigger-service.ts`

- [ ] **Step 1: Implement sync()**

```typescript
async sync(): Promise<void> {
  const triggers = this.deps.getWatchTriggers();

  // Build new path → automationId[] map
  const newPathMap = new Map<string, string[]>();
  for (const trigger of triggers) {
    const existing = newPathMap.get(trigger.path) ?? [];
    existing.push(trigger.automationId);
    newPathMap.set(trigger.path, existing);
  }

  // Tear down watchers for paths no longer needed
  for (const [path, watcher] of this.watchers) {
    if (!newPathMap.has(path)) {
      await watcher.close();
      this.watchers.delete(path);
      this.deps.log(`[WatchTriggerService] Removed watcher: ${path}`);
    }
  }

  // Register watchers for new paths
  const { watch } = await import("chokidar");
  for (const [path, automationIds] of newPathMap) {
    if (!this.watchers.has(path)) {
      const config = triggers.find(t => t.path === path)!;
      const events = config.events ?? ["add", "change"];

      const watcher = watch(path, {
        persistent: true,
        ignoreInitial: true,
        usePolling: config.polling ?? true,
        interval: config.interval ?? 5000,
      });

      for (const event of events) {
        watcher.on(event, (filePath: string) => {
          this.handleFileEvent(path, filePath, event);
        });
      }
      watcher.on("error", (error: Error) => {
        this.handleWatcherError(path, error);
      });

      this.watchers.set(path, watcher);
      this.deps.log(`[WatchTriggerService] Added watcher: ${path}`);
    }
  }

  // Update the path map
  this.pathToAutomations = newPathMap;
}
```

**Test command:** `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/automations/watch-trigger-service.test.ts`

**Expected:** sync tests pass.

**Commit:** `feat(m7-s4): WatchTriggerService dynamic sync on manifest changes`

---

### Task 4: WatchTriggerService — Space-Level Debouncing

Batch rapid file events within the debounce window (5s default) into a single job.

**Files:**
- Edit: `packages/dashboard/src/automations/watch-trigger-service.ts`

- [ ] **Step 1: Implement handleFileEvent()**

```typescript
private handleFileEvent(watchPath: string, filePath: string, event: string): void {
  const debounceKey = watchPath; // debounce by watched path (space-level)

  const pending = this.pendingEvents.get(debounceKey);
  if (pending) {
    // Add file to existing batch, reset timer
    if (!pending.files.includes(filePath)) {
      pending.files.push(filePath);
    }
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => this.flushPendingEvents(debounceKey), this.debounceDurationMs);
    return;
  }

  // New batch
  const timer = setTimeout(() => this.flushPendingEvents(debounceKey), this.debounceDurationMs);
  this.pendingEvents.set(debounceKey, { files: [filePath], event, timer });
}

private async flushPendingEvents(debounceKey: string): Promise<void> {
  const pending = this.pendingEvents.get(debounceKey);
  if (!pending) return;
  this.pendingEvents.delete(debounceKey);

  const automationIds = this.pathToAutomations.get(debounceKey) ?? [];
  const context = {
    trigger: "watch" as const,
    files: pending.files,
    event: pending.event,
    batchSize: pending.files.length,
  };

  this.deps.log(
    `[WatchTriggerService] Firing ${automationIds.length} automation(s) for ${pending.files.length} file(s) at ${debounceKey}`,
  );

  // Fire all automations mapped to this path
  for (const automationId of automationIds) {
    try {
      await this.deps.fireAutomation(automationId, context);
    } catch (err) {
      this.deps.logError(err, `[WatchTriggerService] Failed to fire automation ${automationId}`);
    }
  }

  this.emit("triggered", { automationIds, ...context });
}
```

**Test command:** `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/automations/watch-trigger-service.test.ts`

**Expected:** debounce tests pass — rapid events batched, single job fired after 5s.

**Commit:** `feat(m7-s4): WatchTriggerService space-level debouncing`

---

### Task 5: WatchTriggerService — Mount Failure Handling

Retry with exponential backoff on watcher errors. Alert via ConversationInitiator if persistent.

**Files:**
- Edit: `packages/dashboard/src/automations/watch-trigger-service.ts`

- [ ] **Step 1: Implement handleWatcherError()**

Import `computeBackoff` and `DEFAULT_BACKOFF` from `@my-agent/core`. Track retry attempts per path.

```typescript
import { computeBackoff, DEFAULT_BACKOFF } from "@my-agent/core";

private handleWatcherError(watchPath: string, error: Error): void {
  const attempt = this.mountRetryAttempts.get(watchPath) ?? 0;
  this.deps.logError(error, `[WatchTriggerService] Watcher error on ${watchPath} (attempt ${attempt})`);

  const delay = computeBackoff(DEFAULT_BACKOFF, attempt);
  if (delay === null) {
    // Max attempts exceeded — persistent failure
    this.deps.log(
      `[WatchTriggerService] Persistent mount failure for ${watchPath} after ${attempt} attempts — alerting user`,
    );
    this.emit("mount_failure", { path: watchPath, attempts: attempt });
    this.mountRetryAttempts.delete(watchPath);
    return;
  }

  this.mountRetryAttempts.set(watchPath, attempt + 1);
  this.deps.log(`[WatchTriggerService] Retrying ${watchPath} in ${delay}ms`);

  setTimeout(async () => {
    try {
      // Close existing watcher
      const existing = this.watchers.get(watchPath);
      if (existing) {
        await existing.close();
        this.watchers.delete(watchPath);
      }
      // Re-register via sync (which reads current triggers from DB)
      await this.sync();
      this.mountRetryAttempts.delete(watchPath); // reset on success
    } catch (retryErr) {
      this.handleWatcherError(watchPath, retryErr instanceof Error ? retryErr : new Error(String(retryErr)));
    }
  }, delay);
}
```

- [ ] **Step 2: Wire mount_failure event to ConversationInitiator in app integration (Chunk 5)**

This is wired in Task 14 when integrating into app.ts. Here we just emit the event.

**Test command:** `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/automations/watch-trigger-service.test.ts`

**Expected:** All WatchTriggerService tests pass.

**Commit:** `feat(m7-s4): WatchTriggerService mount failure retry with backoff`

---

## Chunk 2: Channel Triggers via Extended Haiku Extraction (Tasks 6-8)

### Task 6: Rename task-extractor.ts + Extend Types

Rename the file and extend the extraction output schema with `matched_automation`.

**Files:**
- Rename: `packages/dashboard/src/tasks/task-extractor.ts` -> `packages/dashboard/src/automations/automation-extractor.ts`
- Edit: `packages/dashboard/src/conversations/post-response-hooks.ts` (update import)
- Create: `packages/dashboard/tests/automations/automation-extractor.test.ts`

- [ ] **Step 1: Copy and rename**

```bash
cp packages/dashboard/src/tasks/task-extractor.ts packages/dashboard/src/automations/automation-extractor.ts
```

Keep the original file temporarily with a re-export for backward compatibility:

```typescript
// packages/dashboard/src/tasks/task-extractor.ts (preserved for backward compat)
export { extractTaskFromMessage, type ExtractedTask, type ExtractionResult } from "../automations/automation-extractor.js";
```

- [ ] **Step 2: Extend ExtractionResult type**

Add `matched_automation` to the output schema in `automation-extractor.ts`:

```typescript
export interface AutomationMatch {
  automationId: string;
  confidence: number;        // 0-1
  extractedContext: Record<string, unknown>;  // structured data extracted from message
}

export interface ExtractionResult {
  shouldCreateTask: boolean;
  task?: ExtractedTask;
  tasks?: ExtractedTask[];
  matchedAutomation?: AutomationMatch;  // NEW: if message matches an active automation
}
```

- [ ] **Step 3: Write failing tests for automation matching**

```typescript
// packages/dashboard/tests/automations/automation-extractor.test.ts

describe("AutomationExtractor", () => {
  it("matches a message to an automation hint", async () => {
    // Mock: "Here is my invoice" should match automation with hint "invoice, receipt"
  });

  it("returns extractedContext with structured data", async () => {
    // Mock: vendor name, amount extracted from message
  });

  it("preserves existing task extraction when no automation matches", async () => {
    // "Research Bangkok" with no matching automation → shouldCreateTask: true, task: {...}
  });

  it("prefers automation match over new task creation", async () => {
    // When both could match, automation takes priority
  });
});
```

**Test command:** `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/automations/automation-extractor.test.ts`

**Expected:** Tests fail (extraction prompt not yet extended).

**Commit:** `refactor(m7-s4): rename task-extractor to automation-extractor, add AutomationMatch type`

---

### Task 7: Extend Haiku Extraction Prompt for Automation Matching

Add active automation hints to the Haiku prompt and parse the new output format.

**Files:**
- Edit: `packages/dashboard/src/automations/automation-extractor.ts`

- [ ] **Step 1: Add automationHints parameter to extractTaskFromMessage()**

```typescript
export interface AutomationHint {
  id: string;
  name: string;
  hints: string;      // comma-separated hint keywords from trigger config
  description: string; // first line of automation body
}

export async function extractTaskFromMessage(
  userMessage: string,
  assistantResponse?: string,
  automationHints?: AutomationHint[],  // NEW parameter
): Promise<ExtractionResult> {
  // ... existing code, pass hints to buildExtractionPrompt
}
```

- [ ] **Step 2: Extend buildExtractionPrompt()**

Add a section to the system prompt after existing rules:

```typescript
// In buildExtractionPrompt(), after existing prompt text:
if (automationHints && automationHints.length > 0) {
  prompt += `\n\nACTIVE AUTOMATIONS (check these FIRST before creating a new task):
${automationHints.map(h => `- ID: "${h.id}" | Name: "${h.name}" | Hints: ${h.hints} | ${h.description}`).join("\n")}

If the user's message matches an automation:
Return: {"shouldCreateTask": false, "matchedAutomation": {"automationId": "<id>", "confidence": 0.0-1.0, "extractedContext": {<structured data from message>}}}

Only match if confidence >= 0.7. Otherwise fall through to task creation rules above.`;
}
```

- [ ] **Step 3: Parse matched_automation from Haiku response**

After JSON parsing in `extractTaskFromMessage()`, check for `matchedAutomation`:

```typescript
if (result.matchedAutomation) {
  return {
    shouldCreateTask: false,
    matchedAutomation: {
      automationId: String(result.matchedAutomation.automationId),
      confidence: Number(result.matchedAutomation.confidence) || 0,
      extractedContext: result.matchedAutomation.extractedContext ?? {},
    },
  };
}
```

**Test command:** `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/automations/automation-extractor.test.ts`

**Expected:** Automation matching tests pass (with mocked Haiku responses).

**Commit:** `feat(m7-s4): extend Haiku extraction prompt for automation matching`

---

### Task 8: Wire Channel Trigger into PostResponseHooks

Connect the extended extraction to automation firing.

**Files:**
- Edit: `packages/dashboard/src/conversations/post-response-hooks.ts`
- Create: `packages/dashboard/tests/automations/post-response-hooks-automation.test.ts`

- [ ] **Step 1: Extend PostResponseHooksDeps**

```typescript
import { extractTaskFromMessage, type AutomationHint } from "../automations/automation-extractor.js";

export interface PostResponseHooksDeps {
  taskManager: TaskManager;
  log: (msg: string) => void;
  logError: (err: unknown, msg: string) => void;
  // NEW:
  getAutomationHints: () => AutomationHint[];
  fireAutomation: (automationId: string, context: Record<string, unknown>) => Promise<void>;
  getRecentJobsForAutomation: (automationId: string, withinMs: number) => number;
}
```

- [ ] **Step 2: Extend detectMissedTasks() with automation matching**

After the existing task extraction, add automation matching:

```typescript
private async detectMissedTasks(
  conversationId: string,
  userContent: string,
  assistantContent: string,
): Promise<void> {
  try {
    const automationHints = this.deps.getAutomationHints();
    const extraction = await extractTaskFromMessage(
      userContent,
      assistantContent,
      automationHints,
    );

    // NEW: Check for automation match
    if (extraction.matchedAutomation) {
      const { automationId, confidence, extractedContext } = extraction.matchedAutomation;

      // 5-minute dedup: skip if automation fired recently
      const recentJobs = this.deps.getRecentJobsForAutomation(automationId, 300_000);
      if (recentJobs > 0) {
        this.deps.log(`[PostResponseHooks] Automation ${automationId} already fired recently, skipping`);
        return;
      }

      this.deps.log(
        `[PostResponseHooks] Channel trigger: firing automation "${automationId}" (confidence: ${confidence.toFixed(2)})`,
      );
      await this.deps.fireAutomation(automationId, {
        trigger: "channel",
        conversationId,
        ...extractedContext,
      });
      return;
    }

    // Existing task detection path (unchanged)
    if (!extraction.shouldCreateTask) return;
    // ... existing dedup + logging code ...
  } catch {
    // Non-fatal — detection is best-effort
  }
}
```

- [ ] **Step 3: Write tests**

Test the full flow: user sends invoice message -> Haiku matches automation -> `fireAutomation` called with extracted context. Test dedup: automation fired recently -> skip.

**Test command:** `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/automations/post-response-hooks-automation.test.ts`

**Expected:** Channel trigger tests pass.

**Commit:** `feat(m7-s4): channel triggers via PostResponseHooks + Haiku extraction`

---

## Chunk 3: Media Staging + needs_review + HITL (Tasks 9-12)

### Task 9: Media Staging Directory

Create the staging directory and document the convention.

**Files:**
- Edit: `packages/dashboard/src/automations/automation-extractor.ts` (reference staging paths in context)
- Create: `packages/dashboard/tests/automations/media-staging.test.ts`

- [ ] **Step 1: Create staging directory utility**

```typescript
// packages/dashboard/src/automations/media-staging.ts

import { mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const STAGING_DIR = ".my_agent/staging";

/**
 * Ensure the staging directory exists.
 */
export async function ensureStagingDir(agentDir: string): Promise<string> {
  const dir = join(agentDir, "staging");
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Generate a staging path for an incoming media file.
 * Returns the full path where the file should be saved.
 */
export function stagingPath(agentDir: string, originalName: string): string {
  const ext = originalName.includes(".") ? originalName.split(".").pop() : "bin";
  const uniqueName = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
  return join(agentDir, "staging", uniqueName);
}

/**
 * Clean up staging files older than maxAgeMs (default: 24h).
 */
export async function cleanStaging(agentDir: string, maxAgeMs = 86_400_000): Promise<number> {
  const { readdir, stat, unlink } = await import("fs/promises");
  const dir = join(agentDir, "staging");
  let cleaned = 0;

  try {
    const files = await readdir(dir);
    const now = Date.now();

    for (const file of files) {
      const filePath = join(dir, file);
      const fileStat = await stat(filePath);
      if (now - fileStat.mtimeMs > maxAgeMs) {
        await unlink(filePath);
        cleaned++;
      }
    }
  } catch {
    // staging dir may not exist yet
  }

  return cleaned;
}
```

- [ ] **Step 2: Write tests**

Test `ensureStagingDir` creates directory, `stagingPath` returns unique paths, `cleanStaging` removes old files.

**Test command:** `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/automations/media-staging.test.ts`

**Expected:** All pass.

**Commit:** `feat(m7-s4): media staging directory for incoming channel media`

---

### Task 10: needs_review -> ConversationInitiator Wiring

When a job status becomes `needs_review`, trigger ConversationInitiator.alert() with the review question.

**Files:**
- Edit: `packages/dashboard/src/automations/automation-processor.ts` (from S3)
- Create: `packages/dashboard/tests/automations/needs-review-notification.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("needs_review notification", () => {
  it("calls ConversationInitiator.alert() when job status is needs_review", async () => {
    // ...
  });

  it("falls back to initiate() when no active conversation within 15 min", async () => {
    // ...
  });

  it("includes the review question from job summary in the alert prompt", async () => {
    // ...
  });
});
```

- [ ] **Step 2: Add needs_review handling to AutomationProcessor**

In AutomationProcessor's post-execution handler (the method that runs after AutomationExecutor completes), add:

```typescript
// In AutomationProcessor, after job completes:
if (job.status === "needs_review") {
  const question = job.summary ?? "A job requires your review.";
  const automationName = automation.name;
  const prompt = `[SYSTEM: Automation "${automationName}" needs your review.\n\nQuestion: ${question}\n\nJob ID: ${job.id}\n\nPresent this to the user naturally. Ask for their input. When they respond, you can resume the job with resume_job("${job.id}", <their response>).]`;

  const alerted = await this.deps.conversationInitiator.alert(prompt);
  if (!alerted) {
    // No active conversation — start a new one
    await this.deps.conversationInitiator.initiate({
      firstTurnPrompt: prompt,
    });
  }
}
```

**Test command:** `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/automations/needs-review-notification.test.ts`

**Expected:** Tests pass.

**Commit:** `feat(m7-s4): wire needs_review to ConversationInitiator alert/initiate`

---

### Task 11: SDK Session Resumption for HITL — resume_job MCP Tool

Add the `resume_job` MCP tool that resumes a paused job's SDK session with user input.

**Files:**
- Edit: `packages/dashboard/src/mcp/automation-server.ts` (from S3 — add resume_job tool)
- Create: `packages/dashboard/tests/automations/resume-job.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("resume_job MCP tool", () => {
  it("resumes a needs_review job with user input", async () => {
    // ...
  });

  it("calls createBrainQuery with resume: storedSessionId", async () => {
    // ...
  });

  it("rejects if job is not in needs_review status", async () => {
    // ...
  });

  it("falls back to fresh session if stored session ID is stale", async () => {
    // ...
  });
});
```

- [ ] **Step 2: Implement resume_job tool handler**

The `resume_job` tool in `automation-server.ts`:

```typescript
tool(
  "resume_job",
  "Resume a paused job (needs_review status) with user input. The worker continues with full prior context.",
  {
    jobId: z.string().describe("The job ID to resume"),
    userInput: z.string().describe("The user's response/decision"),
  },
  async ({ jobId, userInput }) => {
    // 1. Look up job entry from JSONL
    const job = deps.jobService.getJob(jobId);
    if (!job) {
      return { content: [{ type: "text", text: `Job ${jobId} not found` }] };
    }
    if (job.status !== "needs_review") {
      return { content: [{ type: "text", text: `Job ${jobId} is ${job.status}, not needs_review` }] };
    }

    // 2. Read stored session ID from sidecar file
    const sessionId = deps.jobService.getSessionId(job.automation_id, jobId);

    // 3. Resume via AutomationExecutor
    const result = await deps.executor.resume(job, userInput, sessionId);

    return {
      content: [{
        type: "text",
        text: result.success
          ? `Job ${jobId} resumed and ${result.status}. ${result.summary ?? ""}`
          : `Job ${jobId} resume failed: ${result.error}`,
      }],
    };
  },
)
```

**Test command:** `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/automations/resume-job.test.ts`

**Expected:** Tests pass.

**Commit:** `feat(m7-s4): resume_job MCP tool for HITL session resumption`

---

### Task 12: AutomationExecutor — resume() Method

Add the resume method to AutomationExecutor that calls createBrainQuery with the stored session ID.

**Files:**
- Edit: `packages/dashboard/src/automations/automation-executor.ts` (from S3)
- Create: `packages/dashboard/tests/automations/automation-executor-resume.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("AutomationExecutor.resume()", () => {
  it("calls createBrainQuery with resume: sessionId and user input as prompt", async () => {
    // ...
  });

  it("updates job status to running then completed on success", async () => {
    // ...
  });

  it("falls back to fresh session if resume throws", async () => {
    // ...
  });

  it("stores new session ID from resumed session", async () => {
    // ...
  });
});
```

- [ ] **Step 2: Implement resume() on AutomationExecutor**

Follow the existing pattern from `TaskExecutor.executeQuery()` (lines 368-405):

```typescript
async resume(
  job: JobEntry,
  userInput: string,
  storedSessionId: string | null,
): Promise<{ success: boolean; status: string; summary?: string; error?: string }> {
  // Update job status to running
  this.deps.jobService.updateJob(job.id, { status: "running" });

  try {
    if (storedSessionId) {
      try {
        const response = await this.iterateBrainQuery(
          job,
          createBrainQuery(userInput, {
            model: this.getModel(job.automation_id),
            resume: storedSessionId,
            cwd: job.run_dir,
            tools: WORKER_TOOLS,
            settingSources: ["project"],
            additionalDirectories: [this.agentDir],
            mcpServers: this.config.mcpServers,
            hooks: this.config.hooks,
            includePartialMessages: false,
          }),
        );

        const { work, deliverable } = extractDeliverable(response);
        const summary = deliverable ?? work.slice(0, 200);

        this.deps.jobService.updateJob(job.id, {
          status: "completed",
          completed: new Date().toISOString(),
          summary,
        });

        return { success: true, status: "completed", summary };
      } catch (resumeErr) {
        console.warn(
          `[AutomationExecutor] Session resume failed for job ${job.id}, falling back to fresh`,
          resumeErr,
        );
      }
    }

    // Fresh session fallback (no prior context — user input only)
    // This is a degraded path; the user's input is the only context
    this.deps.jobService.updateJob(job.id, {
      status: "failed",
      completed: new Date().toISOString(),
      summary: "Session resume failed — no stored session available",
    });

    return { success: false, status: "failed", error: "No session to resume" };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    this.deps.jobService.updateJob(job.id, {
      status: "failed",
      completed: new Date().toISOString(),
      summary: `Resume failed: ${errorMsg}`,
    });
    return { success: false, status: "failed", error: errorMsg };
  }
}
```

- [ ] **Step 3: Session ID sidecar storage**

Store and read session IDs from `.my_agent/automations/.sessions/{automation-name}.json`:

```typescript
// In AutomationJobService:
getSessionId(automationId: string, jobId: string): string | null {
  const sessionFile = join(this.sessionsDir, `${automationId}.json`);
  try {
    const data = JSON.parse(readFileSync(sessionFile, "utf-8"));
    return data[jobId] ?? null;
  } catch {
    return null;
  }
}

storeSessionId(automationId: string, jobId: string, sessionId: string): void {
  const sessionFile = join(this.sessionsDir, `${automationId}.json`);
  let data: Record<string, string> = {};
  try {
    data = JSON.parse(readFileSync(sessionFile, "utf-8"));
  } catch { /* new file */ }
  data[jobId] = sessionId;
  writeFileSync(sessionFile, JSON.stringify(data, null, 2));
}
```

**Test command:** `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/automations/automation-executor-resume.test.ts`

**Expected:** Tests pass.

**Commit:** `feat(m7-s4): AutomationExecutor resume with SDK session resumption`

---

## Chunk 4: Timeline UI Redesign (Tasks 13-16)

### Task 13: Timeline Data — Jobs Query + Future Projection

Add backend timeline endpoint that returns past jobs + future projected runs.

**Files:**
- Edit: `packages/dashboard/src/routes/timeline.ts` (or create if not exists)
- Edit: `packages/dashboard/src/conversations/db.ts` (add job timeline query from S3 schema)
- Create: `packages/dashboard/tests/routes/timeline-jobs.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("Timeline jobs endpoint", () => {
  it("returns past jobs ordered by created desc", async () => {
    // ...
  });

  it("returns future projected runs from cron expressions", async () => {
    // ...
  });

  it("includes status, trigger type, automation name, and summary", async () => {
    // ...
  });

  it("supports pagination via before/after cursors", async () => {
    // ...
  });
});
```

- [ ] **Step 2: Add timeline query method to DB layer**

```typescript
// In conversations/db.ts or a new automations/db.ts:
getTimelineJobs(options: {
  before?: string;  // ISO date cursor
  after?: string;
  limit?: number;
}): TimelineJob[] {
  const limit = options.limit ?? 20;

  if (options.before) {
    return this.db.prepare(`
      SELECT j.*, a.name as automation_name, a.trigger_config
      FROM jobs j
      JOIN automations a ON j.automation_id = a.id
      WHERE j.created < ?
      ORDER BY j.created DESC
      LIMIT ?
    `).all(options.before, limit) as TimelineJob[];
  }

  // Default: most recent jobs
  return this.db.prepare(`
    SELECT j.*, a.name as automation_name, a.trigger_config
    FROM jobs j
    JOIN automations a ON j.automation_id = a.id
    ORDER BY j.created DESC
    LIMIT ?
  `).all(limit) as TimelineJob[];
}
```

- [ ] **Step 3: Add future projection from cron expressions**

```typescript
import { parseExpression } from "cron-parser";

function projectFutureRuns(automations: Automation[], hoursAhead = 24): TimelineItem[] {
  const items: TimelineItem[] = [];
  const now = new Date();
  const horizon = new Date(now.getTime() + hoursAhead * 3600_000);

  for (const automation of automations) {
    if (automation.status !== "active") continue;
    const triggers = JSON.parse(automation.trigger_config) as any[];

    for (const trigger of triggers) {
      if (trigger.type !== "schedule" || !trigger.cron) continue;

      try {
        const interval = parseExpression(trigger.cron, {
          currentDate: now,
          endDate: horizon,
          tz: trigger.timezone ?? "UTC",
        });

        while (true) {
          try {
            const next = interval.next();
            items.push({
              id: `projected-${automation.id}-${next.toISOString()}`,
              type: "projected",
              automationId: automation.id,
              automationName: automation.name,
              scheduledFor: next.toISOString(),
              triggerType: "schedule",
              status: "scheduled",
            });
          } catch { break; } // no more occurrences
        }
      } catch { /* invalid cron */ }
    }
  }

  return items.sort((a, b) => a.scheduledFor!.localeCompare(b.scheduledFor!));
}
```

- [ ] **Step 4: Wire timeline route**

```typescript
// GET /api/timeline
fastify.get("/api/timeline", async (req, reply) => {
  const { before, after, limit } = req.query as any;

  const pastJobs = db.getTimelineJobs({ before, after, limit: Number(limit) || 20 });
  const activeAutomations = db.getActiveAutomations();
  const futureRuns = projectFutureRuns(activeAutomations);

  return { pastJobs, futureRuns };
});
```

**Test command:** `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/routes/timeline-jobs.test.ts`

**Expected:** Tests pass.

**Commit:** `feat(m7-s4): timeline API with past jobs and future cron projections`

---

### Task 14: Timeline UI — Jobs + Status Dots + Trigger Badges

Redesign the timeline HTML to show jobs with the new visual language.

**Files:**
- Edit: `packages/dashboard/public/index.html` (timeline section, ~lines 945-1120)
- Edit: `packages/dashboard/public/js/app.js` (timeline data fetching + Alpine store)

- [ ] **Step 1: Update timeline item data model in Alpine store**

Replace the existing task-based timeline items with job-based items:

```javascript
// In app.js timeline store/component:
timelineItems: [],
timelineLoading: false,

async loadTimeline() {
  this.timelineLoading = true;
  try {
    const res = await fetch("/api/timeline");
    const data = await res.json();

    const items = [];

    // Past jobs
    for (const job of data.pastJobs) {
      items.push({
        id: job.id,
        itemType: "job",
        title: job.automation_name,
        summary: job.summary,
        status: job.status,
        date: job.created,
        triggerType: this.parseTriggerType(job.trigger_config, job.context),
        automationId: job.automation_id,
        isPast: true,
      });
    }

    // Future projected runs
    for (const run of data.futureRuns) {
      items.push({
        id: run.id,
        itemType: "projected",
        title: run.automationName,
        status: "scheduled",
        date: run.scheduledFor,
        triggerType: "schedule",
        automationId: run.automationId,
        isPast: false,
      });
    }

    // Sort chronologically (past newest first, then NOW, then future)
    this.timelineItems = this.processTimelineItems(items);
  } finally {
    this.timelineLoading = false;
  }
},
```

- [ ] **Step 2: Update timeline HTML template**

Replace existing bullet/badge rendering with job-specific design:

Status dots:
- `bg-green-400` — completed
- `bg-tokyo-red` — failed
- `bg-amber-400` — needs_review (with `animate-pulse`)
- `bg-blue-400` — scheduled/running (with `animate-pulse` for running)
- `bg-purple-400` — calendar event

Trigger badges:
```html
<!-- Trigger badge -->
<span class="px-1 py-0.5 text-[9px] rounded font-medium"
  :class="{
    'bg-cyan-500/15 text-cyan-400': item.triggerType === 'schedule',
    'bg-violet-500/15 text-violet-400': item.triggerType === 'channel',
    'bg-amber-500/15 text-amber-400': item.triggerType === 'watch',
    'bg-blue-500/15 text-blue-400': item.triggerType === 'manual' || item.triggerType === 'one-off',
  }"
  x-text="item.triggerType"
></span>
```

Needs review items get amber highlight:
```html
<button
  @click="openTimelineItem(item)"
  class="flex-1 flex flex-col gap-0.5 px-2 py-1 ml-1.5 rounded-lg hover:bg-tokyo-card/60 text-left transition-colors max-w-sm"
  :class="{
    'opacity-60': item.isPast && item.status === 'completed',
    'bg-amber-500/10 border border-amber-500/20': item.status === 'needs_review',
    'bg-blue-500/10': item.status === 'running',
  }"
>
```

Running jobs get spinner badge:
```html
<template x-if="item.status === 'running'">
  <span class="text-[9px] text-blue-400 animate-spin">&#9696;</span>
</template>
```

- [ ] **Step 3: Add day section headers**

Already implemented in existing timeline (lines 999-1013, `showDateSeparator` + `formatDateSeparator`). Verify they render correctly with the new data. Labels should use: "Today", "Yesterday", date for older.

- [ ] **Step 4: Timeline click -> Automation detail tab**

Update `openTimelineItem()`:

```javascript
openTimelineItem(item) {
  if (item.itemType === "job" || item.itemType === "projected") {
    // Open automation detail tab
    this.openTab("automation", { id: item.automationId });
  } else if (item.itemType === "event") {
    this.openCalendarOnDate(item.date);
  }
},
```

- [ ] **Step 5: Add legend at bottom**

```html
<!-- Timeline legend -->
<div class="flex flex-wrap gap-3 px-4 py-2 text-[9px] text-tokyo-text/40">
  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-green-400"></span> Completed</span>
  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-tokyo-red"></span> Failed</span>
  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-amber-400"></span> Review</span>
  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-blue-400"></span> Running</span>
  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-purple-400"></span> Calendar</span>
</div>
```

**Test:** Manual — restart dashboard, verify timeline renders with correct dots, badges, and layout.

**Commit:** `feat(m7-s4): timeline UI redesign — jobs, status dots, trigger badges, legend`

---

### Task 15: Timeline — Load Earlier/Later Pagination

Wire the existing pagination buttons to the new job-based timeline API.

**Files:**
- Edit: `packages/dashboard/public/js/app.js`

- [ ] **Step 1: Implement loadEarlierTimeline()**

```javascript
async loadEarlierTimeline() {
  const oldest = this.timelineItems.filter(i => i.isPast).at(-1);
  if (!oldest) return;

  const res = await fetch(`/api/timeline?before=${oldest.date}&limit=20`);
  const data = await res.json();

  const newItems = data.pastJobs.map(job => ({
    id: job.id,
    itemType: "job",
    title: job.automation_name,
    summary: job.summary,
    status: job.status,
    date: job.created,
    triggerType: this.parseTriggerType(job.trigger_config, job.context),
    automationId: job.automation_id,
    isPast: true,
  }));

  this.timelineItems = this.processTimelineItems([...this.timelineItems, ...newItems]);
  this.canLoadEarlier = newItems.length === 20;
},
```

- [ ] **Step 2: Implement loadLaterTimeline()**

Similar pattern, using `after` cursor for future items beyond current projection horizon.

**Test:** Manual — verify pagination works by clicking Load earlier/later buttons.

**Commit:** `feat(m7-s4): timeline pagination for earlier/later jobs`

---

### Task 16: Mobile Timeline

Ensure timeline renders correctly on mobile with the same design.

**Files:**
- Edit: `packages/dashboard/public/index.html` (mobile timeline section, around line 6183)

- [ ] **Step 1: Sync mobile timeline template with desktop**

The mobile timeline (in the mobile sheet) should use the same template structure as desktop. Verify:
- Status dots use same colors
- Trigger badges render
- Needs review amber highlight works
- Running spinner shows
- Legend visible
- Click -> opens Automation detail (or navigates to correct mobile view)

- [ ] **Step 2: Responsive adjustments**

- Reduce time column width on mobile if needed
- Ensure card text truncation works on narrow screens
- Summary text hidden on mobile (only title + badges shown)

**Test:** Manual — open dashboard on mobile viewport, verify timeline renders correctly.

**Commit:** `feat(m7-s4): mobile timeline with jobs, status dots, trigger badges`

---

## Chunk 5: App Integration + Wiring (Tasks 17-18)

### Task 17: Wire WatchTriggerService into App

Connect WatchTriggerService to the app lifecycle.

**Files:**
- Edit: `packages/dashboard/src/app.ts`

- [ ] **Step 1: Initialize WatchTriggerService in App.create()**

After AutomationSyncService and AutomationScheduler initialization:

```typescript
// In App.create(), after AutomationScheduler:
const watchTriggerService = new WatchTriggerService({
  getWatchTriggers: () => db.getWatchTriggers(), // query agent.db
  fireAutomation: async (id, context) => app.automations.fire(id, context),
  log: (msg) => console.log(msg),
  logError: (err, msg) => console.error(msg, err),
});

await watchTriggerService.start();

// Wire mount failure -> ConversationInitiator alert
watchTriggerService.on("mount_failure", async ({ path, attempts }) => {
  const prompt = `[SYSTEM: Filesystem watch on "${path}" has failed after ${attempts} retry attempts. The mount may be down. Alert the user and suggest checking the network mount.]`;
  const alerted = await conversationInitiator.alert(prompt);
  if (!alerted) {
    await conversationInitiator.initiate({ firstTurnPrompt: prompt });
  }
});

// Wire AutomationSyncService events -> WatchTriggerService sync
automationSyncService.on("sync", () => watchTriggerService.sync());
```

- [ ] **Step 2: Wire PostResponseHooks with automation deps**

Extend PostResponseHooks construction with the new dependencies:

```typescript
const postResponseHooks = new PostResponseHooks({
  taskManager,
  log: (msg) => console.log(msg),
  logError: (err, msg) => console.error(msg, err),
  // NEW:
  getAutomationHints: () => db.getAutomationHints(),
  fireAutomation: async (id, context) => app.automations.fire(id, context),
  getRecentJobsForAutomation: (id, withinMs) => db.getRecentJobCount(id, withinMs),
});
```

- [ ] **Step 3: Add db helper methods**

```typescript
// In conversations/db.ts:
getWatchTriggers(): WatchTriggerConfig[] {
  const automations = this.db.prepare(`
    SELECT id, trigger_config FROM automations
    WHERE status = 'active'
  `).all() as { id: string; trigger_config: string }[];

  const triggers: WatchTriggerConfig[] = [];
  for (const a of automations) {
    const triggerConfig = JSON.parse(a.trigger_config) as any[];
    for (const t of triggerConfig) {
      if (t.type === "watch") {
        triggers.push({
          automationId: a.id,
          path: t.path ?? t.space, // path or resolved from space
          events: t.events,
          polling: t.polling ?? true,
          interval: t.interval ?? 5000,
        });
      }
    }
  }
  return triggers;
}

getAutomationHints(): AutomationHint[] {
  return this.db.prepare(`
    SELECT id, name, trigger_config FROM automations
    WHERE status = 'active'
  `).all().map((a: any) => {
    const triggers = JSON.parse(a.trigger_config) as any[];
    const channelTrigger = triggers.find(t => t.type === "channel");
    return {
      id: a.id,
      name: a.name,
      hints: channelTrigger?.hint ?? "",
      description: a.name, // simplified — full desc from markdown body
    };
  }).filter(h => h.hints); // only automations with channel trigger hints
}

getRecentJobCount(automationId: string, withinMs: number): number {
  const since = new Date(Date.now() - withinMs).toISOString();
  const result = this.db.prepare(`
    SELECT COUNT(*) as count FROM jobs
    WHERE automation_id = ? AND created > ?
  `).get(automationId, since) as { count: number };
  return result.count;
}
```

**Test:** Integration — restart dashboard, verify WatchTriggerService logs "Watching:" for any configured watch triggers.

**Commit:** `feat(m7-s4): wire WatchTriggerService and channel triggers into App`

---

### Task 18: Cleanup + Stop Lifecycle

Ensure WatchTriggerService stops cleanly on app shutdown and staging cleanup runs.

**Files:**
- Edit: `packages/dashboard/src/app.ts`

- [ ] **Step 1: Add cleanup to app shutdown**

```typescript
// In App.stop() or shutdown handler:
await watchTriggerService.stop();
```

- [ ] **Step 2: Add staging cleanup to WorkLoopScheduler or startup**

On app startup, clean staging files older than 24h:

```typescript
import { cleanStaging } from "./automations/media-staging.js";

// In App.create(), after staging dir init:
const cleaned = await cleanStaging(agentDir);
if (cleaned > 0) {
  console.log(`[App] Cleaned ${cleaned} stale staging files`);
}
```

- [ ] **Step 3: Ensure re-export from automations/index.ts**

```typescript
// packages/dashboard/src/automations/index.ts
export { WatchTriggerService } from "./watch-trigger-service.js";
export { ensureStagingDir, stagingPath, cleanStaging } from "./media-staging.js";
export {
  extractTaskFromMessage,
  type AutomationMatch,
  type AutomationHint,
  type ExtractionResult,
  type ExtractedTask,
} from "./automation-extractor.js";
```

**Test command:** `cd /home/nina/my_agent/packages/dashboard && npx vitest run`

**Expected:** All tests pass, no regressions.

**Commit:** `feat(m7-s4): app lifecycle cleanup, staging cleanup, re-exports`

---

## Summary

| Chunk | Tasks | Scope |
|-------|-------|-------|
| 1 | 1-5 | WatchTriggerService: types, start/stop, sync, debounce, mount failure |
| 2 | 6-8 | Channel triggers: rename extractor, extend Haiku prompt, wire PostResponseHooks |
| 3 | 9-12 | Media staging, needs_review -> ConversationInitiator, resume_job MCP tool, AutomationExecutor.resume() |
| 4 | 13-16 | Timeline redesign: jobs API, status dots, trigger badges, pagination, mobile |
| 5 | 17-18 | App integration: wire services, DB helpers, cleanup lifecycle |

**Total:** 18 tasks across 5 chunks.

**Key files created:**
- `packages/dashboard/src/automations/watch-trigger-service.ts`
- `packages/dashboard/src/automations/automation-extractor.ts` (moved from tasks/)
- `packages/dashboard/src/automations/media-staging.ts`
- `packages/dashboard/tests/automations/watch-trigger-service.test.ts`
- `packages/dashboard/tests/automations/automation-extractor.test.ts`
- `packages/dashboard/tests/automations/post-response-hooks-automation.test.ts`
- `packages/dashboard/tests/automations/media-staging.test.ts`
- `packages/dashboard/tests/automations/needs-review-notification.test.ts`
- `packages/dashboard/tests/automations/resume-job.test.ts`
- `packages/dashboard/tests/automations/automation-executor-resume.test.ts`
- `packages/dashboard/tests/routes/timeline-jobs.test.ts`

**Key files edited (from S3):**
- `packages/dashboard/src/automations/automation-processor.ts` — needs_review notification
- `packages/dashboard/src/automations/automation-executor.ts` — resume() method
- `packages/dashboard/src/mcp/automation-server.ts` — resume_job tool
- `packages/dashboard/src/conversations/post-response-hooks.ts` — automation matching
- `packages/dashboard/src/conversations/db.ts` — timeline + helper queries
- `packages/dashboard/src/app.ts` — service wiring
- `packages/dashboard/public/index.html` — timeline redesign
- `packages/dashboard/public/js/app.js` — timeline data model
