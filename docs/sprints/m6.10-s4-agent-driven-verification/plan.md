# M6.10-S4: Agent-Driven Verification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the headless App complete enough to replace browser-based testing during sprint QA. Agents drive App directly — no Fastify, no Playwright, no HTTP.

**Architecture:** Extract debug/introspection logic from Fastify route handlers into pure functions. Wrap them in an `AppDebugService` mounted as `app.debug`. Enhance the test harness with SystemPromptBuilder and mock SDK session support. Write agent-style integration tests proving the full QA workflow works headlessly. Document the headless API.

**Tech Stack:** TypeScript, Vitest, AppHarness, SystemPromptBuilder, AsyncGenerator (chat streaming)

**Design spec:** `docs/superpowers/specs/2026-03-16-headless-app-design.md` §S4

**Baseline:** 640 tests, 69 files, 2 skipped

---

## Traceability Matrix

| Spec Requirement | Task | Verification |
|-----------------|------|-------------|
| Agent-style QA scenario (create conv → send msg → assert) | T4 | `agent-qa-scenario.test.ts` passes |
| Agent-style Debug scenario (inspect prompt → verify components) | T3, T5 | `agent-debug-scenario.test.ts` passes |
| Agent-style Task scenario (create → monitor → verify notification) | T6 | `agent-task-scenario.test.ts` passes |
| Debug/Admin API reimplemented as direct App calls | T1, T2 | Debug routes delegate to pure functions; `app.debug.*` returns same data |
| Document headless App API | T7 | `docs/design/headless-api.md` exists |
| All prior tests pass | All | `npx vitest run` — 640+ tests, 0 failures |

---

### Task 1: Extract debug data-assembly into pure functions

**Why:** Debug route handlers in `debug.ts` contain data-assembly logic (brain status, system prompt breakdown, file listing, skill inventory) coupled to Fastify. Extract into importable pure functions so both HTTP routes and headless agents can use them.

**Files:**
- Create: `packages/dashboard/src/debug/debug-queries.ts`
- Create: `packages/dashboard/src/debug/index.ts`
- Modify: `packages/dashboard/src/routes/debug.ts` — delegate to new functions

- [ ] **Step 1: Write failing test for `getBrainStatus()`**

Create `packages/dashboard/tests/integration/agent-debug-scenario.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppHarness } from "./app-harness.js";
import { getBrainStatus } from "../../src/debug/debug-queries.js";

describe("Agent Debug Scenario", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  describe("getBrainStatus()", () => {
    it("returns hatching and auth status", async () => {
      const status = await getBrainStatus(harness.agentDir);
      expect(status).toHaveProperty("hatched");
      expect(status).toHaveProperty("authSource");
      expect(status).toHaveProperty("model");
      expect(typeof status.hatched).toBe("boolean");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/integration/agent-debug-scenario.test.ts`
Expected: FAIL — cannot resolve `../../src/debug/debug-queries.js`

- [ ] **Step 3: Create `debug-queries.ts` with `getBrainStatus()`**

Create `packages/dashboard/src/debug/debug-queries.ts`:

```typescript
/**
 * Debug Queries — Pure functions for agent introspection.
 *
 * Extracted from routes/debug.ts so both HTTP routes and headless agents
 * can access the same data without Fastify.
 */

import { join } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import {
  isHatched,
  resolveAuth,
  loadModels,
  assembleSystemPrompt,
  assembleCalendarContext,
  loadCalendarConfig,
  loadCalendarCredentials,
  createCalDAVClient,
} from "@my-agent/core";

// ── Brain Status ──

export interface BrainStatus {
  hatched: boolean;
  authSource: string | null;
  authType: string | null;
  model: string;
  brainDir: string;
}

export async function getBrainStatus(agentDir: string): Promise<BrainStatus> {
  const hatched = isHatched(agentDir);

  let authSource: string | null = null;
  let authType: string | null = null;

  try {
    const auth = resolveAuth(agentDir);
    authSource = auth.source;
    authType = auth.type;
  } catch {
    authSource = "none";
    authType = "none";
  }

  let model = loadModels(agentDir).sonnet;
  try {
    const configPath = join(agentDir, "config.yaml");
    const configContent = await readFile(configPath, "utf-8");
    const modelMatch = configContent.match(/model:\s*(\S+)/);
    if (modelMatch) {
      model = modelMatch[1];
    }
  } catch {
    // Config not found, use default
  }

  return { hatched, authSource, authType, model, brainDir: agentDir };
}

// ── Brain Files ──

export interface BrainFile {
  path: string;
  size: number;
  modified: string;
}

export async function getBrainFiles(agentDir: string): Promise<{
  root: string;
  files: BrainFile[];
}> {
  const brainDir = join(agentDir, "brain");
  const files = await listFilesRecursive(brainDir);
  return {
    root: brainDir,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

async function listFilesRecursive(
  dir: string,
  basePath: string = "",
): Promise<BrainFile[]> {
  const results: BrainFile[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        const subFiles = await listFilesRecursive(fullPath, relativePath);
        results.push(...subFiles);
      } else if (entry.isFile()) {
        try {
          const stats = await stat(fullPath);
          results.push({
            path: relativePath,
            size: stats.size,
            modified: stats.mtime.toISOString(),
          });
        } catch {
          // Skip files we can't stat
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return results;
}

// ── Skills ──

export interface SkillInfo {
  name: string;
  path: string;
  description?: string;
}

export async function getSkills(
  agentDir: string,
  frameworkSkillsDir: string,
): Promise<{
  framework: SkillInfo[];
  user: SkillInfo[];
}> {
  const frameworkSkills = await loadSkillsFromDir(frameworkSkillsDir);
  const sdkSkillsDir = join(agentDir, ".claude", "skills");
  const userSkills = await loadSkillsFromDir(sdkSkillsDir);
  return { framework: frameworkSkills, user: userSkills };
}

async function loadSkillsFromDir(dir: string): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];
  try {
    const entries = await readdir(dir);
    for (const entry of entries.sort()) {
      const skillMdPath = join(dir, entry, "SKILL.md");
      try {
        const content = await readFile(skillMdPath, "utf-8");
        const firstLine = content
          .split("\n")
          .find((l) => l.trim() && !l.trim().startsWith("#"));
        skills.push({
          name: entry,
          path: join(dir, entry),
          description: firstLine?.trim(),
        });
      } catch {
        // No SKILL.md, skip
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return skills;
}

// ── System Prompt ──

export interface SystemPromptInfo {
  systemPrompt: string;
  components: Record<string, { source: string; chars: number } | null>;
  totalChars: number;
}

export async function getSystemPrompt(
  agentDir: string,
): Promise<SystemPromptInfo> {
  const brainDir = join(agentDir, "brain");

  // Load calendar context if available
  let calendarContext: string | undefined;
  try {
    const calendarConfig = loadCalendarConfig(agentDir);
    const credentials = loadCalendarCredentials(agentDir);
    if (calendarConfig && credentials) {
      const calendarRepo = await createCalDAVClient(calendarConfig, credentials);
      calendarContext = await assembleCalendarContext(calendarRepo);
    }
  } catch {
    // Calendar not configured
  }

  const systemPrompt = await assembleSystemPrompt(brainDir, { calendarContext });

  // Load individual components for breakdown
  const components: Record<string, { source: string; chars: number } | null> = {};

  const componentFiles: Array<{ key: string; source: string; path: string }> = [
    { key: "personality", source: "brain/AGENTS.md", path: join(brainDir, "AGENTS.md") },
    { key: "identity", source: "brain/memory/core/identity.md", path: join(brainDir, "memory/core/identity.md") },
    { key: "contacts", source: "brain/memory/core/contacts.md", path: join(brainDir, "memory/core/contacts.md") },
    { key: "preferences", source: "brain/memory/core/preferences.md", path: join(brainDir, "memory/core/preferences.md") },
  ];

  for (const { key, source, path } of componentFiles) {
    try {
      const content = await readFile(path, "utf-8");
      components[key] = { source, chars: content.length };
    } catch {
      components[key] = null;
    }
  }

  return { systemPrompt, components, totalChars: systemPrompt.length };
}
```

Create `packages/dashboard/src/debug/index.ts`:

```typescript
export {
  getBrainStatus,
  getBrainFiles,
  getSkills,
  getSystemPrompt,
  type BrainStatus,
  type BrainFile,
  type SkillInfo,
  type SystemPromptInfo,
} from "./debug-queries.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/dashboard && npx vitest run tests/integration/agent-debug-scenario.test.ts`
Expected: PASS

- [ ] **Step 5: Add tests for `getBrainFiles()` and `getSystemPrompt()`**

Append to `agent-debug-scenario.test.ts`:

```typescript
  describe("getBrainFiles()", () => {
    it("lists brain directory files", async () => {
      const result = await getBrainFiles(harness.agentDir);
      expect(result.root).toContain("brain");
      expect(result.files.length).toBeGreaterThan(0);
      // AppHarness creates brain/AGENTS.md
      expect(result.files.some(f => f.path === "AGENTS.md")).toBe(true);
    });
  });

  describe("getSystemPrompt()", () => {
    it("returns assembled system prompt", async () => {
      const result = await getSystemPrompt(harness.agentDir);
      expect(result.systemPrompt.length).toBeGreaterThan(0);
      expect(result.totalChars).toBe(result.systemPrompt.length);
      expect(result.components.personality).not.toBeNull();
    });
  });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/integration/agent-debug-scenario.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Refactor `routes/debug.ts` to delegate to `debug-queries.ts`**

In `packages/dashboard/src/routes/debug.ts`, replace the inline implementations for `/brain/status`, `/brain/files`, and `/brain/skills` with calls to the extracted functions. Keep the route registrations — just replace the body.

Example for brain/status:
```typescript
import { getBrainStatus, getBrainFiles, getSkills } from "../debug/debug-queries.js";

// In registerDebugRoutes():
fastify.get("/brain/status", async () => {
  return getBrainStatus(fastify.agentDir);
});
```

- [ ] **Step 8: Run full test suite**

Run: `cd packages/dashboard && npx vitest run`
Expected: 640+ tests pass, 0 failures

- [ ] **Step 9: Commit**

```bash
git add packages/dashboard/src/debug/ packages/dashboard/src/routes/debug.ts packages/dashboard/tests/integration/agent-debug-scenario.test.ts
git commit -m "feat(m6.10-s4): extract debug queries into pure functions for headless access"
```

---

### Task 2: Add `AppDebugService` to App

**Why:** Agents with an App instance should access debug data via `app.debug.*` without importing internal modules. This is the headless replacement for `GET /api/debug/*`.

**Files:**
- Create: `packages/dashboard/src/debug/app-debug-service.ts`
- Modify: `packages/dashboard/src/debug/index.ts` — re-export
- Modify: `packages/dashboard/src/app.ts` — add `debug` namespace
- Modify: `packages/dashboard/tests/integration/app-harness.ts` — add debug service

- [ ] **Step 1: Write failing test**

Add to `agent-debug-scenario.test.ts`:

```typescript
  describe("app.debug (via harness)", () => {
    it("brainStatus() returns same data as standalone function", async () => {
      const standalone = await getBrainStatus(harness.agentDir);
      const viaApp = await harness.debug.brainStatus();
      expect(viaApp).toEqual(standalone);
    });

    it("brainFiles() lists files", async () => {
      const result = await harness.debug.brainFiles();
      expect(result.files.some(f => f.path === "AGENTS.md")).toBe(true);
    });

    it("systemPrompt() returns prompt with components", async () => {
      const result = await harness.debug.systemPrompt();
      expect(result.systemPrompt.length).toBeGreaterThan(0);
      expect(result.components).toHaveProperty("personality");
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/integration/agent-debug-scenario.test.ts`
Expected: FAIL — `harness.debug` is undefined

- [ ] **Step 3: Create `AppDebugService`**

Create `packages/dashboard/src/debug/app-debug-service.ts`:

```typescript
/**
 * AppDebugService — Headless debug/introspection for agents.
 *
 * Replaces HTTP debug routes for headless consumers.
 * All methods return the same data shapes as the corresponding GET /api/debug/* routes.
 */

import type { App } from "../app.js";
import {
  getBrainStatus,
  getBrainFiles,
  getSkills,
  getSystemPrompt,
  type BrainStatus,
  type SystemPromptInfo,
} from "./debug-queries.js";

export class AppDebugService {
  constructor(
    private agentDir: string,
    private frameworkSkillsDir?: string,
  ) {}

  async brainStatus(): Promise<BrainStatus> {
    return getBrainStatus(this.agentDir);
  }

  async brainFiles() {
    return getBrainFiles(this.agentDir);
  }

  async systemPrompt(): Promise<SystemPromptInfo> {
    return getSystemPrompt(this.agentDir);
  }

  async skills() {
    const skillsDir = this.frameworkSkillsDir ?? "";
    return getSkills(this.agentDir, skillsDir);
  }
}
```

Update `packages/dashboard/src/debug/index.ts` to re-export:

```typescript
export { AppDebugService } from "./app-debug-service.js";
```

- [ ] **Step 4: Mount `app.debug` on App**

In `packages/dashboard/src/app.ts`:

1. Import: `import { AppDebugService } from "./debug/app-debug-service.js";`
2. Add property: `debug!: AppDebugService;` (alongside other service namespaces)
3. In `App.create()`, after service namespaces block (~line 1034):
```typescript
app.debug = new AppDebugService(agentDir);
```

- [ ] **Step 5: Add debug to AppHarness**

In `packages/dashboard/tests/integration/app-harness.ts`:

1. Import: `import { AppDebugService } from "../../src/debug/app-debug-service.js";`
2. Add property: `readonly debug: AppDebugService;`
3. In constructor: `this.debug = new AppDebugService(agentDir);`

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/integration/agent-debug-scenario.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 7: Run full test suite**

Run: `cd packages/dashboard && npx vitest run`
Expected: 640+ tests, 0 failures

- [ ] **Step 8: Commit**

```bash
git add packages/dashboard/src/debug/app-debug-service.ts packages/dashboard/src/debug/index.ts packages/dashboard/src/app.ts packages/dashboard/tests/integration/app-harness.ts packages/dashboard/tests/integration/agent-debug-scenario.test.ts
git commit -m "feat(m6.10-s4): add AppDebugService for headless agent introspection"
```

---

### Task 3: Add mock SDK session support to AppHarness

**Why:** `sendMessage()` needs an SDK session to stream responses. For headless testing without the LLM, we need a mock session that returns predictable streaming events. This is the key enabler for agent QA testing without a browser.

**Files:**
- Create: `packages/dashboard/tests/integration/mock-session.ts`
- Modify: `packages/dashboard/tests/integration/app-harness.ts` — wire mock session via SessionRegistry

- [ ] **Step 1: Study SessionManager interface**

Read `packages/dashboard/src/agent/session-manager.ts` to understand what `SessionRegistry.getOrCreate()` returns. The SessionManager must have a `streamMessage(content)` method that returns an AsyncGenerator of StreamEvents.

Read `packages/dashboard/src/agent/session-registry.ts` to understand how sessions are stored and retrieved.

- [ ] **Step 2: Write failing test for mock session**

Create `packages/dashboard/tests/integration/agent-qa-scenario.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppHarness } from "./app-harness.js";
import { installMockSession } from "./mock-session.js";
import type { ChatEvent } from "../../src/chat/chat-service.js";

describe("Agent QA Scenario", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
    installMockSession(harness, {
      response: "Hello! I'm the test agent.",
    });
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("sends a message and collects streaming response", async () => {
    // Create conversation
    const { conversation } = await harness.chat.newConversation();

    // Send message and collect all events
    const events: ChatEvent[] = [];
    for await (const event of harness.chat.sendMessage(
      conversation.id,
      "Hello agent",
      1,
    )) {
      events.push(event);
    }

    // Verify streaming event sequence
    const types = events.map((e) => e.type);
    expect(types).toContain("start");
    expect(types).toContain("text");
    expect(types).toContain("done");

    // Verify response content
    const textEvents = events.filter((e) => e.type === "text");
    const fullText = textEvents.map((e) => (e as any).content).join("");
    expect(fullText).toBe("Hello! I'm the test agent.");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/integration/agent-qa-scenario.test.ts`
Expected: FAIL — cannot resolve `./mock-session.js`

- [ ] **Step 4: Implement mock session**

Create `packages/dashboard/tests/integration/mock-session.ts`:

Study `session-registry.ts` and `session-manager.ts` to understand the exact interface. The mock must:
1. Return an object from `sessionRegistry.getOrCreate()` that has `streamMessage()` returning an AsyncGenerator of the events ChatService expects
2. Support configurable response text

The implementation depends on the exact `SessionManager` / `StreamEvent` types discovered in Step 1. The mock should yield events matching the real stream processor's output shape:
- `{ type: "text", text: "..." }` for content deltas
- `{ type: "stop_turn" }` for completion

```typescript
import type { AppHarness } from "./app-harness.js";

export interface MockSessionOptions {
  response: string;
}

export function installMockSession(
  harness: AppHarness,
  options: MockSessionOptions,
): void {
  // Override sessionRegistry.getOrCreate to return a mock session
  // that yields the configured response as streaming events.
  // Exact implementation depends on SessionManager interface (Step 1).
  const mockSession = {
    async *streamMessage(_content: string) {
      yield { type: "text" as const, text: options.response };
      yield { type: "stop_turn" as const };
    },
    // Add other required SessionManager methods as no-ops
    getSessionId: () => "mock-session-id",
    sdkSessionId: null as string | null,
  };

  harness.sessionRegistry.getOrCreate = async () => mockSession as any;
}
```

**Note:** The exact shape of the mock will need to match what `ChatService.sendMessage()` calls on the session. The implementer MUST read `chat-service.ts:sendMessage()` and `session-manager.ts` to determine the exact method names, parameter shapes, and yield types. The code above is a starting template — adjust based on what you find.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/dashboard && npx vitest run tests/integration/agent-qa-scenario.test.ts`
Expected: PASS

- [ ] **Step 6: Add test for conversation transcript persistence**

Append to the QA scenario test:

```typescript
  it("persists user message and response in transcript", async () => {
    const { conversation } = await harness.chat.newConversation();

    // Consume the full stream
    for await (const _event of harness.chat.sendMessage(
      conversation.id,
      "Hello agent",
      1,
    )) {
      // drain
    }

    // Verify transcript has both turns
    const loaded = await harness.chat.switchConversation(conversation.id);
    expect(loaded.turns.length).toBeGreaterThanOrEqual(2);

    const userTurn = loaded.turns.find((t) => t.role === "user");
    expect(userTurn?.content).toContain("Hello agent");

    const assistantTurn = loaded.turns.find((t) => t.role === "assistant");
    expect(assistantTurn?.content).toContain("Hello! I'm the test agent.");
  });
```

- [ ] **Step 7: Run tests**

Run: `cd packages/dashboard && npx vitest run tests/integration/agent-qa-scenario.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 8: Run full test suite**

Run: `cd packages/dashboard && npx vitest run`
Expected: 640+ tests, 0 failures

- [ ] **Step 9: Commit**

```bash
git add packages/dashboard/tests/integration/mock-session.ts packages/dashboard/tests/integration/agent-qa-scenario.test.ts
git commit -m "feat(m6.10-s4): add mock SDK session + agent QA scenario tests"
```

---

### Task 4: Agent QA scenario — full chat flow with events

**Why:** Prove a QA agent can do everything the browser does: create conversation, send message, listen for streaming events, verify the response, check conversation state — all headlessly.

**Files:**
- Modify: `packages/dashboard/tests/integration/agent-qa-scenario.test.ts` — add event-driven tests

- [ ] **Step 1: Add test for streaming event monitoring**

```typescript
  it("emits chat:done event on App after stream completes", async () => {
    const { conversation } = await harness.chat.newConversation();

    const doneEvents: any[] = [];
    harness.emitter.on("chat:done", (convId, cost, usage) => {
      doneEvents.push({ convId, cost, usage });
    });

    for await (const _event of harness.chat.sendMessage(
      conversation.id,
      "Hello",
      1,
    )) {
      // drain
    }

    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].convId).toBe(conversation.id);
  });
```

- [ ] **Step 2: Add test for multi-turn conversation**

```typescript
  it("supports multi-turn conversation headlessly", async () => {
    const { conversation } = await harness.chat.newConversation();

    // Turn 1
    for await (const _e of harness.chat.sendMessage(
      conversation.id,
      "First message",
      1,
    )) {}

    // Turn 2
    for await (const _e of harness.chat.sendMessage(
      conversation.id,
      "Second message",
      2,
    )) {}

    // Verify both turns persisted
    const loaded = await harness.chat.switchConversation(conversation.id);
    const userTurns = loaded.turns.filter((t) => t.role === "user");
    expect(userTurns).toHaveLength(2);
  });
```

- [ ] **Step 3: Run tests**

Run: `cd packages/dashboard && npx vitest run tests/integration/agent-qa-scenario.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/tests/integration/agent-qa-scenario.test.ts
git commit -m "test(m6.10-s4): agent QA scenario — streaming events + multi-turn"
```

---

### Task 5: Agent Debug scenario — full introspection without HTTP

**Why:** Prove a QA agent can inspect system prompt, brain status, file inventory, and skills — everything in the debug API — without HTTP.

**Files:**
- Modify: `packages/dashboard/tests/integration/agent-debug-scenario.test.ts` — add comprehensive debug tests

- [ ] **Step 1: Add full debug inspection scenario**

Append to `agent-debug-scenario.test.ts`:

```typescript
  describe("Full debug inspection (replaces browser-based QA)", () => {
    it("agent can verify brain is not hatched in test env", async () => {
      const status = await harness.debug.brainStatus();
      expect(status.hatched).toBe(false);
      expect(status.authSource).toBe("none");
    });

    it("agent can inspect system prompt components", async () => {
      const prompt = await harness.debug.systemPrompt();

      // Verify personality component (AGENTS.md created by AppHarness)
      expect(prompt.components.personality).not.toBeNull();
      expect(prompt.components.personality!.source).toBe("brain/AGENTS.md");
      expect(prompt.components.personality!.chars).toBeGreaterThan(0);

      // Total prompt assembled
      expect(prompt.totalChars).toBeGreaterThan(0);
    });

    it("agent can list all brain files", async () => {
      const files = await harness.debug.brainFiles();
      expect(files.files.length).toBeGreaterThan(0);

      // Every file has required fields
      for (const f of files.files) {
        expect(f.path).toBeTruthy();
        expect(typeof f.size).toBe("number");
        expect(f.modified).toMatch(/\d{4}-\d{2}-\d{2}/);
      }
    });
  });
```

- [ ] **Step 2: Run tests**

Run: `cd packages/dashboard && npx vitest run tests/integration/agent-debug-scenario.test.ts`
Expected: PASS (9 tests total)

- [ ] **Step 3: Run full suite**

Run: `cd packages/dashboard && npx vitest run`
Expected: 640+ tests, 0 failures

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/tests/integration/agent-debug-scenario.test.ts
git commit -m "test(m6.10-s4): agent debug scenario — headless introspection"
```

---

### Task 6: Agent Task scenario — headless task lifecycle

**Why:** Prove a QA agent can create a task, listen for execution events, and verify completion notification — all via App methods.

**Files:**
- Create: `packages/dashboard/tests/integration/agent-task-scenario.test.ts`

- [ ] **Step 1: Write task lifecycle scenario test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppHarness } from "./app-harness.js";

describe("Agent Task Scenario", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create();
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("creates task and receives events headlessly", async () => {
    const events: any[] = [];
    harness.emitter.on("task:created", (task) =>
      events.push({ type: "created", task }),
    );
    harness.emitter.on("task:updated", (task) =>
      events.push({ type: "updated", task }),
    );

    // Create task via App namespace
    const task = harness.tasks.create({
      type: "immediate",
      sourceType: "manual",
      createdBy: "agent",
      title: "Test task from agent",
      instructions: "Do something useful",
    });

    expect(task.id).toBeTruthy();
    expect(task.title).toBe("Test task from agent");

    // Verify creation event fired
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("created");
    expect(events[0].task.id).toBe(task.id);
  });

  it("updates task status and receives event", async () => {
    const events: any[] = [];
    harness.emitter.on("task:updated", (task) => events.push(task));

    const task = harness.tasks.create({
      type: "immediate",
      sourceType: "manual",
      createdBy: "agent",
      title: "Status test",
      instructions: "Test status transitions",
    });

    // Update status
    harness.tasks.update(task.id, { status: "running" });

    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("running");

    // Verify via direct read
    const found = harness.tasks.findById(task.id);
    expect(found?.status).toBe("running");
  });

  it("deletes task and receives event", async () => {
    const deletedIds: string[] = [];
    harness.emitter.on("task:deleted", (id) => deletedIds.push(id));

    const task = harness.tasks.create({
      type: "immediate",
      sourceType: "manual",
      createdBy: "agent",
      title: "Delete test",
      instructions: "To be deleted",
    });

    harness.tasks.delete(task.id);

    expect(deletedIds).toEqual([task.id]);
    expect(harness.tasks.findById(task.id)).toBeNull();
  });

  it("task lifecycle: create → run → complete (full scenario)", async () => {
    const allEvents: Array<{ type: string; status?: string }> = [];

    harness.emitter.on("task:created", (task) =>
      allEvents.push({ type: "created", status: task.status }),
    );
    harness.emitter.on("task:updated", (task) =>
      allEvents.push({ type: "updated", status: task.status }),
    );
    harness.emitter.on("notification:created", () =>
      allEvents.push({ type: "notification" }),
    );

    // Create
    const task = harness.tasks.create({
      type: "immediate",
      sourceType: "manual",
      createdBy: "agent",
      title: "Full lifecycle",
      instructions: "Agent-driven lifecycle test",
    });

    // Run
    harness.tasks.update(task.id, { status: "running" });

    // Complete
    harness.tasks.update(task.id, { status: "completed" });

    // Verify event sequence
    expect(allEvents.map((e) => e.type)).toEqual([
      "created",
      "updated",
      "updated",
    ]);
    expect(allEvents[1].status).toBe("running");
    expect(allEvents[2].status).toBe("completed");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd packages/dashboard && npx vitest run tests/integration/agent-task-scenario.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 3: Run full suite**

Run: `cd packages/dashboard && npx vitest run`
Expected: 640+ tests, 0 failures

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/tests/integration/agent-task-scenario.test.ts
git commit -m "test(m6.10-s4): agent task scenario — headless task lifecycle"
```

---

### Task 7: Document headless API

**Why:** Sprint QA agents need a reference doc to know what's available. This is the "how to test without a browser" guide.

**Files:**
- Create: `docs/design/headless-api.md`

- [ ] **Step 1: Write the headless API reference**

Create `docs/design/headless-api.md` documenting:

1. **Quick Start** — how to create an App instance for testing
2. **Service Namespaces** — `app.chat`, `app.tasks`, `app.conversations`, `app.debug`, `app.memory`, `app.calendar`
3. **Events** — full `AppEventMap` with descriptions
4. **Common QA Patterns** — code snippets for:
   - Sending a message and verifying response
   - Inspecting system prompt
   - Creating/monitoring tasks
   - Verifying conversation state
5. **AppHarness** — how to use it for integration testing
6. **Mock Sessions** — how to test chat without the LLM
7. **Migration from HTTP** — mapping debug HTTP routes to `app.debug.*` calls

Content should be derived from the actual interfaces in `app.ts`, `app-events.ts`, `chat-service.ts`, and `debug/app-debug-service.ts`.

- [ ] **Step 2: Run full test suite (final verification)**

Run: `cd packages/dashboard && npx vitest run`
Expected: 640+ tests, 0 failures. No regressions.

- [ ] **Step 3: Commit**

```bash
git add docs/design/headless-api.md
git commit -m "docs(m6.10-s4): headless API reference for agent consumers"
```
