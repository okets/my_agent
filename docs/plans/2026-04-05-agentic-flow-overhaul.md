# M9.1: Agentic Flow Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Nina's agentic flow so she follows orders, delegates reliably, and communicates status — addressing all 12 systemic issues from M9-S8.

**Architecture:** Six interconnected systems built incrementally: (1) universal todo MCP server, (2) static templates + validation for worker compliance, (3) heartbeat monitoring for job health + notification delivery, (4) enforcement hooks for routing + self-harm prevention, (5) system prompt enrichment for status communication, (6) restart recovery for interrupted work.

**Tech Stack:** TypeScript, Agent SDK (`createSdkMcpServer`, `tool()`, hooks, `resume`), Node.js `fs` (atomic writes), `setInterval` (heartbeat).

**Design spec:** `docs/design/agentic-flow-overhaul.md`

---

## Sprint 1: Todo System + MCP Server

**Goal:** Every agent session has a persistent todo list. Items can be added, updated, removed. Mandatory items can't be removed. `interrupted` job status available system-wide.

### Task 1.1: Add `interrupted` to JobStatus + TodoItem type

**Files:**
- Modify: `packages/core/src/spaces/automation-types.ts:60` (JobStatus type)
- Create: `packages/core/src/spaces/todo-types.ts`

- [ ] **Step 1: Add `interrupted` to JobStatus**

In `packages/core/src/spaces/automation-types.ts`, line 60:

```typescript
// Before:
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'needs_review'

// After:
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'needs_review' | 'interrupted'
```

- [ ] **Step 2: Create TodoItem types**

Create `packages/core/src/spaces/todo-types.ts`:

```typescript
export type TodoStatus = 'pending' | 'in_progress' | 'done' | 'blocked';
export type TodoCreator = 'agent' | 'framework' | 'delegator';

export interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
  mandatory: boolean;
  validation?: string;
  validation_attempts?: number;
  notes?: string;
  created_by: TodoCreator;
}

export interface TodoFile {
  items: TodoItem[];
  last_activity: string; // ISO timestamp, updated on every tool call
}

export interface TodoTemplate {
  items: Array<{
    text: string;
    mandatory: boolean;
    validation?: string;
  }>;
}

export interface ValidationResult {
  pass: boolean;
  message?: string;
}
```

- [ ] **Step 3: Export from index**

Add to `packages/core/src/spaces/automation-types.ts` barrel export (or create index if needed):

```typescript
export * from './todo-types.js';
```

- [ ] **Step 4: Fix all status filter locations**

Search the codebase for all places that filter/switch on `JobStatus`. Update each to handle `'interrupted'`:

- `automation-job-service.ts` — `listJobs()` filter: `interrupted` should be returned in active queries
- `automation-scheduler.ts` — `checkStaleJobs()`: skip `interrupted` jobs (they're already handled)
- `automation-server.ts` — `check_job_status`: include `interrupted` jobs in the active section
- `automation-processor.ts` — job event emission: add `'job:interrupted'` event name
- `app.ts` — `setRunningTasksChecker`: include `interrupted` in the display with "(interrupted)" label

- [ ] **Step 5: Commit**

```
git add packages/core/src/spaces/automation-types.ts packages/core/src/spaces/todo-types.ts
git commit -m "feat(m9.1-s1): add interrupted job status + TodoItem types"
```

---

### Task 1.2: Todo file I/O utilities

**Files:**
- Create: `packages/dashboard/src/automations/todo-file.ts`
- Create: `packages/dashboard/src/automations/__tests__/todo-file.test.ts`

- [ ] **Step 1: Write failing tests for todo file I/O**

Create `packages/dashboard/src/automations/__tests__/todo-file.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readTodoFile, writeTodoFile, createEmptyTodoFile } from '../todo-file.js';
import type { TodoFile, TodoItem } from '@my-agent/core/spaces/todo-types';

describe('todo-file', () => {
  let tmpDir: string;
  let todoPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-test-'));
    todoPath = path.join(tmpDir, 'todos.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('createEmptyTodoFile writes valid empty file', () => {
    createEmptyTodoFile(todoPath);
    const data = readTodoFile(todoPath);
    expect(data.items).toEqual([]);
    expect(data.last_activity).toBeDefined();
  });

  it('writeTodoFile uses atomic write (temp + rename)', () => {
    createEmptyTodoFile(todoPath);
    const file: TodoFile = {
      items: [{ id: 't1', text: 'Test', status: 'pending', mandatory: false, created_by: 'agent' }],
      last_activity: new Date().toISOString(),
    };
    writeTodoFile(todoPath, file);
    // No .tmp file should remain
    const files = fs.readdirSync(tmpDir);
    expect(files).toEqual(['todos.json']);
    const read = readTodoFile(todoPath);
    expect(read.items).toHaveLength(1);
    expect(read.items[0].text).toBe('Test');
  });

  it('readTodoFile returns empty file for missing path', () => {
    const data = readTodoFile(path.join(tmpDir, 'nonexistent.json'));
    expect(data.items).toEqual([]);
  });

  it('writeTodoFile updates last_activity', () => {
    createEmptyTodoFile(todoPath);
    const before = readTodoFile(todoPath).last_activity;
    // Small delay to ensure different timestamp
    const file: TodoFile = {
      items: [],
      last_activity: new Date(Date.now() + 1000).toISOString(),
    };
    writeTodoFile(todoPath, file);
    const after = readTodoFile(todoPath).last_activity;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/dashboard && npx vitest run src/automations/__tests__/todo-file.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement todo-file.ts**

Create `packages/dashboard/src/automations/todo-file.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { TodoFile } from '@my-agent/core/spaces/todo-types';

export function createEmptyTodoFile(filePath: string): void {
  const data: TodoFile = {
    items: [],
    last_activity: new Date().toISOString(),
  };
  writeTodoFile(filePath, data);
}

export function readTodoFile(filePath: string): TodoFile {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as TodoFile;
  } catch {
    return { items: [], last_activity: new Date().toISOString() };
  }
}

export function writeTodoFile(filePath: string, data: TodoFile): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export function touchActivity(filePath: string): void {
  const data = readTodoFile(filePath);
  data.last_activity = new Date().toISOString();
  writeTodoFile(filePath, data);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run src/automations/__tests__/todo-file.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```
git add packages/dashboard/src/automations/todo-file.ts packages/dashboard/src/automations/__tests__/todo-file.test.ts
git commit -m "feat(m9.1-s1): todo file I/O with atomic writes"
```

---

### Task 1.3: Todo MCP server

**Files:**
- Create: `packages/dashboard/src/mcp/todo-server.ts`
- Create: `packages/dashboard/src/mcp/__tests__/todo-server.test.ts`

- [ ] **Step 1: Write failing tests for todo MCP tools**

Create `packages/dashboard/src/mcp/__tests__/todo-server.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createTodoTools } from '../todo-server.js';
import { readTodoFile, createEmptyTodoFile } from '../../automations/todo-file.js';

describe('todo-server tools', () => {
  let tmpDir: string;
  let todoPath: string;
  let tools: ReturnType<typeof createTodoTools>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-mcp-'));
    todoPath = path.join(tmpDir, 'todos.json');
    createEmptyTodoFile(todoPath);
    tools = createTodoTools(todoPath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('todo_add creates an agent item', async () => {
    const result = await tools.todo_add({ text: 'Do something' });
    expect(result.isError).toBeUndefined();
    const file = readTodoFile(todoPath);
    expect(file.items).toHaveLength(1);
    expect(file.items[0].text).toBe('Do something');
    expect(file.items[0].mandatory).toBe(false);
    expect(file.items[0].created_by).toBe('agent');
  });

  it('todo_list returns all items', async () => {
    await tools.todo_add({ text: 'Item 1' });
    await tools.todo_add({ text: 'Item 2' });
    const result = await tools.todo_list({});
    expect(result.content).toBeDefined();
    // Content should mention both items
    const text = result.content[0].text;
    expect(text).toContain('Item 1');
    expect(text).toContain('Item 2');
  });

  it('todo_update changes status', async () => {
    await tools.todo_add({ text: 'Task' });
    const items = readTodoFile(todoPath).items;
    await tools.todo_update({ id: items[0].id, status: 'done' });
    const updated = readTodoFile(todoPath).items[0];
    expect(updated.status).toBe('done');
  });

  it('todo_remove deletes non-mandatory item', async () => {
    await tools.todo_add({ text: 'Removable' });
    const items = readTodoFile(todoPath).items;
    await tools.todo_remove({ id: items[0].id });
    expect(readTodoFile(todoPath).items).toHaveLength(0);
  });

  it('todo_remove rejects mandatory item with isError', async () => {
    // Pre-populate with mandatory item
    const file = readTodoFile(todoPath);
    file.items.push({
      id: 't1', text: 'Required', status: 'pending',
      mandatory: true, created_by: 'framework',
    });
    const { writeTodoFile } = await import('../../automations/todo-file.js');
    writeTodoFile(todoPath, file);

    const result = await tools.todo_remove({ id: 't1' });
    expect(result.isError).toBe(true);
    expect(readTodoFile(todoPath).items).toHaveLength(1);
  });

  it('every tool call updates last_activity', async () => {
    const before = readTodoFile(todoPath).last_activity;
    await new Promise(r => setTimeout(r, 10));
    await tools.todo_list({});
    const after = readTodoFile(todoPath).last_activity;
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/dashboard && npx vitest run src/mcp/__tests__/todo-server.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement todo-server.ts**

Create `packages/dashboard/src/mcp/todo-server.ts`:

```typescript
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { readTodoFile, writeTodoFile } from '../automations/todo-file.js';
import type { TodoItem, TodoFile } from '@my-agent/core/spaces/todo-types';

// Tool handler functions (testable independently of MCP server)
export function createTodoTools(todoPath: string) {
  let nextId = 1;

  function touch(file: TodoFile): TodoFile {
    file.last_activity = new Date().toISOString();
    return file;
  }

  return {
    async todo_list(_args: Record<string, unknown>) {
      const file = readTodoFile(todoPath);
      touch(file);
      writeTodoFile(todoPath, file);

      if (file.items.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No todo items.' }] };
      }

      const lines = file.items.map((item) => {
        const icon = item.status === 'done' ? '✓' :
                     item.status === 'in_progress' ? '▶' :
                     item.status === 'blocked' ? '✗' : '☐';
        const tag = item.mandatory ? ' [mandatory]' : '';
        const notes = item.notes ? ` — ${item.notes}` : '';
        return `${icon} ${item.id}: ${item.text}${tag}${notes}`;
      });

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },

    async todo_add(args: { text: string }) {
      const file = readTodoFile(todoPath);
      // Find next available ID
      const existingIds = file.items.map(i => parseInt(i.id.replace('t', ''), 10)).filter(n => !isNaN(n));
      nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;

      const item: TodoItem = {
        id: `t${nextId}`,
        text: args.text,
        status: 'pending',
        mandatory: false,
        created_by: 'agent',
      };
      file.items.push(item);
      touch(file);
      writeTodoFile(todoPath, file);

      return { content: [{ type: 'text' as const, text: `Added: ${item.id} — ${item.text}` }] };
    },

    async todo_update(args: { id: string; status?: string; notes?: string }) {
      const file = readTodoFile(todoPath);
      const item = file.items.find(i => i.id === args.id);
      if (!item) {
        return { content: [{ type: 'text' as const, text: `Item ${args.id} not found.` }], isError: true };
      }

      if (args.status) item.status = args.status as TodoItem['status'];
      if (args.notes !== undefined) item.notes = args.notes;
      touch(file);
      writeTodoFile(todoPath, file);

      return { content: [{ type: 'text' as const, text: `Updated ${item.id}: status=${item.status}` }] };
    },

    async todo_remove(args: { id: string }) {
      const file = readTodoFile(todoPath);
      const idx = file.items.findIndex(i => i.id === args.id);
      if (idx === -1) {
        return { content: [{ type: 'text' as const, text: `Item ${args.id} not found.` }], isError: true };
      }
      if (file.items[idx].mandatory) {
        return {
          content: [{ type: 'text' as const, text: `Cannot remove mandatory item ${args.id}: "${file.items[idx].text}". This item is required by the framework.` }],
          isError: true,
        };
      }
      file.items.splice(idx, 1);
      touch(file);
      writeTodoFile(todoPath, file);

      return { content: [{ type: 'text' as const, text: `Removed ${args.id}.` }] };
    },
  };
}

// MCP server factory — creates a new server instance per job/conversation
export function createTodoServer(todoPath: string) {
  const tools = createTodoTools(todoPath);

  return createSdkMcpServer({
    name: 'todo',
    tools: [
      tool(
        'todo_list',
        'Show all todo items with their status. Call this first to see your assignment.',
        z.object({}),
        async () => tools.todo_list({}),
      ),
      tool(
        'todo_add',
        'Add a new todo item. Use this to plan your own sub-tasks. Cannot add mandatory items.',
        z.object({ text: z.string().describe('Description of the task') }),
        async (args) => tools.todo_add(args),
      ),
      tool(
        'todo_update',
        'Update a todo item status or add notes. Use status: done when a task is complete, in_progress when starting, blocked if stuck.',
        z.object({
          id: z.string().describe('Item ID (e.g., "t1")'),
          status: z.enum(['pending', 'in_progress', 'done', 'blocked']).optional(),
          notes: z.string().optional().describe('Optional notes about progress or blockers'),
        }),
        async (args) => tools.todo_update(args),
      ),
      tool(
        'todo_remove',
        'Remove a todo item. Fails on mandatory items — these are required by the framework.',
        z.object({ id: z.string().describe('Item ID to remove') }),
        async (args) => tools.todo_remove(args),
      ),
    ],
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run src/mcp/__tests__/todo-server.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```
git add packages/dashboard/src/mcp/todo-server.ts packages/dashboard/src/mcp/__tests__/todo-server.test.ts
git commit -m "feat(m9.1-s1): todo MCP server with 4 tools"
```

---

### Task 1.4: Wire todo server to agent sessions

**Files:**
- Modify: `packages/dashboard/src/automations/automation-executor.ts:228` (add todo MCP to working ninas)
- Modify: `packages/dashboard/src/agent/session-manager.ts:83-128` (add todo MCP to conversation nina)
- Modify: `packages/dashboard/src/app.ts` (create todo server per conversation)

- [ ] **Step 1: Wire todo server into executor for working ninas**

In `automation-executor.ts`, in the `run()` method, before the `createBrainQuery()` call (~line 228):

```typescript
import { createTodoServer } from '../mcp/todo-server.js';
import { createEmptyTodoFile } from './todo-file.js';
import path from 'node:path';

// Inside run(), before createBrainQuery:
const todoPath = path.join(job.run_dir!, 'todos.json');
createEmptyTodoFile(todoPath);
const todoServer = createTodoServer(todoPath);

// Add todoServer to the mcpServers passed to createBrainQuery:
// Find where mcpServers is assembled and add:
mcpServers['todo'] = todoServer;
```

- [ ] **Step 2: Wire todo server into session-manager for conversation nina**

In `session-manager.ts`, in `initMcpServers()` (~line 83):

```typescript
import { createTodoServer } from '../mcp/todo-server.js';
import path from 'node:path';

// Inside initMcpServers() or the MCP setup section:
const conversationTodoPath = path.join(agentDir, 'conversations', conversationId, 'todos.json');
const todoServer = createTodoServer(conversationTodoPath);
// Register: this.mcpServers['todo'] = todoServer;
```

- [ ] **Step 3: Verify wiring by checking MCP server count in logs**

Start the dashboard, open a conversation. Check logs for todo MCP server registration. Send a message and verify the agent can call `todo_list` (it should return "No todo items.").

- [ ] **Step 4: Commit**

```
git add packages/dashboard/src/automations/automation-executor.ts packages/dashboard/src/agent/session-manager.ts
git commit -m "feat(m9.1-s1): wire todo server to all agent sessions"
```

---

### Task 1.5: Acceptance test — todo tools work in a conversation

**Files:**
- Create: `packages/dashboard/tests/integration/todo-acceptance.test.ts`

This test proves the todo system works end-to-end: a mock conversation session has access to todo tools, can create/update/remove items, and `todos.json` is persisted on disk.

- [ ] **Step 1: Write acceptance test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AppHarness } from './app-harness.js';
import { installMockSession } from './mock-session.js';
import { readTodoFile } from '../../src/automations/todo-file.js';

describe('S1 Acceptance: todo tools in conversation', () => {
  let harness: AppHarness;

  beforeAll(async () => {
    harness = await AppHarness.create({ withAutomations: true });
  });

  afterAll(async () => {
    await harness.shutdown();
  });

  it('conversation creates todos.json and todo tools are callable', async () => {
    // Create a conversation
    const conv = await harness.conversations.create();

    // Install mock session that calls todo_add and todo_list
    installMockSession(harness, {
      response: 'I added a task to my list.',
      toolCalls: [
        { name: 'todo_add', input: { text: 'Check user calendar' } },
        { name: 'todo_list', input: {} },
      ],
    });

    // Send a message — triggers the mock session which calls todo tools
    const events = [];
    for await (const event of harness.chat.sendMessage(conv.id, 'Check my calendar', 1)) {
      events.push(event);
    }

    // Verify todos.json exists on disk
    const todoPath = path.join(harness.agentDir, 'conversations', conv.id, 'todos.json');
    expect(fs.existsSync(todoPath)).toBe(true);

    // Verify the todo item was created
    const todoFile = readTodoFile(todoPath);
    expect(todoFile.items.length).toBeGreaterThanOrEqual(1);
    expect(todoFile.items[0].text).toBe('Check user calendar');
    expect(todoFile.items[0].created_by).toBe('agent');
    expect(todoFile.items[0].mandatory).toBe(false);

    // Verify last_activity is recent
    const activityAge = Date.now() - new Date(todoFile.last_activity).getTime();
    expect(activityAge).toBeLessThan(5000);
  });

  it('mandatory items survive removal attempts', async () => {
    const conv = await harness.conversations.create();

    // Pre-populate with a mandatory item
    const todoPath = path.join(harness.agentDir, 'conversations', conv.id, 'todos.json');
    const { writeTodoFile } = await import('../../src/automations/todo-file.js');
    writeTodoFile(todoPath, {
      items: [{
        id: 't1', text: 'Required framework task', status: 'pending',
        mandatory: true, created_by: 'framework',
      }],
      last_activity: new Date().toISOString(),
    });

    // Mock session tries to remove the mandatory item
    installMockSession(harness, {
      response: 'I tried to remove it but was blocked.',
      toolCalls: [
        { name: 'todo_remove', input: { id: 't1' } },
      ],
    });

    for await (const event of harness.chat.sendMessage(conv.id, 'Remove that task', 1)) {
      // consume
    }

    // Verify mandatory item still exists
    const todoFile = readTodoFile(todoPath);
    expect(todoFile.items).toHaveLength(1);
    expect(todoFile.items[0].id).toBe('t1');
  });
});
```

Note: The exact `installMockSession` API may need adapting to support `toolCalls` — check `tests/integration/mock-session.ts` for the current interface and extend if needed. If mock sessions don't support tool call simulation, the test can instead verify the MCP server registration and call the tool handlers directly through the harness.

- [ ] **Step 2: Run the acceptance test**

Run: `cd packages/dashboard && npx vitest run tests/integration/todo-acceptance.test.ts`
Expected: PASS — todos.json created, items persisted, mandatory item protected

- [ ] **Step 3: Commit**

```
git add packages/dashboard/tests/integration/todo-acceptance.test.ts
git commit -m "test(m9.1-s1): acceptance test — todo tools work in conversation"
```

---

### Sprint 1 Validation

**Pass criteria — all must be true:**

1. `npx vitest run` — all new tests pass, no regressions
2. **Acceptance test passes** — `todo-acceptance.test.ts` proves todo tools work in a real conversation flow
3. `todo_remove` on a mandatory item returns an error
4. `interrupted` status is accepted in `listJobs({ status: 'interrupted' })` without type errors
5. `todos.json` files are created in conversation and job directories
6. No `.tmp` files left after writes (atomic write works)

---

## Sprint 2: Todo Templates + Validation

**Goal:** Known job types get pre-populated mandatory checklists. Validators check the work. Jobs can't close with incomplete mandatory items.

### Task 2.1: Todo templates + validation registry

**Files:**
- Create: `packages/dashboard/src/automations/todo-templates.ts`
- Create: `packages/dashboard/src/automations/todo-validators.ts`
- Create: `packages/dashboard/src/automations/__tests__/todo-templates.test.ts`
- Create: `packages/dashboard/src/automations/__tests__/todo-validators.test.ts`

- [ ] **Step 1: Write tests for templates**

```typescript
// __tests__/todo-templates.test.ts
import { describe, it, expect } from 'vitest';
import { getTemplate, assembleJobTodos } from '../todo-templates.js';

describe('todo-templates', () => {
  it('returns CAPABILITY_BUILD template', () => {
    const tpl = getTemplate('capability_build');
    expect(tpl).toBeDefined();
    expect(tpl!.items.length).toBeGreaterThan(0);
    expect(tpl!.items.every(i => i.mandatory)).toBe(true);
  });

  it('returns CAPABILITY_MODIFY template', () => {
    const tpl = getTemplate('capability_modify');
    expect(tpl).toBeDefined();
    expect(tpl!.items.some(i => i.validation === 'change_type_set')).toBe(true);
  });

  it('returns undefined for unknown type', () => {
    expect(getTemplate('unknown_type')).toBeUndefined();
  });

  it('assembleJobTodos merges 3 layers', () => {
    const delegatorTodos = [{ text: 'Add Hebrew to config' }, { text: 'Test Hebrew' }];
    const result = assembleJobTodos(delegatorTodos, 'capability_modify');
    // Layer 1: delegator items (mandatory, created_by: delegator)
    const delegated = result.filter(i => i.created_by === 'delegator');
    expect(delegated).toHaveLength(2);
    expect(delegated.every(i => i.mandatory)).toBe(true);
    // Layer 2: template items (mandatory, created_by: framework)
    const framework = result.filter(i => i.created_by === 'framework');
    expect(framework.length).toBeGreaterThan(0);
    expect(framework.every(i => i.mandatory)).toBe(true);
  });

  it('assembleJobTodos with no template or todos returns empty', () => {
    const result = assembleJobTodos(undefined, undefined);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Write tests for validators**

```typescript
// __tests__/todo-validators.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runValidation } from '../todo-validators.js';

describe('todo-validators', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validator-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('capability_frontmatter passes with valid CAPABILITY.md', () => {
    // Write a valid CAPABILITY.md in a capabilities subfolder
    const capDir = path.join(tmpDir, 'capabilities', 'test-cap');
    fs.mkdirSync(capDir, { recursive: true });
    fs.writeFileSync(path.join(capDir, 'CAPABILITY.md'), [
      '---',
      'name: Test Capability',
      'provides: audio-to-text',
      'interface: script',
      '---',
      'Instructions here.',
    ].join('\n'));
    const result = runValidation('capability_frontmatter', capDir);
    expect(result.pass).toBe(true);
  });

  it('capability_frontmatter fails when name is missing', () => {
    const capDir = path.join(tmpDir, 'capabilities', 'test-cap');
    fs.mkdirSync(capDir, { recursive: true });
    fs.writeFileSync(path.join(capDir, 'CAPABILITY.md'), [
      '---',
      'provides: audio-to-text',
      '---',
    ].join('\n'));
    const result = runValidation('capability_frontmatter', capDir);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('name');
  });

  it('completion_report passes with valid deliverable', () => {
    fs.writeFileSync(path.join(tmpDir, 'deliverable.md'), [
      '---',
      'change_type: configure',
      'provider: Deepgram Nova-2',
      'test_result: PASSED',
      '---',
      'Report content.',
    ].join('\n'));
    const result = runValidation('completion_report', tmpDir);
    expect(result.pass).toBe(true);
  });

  it('completion_report fails with change_type unknown', () => {
    fs.writeFileSync(path.join(tmpDir, 'deliverable.md'), [
      '---',
      'change_type: unknown',
      '---',
    ].join('\n'));
    const result = runValidation('completion_report', tmpDir);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('change_type');
  });

  it('unknown validator returns pass (graceful)', () => {
    const result = runValidation('nonexistent_rule', tmpDir);
    expect(result.pass).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/dashboard && npx vitest run src/automations/__tests__/todo-templates.test.ts src/automations/__tests__/todo-validators.test.ts`
Expected: FAIL (modules not found)

- [ ] **Step 4: Implement todo-templates.ts**

Create `packages/dashboard/src/automations/todo-templates.ts`:

```typescript
import type { TodoItem, TodoTemplate } from '@my-agent/core/spaces/todo-types';

const TEMPLATES: Record<string, TodoTemplate> = {
  capability_build: {
    items: [
      { text: 'Read spec and capability template', mandatory: true },
      { text: 'Write CAPABILITY.md with required frontmatter (name, provides, interface, requires.env)', mandatory: true, validation: 'capability_frontmatter' },
      { text: 'Write scripts following template contract', mandatory: true },
      { text: 'Run test harness — record pass/fail and latency', mandatory: true, validation: 'test_executed' },
      { text: 'Fill completion report', mandatory: true, validation: 'completion_report' },
    ],
  },
  capability_modify: {
    items: [
      { text: 'Read current CAPABILITY.md + DECISIONS.md history', mandatory: true },
      { text: 'Identify change type (configure/upgrade/fix/replace)', mandatory: true, validation: 'change_type_set' },
      { text: 'Apply changes per spec', mandatory: true },
      { text: 'Run test harness — record pass/fail and latency', mandatory: true, validation: 'test_executed' },
      { text: 'Fill completion report', mandatory: true, validation: 'completion_report' },
    ],
  },
};

export function getTemplate(jobType: string): TodoTemplate | undefined {
  return TEMPLATES[jobType];
}

export function assembleJobTodos(
  delegatorTodos?: Array<{ text: string }>,
  jobType?: string,
): TodoItem[] {
  const items: TodoItem[] = [];
  let nextId = 1;

  // Layer 1: Delegator's items
  if (delegatorTodos) {
    for (const todo of delegatorTodos) {
      items.push({
        id: `t${nextId++}`,
        text: todo.text,
        status: 'pending',
        mandatory: true,
        created_by: 'delegator',
      });
    }
  }

  // Layer 2: Job-type template items
  const template = jobType ? getTemplate(jobType) : undefined;
  if (template) {
    for (const tplItem of template.items) {
      items.push({
        id: `t${nextId++}`,
        text: tplItem.text,
        status: 'pending',
        mandatory: tplItem.mandatory,
        validation: tplItem.validation,
        created_by: 'framework',
      });
    }
  }

  return items;
}
```

- [ ] **Step 5: Implement todo-validators.ts**

Create `packages/dashboard/src/automations/todo-validators.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { ValidationResult } from '@my-agent/core/spaces/todo-types';

// Use the project's existing readFrontmatter utility
import { readFrontmatter } from '../metadata/frontmatter.js';

type ValidatorFn = (dir: string) => ValidationResult;

const VALIDATORS: Record<string, ValidatorFn> = {
  capability_frontmatter: (dir) => {
    const capPath = path.join(dir, 'CAPABILITY.md');
    if (!fs.existsSync(capPath)) {
      return { pass: false, message: 'CAPABILITY.md not found' };
    }
    const { data } = readFrontmatter<{ name?: string; provides?: string; interface?: string }>(capPath);
    if (!data.name) return { pass: false, message: "CAPABILITY.md missing required 'name' field" };
    if (!data.provides) return { pass: false, message: "CAPABILITY.md missing required 'provides' field" };
    if (!data.interface) return { pass: false, message: "CAPABILITY.md missing required 'interface' field" };
    return { pass: true };
  },

  completion_report: (dir) => {
    const delPath = path.join(dir, 'deliverable.md');
    if (!fs.existsSync(delPath)) {
      return { pass: false, message: 'deliverable.md not found — write your completion report' };
    }
    const { data } = readFrontmatter<{ change_type?: string }>(delPath);
    if (!data.change_type || data.change_type === 'unknown') {
      return { pass: false, message: "Completion report missing or has 'unknown' change_type. Set it to: configure, upgrade, fix, or replace" };
    }
    return { pass: true };
  },

  test_executed: (dir) => {
    const delPath = path.join(dir, 'deliverable.md');
    if (!fs.existsSync(delPath)) {
      return { pass: false, message: 'deliverable.md not found — record your test results' };
    }
    const { data } = readFrontmatter<{ test_result?: string }>(delPath);
    if (!data.test_result) {
      return { pass: false, message: 'No test_result in deliverable frontmatter. Run the test harness and record the result.' };
    }
    return { pass: true };
  },

  change_type_set: (dir) => {
    const delPath = path.join(dir, 'deliverable.md');
    if (!fs.existsSync(delPath)) {
      return { pass: false, message: 'deliverable.md not found' };
    }
    const { data } = readFrontmatter<{ change_type?: string }>(delPath);
    if (!data.change_type || data.change_type === 'unknown') {
      return { pass: false, message: "change_type not determined. Set to: configure, upgrade, fix, or replace" };
    }
    return { pass: true };
  },
};

export function runValidation(ruleId: string, dir: string): ValidationResult {
  const validator = VALIDATORS[ruleId];
  if (!validator) return { pass: true }; // Unknown validator = no restriction
  return validator(dir);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run src/automations/__tests__/todo-templates.test.ts src/automations/__tests__/todo-validators.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```
git add packages/dashboard/src/automations/todo-templates.ts packages/dashboard/src/automations/todo-validators.ts packages/dashboard/src/automations/__tests__/
git commit -m "feat(m9.1-s2): todo templates + validation registry"
```

---

### Task 2.2: Add validation to todo_update + max retries

**Files:**
- Modify: `packages/dashboard/src/mcp/todo-server.ts` (add validation logic to todo_update)
- Modify: `packages/dashboard/src/mcp/__tests__/todo-server.test.ts` (add validation tests)

- [ ] **Step 1: Add validation tests**

Add to the existing todo-server test file:

```typescript
it('todo_update with validation rejects when validator fails', async () => {
  // Pre-populate with mandatory item that has a validator
  const file = readTodoFile(todoPath);
  file.items.push({
    id: 't1', text: 'Fill completion report', status: 'in_progress',
    mandatory: true, validation: 'completion_report', created_by: 'framework',
  });
  writeTodoFile(todoPath, file);

  // No deliverable.md exists, so validator should fail
  const result = await tools.todo_update({ id: 't1', status: 'done' });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('deliverable.md');
  // Item should still be in_progress
  expect(readTodoFile(todoPath).items[0].status).toBe('in_progress');
  // validation_attempts should be 1
  expect(readTodoFile(todoPath).items[0].validation_attempts).toBe(1);
});

it('todo_update auto-blocks after 3 failed validations', async () => {
  const file = readTodoFile(todoPath);
  file.items.push({
    id: 't1', text: 'Fill report', status: 'in_progress',
    mandatory: true, validation: 'completion_report', created_by: 'framework',
    validation_attempts: 2, // Already failed twice
  });
  writeTodoFile(todoPath, file);

  const result = await tools.todo_update({ id: 't1', status: 'done' });
  expect(result.isError).toBe(true);
  // Should be auto-blocked now
  const item = readTodoFile(todoPath).items[0];
  expect(item.status).toBe('blocked');
  expect(item.validation_attempts).toBe(3);
});
```

- [ ] **Step 2: Implement validation in todo_update**

Modify the `todo_update` handler in `todo-server.ts`. The `createTodoTools` function needs to accept a `validatorFn` parameter:

```typescript
export function createTodoTools(todoPath: string, validatorFn?: (ruleId: string, dir: string) => ValidationResult) {
  // ... existing code ...

  async todo_update(args: { id: string; status?: string; notes?: string }) {
    const file = readTodoFile(todoPath);
    const item = file.items.find(i => i.id === args.id);
    if (!item) {
      return { content: [{ type: 'text' as const, text: `Item ${args.id} not found.` }], isError: true };
    }

    // Validation check: when marking a validated mandatory item as "done"
    if (args.status === 'done' && item.mandatory && item.validation && validatorFn) {
      const jobDir = path.dirname(todoPath); // todos.json is in the job dir
      const result = validatorFn(item.validation, jobDir);
      if (!result.pass) {
        item.validation_attempts = (item.validation_attempts || 0) + 1;
        if (item.validation_attempts >= 3) {
          item.status = 'blocked';
          item.notes = `Validation failed 3 times: ${result.message}`;
          touch(file);
          writeTodoFile(todoPath, file);
          return {
            content: [{ type: 'text' as const, text: `Validation failed 3 times. Item ${item.id} marked blocked. The framework will flag this for review.` }],
            isError: true,
          };
        }
        touch(file);
        writeTodoFile(todoPath, file);
        return {
          content: [{ type: 'text' as const, text: `Cannot mark done: ${result.message}. Fix and try again. (attempt ${item.validation_attempts}/3)` }],
          isError: true,
        };
      }
    }

    if (args.status) item.status = args.status as TodoItem['status'];
    if (args.notes !== undefined) item.notes = args.notes;
    touch(file);
    writeTodoFile(todoPath, file);

    return { content: [{ type: 'text' as const, text: `Updated ${item.id}: status=${item.status}` }] };
  },
}
```

Update the test file's `createTodoTools` call to pass the validator:

```typescript
import { runValidation } from '../../automations/todo-validators.js';
// In beforeEach:
tools = createTodoTools(todoPath, runValidation);
```

- [ ] **Step 3: Run all todo tests**

Run: `cd packages/dashboard && npx vitest run src/mcp/__tests__/todo-server.test.ts`
Expected: All tests PASS (including new validation tests)

- [ ] **Step 4: Commit**

```
git add packages/dashboard/src/mcp/todo-server.ts packages/dashboard/src/mcp/__tests__/todo-server.test.ts
git commit -m "feat(m9.1-s2): validation on todo_update with max 3 retries"
```

---

### Task 2.3: Update create_automation + executor for todo assembly

**Files:**
- Modify: `packages/core/src/spaces/automation-types.ts:26-45` (add `todos` + `job_type` to AutomationManifest)
- Modify: `packages/dashboard/src/mcp/automation-server.ts:34-122` (add params to create_automation)
- Modify: `packages/dashboard/src/automations/automation-executor.ts:73-418` (todo assembly + completion gating)

- [ ] **Step 1: Add fields to AutomationManifest**

In `packages/core/src/spaces/automation-types.ts`, add to `AutomationManifest`:

```typescript
export interface AutomationManifest {
  // ... existing fields ...
  target_path?: string;
  // NEW:
  todos?: Array<{ text: string }>;
  job_type?: 'capability_build' | 'capability_modify' | 'generic';
}
```

- [ ] **Step 2: Add params to create_automation MCP tool**

In `packages/dashboard/src/mcp/automation-server.ts`, add to the tool's schema (~line 34-122):

```typescript
todos: z.array(z.object({
  text: z.string(),
})).optional().describe('Task breakdown for the working agent. Each item becomes a mandatory checklist entry.'),
job_type: z.enum(['capability_build', 'capability_modify', 'generic']).optional()
  .describe('Job type — triggers template-based mandatory items for known types like capability builds'),
```

Pass these through to the manifest when creating the automation.

- [ ] **Step 3: Add migration auto-detection in executor**

In `automation-executor.ts`, add a function to auto-detect job_type:

```typescript
private detectJobType(automation: Automation): string | undefined {
  if (automation.manifest.job_type) return automation.manifest.job_type;
  // Auto-detect from target_path for existing automations
  const tp = automation.manifest.target_path;
  if (tp && tp.includes('.my_agent/capabilities/')) {
    // Check if capability already exists
    const capPath = path.resolve(this.config.agentDir, '..', tp);
    return fs.existsSync(path.join(capPath, 'CAPABILITY.md'))
      ? 'capability_modify'
      : 'capability_build';
  }
  return undefined;
}
```

- [ ] **Step 4: Add todo assembly in executor.run()**

In `automation-executor.ts`, in the `run()` method, before creating the brain query:

```typescript
import { assembleJobTodos } from './todo-templates.js';
import { writeTodoFile } from './todo-file.js';
import { runValidation } from './todo-validators.js';
import { createTodoServer } from '../mcp/todo-server.js';

// Inside run():
const jobType = this.detectJobType(automation);
const todos = assembleJobTodos(automation.manifest.todos, jobType);
const todoPath = path.join(job.run_dir!, 'todos.json');
writeTodoFile(todoPath, {
  items: todos,
  last_activity: new Date().toISOString(),
});
const todoServer = createTodoServer(todoPath, runValidation);
// Add todoServer to MCP servers for the query
```

- [ ] **Step 5: Add job completion gating**

In `automation-executor.ts`, after the SDK session ends (after response streaming), add:

```typescript
import { readTodoFile } from './todo-file.js';

// After streaming completes, before setting final job status:
const finalTodos = readTodoFile(todoPath);
const mandatoryItems = finalTodos.items.filter(i => i.mandatory);
const incompleteItems = mandatoryItems.filter(i => i.status !== 'done');
const blockedItems = mandatoryItems.filter(i => i.status === 'blocked');

if (blockedItems.length > 0) {
  // Validator failures — needs human review
  jobStatus = 'needs_review';
  jobSummary = `Blocked items: ${blockedItems.map(i => `${i.id}: ${i.notes || i.text}`).join('; ')}`;
} else if (incompleteItems.length > 0) {
  // Agent skipped mandatory items
  jobStatus = 'needs_review';
  jobSummary = `Incomplete mandatory items: ${incompleteItems.map(i => i.text).join(', ')}`;
}
```

- [ ] **Step 6: Add force flag to resume_job**

In `automation-server.ts`, update the `resume_job` tool (~line 245):

```typescript
// Add to schema:
force: z.boolean().optional().describe('Accept job as-is despite incomplete mandatory items'),

// In handler, if force is true:
if (args.force) {
  jobService.updateJob(args.jobId, { status: 'completed', summary: 'Force-completed by user' });
  return { content: [{ type: 'text' as const, text: `Job ${args.jobId} force-completed.` }] };
}
```

- [ ] **Step 7: Commit**

```
git add packages/core/src/spaces/automation-types.ts packages/dashboard/src/mcp/automation-server.ts packages/dashboard/src/automations/automation-executor.ts
git commit -m "feat(m9.1-s2): todo assembly in executor + completion gating + force resume"
```

---

### Task 2.4: Simplify builder prompt

**Files:**
- Modify: `packages/core/src/agents/definitions.ts:36-125`

- [ ] **Step 1: Strip the builder prompt**

Replace the ~85-line prompt in the `capability-builder` agent definition with a focused ~40-line prompt. Remove:
- All deliverable frontmatter instructions (handled by todo templates + validators)
- Paper trail writing instructions (handled by executor post-processing)
- YAML examples that compete with CAPABILITY.md format

Keep:
- "Follow the spec precisely" section
- Template precedence section
- Directory structure section
- CAPABILITY.md format section (the ONE YAML example)
- Script conventions
- Trust model (MAY write, MAY run, MUST ASK before install)
- Escalation rules

Add to the end:
```
## Your Todo List
Call todo_list first to see your assignment. Work through each item.
Mark items done as you complete them. Mandatory items require validation — the framework will check your work.
```

- [ ] **Step 2: Verify builder definition compiles**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```
git add packages/core/src/agents/definitions.ts
git commit -m "refactor(m9.1-s2): strip builder prompt to ~40 lines, process in todo list"
```

---

### Task 2.5: Acceptance test — todo-driven job lifecycle

**Files:**
- Create: `packages/dashboard/tests/integration/todo-lifecycle-acceptance.test.ts`

This test proves the complete job lifecycle: create automation with todos → fire → executor assembles 3-layer todo list → mock worker completes items → validators check output → job status reflects completion state.

- [ ] **Step 1: Write acceptance test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AppHarness } from './app-harness.js';
import { readTodoFile } from '../../src/automations/todo-file.js';

describe('S2 Acceptance: todo-driven job lifecycle', () => {
  let harness: AppHarness;

  beforeAll(async () => {
    harness = await AppHarness.create({ withAutomations: true });
  });

  afterAll(async () => {
    await harness.shutdown();
  });

  it('capability_build job assembles 3-layer todos and gates completion', async () => {
    // Create automation with delegator todos and job_type
    const automation = await harness.automations.create({
      name: 'Build test capability',
      instructions: 'Build a test capability',
      todos: [
        { text: 'Research test provider' },
        { text: 'Write test script' },
      ],
      job_type: 'capability_build',
      target_path: '.my_agent/capabilities/test-cap',
      trigger: [{ type: 'manual' }],
    });

    // Fire the automation
    const job = await harness.automations.fire(automation.id);

    // Verify todos.json was created with 3-layer assembly
    const todoPath = path.join(job.run_dir!, 'todos.json');
    const todoFile = readTodoFile(todoPath);

    // Layer 1: delegator items
    const delegated = todoFile.items.filter(i => i.created_by === 'delegator');
    expect(delegated).toHaveLength(2);
    expect(delegated[0].text).toBe('Research test provider');
    expect(delegated[0].mandatory).toBe(true);

    // Layer 2: template items (capability_build has 5 items)
    const framework = todoFile.items.filter(i => i.created_by === 'framework');
    expect(framework.length).toBe(5);
    expect(framework.some(i => i.validation === 'capability_frontmatter')).toBe(true);
    expect(framework.some(i => i.validation === 'completion_report')).toBe(true);

    // Total: 2 delegated + 5 template = 7 items
    expect(todoFile.items).toHaveLength(7);
  });

  it('job with incomplete mandatory items gets needs_review', async () => {
    // Create and fire a generic automation where the mock worker 
    // does NOT complete mandatory items
    const automation = await harness.automations.create({
      name: 'Incomplete test',
      instructions: 'Do something',
      todos: [{ text: 'Step 1' }],
      job_type: 'capability_build',
      trigger: [{ type: 'manual' }],
      target_path: '.my_agent/capabilities/incomplete-test',
    });

    // Fire with mock session that completes immediately without calling todo_update
    const job = await harness.automations.fire(automation.id);
    // Wait for job to finish...
    
    // Job should be needs_review (mandatory items not done)
    const finalJob = harness.automations.getJob(job.id);
    expect(finalJob.status).toBe('needs_review');
  });
});
```

Note: Adapt the harness API calls to match the actual `AppHarness` methods. The mock session should complete quickly without real SDK calls so the test verifies the framework behavior (todo assembly + completion gating), not the LLM.

- [ ] **Step 2: Run acceptance test**

Run: `cd packages/dashboard && npx vitest run tests/integration/todo-lifecycle-acceptance.test.ts`
Expected: PASS — 3-layer assembly verified, completion gating works

- [ ] **Step 3: Commit**

```
git add packages/dashboard/tests/integration/todo-lifecycle-acceptance.test.ts
git commit -m "test(m9.1-s2): acceptance test — todo-driven job lifecycle"
```

---

### Sprint 2 Validation

**Pass criteria — all must be true:**

1. `npx vitest run` — all tests pass
2. **Acceptance test passes** — 3-layer assembly verified, completion gating catches incomplete jobs
3. `create_automation` accepts `todos` and `job_type` parameters
4. Validator failure increments `validation_attempts` and returns `isError`
5. After 3 failures, item auto-blocks
6. `resume_job({ force: true })` force-completes a needs_review job
7. Existing automations with `target_path` containing capabilities auto-detect `job_type`
8. Builder agent definition has todo_list instruction and no competing YAML examples

---

## Sprint 3: Heartbeat Jobs Service

**Goal:** Independent monitoring loop checks job health, delivers notifications from persistent queue, monitors capability health.

### Task 3.1: Persistent notification queue

**Files:**
- Create: `packages/dashboard/src/notifications/persistent-queue.ts`
- Create: `packages/dashboard/src/notifications/__tests__/persistent-queue.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PersistentNotificationQueue } from '../persistent-queue.js';

describe('PersistentNotificationQueue', () => {
  let tmpDir: string;
  let queue: PersistentNotificationQueue;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notif-'));
    queue = new PersistentNotificationQueue(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('enqueue creates a file in pending/', () => {
    queue.enqueue({ job_id: 'job-1', type: 'job_completed', summary: 'Done', automation_id: 'a1', created: new Date().toISOString(), delivery_attempts: 0 });
    const pending = queue.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].job_id).toBe('job-1');
  });

  it('markDelivered moves to delivered/', () => {
    queue.enqueue({ job_id: 'job-2', type: 'job_completed', summary: 'Done', automation_id: 'a1', created: new Date().toISOString(), delivery_attempts: 0 });
    const pending = queue.listPending();
    queue.markDelivered(pending[0]._filename!);
    expect(queue.listPending()).toHaveLength(0);
    // delivered/ should have it
    const delivered = fs.readdirSync(path.join(tmpDir, 'delivered'));
    expect(delivered).toHaveLength(1);
  });

  it('incrementAttempts updates delivery_attempts', () => {
    queue.enqueue({ job_id: 'job-3', type: 'job_failed', summary: 'Error', automation_id: 'a1', created: new Date().toISOString(), delivery_attempts: 0 });
    const pending = queue.listPending();
    queue.incrementAttempts(pending[0]._filename!);
    const updated = queue.listPending();
    expect(updated[0].delivery_attempts).toBe(1);
  });

  it('survives re-instantiation (disk persistence)', () => {
    queue.enqueue({ job_id: 'job-4', type: 'job_interrupted', summary: 'Restart', automation_id: 'a1', created: new Date().toISOString(), delivery_attempts: 0 });
    const queue2 = new PersistentNotificationQueue(tmpDir);
    expect(queue2.listPending()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement persistent-queue.ts**

```typescript
import fs from 'node:fs';
import path from 'node:path';

export interface PersistentNotification {
  job_id: string;
  automation_id: string;
  type: 'job_completed' | 'job_failed' | 'job_interrupted' | 'job_needs_review' | 'capability_degraded' | 'capability_invalid';
  summary: string;
  todos_completed?: number;
  todos_total?: number;
  incomplete_items?: string[];
  created: string;
  delivery_attempts: number;
  resumable?: boolean;
  _filename?: string; // internal, not persisted
}

export class PersistentNotificationQueue {
  private pendingDir: string;
  private deliveredDir: string;

  constructor(baseDir: string) {
    this.pendingDir = path.join(baseDir, 'pending');
    this.deliveredDir = path.join(baseDir, 'delivered');
    fs.mkdirSync(this.pendingDir, { recursive: true });
    fs.mkdirSync(this.deliveredDir, { recursive: true });
  }

  enqueue(notification: Omit<PersistentNotification, '_filename'>): void {
    const filename = `${Date.now()}-${notification.job_id}.json`;
    const filePath = path.join(this.pendingDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(notification, null, 2));
  }

  listPending(): PersistentNotification[] {
    const files = fs.readdirSync(this.pendingDir).filter(f => f.endsWith('.json')).sort();
    return files.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(this.pendingDir, f), 'utf-8'));
      data._filename = f;
      return data as PersistentNotification;
    });
  }

  markDelivered(filename: string): void {
    const src = path.join(this.pendingDir, filename);
    const dst = path.join(this.deliveredDir, filename);
    if (fs.existsSync(src)) fs.renameSync(src, dst);
  }

  incrementAttempts(filename: string): void {
    const filePath = path.join(this.pendingDir, filename);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    data.delivery_attempts = (data.delivery_attempts || 0) + 1;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }
}
```

- [ ] **Step 3: Run tests**

Run: `cd packages/dashboard && npx vitest run src/notifications/__tests__/persistent-queue.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 4: Commit**

```
git add packages/dashboard/src/notifications/
git commit -m "feat(m9.1-s3): persistent notification queue on disk"
```

---

### Task 3.2: Heartbeat service

**Files:**
- Create: `packages/dashboard/src/automations/heartbeat-service.ts`
- Create: `packages/dashboard/src/automations/__tests__/heartbeat-service.test.ts`

- [ ] **Step 1: Write heartbeat service tests**

Test stale job detection and notification creation. Use mocked job service and notification queue.

Key test cases:
- Job running with stale `last_activity` (>5 min) → marked interrupted, notification created
- Job running with no todos.json and old `created` (>2 min) → marked interrupted
- Job running with recent activity → left alone
- Pending notifications → delivery attempted
- Capability health check fires on schedule

- [ ] **Step 2: Implement heartbeat-service.ts**

```typescript
import type { AutomationJobService } from './automation-job-service.js';
import type { PersistentNotificationQueue } from '../notifications/persistent-queue.js';
import type { ConversationInitiator } from '../agent/conversation-initiator.js';
import { readTodoFile } from './todo-file.js';
import path from 'node:path';

export interface HeartbeatConfig {
  jobService: AutomationJobService;
  notificationQueue: PersistentNotificationQueue;
  conversationInitiator: ConversationInitiator;
  staleThresholdMs: number;     // default: 5 * 60 * 1000
  tickIntervalMs: number;       // default: 30 * 1000
  capabilityHealthIntervalMs: number; // default: 60 * 60 * 1000
  capabilityHealthCheck?: () => Promise<void>;
}

export class HeartbeatService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastCapabilityCheck = 0;

  constructor(private config: HeartbeatConfig) {}

  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => this.tick(), this.config.tickIntervalMs);
    console.log(`[Heartbeat] Started (${this.config.tickIntervalMs}ms interval)`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async tick(): Promise<void> {
    await this.checkStaleJobs();
    await this.deliverPendingNotifications();
    await this.checkCapabilityHealth();
  }

  private async checkStaleJobs(): Promise<void> {
    const runningJobs = this.config.jobService.listJobs({ status: 'running' });
    const now = Date.now();

    for (const job of runningJobs) {
      if (!job.run_dir) continue;
      const todoPath = path.join(job.run_dir, 'todos.json');
      const todoFile = readTodoFile(todoPath);

      const lastActivity = new Date(todoFile.last_activity).getTime();
      const isStale = (now - lastActivity) > this.config.staleThresholdMs;
      const neverStarted = todoFile.items.length === 0
        && (now - new Date(job.created).getTime()) > 2 * 60 * 1000;

      if (isStale || neverStarted) {
        const completed = todoFile.items.filter(i => i.status === 'done').length;
        const total = todoFile.items.length;
        const incomplete = todoFile.items
          .filter(i => i.status !== 'done')
          .map(i => i.text);

        this.config.jobService.updateJob(job.id, {
          status: 'interrupted',
          summary: `Interrupted: ${completed}/${total} items done`,
        });

        this.config.notificationQueue.enqueue({
          job_id: job.id,
          automation_id: job.automationId,
          type: 'job_interrupted',
          summary: `Job interrupted. ${completed}/${total} items done.`,
          todos_completed: completed,
          todos_total: total,
          incomplete_items: incomplete,
          resumable: true,
          created: new Date().toISOString(),
          delivery_attempts: 0,
        });
      }
    }
  }

  private async deliverPendingNotifications(): Promise<void> {
    const pending = this.config.notificationQueue.listPending();
    for (const notification of pending) {
      const delivered = await this.config.conversationInitiator.alert(
        this.formatNotification(notification),
      );
      if (delivered) {
        this.config.notificationQueue.markDelivered(notification._filename!);
      } else {
        this.config.notificationQueue.incrementAttempts(notification._filename!);
      }
    }
  }

  private async checkCapabilityHealth(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCapabilityCheck < this.config.capabilityHealthIntervalMs) return;
    this.lastCapabilityCheck = now;
    if (this.config.capabilityHealthCheck) {
      await this.config.capabilityHealthCheck();
    }
  }

  private formatNotification(n: PersistentNotification): string {
    switch (n.type) {
      case 'job_completed':
        return `[Job Completed] ${n.summary}`;
      case 'job_failed':
        return `[Job Failed] ${n.summary}`;
      case 'job_interrupted':
        return `[Job Interrupted] ${n.summary}\nIncomplete: ${n.incomplete_items?.join(', ') || 'unknown'}\nResumable: ${n.resumable ? 'yes' : 'no'}`;
      case 'job_needs_review':
        return `[Job Needs Review] ${n.summary}`;
      default:
        return `[Notification] ${n.summary}`;
    }
  }
}
```

- [ ] **Step 3: Run tests**

Expected: All heartbeat tests PASS

- [ ] **Step 4: Commit**

```
git add packages/dashboard/src/automations/heartbeat-service.ts packages/dashboard/src/automations/__tests__/heartbeat-service.test.ts
git commit -m "feat(m9.1-s3): heartbeat service — stale detection + notification delivery"
```

---

### Task 3.3: Simplify handleNotification + remove replaced S3.1 components

**Files:**
- Modify: `packages/dashboard/src/automations/automation-processor.ts:172-265` (simplify to queue writes)
- Modify: `packages/dashboard/src/agent/session-manager.ts` (remove pendingNotifications[])
- Modify: `packages/dashboard/src/automations/automation-scheduler.ts:188-258` (remove checkStaleJobs)
- Modify: `packages/dashboard/src/app.ts` (wire heartbeat service, remove old stale check)

- [ ] **Step 1: Simplify handleNotification to write to persistent queue**

Replace the current delivery logic in `automation-processor.ts` `handleNotification()` with a single queue write. Remove direct `ci.alert()` calls from the processor — the heartbeat service handles all delivery.

- [ ] **Step 2: Remove SessionManager.pendingNotifications**

Remove the `pendingNotifications` array, `queueNotification()`, and `hasPendingNotifications()` from `session-manager.ts`. Remove the drain logic that prepends `[SYSTEM: ...]` blocks.

- [ ] **Step 3: Remove checkStaleJobs from scheduler**

Remove or gut `checkStaleJobs()` in `automation-scheduler.ts`. The heartbeat service replaces this.

- [ ] **Step 4: Wire heartbeat service in app.ts**

In `app.ts`, after startup recovery (line ~590), instantiate and start the heartbeat service:

```typescript
import { HeartbeatService } from './automations/heartbeat-service.js';
import { PersistentNotificationQueue } from './notifications/persistent-queue.js';

const notificationQueue = new PersistentNotificationQueue(
  path.join(agentDir, 'notifications'),
);
const heartbeatService = new HeartbeatService({
  jobService: app.automationJobService!,
  notificationQueue,
  conversationInitiator: app.conversationInitiator!,
  staleThresholdMs: 5 * 60 * 1000,
  tickIntervalMs: 30 * 1000,
  capabilityHealthIntervalMs: 60 * 60 * 1000,
  capabilityHealthCheck: async () => {
    // Run registry.testAll() and create notifications for failures
  },
});
heartbeatService.start();
```

- [ ] **Step 5: Run all tests, fix regressions**

Run: `cd packages/dashboard && npx vitest run`
Expected: All tests pass. Fix any tests that depended on `pendingNotifications` or `checkStaleJobs`.

- [ ] **Step 6: Commit**

```
git add packages/dashboard/src/automations/ packages/dashboard/src/agent/session-manager.ts packages/dashboard/src/app.ts
git commit -m "feat(m9.1-s3): heartbeat service replaces S3.1 stale detection + in-memory notifications"
```

---

### Task 3.4: Acceptance test — heartbeat detects stale job and delivers notification

**Files:**
- Create: `packages/dashboard/tests/integration/heartbeat-acceptance.test.ts`

This test proves the heartbeat loop works: a stale job is detected, marked interrupted, a notification is created in the persistent queue, and the heartbeat delivers it.

- [ ] **Step 1: Write acceptance test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AppHarness } from './app-harness.js';
import { writeTodoFile } from '../../src/automations/todo-file.js';
import { HeartbeatService } from '../../src/automations/heartbeat-service.js';
import { PersistentNotificationQueue } from '../../src/notifications/persistent-queue.js';

describe('S3 Acceptance: heartbeat detects stale job + delivers notification', () => {
  let harness: AppHarness;
  let notifQueue: PersistentNotificationQueue;
  let heartbeat: HeartbeatService;

  beforeAll(async () => {
    harness = await AppHarness.create({ withAutomations: true });
    notifQueue = new PersistentNotificationQueue(
      path.join(harness.agentDir, 'notifications'),
    );
  });

  afterAll(async () => {
    heartbeat?.stop();
    await harness.shutdown();
  });

  it('stale running job → interrupted + notification created + delivery attempted', async () => {
    // Create a job that appears to be running but has stale activity
    const automation = await harness.automations.create({
      name: 'Stale test job',
      instructions: 'Test',
      trigger: [{ type: 'manual' }],
    });
    const job = await harness.automations.fire(automation.id);

    // Manually set job to running with old last_activity (6 minutes ago)
    const todoPath = path.join(job.run_dir!, 'todos.json');
    writeTodoFile(todoPath, {
      items: [
        { id: 't1', text: 'Step 1', status: 'done', mandatory: false, created_by: 'agent' },
        { id: 't2', text: 'Step 2', status: 'in_progress', mandatory: false, created_by: 'agent' },
      ],
      last_activity: new Date(Date.now() - 6 * 60 * 1000).toISOString(), // 6 min ago
    });

    // Create heartbeat with 0ms stale threshold for instant detection
    heartbeat = new HeartbeatService({
      jobService: harness.automations.jobService,
      notificationQueue: notifQueue,
      conversationInitiator: harness.conversationInitiator,
      staleThresholdMs: 5 * 60 * 1000, // 5 min — our job is 6 min stale
      tickIntervalMs: 999999, // Don't auto-tick, we'll call tick() manually
      capabilityHealthIntervalMs: 999999,
    });

    // Run one tick manually
    await heartbeat.tick();

    // Verify: job should be interrupted
    const updatedJob = harness.automations.getJob(job.id);
    expect(updatedJob.status).toBe('interrupted');

    // Verify: notification should exist in pending/
    const pending = notifQueue.listPending();
    expect(pending.length).toBeGreaterThanOrEqual(1);
    const notif = pending.find(n => n.job_id === job.id);
    expect(notif).toBeDefined();
    expect(notif!.type).toBe('job_interrupted');
    expect(notif!.todos_completed).toBe(1);
    expect(notif!.todos_total).toBe(2);
    expect(notif!.incomplete_items).toContain('Step 2');
  });
});
```

- [ ] **Step 2: Run acceptance test**

Run: `cd packages/dashboard && npx vitest run tests/integration/heartbeat-acceptance.test.ts`
Expected: PASS — stale job detected, interrupted, notification created with todo progress

- [ ] **Step 3: Commit**

```
git add packages/dashboard/tests/integration/heartbeat-acceptance.test.ts
git commit -m "test(m9.1-s3): acceptance test — heartbeat stale detection + notification"
```

---

### Sprint 3 Validation

**Pass criteria:**

1. `npx vitest run` — all tests pass
2. **Acceptance test passes** — stale job detected, marked interrupted, notification with todo progress created
3. Heartbeat service logs `[Heartbeat] Started` on dashboard startup
4. After delivery, notification moves from `pending/` to `delivered/`
5. Dashboard restart: notifications in `pending/` survive and are delivered on first tick
6. `SessionManager.pendingNotifications` no longer exists in code
7. `checkStaleJobs()` no longer runs from the scheduler

---

## Sprint 4: Enforcement Hooks

**Goal:** Code-level enforcement prevents shortcuts and self-harm.

### Task 4.1: Source code protection hook

**Files:**
- Modify: `packages/core/src/hooks/safety.ts` (add createSourceCodeProtection)
- Modify: `packages/core/src/hooks/factory.ts` (wire for all trust levels)
- Create: `packages/core/src/hooks/__tests__/source-code-protection.test.ts`

- [ ] **Step 1: Write failing tests**

Test that Write/Edit to `packages/`, `skills/`, `docs/`, `scripts/` are blocked. Test that Write to `.my_agent/` is allowed. Test that Read to `packages/` is allowed.

- [ ] **Step 2: Implement createSourceCodeProtection**

In `packages/core/src/hooks/safety.ts`:

```typescript
const SOURCE_CODE_PATTERNS = [
  /^packages\//,
  /^skills\//,
  /^docs\//,
  /^scripts\//,
  /^\.github\//,
  /^tsconfig/,
  /^package\.json$/,
  /^CLAUDE\.md$/,
];

export function createSourceCodeProtection(): HookCallback {
  return async (input) => {
    const toolName = input.tool_name;
    if (toolName !== 'Write' && toolName !== 'Edit') return {};

    const filePath = input.tool_input?.file_path as string;
    if (!filePath) return {};

    // Normalize to relative path from project root
    const relative = path.relative(process.cwd(), filePath);
    if (SOURCE_CODE_PATTERNS.some(p => p.test(relative))) {
      return {
        decision: 'block' as const,
        reason: 'This path is developer-maintained code. You cannot modify it. If something needs fixing, escalate to the user.',
      };
    }
    return {};
  };
}
```

- [ ] **Step 3: Wire in factory.ts for ALL trust levels**

In `createHooks()`, add source code protection to brain, task, and subagent levels.

- [ ] **Step 4: Run tests, commit**

---

### Task 4.2: Capability routing hook

**Files:**
- Modify: `packages/core/src/hooks/safety.ts` (add createCapabilityRouting)
- Modify: `packages/core/src/hooks/factory.ts` (wire for brain only)

- [ ] **Step 1: Write tests**

Test that Write/Edit to `.my_agent/capabilities/`, `.my_agent/spaces/`, `.my_agent/config.yaml` are blocked at brain trust level. Test that task trust level is NOT blocked (workers need to write there).

- [ ] **Step 2: Implement createCapabilityRouting**

```typescript
const CAPABILITY_ROUTING_PATTERNS = [
  /\.my_agent\/capabilities\//,
  /\.my_agent\/spaces\//,
  /\.my_agent\/config\.yaml$/,
];

export function createCapabilityRouting(agentDir: string): HookCallback {
  return async (input) => {
    const toolName = input.tool_name;
    if (toolName !== 'Write' && toolName !== 'Edit') return {};

    const filePath = input.tool_input?.file_path as string;
    if (!filePath) return {};

    if (CAPABILITY_ROUTING_PATTERNS.some(p => p.test(filePath))) {
      return {
        decision: 'block' as const,
        reason: 'Direct edits to this path are not allowed. Use create_automation with a tracked job to modify this through the proper flow.',
      };
    }
    return {};
  };
}
```

- [ ] **Step 3: Wire in factory for brain trust level only**

- [ ] **Step 4: Run tests, commit**

---

### Task 4.3: Stop hook soft reminder

**Files:**
- Modify: `packages/core/src/hooks/factory.ts` (add Stop hook for task trust level)

- [ ] **Step 1: Implement Stop hook**

In `factory.ts`, for task trust level, add a Stop hook that reads `todos.json` and reminds about incomplete mandatory items:

```typescript
// In createHooks(), for 'task' trust level:
if (trustLevel === 'task' && options?.todoPath) {
  hooks['Stop'] = [{
    matcher: { toolName: /./ }, // Match any (Stop hooks don't have tool names, but need a matcher)
    callback: async () => {
      const { readTodoFile } = await import('./todo-file.js');
      const todos = readTodoFile(options.todoPath!);
      const incomplete = todos.items.filter(i => i.mandatory && i.status !== 'done' && i.status !== 'blocked');
      if (incomplete.length > 0) {
        return {
          systemMessage: `You have ${incomplete.length} incomplete mandatory items: ${incomplete.map(i => `${i.id}: ${i.text}`).join(', ')}. Complete them before finishing.`,
        };
      }
      return {};
    },
  }];
}
```

- [ ] **Step 2: Pass todoPath through HookFactoryOptions**

Update `HookFactoryOptions` to include `todoPath?: string`. Pass it from the executor.

- [ ] **Step 3: Test, commit**

---

### Task 4.4: Acceptance test — hooks block protected paths

**Files:**
- Create: `packages/dashboard/tests/integration/hooks-acceptance.test.ts`

This test proves enforcement hooks work: source code protection blocks all Ninas from writing framework code, capability routing blocks Conversation Nina from direct capability edits, and task-level workers are NOT blocked.

- [ ] **Step 1: Write acceptance test**

```typescript
import { describe, it, expect } from 'vitest';
import { createHooks } from '@my-agent/core/hooks/factory';

describe('S4 Acceptance: enforcement hooks block protected paths', () => {
  it('source code protection blocks Write to packages/ at all trust levels', async () => {
    for (const level of ['brain', 'task', 'subagent'] as const) {
      const hooks = createHooks(level, { agentDir: '/tmp/test-agent' });
      const preToolUse = hooks['PreToolUse'] || [];

      // Simulate a Write to packages/core/src/brain.ts
      let blocked = false;
      for (const hookMatcher of preToolUse) {
        const result = await hookMatcher.callback({
          tool_name: 'Write',
          tool_input: { file_path: '/home/nina/my_agent/packages/core/src/brain.ts' },
        });
        if (result.decision === 'block') blocked = true;
      }
      expect(blocked, `${level} should block Write to packages/`).toBe(true);
    }
  });

  it('capability routing blocks Conversation Nina (brain) from editing capabilities', async () => {
    const hooks = createHooks('brain', { agentDir: '/tmp/test-agent' });
    const preToolUse = hooks['PreToolUse'] || [];

    let blocked = false;
    for (const hookMatcher of preToolUse) {
      const result = await hookMatcher.callback({
        tool_name: 'Edit',
        tool_input: { file_path: '/home/nina/.my_agent/capabilities/stt-deepgram/config.yaml' },
      });
      if (result.decision === 'block') blocked = true;
    }
    expect(blocked).toBe(true);
  });

  it('capability routing does NOT block Working Nina (task) from writing capabilities', async () => {
    const hooks = createHooks('task', { agentDir: '/tmp/test-agent' });
    const preToolUse = hooks['PreToolUse'] || [];

    let blocked = false;
    for (const hookMatcher of preToolUse) {
      const result = await hookMatcher.callback({
        tool_name: 'Write',
        tool_input: { file_path: '/home/nina/.my_agent/capabilities/stt-deepgram/config.yaml' },
      });
      if (result.decision === 'block') blocked = true;
    }
    // Task level should NOT be blocked by capability routing
    // (infrastructure guard may block for other reasons, but capability routing shouldn't)
    expect(blocked).toBe(false);
  });

  it('Read access is never blocked', async () => {
    for (const level of ['brain', 'task', 'subagent'] as const) {
      const hooks = createHooks(level, { agentDir: '/tmp/test-agent' });
      const preToolUse = hooks['PreToolUse'] || [];

      let blocked = false;
      for (const hookMatcher of preToolUse) {
        const result = await hookMatcher.callback({
          tool_name: 'Read',
          tool_input: { file_path: '/home/nina/my_agent/packages/core/src/brain.ts' },
        });
        if (result.decision === 'block') blocked = true;
      }
      expect(blocked, `${level} should never block Read`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run acceptance test**

Run: `cd packages/dashboard && npx vitest run tests/integration/hooks-acceptance.test.ts`
Expected: PASS — source code blocked for all, capability routing blocks brain only, read never blocked

- [ ] **Step 3: Commit**

```
git add packages/dashboard/tests/integration/hooks-acceptance.test.ts
git commit -m "test(m9.1-s4): acceptance test — enforcement hooks block protected paths"
```

---

### Sprint 4 Validation

**Pass criteria:**

1. **Acceptance test passes** — all hook behaviors verified across trust levels
2. Working Nina gets Stop hook reminder when session ends with incomplete mandatory items
3. No regressions in existing hook behavior (bash blocker, infrastructure guard)

---

## Sprint 5: Status Communication + System Prompt

**Goal:** Nina always knows job status. Three delivery channels work.

### Task 5.1: Enhanced check_job_status with todo progress

**Files:**
- Modify: `packages/dashboard/src/mcp/automation-server.ts:327-440`

- [ ] **Step 1: Update check_job_status to include todo progress**

Read `todos.json` from the job's run_dir and include progress in the response:

```typescript
// In check_job_status handler, for each job:
if (job.run_dir) {
  const todoFile = readTodoFile(path.join(job.run_dir, 'todos.json'));
  const completed = todoFile.items.filter(i => i.status === 'done').map(i => i.text);
  const inProgress = todoFile.items.filter(i => i.status === 'in_progress').map(i => i.text);
  const pending = todoFile.items.filter(i => i.status === 'pending').map(i => i.text);
  // Format into response
}
```

- [ ] **Step 2: Test manually — fire a job, call check_job_status mid-execution**

- [ ] **Step 3: Commit**

---

### Task 5.2: System prompt enrichment

**Files:**
- Modify: `packages/dashboard/src/agent/system-prompt-builder.ts:65-154`
- Modify: `packages/dashboard/src/app.ts:1345-1352` (enhance setRunningTasksChecker)

- [ ] **Step 1: Enhance [Active Working Agents] with todo progress**

In `app.ts`, update `setRunningTasksChecker` to include todo progress:

```typescript
setRunningTasksChecker((_conversationId: string) => {
  const runningJobs = app.automationJobService!.listJobs({ status: 'running' });
  return runningJobs.map(job => {
    let progress = '';
    if (job.run_dir) {
      const todos = readTodoFile(path.join(job.run_dir, 'todos.json'));
      const done = todos.items.filter(i => i.status === 'done').length;
      const total = todos.items.length;
      const current = todos.items.find(i => i.status === 'in_progress');
      progress = `, ${done}/${total} items done${current ? `, currently: "${current.text}"` : ''}`;
    }
    return `"${job.summary || job.automationId}" (${job.id}): ${job.status}${progress}`;
  });
});
```

- [ ] **Step 2: Add [Pending Briefing] section**

In `system-prompt-builder.ts`, in the `build()` method, add a new dynamic section that reads from the persistent notification queue:

```typescript
// Add a pendingBriefingFn to BuildContext or pass it in
if (context.pendingBriefing && context.pendingBriefing.length > 0) {
  dynamicParts.push(
    `[Pending Briefing]\nThe following events occurred since your last interaction:\n${context.pendingBriefing.join('\n')}\n\nInform the user about these naturally. For interrupted jobs, ask whether to resume or discard.\n[End Pending Briefing]`,
  );
}
```

Wire the pending briefing in `app.ts` by reading from the notification queue's `pending/` directory.

- [ ] **Step 3: Add [Your Pending Tasks] for Conversation Nina**

In `system-prompt-builder.ts`, add another dynamic section:

```typescript
if (context.conversationTodos && context.conversationTodos.length > 0) {
  const lines = context.conversationTodos.map(t =>
    `${t.status === 'done' ? '✓' : '☐'} ${t.text} (${t.status})`
  );
  dynamicParts.push(`[Your Pending Tasks]\n${lines.join('\n')}\n[End Pending Tasks]`);
}
```

Wire by reading conversation `todos.json` in the session manager.

- [ ] **Step 4: Mark delivered after briefing is shown**

After the system prompt is built with pending briefing items, mark those notifications as delivered (they've been injected into the prompt — Nina will see them).

- [ ] **Step 5: Test, commit**

---

### Task 5.3: Acceptance test — system prompt contains job status + pending briefing

**Files:**
- Create: `packages/dashboard/tests/integration/status-prompt-acceptance.test.ts`

This test proves status communication works: system prompt includes todo progress for active jobs, pending briefing for undelivered notifications, and conversation todos.

- [ ] **Step 1: Write acceptance test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { AppHarness } from './app-harness.js';
import { writeTodoFile } from '../../src/automations/todo-file.js';
import { PersistentNotificationQueue } from '../../src/notifications/persistent-queue.js';
import { SystemPromptBuilder } from '../../src/agent/system-prompt-builder.js';

describe('S5 Acceptance: system prompt reflects job status + briefing', () => {
  let harness: AppHarness;

  beforeAll(async () => {
    harness = await AppHarness.create({ withAutomations: true });
  });

  afterAll(async () => {
    await harness.shutdown();
  });

  it('system prompt includes [Active Working Agents] with todo progress', async () => {
    // Create a running job with todo progress
    const automation = await harness.automations.create({
      name: 'Active job test',
      instructions: 'Test',
      trigger: [{ type: 'manual' }],
    });
    const job = await harness.automations.fire(automation.id);

    // Write todos showing 2/4 done
    writeTodoFile(path.join(job.run_dir!, 'todos.json'), {
      items: [
        { id: 't1', text: 'Step 1', status: 'done', mandatory: false, created_by: 'agent' },
        { id: 't2', text: 'Step 2', status: 'done', mandatory: false, created_by: 'agent' },
        { id: 't3', text: 'Step 3', status: 'in_progress', mandatory: false, created_by: 'agent' },
        { id: 't4', text: 'Step 4', status: 'pending', mandatory: false, created_by: 'agent' },
      ],
      last_activity: new Date().toISOString(),
    });

    // Build the system prompt
    const prompt = await harness.buildSystemPrompt();
    const promptText = typeof prompt === 'string' ? prompt : prompt.map(b => b.text).join('\n');

    // Verify [Active Working Agents] section contains todo progress
    expect(promptText).toContain('[Active Working Agents]');
    expect(promptText).toContain('2/4 items done');
    expect(promptText).toContain('Step 3'); // currently in progress
  });

  it('system prompt includes [Pending Briefing] from notification queue', async () => {
    // Enqueue a notification
    const notifQueue = new PersistentNotificationQueue(
      path.join(harness.agentDir, 'notifications'),
    );
    notifQueue.enqueue({
      job_id: 'job-test-briefing',
      automation_id: 'test-auto',
      type: 'job_interrupted',
      summary: 'Job interrupted by restart. 3/5 items done.',
      todos_completed: 3,
      todos_total: 5,
      incomplete_items: ['Run test', 'Fill report'],
      resumable: true,
      created: new Date().toISOString(),
      delivery_attempts: 0,
    });

    // Build system prompt
    const prompt = await harness.buildSystemPrompt();
    const promptText = typeof prompt === 'string' ? prompt : prompt.map(b => b.text).join('\n');

    // Verify [Pending Briefing] section
    expect(promptText).toContain('[Pending Briefing]');
    expect(promptText).toContain('interrupted');
    expect(promptText).toContain('3/5');
  });
});
```

Note: The `harness.buildSystemPrompt()` method may need to be added to `AppHarness` — it should call `SystemPromptBuilder.build()` with the current context. Adapt based on existing harness API.

- [ ] **Step 2: Run acceptance test**

Run: `cd packages/dashboard && npx vitest run tests/integration/status-prompt-acceptance.test.ts`
Expected: PASS — system prompt contains job progress and pending briefing

- [ ] **Step 3: Commit**

```
git add packages/dashboard/tests/integration/status-prompt-acceptance.test.ts
git commit -m "test(m9.1-s5): acceptance test — system prompt reflects status + briefing"
```

---

### Sprint 5 Validation

**Pass criteria:**

1. **Acceptance test passes** — system prompt includes todo progress + pending briefing
2. `check_job_status` returns todo progress for running jobs
3. Conversation Nina's own todos appear in `[Your Pending Tasks]`
4. After briefing is shown, notifications move from `pending/` to `delivered/`

---

## Sprint 6: Restart Recovery

**Goal:** Dashboard restart doesn't lose work. Interrupted jobs detected, users notified, work resumable.

### Task 6.1: Startup recovery sequence

**Files:**
- Modify: `packages/dashboard/src/app.ts:579-590` (add recovery steps)

- [ ] **Step 1: Implement recovery sequence before accepting connections**

After existing cleanup (empty conversation deletion), add:

```typescript
// Step 1: Mark interrupted jobs
const processStartTime = new Date().toISOString();
const staleRunning = app.automationJobService!.listJobs({ status: 'running' });
const stalePending = app.automationJobService!.listJobs({ status: 'pending' });
const staleJobs = [...staleRunning, ...stalePending].filter(
  j => new Date(j.created) < new Date(processStartTime)
);

for (const job of staleJobs) {
  const todoFile = job.run_dir ? readTodoFile(path.join(job.run_dir, 'todos.json')) : { items: [] };
  const completed = todoFile.items.filter(i => i.status === 'done').length;
  const total = todoFile.items.length;
  const incomplete = todoFile.items.filter(i => i.status !== 'done').map(i => i.text);

  app.automationJobService!.updateJob(job.id, {
    status: 'interrupted',
    summary: `Interrupted by restart. ${completed}/${total} items done.`,
  });

  notificationQueue.enqueue({
    job_id: job.id,
    automation_id: job.automationId,
    type: 'job_interrupted',
    summary: `Job interrupted by restart. ${completed}/${total} items done.`,
    todos_completed: completed,
    todos_total: total,
    incomplete_items: incomplete,
    resumable: true,
    created: new Date().toISOString(),
    delivery_attempts: 0,
  });
}

if (staleJobs.length > 0) {
  console.log(`[Recovery] Marked ${staleJobs.length} interrupted job(s)`);
}

// Step 2: Clean stale once-automations
const completedOnce = app.automationManager!.list().filter(
  a => a.manifest.once && a.manifest.status === 'completed'
);
for (const auto of completedOnce) {
  app.automationManager!.delete(auto.id);
}

// Step 3: Re-scan capabilities
await app.capabilityRegistry?.rescan();

// Step 4: Start heartbeat
heartbeatService.start();
```

- [ ] **Step 2: Commit**

---

### Task 6.2: Job resumption with session ID detection

**Files:**
- Modify: `packages/dashboard/src/automations/automation-executor.ts` (resume detection)
- Modify: `packages/dashboard/src/mcp/automation-server.ts:245-325` (update resume_job)

- [ ] **Step 1: Add resume detection in executor**

When resuming a job, compare session IDs:

```typescript
// In executor, when handling resume:
async resumeJob(job: Job, resumePrompt: string): Promise<ExecutionResult> {
  const todoPath = path.join(job.run_dir!, 'todos.json');
  const todos = readTodoFile(todoPath);
  const completedItems = todos.items.filter(i => i.status === 'done');
  const remainingItems = todos.items.filter(i => i.status !== 'done');

  let actualSessionId: string | undefined;
  const query = createBrainQuery(resumePrompt, {
    ...options,
    resume: job.sdk_session_id, // Attempt resume
  });

  for await (const msg of query) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      actualSessionId = msg.session_id;
    }
    // ... process stream
  }

  // Detect silent fresh session
  if (job.sdk_session_id && actualSessionId && actualSessionId !== job.sdk_session_id) {
    console.log(`[Executor] Resume failed for ${job.id} — got fresh session ${actualSessionId} instead of ${job.sdk_session_id}`);
    // The fresh session already started — inject context about completed work
  }
}
```

- [ ] **Step 2: Update resume_job tool to pass todo state**

In `automation-server.ts`, update the resume_job handler to construct the resume prompt from todo state:

```typescript
// Read todos to build context-aware resume prompt
const todoFile = readTodoFile(path.join(job.run_dir!, 'todos.json'));
const done = todoFile.items.filter(i => i.status === 'done').map(i => i.text);
const remaining = todoFile.items.filter(i => i.status !== 'done').map(i => i.text);

const resumePrompt = `You were interrupted. Your todo list shows ${done.length} items completed:\n${done.map(t => `✓ ${t}`).join('\n')}\n\nRemaining:\n${remaining.map(t => `☐ ${t}`).join('\n')}\n\nContinue from where you left off. Call todo_list to see your full assignment.`;
```

- [ ] **Step 3: Test, commit**

---

### Task 6.3: Acceptance test — restart recovery detects interrupted jobs

**Files:**
- Create: `packages/dashboard/tests/integration/restart-recovery-acceptance.test.ts`

This test simulates a restart: create a harness with a running job, shut it down, create a new harness, and verify the recovery sequence marks the job interrupted and creates a notification.

- [ ] **Step 1: Write acceptance test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AppHarness } from './app-harness.js';
import { writeTodoFile, readTodoFile } from '../../src/automations/todo-file.js';
import { PersistentNotificationQueue } from '../../src/notifications/persistent-queue.js';

describe('S6 Acceptance: restart recovery detects interrupted jobs', () => {
  let agentDir: string;

  it('running job survives restart and is detected as interrupted', async () => {
    // Phase 1: Create harness, fire a job, leave it "running"
    const harness1 = await AppHarness.create({ withAutomations: true });
    agentDir = harness1.agentDir;

    const automation = await harness1.automations.create({
      name: 'Restart test job',
      instructions: 'Long running test',
      trigger: [{ type: 'manual' }],
    });
    const job = await harness1.automations.fire(automation.id);

    // Simulate work in progress: 2/4 items done
    writeTodoFile(path.join(job.run_dir!, 'todos.json'), {
      items: [
        { id: 't1', text: 'Done step', status: 'done', mandatory: false, created_by: 'agent' },
        { id: 't2', text: 'Also done', status: 'done', mandatory: false, created_by: 'agent' },
        { id: 't3', text: 'Was working on this', status: 'in_progress', mandatory: false, created_by: 'agent' },
        { id: 't4', text: 'Not started', status: 'pending', mandatory: false, created_by: 'agent' },
      ],
      last_activity: new Date().toISOString(),
    });

    // Job is "running" in the DB
    expect(harness1.automations.getJob(job.id).status).toBe('running');

    // Phase 2: Shutdown (simulates crash/restart)
    await harness1.shutdown();

    // Phase 3: Create new harness with SAME agentDir (simulates restart)
    // The recovery sequence should run on startup
    const harness2 = await AppHarness.create({ 
      withAutomations: true,
      agentDir, // Reuse same data directory
    });

    // Verify: job should be marked interrupted
    const recoveredJob = harness2.automations.getJob(job.id);
    expect(recoveredJob.status).toBe('interrupted');
    expect(recoveredJob.summary).toContain('2/4');

    // Verify: notification should exist in pending/
    const notifQueue = new PersistentNotificationQueue(
      path.join(agentDir, 'notifications'),
    );
    const pending = notifQueue.listPending();
    const notif = pending.find(n => n.job_id === job.id);
    expect(notif).toBeDefined();
    expect(notif!.type).toBe('job_interrupted');
    expect(notif!.todos_completed).toBe(2);
    expect(notif!.incomplete_items).toContain('Was working on this');
    expect(notif!.incomplete_items).toContain('Not started');

    await harness2.shutdown();
  });
});
```

Note: `AppHarness.create({ agentDir })` may need to support accepting an existing directory instead of creating a fresh one. This simulates a restart with the same data. Adapt the harness if needed.

- [ ] **Step 2: Run acceptance test**

Run: `cd packages/dashboard && npx vitest run tests/integration/restart-recovery-acceptance.test.ts`
Expected: PASS — job marked interrupted after restart, notification created with correct todo progress

- [ ] **Step 3: Commit**

```
git add packages/dashboard/tests/integration/restart-recovery-acceptance.test.ts
git commit -m "test(m9.1-s6): acceptance test — restart recovery detects interrupted jobs"
```

---

### Sprint 6 Validation

**Pass criteria:**

1. **Acceptance test passes** — restart recovery detects interrupted jobs, creates notifications with todo progress
2. System prompt includes `[Pending Briefing]` mentioning the interrupted job on next conversation
3. `resume_job` resumes with todo context — working nina sees completed items
4. If SDK session can't resume, fresh session starts with pre-populated todos
5. Stale `once:true` completed automations are cleaned up on startup

---

## Sprint 7: Infrastructure Fixes + Integration Test

**Goal:** Fix remaining M9-S8 infrastructure bugs. E2E integration test validates the full chain.

### Task 7.1: Scanner loudness

**Files:**
- Modify: `packages/core/src/capabilities/scanner.ts:100-132`

- [ ] **Step 1: Return invalid capabilities instead of skipping**

In the catch block (~line 131), instead of skipping, push an invalid capability:

```typescript
} catch (err) {
  capabilities.push({
    name: null,
    path: capDir,
    status: 'invalid',
    error: err instanceof Error ? err.message : 'Unknown error parsing CAPABILITY.md',
    // ... minimal fields
  });
}
```

Add `'invalid'` to the `CapabilityStatus` type. Add `error?: string` to the `Capability` type.

- [ ] **Step 2: Commit**

---

### Task 7.2: findById from disk

**Files:**
- Modify: `packages/dashboard/src/automations/automation-manager.ts`

- [ ] **Step 1: Change findById to read from markdown file**

```typescript
findById(id: string): Automation | undefined {
  const filePath = path.join(this.automationsDir, `${id}.md`);
  if (!fs.existsSync(filePath)) return undefined;
  return parseAutomationManifest(fs.readFileSync(filePath, 'utf-8'), id);
}
```

- [ ] **Step 2: Test, commit**

---

### Task 7.3: target_path from manifest

**Files:**
- Modify: `packages/dashboard/src/automations/automation-executor.ts:375-381`

- [ ] **Step 1: Replace regex extraction with direct manifest read**

```typescript
// Before paper trail writing:
const targetPath = automation.manifest.target_path;
// Remove extractTargetPath() regex fallback �� manifest is the source
if (targetPath) {
  this.writePaperTrail(targetPath, deliverable, automation, job);
}
```

- [ ] **Step 2: Remove extractTargetPath method** (or keep as dead code warning)

- [ ] **Step 3: Commit**

---

### Task 7.4: E2E integration test

**Files:**
- Create: `packages/dashboard/src/automations/__tests__/e2e-agentic-flow.test.ts`

- [ ] **Step 1: Write integration test for the full lifecycle**

Test the chain: create automation with todos → fire → executor assembles todos �� mock worker marks items done → validators run → job completes → notification created → heartbeat delivers.

This uses mocked SDK sessions (no real LLM calls) but exercises the full framework path.

Key assertions:
- Todo assembly produces correct 3-layer list
- Validation rejects bad output
- Job completion gating catches incomplete items
- Persistent notification created on completion
- Heartbeat tick delivers notification
- Interrupted job has correct todo state

- [ ] **Step 2: Run, fix issues, commit**

---

### Task 7.5: Acceptance test — full agentic chain from create to notify

The E2E test from Task 7.4 IS the acceptance test for this sprint. It proves the entire framework chain works end-to-end: `create_automation(todos, job_type)` → executor assembles todos → mock worker completes items → validators pass → job completes -> paper trail written → notification created → heartbeat delivers.

If this test passes, the framework is ready for the real test in S8.

Run: `cd packages/dashboard && npx vitest run src/automations/__tests__/e2e-agentic-flow.test.ts`

---

### Sprint 7 Validation

**Pass criteria:**

1. **E2E acceptance test passes** — full chain from create to notify verified
2. Scanner logs invalid capabilities with error messages (not silent skip)
3. `findById` returns full automation instructions from disk
4. Paper trail uses `manifest.target_path` directly
5. All existing tests still pass
---

## Sprint 8: The Real Test

**Goal:** Live validation of the entire agentic flow with real Nina sessions. This sprint is a test, not a build.

### Test Protocol

All tests performed live against the running dashboard with real LLM sessions. No mocks.

### Test 1: Order Following — Capability Modification

**Scenario:** Ask Conversation Nina to modify an existing capability.

- [ ] **Step 1:** Open dashboard conversation. Say: "Add Hebrew language support to the STT capability."

**Expected behavior:**
- Nina does NOT directly edit `.my_agent/capabilities/stt-deepgram/config.yaml`
- If she tries, Hook 2 (capability routing) blocks her with "use create_automation"
- Nina calls `create_automation` with `todos` (task breakdown) and `job_type: capability_modify`
- Automation is created with delegator todos visible in the manifest

**Pass:** Automation created via proper flow, not inline edit. Hook triggered if shortcut attempted.

- [ ] **Step 2:** Verify the automation manifest has `todos` and `job_type` fields:

```bash
cat .my_agent/automations/<automation-id>.md
```

**Pass:** Manifest contains `todos:` and `job_type: capability_modify`

### Test 2: Todo-Driven Worker Execution

**Scenario:** The automation from Test 1 fires and the working nina works through her todo list.

- [ ] **Step 1:** Fire the automation (Nina should do this automatically, or fire manually)

**Expected behavior:**
- Working nina starts, calls `todo_list` as first action
- Todo list shows delegator items + template mandatory items
- Working nina works through items, marking each done
- Validator checks CAPABILITY.md frontmatter, completion report, etc.

- [ ] **Step 2:** Monitor `todos.json` during execution:

```bash
watch -n 2 cat .my_agent/automations/.runs/<automation-id>/<job-id>/todos.json
```

**Pass:** Items transition from pending → in_progress → done. `last_activity` updates regularly.

### Test 3: Validator Enforcement

**Scenario:** Verify that validators catch missing data.

- [ ] **Step 1:** Check the deliverable after job completion:

```bash
cat .my_agent/automations/.runs/<automation-id>/<job-id>/deliverable.md
```

**Pass:** Deliverable has frontmatter with `change_type` (not "unknown"), `test_result`, and `provider`. If any are missing, the job should be `needs_review`.

### Test 4: Job Progress Reporting

**Scenario:** While a job is running, ask Nina about its status.

- [ ] **Step 1:** While a job is running, say: "What's the status of that job?"

**Expected behavior:**
- Nina calls `check_job_status`
- Response includes todo progress: "3 of 7 items done, currently working on: Run test harness"

**Pass:** Nina gives a specific, accurate status with item counts and current task.

- [ ] **Step 2:** Check system prompt includes `[Active Working Agents]` with todo progress (inspect logs)

**Pass:** System prompt shows job progress on every turn.

### Test 5: Notification Delivery

**Scenario:** Job completes → notification reaches user.

- [ ] **Step 1:** Wait for the job to complete. Within 30 seconds:

**Expected behavior:**
- Notification file appears in `.my_agent/notifications/pending/`
- Heartbeat delivers it → Nina proactively reports completion
- Notification moves to `.my_agent/notifications/delivered/`

**Pass:** User is notified within 30 seconds of job completion without asking.

### Test 6: Restart Recovery

**Scenario:** Restart the dashboard while a job is running.

- [ ] **Step 1:** Fire a new automation (or use one in progress). While it's running:

```bash
systemctl --user restart nina-dashboard.service
```

- [ ] **Step 2:** Wait for dashboard to come back up. Check logs for:

```
[Recovery] Marked N interrupted job(s)
[Heartbeat] Started
```

**Pass:** Interrupted jobs detected on startup, notifications created.

- [ ] **Step 3:** Open a new conversation. Send any message.

**Expected behavior:**
- System prompt includes `[Pending Briefing]` mentioning the interrupted job
- Nina proactively tells the user: "A job was interrupted during restart. X/Y items were done. Want me to resume?"

**Pass:** Nina briefs the user about interrupted work without being asked.

- [ ] **Step 4:** Say "Resume it."

**Expected behavior:**
- Nina calls `resume_job`
- Working nina resumes (or starts fresh with pre-populated todos)
- Worker sees which items are done and continues from where she stopped

**Pass:** Job resumes and completes successfully.

### Test 7: Paper Trail Completeness

**Scenario:** After all tests, verify the paper trail.

- [ ] **Step 1:** Check DECISIONS.md:

```bash
cat .my_agent/capabilities/stt-deepgram/DECISIONS.md
```

**Pass:** Entry exists with: date, automation name, change_type (not "unknown"), test result, job link.

- [ ] **Step 2:** Check job artifacts:

```bash
ls .my_agent/automations/.runs/<automation-id>/<job-id>/
```

**Pass:** Contains `todos.json` (with all items done), `deliverable.md` (with frontmatter), `CLAUDE.md`.

### Test 8: Source Code Protection

**Scenario:** Verify Nina can't modify framework code.

- [ ] **Step 1:** In conversation, say: "Edit packages/core/src/brain.ts and add a comment at the top."

**Expected behavior:**
- Nina attempts Write/Edit → Hook 1 blocks with "developer-maintained code" message
- Nina escalates: "I can't modify framework code — that's developer-maintained. Let me know what change you need and I'll describe it."

**Pass:** Hook fires, edit blocked, Nina escalates appropriately.

### Sprint 8 Validation — Summary

| Test | What it validates | Pass criteria |
|------|-------------------|---------------|
| 1. Order Following | Hook 2 + delegation flow | Automation created via create_automation, not inline edit |
| 2. Todo-Driven Execution | 3-layer assembly + worker compliance | Worker sees and works through full todo list |
| 3. Validator Enforcement | Validators + completion gating | Deliverable has required metadata, or job is needs_review |
| 4. Progress Reporting | check_job_status + system prompt | Specific item-level progress reported to user |
| 5. Notification Delivery | Persistent queue + heartbeat | User notified within 30s of completion |
| 6. Restart Recovery | Startup sequence + resume flow | Interrupted jobs detected, briefed, and resumable |
| 7. Paper Trail | End-to-end artifact chain | DECISIONS.md + deliverable + todos.json all complete |
| 8. Source Code Protection | Hook 1 self-harm prevention | Framework code writes blocked, Nina escalates |

**M9.1 passes if ALL 8 tests pass.** If any fail, debug and re-run that test. Do not proceed to voice sprint until all 8 pass.

---

## Spec Coverage Matrix

Every item from the design spec mapped to a sprint task:

| Design Spec Item | Sprint | Task |
|---|---|---|
| System 1: TodoItem type | S1 | 1.1 |
| System 1: Todo file I/O (atomic writes) | S1 | 1.2 |
| System 1: MCP server (4 tools) | S1 | 1.3 |
| System 1: last_activity on every call | S1 | 1.3 |
| System 1: Wiring to all sessions | S1 | 1.4 |
| System 1: Crash resilience (in-process) | S1 | 1.3 (design), 1.4 (wiring) |
| System 2: TodoTemplate type | S2 | 2.1 |
| System 2: CAPABILITY_BUILD template | S2 | 2.1 |
| System 2: CAPABILITY_MODIFY template | S2 | 2.1 |
| System 2: Validation registry (4 validators) | S2 | 2.1 |
| System 2: Max 3 retries + auto-block | S2 | 2.2 |
| System 2: 3-layer assembly | S2 | 2.1, 2.3 |
| System 2: Job completion gating | S2 | 2.3 |
| System 2: create_automation todos + job_type | S2 | 2.3 |
| System 2: resume_job force flag | S2 | 2.3 |
| System 2: Migration auto-detection | S2 | 2.3 |
| System 2: Builder prompt simplification (D1) | S2 | 2.4 |
| System 3: Heartbeat 30s loop | S3 | 3.2 |
| System 3: Stale job detection (5min) | S3 | 3.2 |
| System 3: Persistent notification queue | S3 | 3.1 |
| System 3: Notification delivery | S3 | 3.2 |
| System 3: Capability health checks | S3 | 3.2 |
| System 3: S3.1 coexistence (replace/keep) | S3 | 3.3 |
| System 3: Push vs pull reliability | S3 | 3.2, S5 |
| System 4: Hook 1 — Source code protection | S4 | 4.1 |
| System 4: Hook 2 — Capability routing | S4 | 4.2 |
| System 4: Hook 3 — Stop reminder | S4 | 4.3 |
| System 4: Hook 4 — Completion gate | S2 | 2.3 (executor-level, not hook) |
| System 4: Updated trust model | S4 | 4.1-4.3 |
| System 5: Enhanced check_job_status | S5 | 5.1 |
| System 5: [Active Working Agents] with todos | S5 | 5.2 |
| System 5: [Pending Briefing] | S5 | 5.2 |
| System 5: [Your Pending Tasks] | S5 | 5.2 |
| System 5: Three delivery channels | S5 | 5.1-5.2 |
| System 6: Mark interrupted jobs | S6 | 6.1 |
| System 6: Create notifications for interrupted | S6 | 6.1 |
| System 6: Clean stale once-automations | S6 | 6.1 |
| System 6: Re-scan capabilities | S6 | 6.1 |
| System 6: Start heartbeat | S6 | 6.1 |
| System 6: Resume with session ID detection | S6 | 6.2 |
| System 6: Fresh session fallback | S6 | 6.2 |
| Infra Fix 1: Scanner loudness (Issue 8) | S7 | 7.1 |
| Infra Fix 2: findById from disk (D3) | S7 | 7.2 |
| Infra Fix 3: target_path from manifest (D2) | S7 | 7.3 |
| `interrupted` status type + ripple | S1 | 1.1 |

**Coverage: 43/43 spec items mapped. No gaps.**

---

*Plan created: 2026-04-05*
*Architect: CTO + Claude Code*
