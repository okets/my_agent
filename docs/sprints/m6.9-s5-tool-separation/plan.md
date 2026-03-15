# Conversation Nina Tool Separation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove power tools from conversation Nina, add create_task/search_tasks/update_property MCP tools, add WebUI task context, convert post-response hook to missed task detector — so conversation Nina delegates research instead of answering herself.

**Architecture:** Restrict conversation Nina to `["WebSearch", "WebFetch"]` SDK tools + MCP tools. Add 3 new MCP tools to `task-tools-server.ts` (renamed from `task-revision-server.ts`). Add hybrid FTS5+vector `TaskSearchService` for semantic task search. Add `"task"` ViewContext for WebUI. Convert post-response hook from auto-creation to detection-only.

**Tech Stack:** Agent SDK v0.2.74, sqlite-vec, FTS5, existing EmbeddingsPlugin (Ollama), Zod schemas.

**Spec:** `docs/superpowers/specs/2026-03-15-conversation-tool-separation-design.md`

---

## Phase 1: Core Behavior Change (Tasks 1–5)

### Task 1: Rename task-revision-server → task-tools-server

Simple rename + re-export. No logic changes.

**Files:**
- Rename: `packages/dashboard/src/mcp/task-revision-server.ts` → `packages/dashboard/src/mcp/task-tools-server.ts`
- Modify: `packages/dashboard/src/index.ts:62` (update import path)

- [ ] **Step 1: Rename the file**

```bash
cd /home/nina/my_agent
mv packages/dashboard/src/mcp/task-revision-server.ts packages/dashboard/src/mcp/task-tools-server.ts
```

- [ ] **Step 2: Update import in index.ts**

In `packages/dashboard/src/index.ts:62`, change:
```typescript
import { createTaskRevisionServer } from "./mcp/task-revision-server.js";
```
To:
```typescript
import { createTaskToolsServer } from "./mcp/task-tools-server.js";
```

Also update the function call at line ~771:
```typescript
const taskToolsServer = createTaskToolsServer({
```

And the addMcpServer call:
```typescript
addMcpServer("task-tools", taskToolsServer);
```

- [ ] **Step 3: Rename the exported function in task-tools-server.ts**

Change `createTaskRevisionServer` → `createTaskToolsServer` and `name: "task-revision"` → `name: "task-tools"`.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /home/nina/my_agent/packages/dashboard && npx -p typescript tsc --noEmit`

- [ ] **Step 5: Run tests**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/mcp/`
Expected: All existing tests pass (update import paths in test files if needed)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: rename task-revision-server to task-tools-server"
```

---

### Task 2: Add `create_task` MCP Tool

Add the `create_task` tool to the task-tools server. This is how conversation Nina delegates work.

**Files:**
- Modify: `packages/dashboard/src/mcp/task-tools-server.ts`
- Modify: `packages/dashboard/src/mcp/task-tools-server.ts` (deps interface — add conversationManager)
- Modify: `packages/dashboard/src/index.ts` (pass conversationManager to deps)
- Test: `packages/dashboard/tests/mcp/create-task.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/dashboard/tests/mcp/create-task.test.ts
import { describe, it, expect, vi } from "vitest";
import { createTaskToolsServer } from "../../src/mcp/task-tools-server.js";

describe("create_task MCP tool", () => {
  function makeDeps() {
    const created: any[] = [];
    const linked: any[] = [];
    const triggered: any[] = [];
    return {
      deps: {
        taskManager: {
          create: vi.fn((input: any) => {
            const task = { id: "task-test-001", ...input, status: "pending" };
            created.push(task);
            return task;
          }),
          findById: vi.fn(),
          update: vi.fn(),
          linkTaskToConversation: vi.fn((taskId: string, convId: string) => {
            linked.push({ taskId, convId });
          }),
        },
        taskProcessor: {
          onTaskCreated: vi.fn((task: any) => triggered.push(task)),
        },
      },
      created,
      linked,
      triggered,
    };
  }

  it("creates an immediate task and triggers execution", async () => {
    const { deps, created, linked, triggered } = makeDeps();
    const server = createTaskToolsServer(deps as any);
    // Extract the create_task tool handler from the server
    // We test via the server's tool list
    expect(created.length).toBe(0); // baseline
    // Direct tool invocation would require MCP protocol — test the handler logic separately
  });

  // Additional tests for:
  // - scheduled task (no trigger, has scheduledFor)
  // - missing title returns error
  // - conversation linking
  // - notifyOnCompletion passthrough
});
```

Note: MCP tools are hard to unit test directly because they go through the SDK server protocol. The tests should mock the deps and call the handler functions extracted into testable units. Read the existing `tests/mcp/task-revision-server.test.ts` to see the pattern used there, and follow it.

- [ ] **Step 2: Extend the deps interface**

In `packages/dashboard/src/mcp/task-tools-server.ts`, update the interface:

```typescript
export interface TaskToolsServerDeps {
  taskManager: TaskManager;
  taskProcessor: TaskProcessor;
}
```

No change needed — `taskManager` already has `create()` and `linkTaskToConversation()`.

- [ ] **Step 3: Add the create_task tool definition**

In `task-tools-server.ts`, add before the `return createSdkMcpServer(...)` call:

```typescript
const createTaskTool = tool(
  "create_task",
  "Create a background task for a working agent. Use when the user requests research, comparison, scripting, browser automation, or any multi-step work. Include ALL context in instructions — the working agent cannot see this conversation.",
  {
    title: z.string().describe("Short descriptive title"),
    instructions: z.string().describe("Self-contained instructions with full context"),
    work: z.array(z.object({ description: z.string() })).optional()
      .describe("Work items to complete"),
    type: z.enum(["immediate", "scheduled"]).describe("immediate = now, scheduled = later"),
    conversationId: z.string().describe("Conversation ID from [Session Context] in your system prompt"),
    scheduledFor: z.string().optional()
      .describe("ISO datetime in UTC for scheduled tasks"),
    notifyOnCompletion: z.enum(["immediate", "debrief", "none"]).optional()
      .describe("How to notify when complete (default: immediate)"),
    model: z.string().optional()
      .describe("Override model (e.g. 'claude-opus-4-6')"),
  },
  async (args) => {
    try {
      const task = deps.taskManager.create({
        type: args.type,
        sourceType: "conversation",
        title: args.title,
        instructions: args.instructions,
        work: args.work,
        notifyOnCompletion: args.notifyOnCompletion ?? "immediate",
        model: args.model,
        scheduledFor: args.scheduledFor ? new Date(args.scheduledFor) : undefined,
        createdBy: "agent",
      });

      deps.taskManager.linkTaskToConversation(task.id, args.conversationId);

      if (args.type === "immediate") {
        deps.taskProcessor.onTaskCreated(task);
      }

      return {
        content: [{
          type: "text" as const,
          text: `Task created: "${task.title}" (ID: ${task.id}). ${args.type === "immediate" ? "Executing now — I'll let you know when it's done." : `Scheduled for ${args.scheduledFor}.`}`,
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: "text" as const,
          text: `Failed to create task: ${err instanceof Error ? err.message : "Unknown error"}`,
        }],
        isError: true,
      };
    }
  },
);
```

- [ ] **Step 4: Register in createSdkMcpServer**

Update the `return createSdkMcpServer(...)` call to include the new tool:

```typescript
return createSdkMcpServer({
  name: "task-tools",
  tools: [reviseTaskTool, createTaskTool],
});
```

- [ ] **Step 5: Run tests**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/mcp/`
Expected: All PASS

- [ ] **Step 6: TypeScript check**

Run: `cd /home/nina/my_agent/packages/dashboard && npx -p typescript tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/mcp/task-tools-server.ts packages/dashboard/tests/mcp/
git commit -m "feat: create_task MCP tool for conversation Nina"
```

---

### Task 3: Add `update_property` MCP Tool

Add `update_property` to the same task-tools server.

**Files:**
- Modify: `packages/dashboard/src/mcp/task-tools-server.ts`
- Modify: `packages/dashboard/src/mcp/task-tools-server.ts` (deps — add agentDir)
- Modify: `packages/dashboard/src/index.ts` (pass agentDir)
- Test: `packages/dashboard/tests/mcp/update-property.test.ts`

- [ ] **Step 1: Write failing tests**

Test that the tool calls `updateProperty()` with the correct args and writes to status.yaml.

- [ ] **Step 2: Add agentDir to deps interface**

```typescript
export interface TaskToolsServerDeps {
  taskManager: TaskManager;
  taskProcessor: TaskProcessor;
  agentDir: string;  // NEW — for property updates
}
```

Update `index.ts` to pass `agentDir` when creating the server.

- [ ] **Step 3: Add the update_property tool**

```typescript
import { updateProperty } from "../conversations/properties.js";

const updatePropertyTool = tool(
  "update_property",
  "Update a dynamic property (location, timezone, availability). Call immediately when the user shares changes to these. Properties feed into task scheduling and working agent context.",
  {
    key: z.string().describe("Property key: location, timezone, or availability"),
    value: z.string().describe("The new value"),
    confidence: z.enum(["high", "medium", "low"]).describe("How confident you are"),
    source: z.string().default("conversation").describe("How you learned this"),
  },
  async (args) => {
    try {
      await updateProperty(deps.agentDir, args.key, {
        value: args.value,
        confidence: args.confidence,
        source: args.source,
      });
      return {
        content: [{ type: "text" as const, text: `Updated ${args.key} to "${args.value}"` }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Failed to update property: ${err instanceof Error ? err.message : "Unknown error"}` }],
        isError: true,
      };
    }
  },
);
```

- [ ] **Step 4: Register in createSdkMcpServer**

```typescript
tools: [reviseTaskTool, createTaskTool, updatePropertyTool],
```

- [ ] **Step 5: Run tests**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/mcp/`

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/mcp/task-tools-server.ts packages/dashboard/tests/mcp/ packages/dashboard/src/index.ts
git commit -m "feat: update_property MCP tool for immediate property updates"
```

---

### Task 4: Restrict Conversation Nina's Tools

Remove power tools from conversation Nina. Keep only WebSearch + WebFetch.

**Files:**
- Modify: `packages/dashboard/src/agent/session-manager.ts:307-316` (add tools to opts)

- [ ] **Step 1: Add tools restriction to buildQuery()**

In `packages/dashboard/src/agent/session-manager.ts`, in the `buildQuery()` method (line ~309), add `tools` to the opts:

```typescript
const opts: BrainSessionOptions = {
  model,
  systemPrompt,
  tools: ["WebSearch", "WebFetch"],  // Conversation Nina: no power tools
  includePartialMessages: true,
  reasoning,
  hooks: this.hooks ?? undefined,
  mcpServers: sharedMcpServers ?? undefined,
};
```

- [ ] **Step 2: Remove Playwright MCP from conversation Nina**

In `session-manager.ts`, find where the Playwright MCP server is registered in `initMcpServers()` (line ~113-118). The Playwright server is added to `sharedMcpServers` which is used by BOTH conversation Nina and working Nina.

Since working Nina needs Playwright but conversation Nina doesn't, we have two options:
- A: Keep Playwright in shared servers (it's auto-deferred anyway, minimal cost)
- B: Remove from shared, add only to task executor config

**Choose A** — Playwright tools are MCP tools, so they're auto-deferred. Conversation Nina will never discover them via ToolSearch because she has no use case that triggers it. The standing orders + lack of power tools make it irrelevant. No code change needed here.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /home/nina/my_agent/packages/dashboard && npx -p typescript tsc --noEmit`

- [ ] **Step 4: Run all tests**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/agent/session-manager.ts
git commit -m "feat: restrict conversation Nina to WebSearch + WebFetch only"
```

---

### Task 5: Convert Post-Response Hook to Missed Task Detector

Change from auto-creating tasks to detection-only (log + notify).

**Files:**
- Modify: `packages/dashboard/src/conversations/post-response-hooks.ts`
- Test: `packages/dashboard/tests/conversations/missed-task-detector.test.ts`

- [ ] **Step 1: Write failing tests**

Test that the hook:
- Detects a task-worthy message that Nina didn't create a task for → logs warning
- Does NOT create a task (no `taskManager.create()` call)
- Skips detection when Nina already created a task for the conversation

- [ ] **Step 2: Refactor extractTasks() to detectMissedTasks()**

In `post-response-hooks.ts`, rename `extractTasks` to `detectMissedTasks`. Change the logic:

```typescript
private async detectMissedTasks(
  conversationId: string,
  userContent: string,
  assistantContent: string,
): Promise<void> {
  try {
    const result = await extractTaskFromMessage(userContent, assistantContent);
    if (!result.shouldCreateTask) return;

    // Check if Nina already created tasks for this conversation
    const existingTasks = this.deps.taskManager.getTasksForConversation(conversationId);
    const recentTasks = existingTasks.filter(
      (t) => Date.now() - t.linkedAt.getTime() < 300_000, // within last 5 minutes
    );

    if (recentTasks.length > 0) return; // Nina handled it

    // Nina missed it — log warning
    const title = result.task?.title ?? result.tasks?.[0]?.title ?? "unknown";
    this.deps.log(
      `[MissedTaskDetector] Potential missed task: "${title}" in conversation ${conversationId}`,
    );
  } catch {
    // Non-fatal — detection is best-effort
  }
}
```

Note: `task-extractor.ts` itself needs no changes — its `extractTaskFromMessage()` function is reused as-is for detection. Only the caller (`post-response-hooks.ts`) changes behavior.

- [ ] **Step 2b: Clean up PostResponseHooksDeps interface**

Remove `broadcastToConversation` and `publishTasks` from the deps interface — they're no longer used since the hook doesn't create tasks.

- [ ] **Step 3: Update run() to call detectMissedTasks()**

```typescript
async run(conversationId: string, userContent: string, assistantContent: string): Promise<void> {
  await this.detectMissedTasks(conversationId, userContent, assistantContent);
}
```

- [ ] **Step 4: Run tests**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/conversations/`

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/conversations/post-response-hooks.ts packages/dashboard/tests/conversations/
git commit -m "refactor: convert post-response hook to missed task detector"
```

---

### Task 6: Update Standing Orders

Add task delegation guidance to conversation Nina's operational instructions.

**Files:**
- Modify: `.my_agent/notebook/reference/standing-orders.md`

- [ ] **Step 1: Replace the existing "Task Follow-ups" section with comprehensive delegation guidance**

Replace the current "Task Follow-ups" section in standing-orders.md with:

```markdown
## Task Delegation

You do not have Bash, file editing, or browser tools. For anything beyond a quick WebSearch:
- Use `create_task` to delegate to a working agent
- Include ALL relevant context in the instructions — the working agent cannot see this conversation
- You can ask clarifying questions before creating a task
- Convert relative times ("in 30 minutes", "at 2pm") to absolute UTC in scheduledFor
- When the user mentions a location, timezone, or availability change, call `update_property` immediately

### When to use WebSearch vs create_task
- WebSearch: single factual question, one search, instant answer
- create_task: research, comparison, multi-step work, file creation, browser automation, scripting

### Task corrections
- When the user asks for changes to task results, use `revise_task` with the task ID and correction instructions
- If you don't know the task ID, use `search_tasks` to find it by description
- For simple factual questions about results you can see in the conversation, answer directly
```

- [ ] **Step 2: This is a private file (.my_agent/), no git commit needed**

The file is gitignored. No commit.

---

### Phase 1 E2E Test

At this point, restart the dashboard and test:

- [ ] **Step 7: Restart dashboard**

```bash
systemctl --user restart nina-dashboard.service
```

- [ ] **Step 8: Test via WhatsApp or dashboard**

Send a message that requires research (e.g., "Find the best Thai restaurants near Nimman"). Verify:
1. Conversation Nina says "On it!" or similar (no research attempt)
2. A task is created (check logs)
3. Working Nina executes the task
4. Results are delivered back to the conversation
5. User can request corrections

---

## Phase 2: Task Discovery (Tasks 7–9)

### Task 7: TaskSearchService — Hybrid FTS5 + Vector Search

Create the search infrastructure for finding tasks by meaning.

**Files:**
- Create: `packages/dashboard/src/tasks/task-search-service.ts`
- Modify: `packages/dashboard/src/conversations/db.ts` (add tables)
- Test: `packages/dashboard/tests/tasks/task-search-service.test.ts`

- [ ] **Step 1: Add DB tables**

Note: Tasks and conversations share the same SQLite database (`agent.db`), so task search tables go in the same `conversations/db.ts` migration block. This is consistent with the existing `tasks` table which is also defined there.

In `packages/dashboard/src/conversations/db.ts`, in the migrations section (after the `model` column migration), add:

```typescript
// M6.9-S5: Task search tables
this.db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(task_id, content);
`);

this.db.exec(`
  CREATE TABLE IF NOT EXISTS task_embedding_map (
    vec_rowid INTEGER PRIMARY KEY,
    task_id TEXT NOT NULL
  );
`);

// tasks_vec created dynamically by TaskSearchService when embedding dimensions are known
```

- [ ] **Step 2: Write failing tests**

Follow the pattern from `packages/dashboard/src/conversations/search-service.ts`. Test:
- `indexTask(task)` — inserts into FTS5 and (if embeddings available) vector table
- `search(query)` — returns matching tasks ranked by RRF score
- FTS5-only fallback when embeddings unavailable
- Status filtering ("completed" vs "all")

- [ ] **Step 3: Implement TaskSearchService**

```typescript
// packages/dashboard/src/tasks/task-search-service.ts
// Mirror ConversationSearchService pattern:
// - constructor takes db + embeddingsPlugin
// - indexTask(task) embeds title + instructions, inserts FTS5 + vector
// - search(query, options) does hybrid FTS5 + vector with RRF (K=60)
// - Graceful fallback to FTS5-only when embeddings unavailable
```

Key methods:
- `indexTask(task: { id, title, instructions })` — fire-and-forget
- `search(query: string, options?: { status?: string, limit?: number })` → `TaskSearchResult[]`
- `isSemanticAvailable()` — checks embedding plugin readiness

- [ ] **Step 4: Wire indexing in TaskManager**

When a task is created via `TaskManager.create()`, call `taskSearchService.indexTask(task)` (fire-and-forget, async, never blocks).

- [ ] **Step 5: Wire in index.ts**

Create `TaskSearchService` after `searchService` is initialized (it needs the same `embeddingsPlugin`). Pass to task-tools server deps.

- [ ] **Step 6: Run tests**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/tasks/task-search-service.test.ts`

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/tasks/task-search-service.ts packages/dashboard/tests/tasks/ packages/dashboard/src/conversations/db.ts packages/dashboard/src/tasks/task-manager.ts packages/dashboard/src/index.ts
git commit -m "feat: TaskSearchService with hybrid FTS5+vector search"
```

---

### Task 8: Add `search_tasks` MCP Tool

Wire the search service into the MCP tools server.

**Files:**
- Modify: `packages/dashboard/src/mcp/task-tools-server.ts`
- Modify: `packages/dashboard/src/mcp/task-tools-server.ts` (deps — add taskSearchService)
- Test: `packages/dashboard/tests/mcp/search-tasks.test.ts`

- [ ] **Step 1: Add taskSearchService to deps**

```typescript
export interface TaskToolsServerDeps {
  taskManager: TaskManager;
  taskProcessor: TaskProcessor;
  agentDir: string;
  taskSearchService?: TaskSearchService;  // Optional — may not be initialized yet
}
```

- [ ] **Step 2: Add the search_tasks tool**

```typescript
const searchTasksTool = tool(
  "search_tasks",
  "Search past tasks by meaning. Use when the user refers to a previous task ('that flights research', 'the co-working comparison'). Returns matching tasks with IDs for use with revise_task.",
  {
    query: z.string().describe("Natural language search query"),
    status: z.enum(["completed", "failed", "all"]).optional()
      .describe("Filter by status (default: completed)"),
    limit: z.number().optional().describe("Max results (default: 5)"),
  },
  async (args) => {
    if (!deps.taskSearchService) {
      return {
        content: [{ type: "text" as const, text: "Task search is not available yet." }],
        isError: true,
      };
    }

    try {
      const results = await deps.taskSearchService.search(args.query, {
        status: args.status ?? "completed",
        limit: args.limit ?? 5,
      });

      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No matching tasks found." }],
        };
      }

      const formatted = results.map(
        (r) => `- "${r.title}" (ID: ${r.id}) — ${r.status}, ${r.completedAt ?? r.created}`,
      ).join("\n");

      return {
        content: [{ type: "text" as const, text: `Found ${results.length} task(s):\n${formatted}` }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Search failed: ${err instanceof Error ? err.message : "Unknown error"}` }],
        isError: true,
      };
    }
  },
);
```

- [ ] **Step 3: Register in createSdkMcpServer**

```typescript
tools: [reviseTaskTool, createTaskTool, updatePropertyTool, searchTasksTool],
```

- [ ] **Step 4: Run tests**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/mcp/`

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/mcp/task-tools-server.ts packages/dashboard/tests/mcp/ packages/dashboard/src/index.ts
git commit -m "feat: search_tasks MCP tool with semantic search"
```

---

### Task 9: WebUI Task Context

Add task awareness to the dashboard so conversation Nina knows when the user is viewing a task.

**Files:**
- Modify: `packages/dashboard/src/ws/protocol.ts:73-79` (ViewContext type)
- Modify: `packages/dashboard/src/ws/chat-handler.ts:826-830` (context injection)
- Modify: `packages/dashboard/public/js/app.js` (set taskId in chatContext)
- Modify: `packages/dashboard/src/agent/system-prompt-builder.ts` (or chat-handler — inject task context)

- [ ] **Step 1: Add "task" to ViewContext**

In `packages/dashboard/src/ws/protocol.ts:73-79`:

```typescript
export interface ViewContext {
  type: "notebook" | "conversation" | "settings" | "task";  // Add "task"
  title: string;
  icon?: string;
  file?: string;
  conversationId?: string;
  taskId?: string;  // NEW
}
```

- [ ] **Step 2: Inject task context in chat handler**

In `packages/dashboard/src/ws/chat-handler.ts`, after the existing context logging (line ~826-830), add:

```typescript
if (context?.type === "task" && context.taskId) {
  // Inject task context into the next system prompt build
  // The SessionManager will include this in the prompt
  sessionManager.setTaskContext(context.taskId, context.title);
}
```

This requires adding a `setTaskContext()` method to SessionManager that stores the active task info and includes it in the next `buildQuery()` call as part of `buildContext`.

- [ ] **Step 3: Add setTaskContext to SessionManager**

In `packages/dashboard/src/agent/session-manager.ts`:

```typescript
private activeTaskContext: { taskId: string; title: string } | null = null;

setTaskContext(taskId: string, title: string): void {
  this.activeTaskContext = { taskId, title };
}
```

Then in `buildQuery()`, add to `buildContext`:

```typescript
const buildContext: BuildContext = {
  channel: this.channel,
  conversationId: this.conversationId,
  messageIndex: this.messageIndex,
  activeWorkingAgents,
  activeTaskContext: this.activeTaskContext,  // NEW
};
// Clear after use — only applies to this message
this.activeTaskContext = null;
```

- [ ] **Step 4: Add activeTaskContext to BuildContext and SystemPromptBuilder**

In `system-prompt-builder.ts`, extend `BuildContext`:

```typescript
export interface BuildContext {
  // ... existing fields
  activeTaskContext?: { taskId: string; title: string } | null;
}
```

In the `build()` method, add after the active working agents block:

```typescript
if (context.activeTaskContext) {
  dynamicParts.push(
    `[Active Task View]\nThe user is currently viewing task: "${context.activeTaskContext.title}" (${context.activeTaskContext.taskId})\nIf they ask about "this task" or request changes, use revise_task with this task ID.\n[End Active Task View]`,
  );
}
```

- [ ] **Step 5: Update frontend to set taskId in chatContext**

In `packages/dashboard/public/js/app.js`, find where task views/popovers are rendered. When a task is displayed, set:

```javascript
chatContext = { type: "task", title: task.title, taskId: task.id };
```

This requires reading the frontend code to find the exact location. Look for task detail rendering, task popovers, or task tab components.

- [ ] **Step 6: TypeScript check + run tests**

Run: `cd /home/nina/my_agent/packages/dashboard && npx -p typescript tsc --noEmit && npx vitest run`

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/ws/protocol.ts packages/dashboard/src/ws/chat-handler.ts packages/dashboard/src/agent/session-manager.ts packages/dashboard/src/agent/system-prompt-builder.ts packages/dashboard/public/js/app.js
git commit -m "feat: WebUI task context — Nina knows which task the user is viewing"
```

---

### Phase 2 E2E Test

- [ ] **Step 8: Restart dashboard**

```bash
systemctl --user restart nina-dashboard.service
```

- [ ] **Step 9: Test search_tasks flow**

Via WhatsApp or dashboard: "Remember that co-working research?" Verify Nina uses `search_tasks`, finds the task, and offers to revise it.

- [ ] **Step 10: Test WebUI task context**

Open a task in the dashboard, type "update this with newer data." Verify Nina uses `revise_task` with the correct task ID.

---

## Dependency Graph

```
Task 1 (rename server)       ─→ Tasks 2, 3, 8
Task 2 (create_task)          ─→ Task 4 (enables tool restriction)
Task 3 (update_property)      ─→ Task 6 (standing orders reference it)
Task 4 (restrict tools)       ─→ Task 5 (hook becomes safety net)
Task 5 (missed task detector) ─→ Phase 1 E2E
Task 6 (standing orders)      ─→ Phase 1 E2E

Task 7 (TaskSearchService)    ─→ Task 8 (wired into MCP)
Task 8 (search_tasks tool)    ─→ Phase 2 E2E
Task 9 (WebUI task context)   ─→ Phase 2 E2E
```

**Phase 1 (Tasks 1–6):** Core behavior change. Can be tested independently.
**Phase 2 (Tasks 7–9):** Discovery enhancements. Build on Phase 1.

**Parallelizable within Phase 1:** Tasks 2 + 3 can run in parallel. Task 4 depends on 2. Task 5 depends on 4.
**Parallelizable within Phase 2:** Tasks 7, 8, 9 are sequential (7→8, 9 independent).
