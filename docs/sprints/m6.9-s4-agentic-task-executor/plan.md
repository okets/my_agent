# M6.9-S4: Agentic Task Executor — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the task executor from text-in/text-out to a full Agent SDK session with tools, bash, MCP servers, infrastructure protection hooks, and an autonomous "get shit done" persona — so every task becomes an autonomous agent.

**Architecture:** Extend `createBrainQuery()` with `cwd`, `tools`, `persistSession` fields. Build a separate "working Nina" system prompt (autonomous persona, temporal context, properties). Add infrastructure protection hooks (file guards + bash pattern guards) at the task trust level. Wire Playwright MCP for both conversation Nina and working Nina. Validate deferred tool loading via PoC.

**Tech Stack:** Agent SDK v0.2.74, `@playwright/mcp`, `uv` (Python), existing hook factory pattern.

**Spec:** `docs/superpowers/specs/2026-03-14-agentic-task-executor-design.md`

---

## Chunk 1: Foundation (Tasks 1–4)

### Task 1: PoC — Deferred Tool Loading via Agent SDK

Validate that `defer_loading: true` works when passed through the SDK's `query()` function. The Anthropic article describes this as a real API feature, but the SDK TypeScript types don't expose it. We need to prove it works end-to-end before committing to the design.

**Files:**
- Create: `packages/core/src/poc/deferred-tool-loading.ts`

- [ ] **Step 1: Write the PoC script**

The Anthropic advanced tool use article shows `defer_loading: true` on tool definitions in the raw API. We need to test whether the Agent SDK forwards this flag. The SDK's TypeScript types don't expose `defer_loading` on MCP configs, so we test two approaches:

**Approach A:** Create an in-process MCP server with many tools and see if Claude Code auto-defers them.

**Approach B:** Use the raw `tool()` helper from the SDK to register tools, passing `defer_loading` via type assertion.

```typescript
// packages/core/src/poc/deferred-tool-loading.ts
//
// Proves: defer_loading works through the Agent SDK.
// Run: cd packages/core && npx tsx src/poc/deferred-tool-loading.ts
//
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

async function main() {
  console.log("=== Deferred Tool Loading PoC ===\n");

  // Create an MCP server with many tools to trigger auto-deferral
  const dummyTools = Array.from({ length: 20 }, (_, i) =>
    tool(
      `dummy_tool_${i}`,
      `Dummy tool number ${i} for testing deferred loading`,
      { input: z.string() },
      async () => ({ content: [{ type: "text" as const, text: `Tool ${i} called` }] }),
    ),
  );

  const testServer = createSdkMcpServer({
    name: "deferred-test",
    tools: dummyTools,
  });

  const q = query({
    prompt:
      "List ALL tools available to you. Specifically: (1) Do you see a ToolSearch tool? (2) Can you see tools named dummy_tool_0 through dummy_tool_19 in your tool list? (3) Are any tools listed as 'deferred' or in an <available-deferred-tools> block? Report exactly what you observe.",
    options: {
      model: "claude-sonnet-4-6",
      systemPrompt: "You are a test agent. Report exactly what tools you can access.",
      tools: ["Read"],
      permissionMode: "bypassPermissions" as any,
      persistSession: false,
      maxTurns: 1,
      mcpServers: {
        "deferred-test": { type: "sdk" as const, name: "deferred-test", instance: testServer } as any,
      },
    },
  });

  let fullResponse = "";
  for await (const message of q) {
    if (message.type === "assistant" && "content" in message) {
      for (const block of message.content as any[]) {
        if (block.type === "text") {
          fullResponse += block.text;
        }
      }
    }
  }

  console.log("Response:", fullResponse);
  console.log("\n=== PoC Complete ===");
}

main().catch(console.error);
```

- [ ] **Step 2: Run the PoC and observe behavior**

Run: `cd /home/nina/my_agent/packages/core && npx tsx src/poc/deferred-tool-loading.ts`

Observe:
- Does the SDK accept `defer_loading` on tool/MCP configs without error?
- Does `ToolSearch` appear in the available tools?
- Are deferred tools hidden from the initial tool list?

- [ ] **Step 3: Document findings**

If it works: note the exact config shape that enables it.
If it doesn't: note the error or behavior. We'll use system-prompt-based deferral as fallback (list tool names in prompt text without schemas).

- [ ] **Step 4: Clean up**

Delete the PoC file after documenting findings in `DECISIONS.md`.

---

### Task 2: Shared Timezone Utility

Extract `resolveTimezone()` from `WorkLoopScheduler` (private method) into a shared utility so the task executor can use it without depending on the scheduler.

**Files:**
- Create: `packages/dashboard/src/utils/timezone.ts`
- Modify: `packages/dashboard/src/scheduler/work-loop-scheduler.ts:376-397`
- Test: `packages/dashboard/tests/utils/timezone.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/dashboard/tests/utils/timezone.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the dashboard readProperties (returns PropertiesMap)
vi.mock("../../src/conversations/properties.js", () => ({
  readProperties: vi.fn(),
}));

vi.mock("@my-agent/core", () => ({
  loadPreferences: vi.fn(),
}));

import { resolveTimezone } from "../../src/utils/timezone.js";
import { readProperties } from "../../src/conversations/properties.js";
import { loadPreferences } from "@my-agent/core";

describe("resolveTimezone", () => {
  const agentDir = "/tmp/test-agent";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns timezone from properties when available", async () => {
    (readProperties as any).mockResolvedValue({
      timezone: { value: "Asia/Bangkok (UTC+7)" },
    });
    expect(await resolveTimezone(agentDir)).toBe("Asia/Bangkok");
  });

  it("falls back to preferences when properties unavailable", async () => {
    (readProperties as any).mockRejectedValue(new Error("no file"));
    (loadPreferences as any).mockReturnValue({ timezone: "Europe/London" });
    expect(await resolveTimezone(agentDir)).toBe("Europe/London");
  });

  it("falls back to UTC when nothing configured", async () => {
    (readProperties as any).mockRejectedValue(new Error("no file"));
    (loadPreferences as any).mockReturnValue({});
    expect(await resolveTimezone(agentDir)).toBe("UTC");
  });

  it("strips parenthetical from properties timezone", async () => {
    (readProperties as any).mockResolvedValue({
      timezone: { value: "America/New_York (Eastern Time)" },
    });
    expect(await resolveTimezone(agentDir)).toBe("America/New_York");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/utils/timezone.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the utility**

```typescript
// packages/dashboard/src/utils/timezone.ts
import { readProperties } from "../conversations/properties.js";
import { loadPreferences } from "@my-agent/core";

/**
 * Resolve the agent's timezone.
 * Priority: properties/status.yaml → preferences.timezone → "UTC"
 */
export async function resolveTimezone(agentDir: string): Promise<string> {
  try {
    const props = await readProperties(agentDir);
    if (props.timezone?.value) {
      const raw = props.timezone.value.split(/\s*\(/)[0].trim();
      if (isValidTimezone(raw)) return raw;
    }
  } catch {
    // Properties unavailable — continue to preferences
  }

  try {
    const prefs = loadPreferences(agentDir);
    if (prefs.timezone) return prefs.timezone;
  } catch {
    // Preferences unavailable — continue to fallback
  }

  return "UTC";
}

function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/utils/timezone.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Update WorkLoopScheduler to use shared utility**

In `packages/dashboard/src/scheduler/work-loop-scheduler.ts`:

Replace the private `resolveTimezone()` method (lines ~376–397) with an import:

```typescript
// Add import at top of file:
import { resolveTimezone } from "../utils/timezone.js";

// Replace the private method body. Change:
private async resolveTimezone(): Promise<string> {
  // ... 20 lines of implementation ...
}
// To:
private async resolveTimezone(): Promise<string> {
  return resolveTimezone(this.agentDir);
}
```

- [ ] **Step 6: Run existing scheduler tests to verify no regression**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/scheduler/`
Expected: All existing tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/utils/timezone.ts packages/dashboard/tests/utils/timezone.test.ts packages/dashboard/src/scheduler/work-loop-scheduler.ts
git commit -m "refactor: extract resolveTimezone to shared utility"
```

---

### Task 3: Infrastructure Protection Hooks

Add infrastructure file path guards (Write/Edit) and extended bash pattern guards to the task trust level. Currently, task level only has bash blocker — no file path protection.

**Files:**
- Modify: `packages/core/src/hooks/safety.ts`
- Modify: `packages/core/src/hooks/factory.ts`
- Test: `packages/core/tests/hooks/infrastructure-guard.test.ts`

- [ ] **Step 1: Write failing tests for the infrastructure guard**

```typescript
// packages/core/tests/hooks/infrastructure-guard.test.ts
import { describe, it, expect } from "vitest";
import { createInfrastructureGuard } from "../../src/hooks/safety.js";

describe("createInfrastructureGuard", () => {
  const agentDir = "/home/nina/.my_agent";
  const guard = createInfrastructureGuard(agentDir);

  // Helper to build hook input for Write/Edit tools
  function makeInput(toolName: string, filePath: string) {
    return {
      hook_event_name: "PreToolUse" as const,
      tool_name: toolName,
      tool_input: { file_path: filePath },
      tool_use_id: "test-id",
    };
  }

  // Protected paths — should DENY
  it("blocks Write to brain/CLAUDE.md", async () => {
    const result = await guard(
      makeInput("Write", `${agentDir}/brain/CLAUDE.md`) as any,
      "test-id",
      { signal: AbortSignal.timeout(5000) }
    );
    expect(result.decision).toBe("block");
  });

  it("blocks Edit to brain/skills/any-skill.md", async () => {
    const result = await guard(
      makeInput("Edit", `${agentDir}/brain/skills/example.md`) as any,
      "test-id",
      { signal: AbortSignal.timeout(5000) }
    );
    expect(result.decision).toBe("block");
  });

  it("blocks Write to config.yaml", async () => {
    const result = await guard(
      makeInput("Write", `${agentDir}/config.yaml`) as any,
      "test-id",
      { signal: AbortSignal.timeout(5000) }
    );
    expect(result.decision).toBe("block");
  });

  it("blocks Write to .env", async () => {
    const result = await guard(
      makeInput("Write", "/home/nina/my_agent/packages/dashboard/.env") as any,
      "test-id",
      { signal: AbortSignal.timeout(5000) }
    );
    expect(result.decision).toBe("block");
  });

  it("blocks Write to auth/ directory", async () => {
    const result = await guard(
      makeInput("Write", `${agentDir}/auth/whatsapp-creds.json`) as any,
      "test-id",
      { signal: AbortSignal.timeout(5000) }
    );
    expect(result.decision).toBe("block");
  });

  it("blocks Write to .db files", async () => {
    const result = await guard(
      makeInput("Write", `${agentDir}/agent.db`) as any,
      "test-id",
      { signal: AbortSignal.timeout(5000) }
    );
    expect(result.decision).toBe("block");
  });

  it("blocks Write to .guardrails", async () => {
    const result = await guard(
      makeInput("Write", "/home/nina/my_agent/.guardrails") as any,
      "test-id",
      { signal: AbortSignal.timeout(5000) }
    );
    expect(result.decision).toBe("block");
  });

  it("blocks Write to .git/hooks/", async () => {
    const result = await guard(
      makeInput("Write", "/home/nina/my_agent/.git/hooks/pre-commit") as any,
      "test-id",
      { signal: AbortSignal.timeout(5000) }
    );
    expect(result.decision).toBe("block");
  });

  it("blocks Write to .service files", async () => {
    const result = await guard(
      makeInput("Write", "/home/nina/.config/systemd/user/nina-dashboard.service") as any,
      "test-id",
      { signal: AbortSignal.timeout(5000) }
    );
    expect(result.decision).toBe("block");
  });

  // Allowed paths — should pass through (no decision)
  it("allows Write to notebook/", async () => {
    const result = await guard(
      makeInput("Write", `${agentDir}/notebook/reference/notes.md`) as any,
      "test-id",
      { signal: AbortSignal.timeout(5000) }
    );
    expect(result.decision).toBeUndefined();
  });

  it("allows Write to task workspace", async () => {
    const result = await guard(
      makeInput("Write", `${agentDir}/tasks/abc123/workspace/script.py`) as any,
      "test-id",
      { signal: AbortSignal.timeout(5000) }
    );
    expect(result.decision).toBeUndefined();
  });

  it("allows Write to properties/", async () => {
    const result = await guard(
      makeInput("Write", `${agentDir}/properties/status.yaml`) as any,
      "test-id",
      { signal: AbortSignal.timeout(5000) }
    );
    expect(result.decision).toBeUndefined();
  });

  // Fail-closed: if hook throws, operation should be denied
  it("denies on error (fail-closed)", async () => {
    const badGuard = createInfrastructureGuard(agentDir);
    const result = await badGuard(
      { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: null } as any,
      "test-id",
      { signal: AbortSignal.timeout(5000) }
    );
    expect(result.decision).toBe("block");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/nina/my_agent/packages/core && npx vitest run tests/hooks/infrastructure-guard.test.ts`
Expected: FAIL — `createInfrastructureGuard` not found

- [ ] **Step 3: Implement `createInfrastructureGuard` in safety.ts**

Add to `packages/core/src/hooks/safety.ts`:

```typescript
/**
 * Infrastructure guard for task-level agents.
 * Blocks Write/Edit to protected infrastructure files.
 * Fail-closed: denies on error (a bug should not disable protection).
 */
export function createInfrastructureGuard(agentDir: string): HookCallback {
  const protectedPatterns: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: new RegExp(`${escapeRegex(agentDir)}/brain/CLAUDE\\.md$`), reason: "Identity file — conversation Nina's domain" },
    { pattern: new RegExp(`${escapeRegex(agentDir)}/brain/skills/`), reason: "Brain-level skills — not modifiable by tasks" },
    { pattern: new RegExp(`${escapeRegex(agentDir)}/config\\.yaml$`), reason: "Agent configuration" },
    { pattern: /\.env$/, reason: "Environment secrets" },
    { pattern: new RegExp(`${escapeRegex(agentDir)}/auth/`), reason: "Channel credentials" },
    { pattern: /\.db$/, reason: "Database files" },
    { pattern: /\.guardrails$/, reason: "Safety patterns" },
    { pattern: /\.git\/hooks\//, reason: "Git hook scripts" },
    { pattern: /\.service$/, reason: "Systemd service definitions" },
  ];

  return async (input, _toolUseId, _options) => {
    try {
      // Cast to PreToolUseHookInput for type-safe access (matches existing pattern in createBashBlocker)
      const preInput = input as PreToolUseHookInput;
      const toolInput = preInput.tool_input as Record<string, unknown> | null;
      const filePath = toolInput?.file_path as string | undefined;

      if (!filePath) {
        // No file path in input — fail closed
        return {
          decision: "block" as const,
          reason: "Infrastructure guard: no file_path in tool input",
        };
      }

      for (const { pattern, reason } of protectedPatterns) {
        if (pattern.test(filePath)) {
          return {
            decision: "block" as const,
            reason: `Infrastructure guard: ${reason}`,
            systemMessage: `Blocked: ${reason}. This file is protected infrastructure. Try an alternative approach or write to your workspace instead.`,
            hookSpecificOutput: {
              hookEventName: "PreToolUse" as const,
              permissionDecision: "deny" as const,
              permissionDecisionReason: reason,
            },
          };
        }
      }

      // Not a protected path — allow
      return {};
    } catch (err) {
      // Fail closed — deny on error (spec §3.1: bug in guard must not disable protection)
      return {
        decision: "block" as const,
        reason: `Infrastructure guard error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 4: Write tests for extended bash patterns**

Add to the same test file or create `packages/core/tests/hooks/bash-blocker-extended.test.ts`:

```typescript
// packages/core/tests/hooks/bash-blocker-extended.test.ts
import { describe, it, expect } from "vitest";
import { createBashBlocker } from "../../src/hooks/safety.js";

describe("createBashBlocker — extended patterns for task level", () => {
  const blocker = createBashBlocker();

  function makeInput(command: string) {
    return {
      hook_event_name: "PreToolUse" as const,
      tool_name: "Bash",
      tool_input: { command },
      tool_use_id: "test-id",
    };
  }

  it("blocks systemctl stop nina-*", async () => {
    const result = await blocker(
      makeInput("systemctl stop nina-dashboard") as any,
      "test-id",
      { signal: AbortSignal.timeout(5000) }
    );
    expect(result.decision).toBe("block");
  });

  it("blocks systemctl disable nina-*", async () => {
    const result = await blocker(
      makeInput("systemctl disable nina-brain.service") as any,
      "test-id",
      { signal: AbortSignal.timeout(5000) }
    );
    expect(result.decision).toBe("block");
  });

  it("blocks kill targeting nina processes", async () => {
    const result = await blocker(
      makeInput("kill $(pgrep -f nina)") as any,
      "test-id",
      { signal: AbortSignal.timeout(5000) }
    );
    expect(result.decision).toBe("block");
  });

  it("blocks chmod 000 on protected paths", async () => {
    const result = await blocker(
      makeInput("chmod 000 /home/nina/.my_agent/config.yaml") as any,
      "test-id",
      { signal: AbortSignal.timeout(5000) }
    );
    expect(result.decision).toBe("block");
  });

  it("allows normal bash commands", async () => {
    const result = await blocker(
      makeInput("ls -la /tmp") as any,
      "test-id",
      { signal: AbortSignal.timeout(5000) }
    );
    expect(result.decision).toBeUndefined();
  });

  it("allows systemctl status (non-destructive)", async () => {
    const result = await blocker(
      makeInput("systemctl --user status nina-dashboard") as any,
      "test-id",
      { signal: AbortSignal.timeout(5000) }
    );
    expect(result.decision).toBeUndefined();
  });
});
```

- [ ] **Step 5: Add extended bash patterns to `createBashBlocker()`**

In `packages/core/src/hooks/safety.ts`, extend the `BLOCKED_PATTERNS` array:

```typescript
// Add these to the existing BLOCKED_BASH_PATTERNS array (plain RegExp values):
/systemctl\s+(stop|disable)\s+nina-/i,   // Cannot stop/disable own services
/kill\s+.*nina/i,                          // Cannot kill own processes
/chmod\s+000\s/i,                          // Cannot destroy file permissions
/chown\s+.*\/(brain|config|auth|\.env)/i,  // Cannot change ownership of protected files
```

- [ ] **Step 6: Run all hook tests**

Run: `cd /home/nina/my_agent/packages/core && npx vitest run tests/hooks/`
Expected: All tests PASS

- [ ] **Step 7: Update factory.ts — wire infrastructure guard to task level**

In `packages/core/src/hooks/factory.ts`, add the infrastructure guard to the task trust level:

```typescript
// Add import:
import { createInfrastructureGuard } from "./safety.js";

// In createHooks(), for the 'task' trust level, add Write/Edit matcher:
// After the existing Bash matcher (lines ~35-42), add:
if (trustLevel === "task" || trustLevel === "subagent") {
  preToolUse.push({
    matcher: "Write|Edit",
    hooks: [createInfrastructureGuard(options?.agentDir ?? "")],
  });
}
```

- [ ] **Step 8: Export `createInfrastructureGuard` from hooks index**

Update `packages/core/src/hooks/index.ts` to export `createInfrastructureGuard`.

- [ ] **Step 9: Run full test suite to verify no regression**

Run: `cd /home/nina/my_agent/packages/core && npx vitest run`
Expected: All tests PASS

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/hooks/safety.ts packages/core/src/hooks/factory.ts packages/core/src/hooks/index.ts packages/core/tests/hooks/
git commit -m "feat: infrastructure protection hooks for task-level agents"
```

---

### Task 4: Extend `createBrainQuery()` with `cwd`, `tools`, `persistSession`

Add the missing fields to `BrainSessionOptions` so the task executor can configure full agentic sessions through the existing abstraction.

**Files:**
- Modify: `packages/core/src/brain.ts:25-40` (BrainSessionOptions)
- Modify: `packages/core/src/brain.ts:53-150` (createBrainQuery implementation)
- Test: `packages/core/tests/brain-options.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/tests/brain-options.test.ts
import { describe, it, expect, vi } from "vitest";

// Mock the SDK to capture what options are passed
let capturedOptions: any = null;
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn((params: any) => {
    capturedOptions = params.options;
    return (async function* () {})(); // empty async generator
  }),
}));

import { createBrainQuery } from "../src/brain.js";

describe("createBrainQuery — extended options", () => {
  it("passes cwd to SDK options", () => {
    createBrainQuery("test", {
      model: "claude-sonnet-4-6",
      cwd: "/tmp/task-workspace",
    });
    expect(capturedOptions.cwd).toBe("/tmp/task-workspace");
  });

  it("passes custom tools when provided", () => {
    createBrainQuery("test", {
      model: "claude-sonnet-4-6",
      tools: ["Bash", "Read", "Write"],
    });
    expect(capturedOptions.allowedTools).toEqual(["Bash", "Read", "Write"]);
  });

  it("passes persistSession to SDK options", () => {
    createBrainQuery("test", {
      model: "claude-sonnet-4-6",
      persistSession: false,
    });
    expect(capturedOptions.persistSession).toBe(false);
  });

  it("uses default tools when not specified", () => {
    createBrainQuery("test", { model: "claude-sonnet-4-6" });
    expect(capturedOptions.allowedTools).toContain("Bash");
    expect(capturedOptions.allowedTools).toContain("Read");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/nina/my_agent/packages/core && npx vitest run tests/brain-options.test.ts`

- [ ] **Step 3: Add fields to `BrainSessionOptions`**

In `packages/core/src/brain.ts`, extend the interface:

```typescript
export interface BrainSessionOptions {
  model: string;
  systemPrompt?: string | SystemPromptBlock[];
  continue?: boolean;
  includePartialMessages?: boolean;
  reasoning?: boolean;
  resume?: string;
  mcpServers?: Options["mcpServers"];
  agents?: Record<string, AgentDefinition>;
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  // New fields for agentic task execution:
  cwd?: string;
  tools?: string[];
  persistSession?: boolean;
}
```

- [ ] **Step 4: Wire new fields in `createBrainQuery()`**

In the query options construction:

```typescript
// Replace the hardcoded allowedTools with configurable tools:
const defaultTools = ["Bash", "Read", "Write", "Edit", "Glob", "Grep"];
const allowedTools = options.tools ?? defaultTools;
// (Plus existing logic to add "Task" if agents defined)

// The SDK has two fields:
// - Options.tools: controls which tools are AVAILABLE (the set the model can see)
// - Options.allowedTools: controls which are auto-approved without prompting
// Since we set permissionMode: 'bypassPermissions', both fields behave the same.
// We set allowedTools (existing pattern) which works under bypass mode.

// Add to queryOptions:
if (options.cwd) queryOptions.cwd = options.cwd;
if (options.persistSession !== undefined) queryOptions.persistSession = options.persistSession;
```

- [ ] **Step 5: Run tests**

Run: `cd /home/nina/my_agent/packages/core && npx vitest run tests/brain-options.test.ts`
Expected: PASS

- [ ] **Step 6: Run full core test suite**

Run: `cd /home/nina/my_agent/packages/core && npx vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/brain.ts packages/core/tests/brain-options.test.ts
git commit -m "feat: extend createBrainQuery with cwd, tools, persistSession"
```

---

## Chunk 2: Task Executor Upgrade (Tasks 5–7)

### Task 5: Working Nina System Prompt

Build the autonomous "get shit done" system prompt for working Nina. This is fundamentally different from conversation Nina's persona — no conversational warmth, just autonomous task execution. Shares the same notebook/knowledge context but with a different personality layer.

**Files:**
- Create: `packages/dashboard/src/tasks/working-nina-prompt.ts`
- Test: `packages/dashboard/tests/tasks/working-nina-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/dashboard/tests/tasks/working-nina-prompt.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@my-agent/core", () => ({
  assembleSystemPrompt: vi.fn().mockResolvedValue("## Identity\nI am Nina.\n## Notebook\nSome notes."),
}));

vi.mock("../../src/conversations/properties.js", () => ({
  readProperties: vi.fn().mockResolvedValue({
    timezone: { value: "Asia/Bangkok", confidence: "high", updated: "2026-03-14", source: "conversation" },
    location: { value: "Chiang Mai, Thailand", confidence: "high", updated: "2026-03-14", source: "conversation" },
    availability: { value: "No fixed schedule", confidence: "medium", updated: "2026-03-14", source: "conversation" },
  }),
}));

vi.mock("../../src/utils/timezone.js", () => ({
  resolveTimezone: vi.fn().mockResolvedValue("Asia/Bangkok"),
}));

import { buildWorkingNinaPrompt } from "../../src/tasks/working-nina-prompt.js";

describe("buildWorkingNinaPrompt", () => {
  const agentDir = "/tmp/test-agent";

  it("includes working Nina persona", async () => {
    const prompt = await buildWorkingNinaPrompt(agentDir, {
      taskTitle: "Check weather",
      taskId: "abc123",
    });
    expect(prompt).toContain("autonomous");
    expect(prompt).toContain("get the job done");
  });

  it("includes temporal context with timezone", async () => {
    const prompt = await buildWorkingNinaPrompt(agentDir, {
      taskTitle: "Check weather",
      taskId: "abc123",
    });
    expect(prompt).toContain("[Temporal Context]");
    expect(prompt).toContain("Asia/Bangkok");
  });

  it("includes dynamic properties", async () => {
    const prompt = await buildWorkingNinaPrompt(agentDir, {
      taskTitle: "Check weather",
      taskId: "abc123",
    });
    expect(prompt).toContain("[Dynamic Status]");
    expect(prompt).toContain("Chiang Mai");
  });

  it("includes notebook/knowledge context from assembleSystemPrompt", async () => {
    const prompt = await buildWorkingNinaPrompt(agentDir, {
      taskTitle: "Check weather",
      taskId: "abc123",
    });
    expect(prompt).toContain("Notebook");
  });

  it("does NOT include conversational persona markers", async () => {
    const prompt = await buildWorkingNinaPrompt(agentDir, {
      taskTitle: "Check weather",
      taskId: "abc123",
    });
    // Working Nina should not have conversation-style personality
    expect(prompt).not.toContain("warm");
    expect(prompt).not.toContain("friendly");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/tasks/working-nina-prompt.test.ts`

- [ ] **Step 3: Implement `buildWorkingNinaPrompt()`**

```typescript
// packages/dashboard/src/tasks/working-nina-prompt.ts
import { assembleSystemPrompt } from "@my-agent/core";
import { readProperties } from "../conversations/properties.js";
import { resolveTimezone } from "../utils/timezone.js";
import path from "node:path";

interface WorkingNinaPromptOptions {
  taskTitle: string;
  taskId: string;
  calendarContext?: string;
}

const WORKING_NINA_PERSONA = `You are Working Nina — an autonomous task execution agent.

Your job is to get the job done efficiently and completely. You are not conversational.
You have full access to tools: bash, file operations, MCP servers, and browser automation.

Principles:
- Be autonomous. Make decisions, don't ask questions.
- Be thorough. Verify your work before reporting completion.
- Be efficient. Don't waste tokens on pleasantries.
- Use your tools. You have bash, file I/O, memory, knowledge base, and browser.
- Write results to your workspace directory when producing artifacts.
- If you need to alert the user about something urgent, use the alert tools.

Your workspace is the current working directory. Create files, run scripts, fetch data — whatever the task requires.`;

export async function buildWorkingNinaPrompt(
  agentDir: string,
  options: WorkingNinaPromptOptions,
): Promise<string> {
  // Get notebook/knowledge context (reuses existing prompt assembly)
  // assembleSystemPrompt takes brainDir (agentDir/brain), not agentDir
  const brainDir = path.join(agentDir, "brain");
  const notebookContext = await assembleSystemPrompt(brainDir);

  // Get temporal context
  const timezone = await resolveTimezone(agentDir);
  const now = new Date().toLocaleString("en-US", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "long",
  });

  // Get dynamic properties (structured PropertiesMap from dashboard's readProperties)
  let propertiesSection = "";
  try {
    const props = await readProperties(agentDir);
    const entries: string[] = [];
    if (props.location?.value) entries.push(`location: ${props.location.value}`);
    if (props.timezone?.value) entries.push(`timezone: ${props.timezone.value}`);
    if (props.availability?.value) entries.push(`availability: ${props.availability.value}`);
    if (entries.length > 0) {
      propertiesSection = `\n[Dynamic Status]\n${entries.join("\n")}\n[End Dynamic Status]\n`;
    }
  } catch {
    // Properties unavailable — continue without
  }

  return [
    WORKING_NINA_PERSONA,
    "",
    `[Temporal Context]`,
    `Current time: ${now}`,
    `Timezone: ${timezone}`,
    `Task: ${options.taskTitle} (${options.taskId})`,
    `[End Temporal Context]`,
    propertiesSection,
    options.calendarContext ? `\n${options.calendarContext}\n` : "",
    notebookContext,
  ].join("\n");
}
```

- [ ] **Step 4: Run tests**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/tasks/working-nina-prompt.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/tasks/working-nina-prompt.ts packages/dashboard/tests/tasks/working-nina-prompt.test.ts
git commit -m "feat: working Nina autonomous system prompt"
```

---

### Task 6: Task Folder Structure + Log Migration

Update `TaskLogStorage` to use the new `tasks/{taskId}/` directory structure with workspace subdirectory. Old logs remain readable at their original paths.

**Files:**
- Modify: `packages/dashboard/src/tasks/log-storage.ts`
- Test: `packages/dashboard/tests/tasks/log-storage.test.ts` (extend existing or create)

- [ ] **Step 1: Write failing test for new path structure**

```typescript
// Add to existing tests or create packages/dashboard/tests/tasks/log-storage-migration.test.ts
import { describe, it, expect } from "vitest";
import { TaskLogStorage } from "../../src/tasks/log-storage.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("TaskLogStorage — new directory structure", () => {
  const tmpDir = path.join(os.tmpdir(), `log-storage-test-${Date.now()}`);

  it("creates task directory with workspace subdirectory", () => {
    const storage = new TaskLogStorage(tmpDir);
    storage.createLog("task-001", "session-abc", "Test Task");

    expect(fs.existsSync(path.join(tmpDir, "tasks/task-001/task.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "tasks/task-001/workspace"))).toBe(true);
  });

  it("getLogPath returns new path for new tasks", () => {
    const storage = new TaskLogStorage(tmpDir);
    const logPath = storage.getLogPath("task-002");
    expect(logPath).toContain("tasks/task-002/task.jsonl");
  });

  it("reads old log path if new path doesn't exist", () => {
    const storage = new TaskLogStorage(tmpDir);
    // Create a log at the old location
    const oldDir = path.join(tmpDir, "tasks/logs");
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, "old-task.jsonl"), '{"type":"meta"}\n');

    const logPath = storage.getLogPath("old-task");
    expect(logPath).toContain("tasks/logs/old-task.jsonl");
  });

  it("getTaskDir returns task directory path", () => {
    const storage = new TaskLogStorage(tmpDir);
    const taskDir = storage.getTaskDir("task-003");
    expect(taskDir).toBe(path.join(tmpDir, "tasks/task-003"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/tasks/log-storage-migration.test.ts`

- [ ] **Step 3: Update TaskLogStorage**

In `packages/dashboard/src/tasks/log-storage.ts`:

```typescript
// Add getTaskDir method:
getTaskDir(taskId: string): string {
  return path.join(this.agentDir, "tasks", taskId);
}

// Update getLogPath to check both locations:
getLogPath(taskId: string): string {
  const newPath = path.join(this.agentDir, "tasks", taskId, "task.jsonl");
  if (fs.existsSync(newPath)) return newPath;

  const oldPath = path.join(this.agentDir, "tasks", "logs", `${taskId}.jsonl`);
  if (fs.existsSync(oldPath)) return oldPath;

  // Default to new path for new tasks
  return newPath;
}

// Update createLog to use new directory structure:
createLog(taskId: string, sessionId: string, title: string): void {
  const taskDir = this.getTaskDir(taskId);
  const workspaceDir = path.join(taskDir, "workspace");
  fs.mkdirSync(workspaceDir, { recursive: true });

  const logPath = path.join(taskDir, "task.jsonl");
  const meta: TaskLogMeta = { type: "meta", taskId, sessionId, title, created: new Date().toISOString() };
  fs.writeFileSync(logPath, JSON.stringify(meta) + "\n");
}
```

- [ ] **Step 4: Run tests**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/tasks/log-storage-migration.test.ts`
Expected: PASS

- [ ] **Step 5: Run full task test suite**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/tasks/`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/tasks/log-storage.ts packages/dashboard/tests/tasks/
git commit -m "feat: task folder structure with workspace directory"
```

---

### Task 7: Upgrade TaskExecutor to Agentic Session

The core change: replace the text-only `createBrainQuery()` call in `executeQuery()` with a full agentic session using tools, hooks, MCP servers, cwd, and the working Nina prompt.

**Files:**
- Modify: `packages/dashboard/src/tasks/task-executor.ts:344-465`
- Modify: `packages/dashboard/src/index.ts:288-293` (pass new dependencies)
- Test: `packages/dashboard/tests/tasks/task-executor-agentic.test.ts`

- [ ] **Step 1: Update `TaskExecutorConfig` to accept new dependencies**

In `packages/dashboard/src/tasks/task-executor.ts`, extend the config:

```typescript
export interface TaskExecutorConfig {
  taskManager: TaskManager;
  logStorage: TaskLogStorage;
  agentDir: string;
  db: ConversationDatabase;
  // New for agentic execution:
  mcpServers?: Options["mcpServers"];
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
}
```

- [ ] **Step 2: Update `buildFreshQuery()` to use agentic session config**

Replace the system prompt construction in `buildFreshQuery()` to use `buildWorkingNinaPrompt()` and pass `cwd`, `tools`, `hooks`, `mcpServers`, `persistSession`:

```typescript
import { buildWorkingNinaPrompt } from "./working-nina-prompt.js";

// In buildFreshQuery():
async buildFreshQuery(task: Task, brainConfig: any, priorContext: string | null): Promise<Query> {
  const taskDir = this.logStorage.getTaskDir(task.id);

  // Build working Nina system prompt (autonomous persona + temporal + properties + notebook)
  const calendarContext = await this.loadCalendarContext(task);
  const systemPrompt = await buildWorkingNinaPrompt(this.agentDir, {
    taskTitle: task.title,
    taskId: task.id,
    calendarContext,
  });

  const userMessage = this.buildUserMessage(task);
  const priorContextSection = priorContext
    ? `\n\n[Prior Execution Context]\n${priorContext}\n[End Prior Context]\n`
    : "";

  return createBrainQuery(userMessage + priorContextSection, {
    model: brainConfig.model ?? "claude-sonnet-4-6",
    systemPrompt,
    cwd: taskDir,
    tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
    mcpServers: this.config.mcpServers,
    hooks: this.config.hooks,
    persistSession: !!task.recurrenceId,
  });
}
```

- [ ] **Step 3: Extract calendar loading to helper method**

Move the CalDAV logic from `buildFreshQuery()` (lines 406–432) into `loadCalendarContext()`:

```typescript
private async loadCalendarContext(task: Task): Promise<string | undefined> {
  // Existing calendar logic extracted from buildFreshQuery lines 406-432
  // Returns calendar context string or undefined
}
```

- [ ] **Step 4: Update `index.ts` wiring to pass MCP servers and hooks**

In `packages/dashboard/src/index.ts`, update the TaskExecutor construction:

```typescript
import { createHooks } from "@my-agent/core";

// In the hatched block:
// NOTE: sharedMcpServers is initialized later in initMcpServers() (line ~751),
// so we use a lazy getter to defer access until first task execution.
taskExecutor = new TaskExecutor({
  taskManager,
  logStorage,
  agentDir,
  db: conversationManager.getConversationDb(),
  get mcpServers() { return sharedMcpServers; },
  hooks: createHooks("task", { agentDir }),
});
```

This uses the same lazy getter pattern as `TaskProcessor`'s `conversationInitiator` (line ~309).

- [ ] **Step 5: Write integration-style test**

```typescript
// packages/dashboard/tests/tasks/task-executor-agentic.test.ts
import { describe, it, expect, vi } from "vitest";

// This tests the config wiring, not the actual SDK call
describe("TaskExecutor — agentic session config", () => {
  it("passes cwd as task directory to createBrainQuery", async () => {
    // Mock createBrainQuery to capture args
    // Verify cwd = logStorage.getTaskDir(taskId)
    // Verify tools includes Bash, Read, Write, Edit, Glob, Grep
    // Verify hooks are present
    // Verify persistSession = false for non-recurring task
    // Verify persistSession = true for recurring task (has recurrenceId)
  });
});
```

- [ ] **Step 6: Run tests**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/tasks/`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/tasks/task-executor.ts packages/dashboard/src/index.ts packages/dashboard/tests/tasks/
git commit -m "feat: upgrade task executor to full agentic session"
```

---

## Chunk 3: Extraction, Playwright, Testing (Tasks 8–10)

### Task 8: `notifyOnCompletion` in Task Extraction

Add `notifyOnCompletion` to the extraction prompt, schema, and passthrough to task creation.

**Files:**
- Modify: `packages/dashboard/src/tasks/task-extractor.ts:11-18,29-95`
- Modify: `packages/dashboard/src/conversations/post-response-hooks.ts:64-96`
- Test: `packages/dashboard/tests/tasks/task-extractor-notify.test.ts`

- [ ] **Step 1: Write failing tests**

Note: The normalization function is private (not exported). We test `notifyOnCompletion` passthrough via the public `extractTaskFromMessage()` API by mocking the Haiku model call to return JSON with `notifyOnCompletion` fields.

```typescript
// packages/dashboard/tests/tasks/task-extractor-notify.test.ts
import { describe, it, expect, vi } from "vitest";

// Mock the brain query to return controlled JSON
vi.mock("@my-agent/core", async () => {
  const actual = await vi.importActual("@my-agent/core");
  return {
    ...actual,
    createBrainQuery: vi.fn(),
    streamResponse: vi.fn(),
  };
});

import { extractTaskFromMessage } from "../../src/tasks/task-extractor.js";
import { streamResponse } from "@my-agent/core";

describe("notifyOnCompletion extraction", () => {
  it("extracts 'immediate' when model returns it", async () => {
    (streamResponse as any).mockResolvedValue(
      JSON.stringify({
        shouldCreateTask: true,
        title: "Check weather",
        instructions: "Check the weather and let me know",
        work: ["Check forecast"],
        type: "immediate",
        notifyOnCompletion: "immediate",
      }),
    );

    const result = await extractTaskFromMessage("Check weather and let me know");
    expect(result.shouldCreateTask).toBe(true);
    expect(result.task?.notifyOnCompletion).toBe("immediate");
  });

  it("extracts 'debrief' for background tasks", async () => {
    (streamResponse as any).mockResolvedValue(
      JSON.stringify({
        shouldCreateTask: true,
        title: "Monitor logs",
        instructions: "Keep an eye on logs",
        work: ["Monitor"],
        type: "scheduled",
        notifyOnCompletion: "debrief",
      }),
    );

    const result = await extractTaskFromMessage("Keep an eye on server logs");
    expect(result.shouldCreateTask).toBe(true);
    expect(result.task?.notifyOnCompletion).toBe("debrief");
  });

  it("omits notifyOnCompletion when model doesn't return it", async () => {
    (streamResponse as any).mockResolvedValue(
      JSON.stringify({
        shouldCreateTask: true,
        title: "Do something",
        instructions: "Do it",
        work: ["Do it"],
        type: "immediate",
      }),
    );

    const result = await extractTaskFromMessage("Do something");
    expect(result.task?.notifyOnCompletion).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/tasks/task-extractor-notify.test.ts`

- [ ] **Step 3: Add `notifyOnCompletion` to `ExtractedTask`**

In `packages/dashboard/src/tasks/task-extractor.ts`:

```typescript
export interface ExtractedTask {
  title: string;
  instructions: string;
  work: WorkItem[];
  delivery?: DeliveryAction[];
  type: TaskType;
  scheduledFor?: Date;
  notifyOnCompletion?: "immediate" | "debrief" | "none";
}
```

- [ ] **Step 4: Update extraction prompt**

In `buildExtractionPrompt()`, add to the JSON schema description:

```
Set notifyOnCompletion based on the user's intent:
- "immediate" — user wants to hear back ("message me", "let me know", "tell me", "remind me", "send me", "notify me", "report back")
- "debrief" — background work, no urgency ("check daily", "keep an eye on", "when you get a chance", "log this")
- Omit if unclear — system defaults apply
```

- [ ] **Step 5: Update normalization to pass through `notifyOnCompletion`**

In the normalization function, add:

```typescript
notifyOnCompletion: raw.notifyOnCompletion,
```

- [ ] **Step 6: Update `post-response-hooks.ts` to pass `notifyOnCompletion`**

In `packages/dashboard/src/conversations/post-response-hooks.ts`, in the task creation loop:

```typescript
const task = this.deps.taskManager.create({
  ...existingFields,
  notifyOnCompletion: extracted.notifyOnCompletion,
});
```

- [ ] **Step 7: Run tests**

Run: `cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/tasks/`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add packages/dashboard/src/tasks/task-extractor.ts packages/dashboard/src/conversations/post-response-hooks.ts packages/dashboard/tests/tasks/
git commit -m "feat: notifyOnCompletion in task extraction"
```

---

### Task 9: Playwright MCP + uv Installation

Register Playwright MCP server for both conversation Nina and working Nina. Install `uv` for Python script execution.

**Files:**
- Modify: `packages/dashboard/src/agent/session-manager.ts:63-100` (add Playwright to shared MCP servers)
- Modify: `packages/dashboard/package.json` (add `@playwright/mcp` dependency)

- [ ] **Step 1: Install `@playwright/mcp` as dependency**

```bash
cd /home/nina/my_agent/packages/dashboard && npm install @playwright/mcp
```

- [ ] **Step 2: Register Playwright MCP server in `initMcpServers()`**

In `packages/dashboard/src/agent/session-manager.ts`, in the `initMcpServers()` function:

```typescript
// Add Playwright as a stdio MCP server alongside existing SDK-based servers:
const playwrightServer: McpStdioServerConfig = {
  type: "stdio",
  command: "npx",
  args: ["@playwright/mcp"],
};

// Add to the mcpServers record:
sharedMcpServers = {
  ...existingServers,
  playwright: playwrightServer,
};
```

Note: Since `sharedMcpServers` is passed to both conversation Nina (SessionManager) and working Nina (TaskExecutor via index.ts), both get Playwright automatically.

- [ ] **Step 3: Install uv on the VPS**

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Verify: `uv --version`

- [ ] **Step 4: Verify Playwright is available**

```bash
npx @playwright/mcp --help
```

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/package.json packages/dashboard/package-lock.json packages/dashboard/src/agent/session-manager.ts
git commit -m "feat: Playwright MCP server + uv installation"
```

---

### Task 10: End-to-End Verification — 3 Non-Trivial Test Tasks

Create and execute 3 test tasks that exercise the full agentic capabilities. These are run manually via the debug API or task creation endpoint.

**Test tasks:**

1. **Weather comparison** — "Check the weather in Chiang Mai on 3 different weather sites using the browser, compare forecasts, and save a structured comparison to the workspace"
   - Validates: Playwright MCP (browser), Bash, Write (workspace), cwd isolation

2. **Git commit frequency analysis** — "Write a Python script that analyzes git commit frequency by day-of-week across all repos in ~/projects, generate a chart, and save it to the task workspace"
   - Validates: Bash (uv run), Read/Glob (find repos), Write (workspace), Python/uv integration

3. **npm CVE audit** — "Run npm audit on packages/core and packages/dashboard, cross-reference with the knowledge base for any known issues, and create a notebook entry summarizing findings"
   - Validates: Bash (npm audit), MCP knowledge server, MCP memory server (notebook write), Write to allowed paths, infrastructure guard (should NOT block notebook writes)

**Files:**
- Create: `docs/sprints/m6.9-s4-agentic-task-executor/test-tasks.md` (test task definitions + results)

- [ ] **Step 1: Restart dashboard service**

```bash
systemctl --user restart nina-dashboard.service
```

- [ ] **Step 2: Create test task 1 via API — Weather comparison**

```bash
curl -X POST http://localhost:4321/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Weather comparison - Chiang Mai",
    "instructions": "Check the weather in Chiang Mai on 3 different weather sites using the browser, compare forecasts, and save a structured comparison to the workspace",
    "type": "immediate",
    "sourceType": "manual",
    "createdBy": "user"
  }'
```

Wait for completion. Check:
- Task workspace has a comparison file
- Playwright browser was launched (check task log)
- No infrastructure guard violations

- [ ] **Step 3: Create test task 2 via API — Git analysis**

```bash
curl -X POST http://localhost:4321/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Git commit frequency analysis",
    "instructions": "Write a Python script using uv that analyzes git commit frequency by day-of-week across all repos in ~/projects, generate a chart (save as PNG), and save both script and chart to the task workspace",
    "type": "immediate",
    "sourceType": "manual",
    "createdBy": "user"
  }'
```

Wait for completion. Check:
- Task workspace has Python script + chart PNG
- `uv run` was used (check task log)
- Script executed successfully

- [ ] **Step 4: Create test task 3 via API — npm CVE audit**

```bash
curl -X POST http://localhost:4321/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "npm CVE audit",
    "instructions": "Run npm audit on packages/core and packages/dashboard, cross-reference with the knowledge base for any known issues, and create a notebook entry summarizing findings. Let me know what you find.",
    "type": "immediate",
    "sourceType": "manual",
    "createdBy": "user",
    "notifyOnCompletion": "immediate"
  }'
```

Wait for completion. Check:
- Notebook entry was created (check `.my_agent/notebook/`)
- MCP knowledge server was queried (check task log)
- Infrastructure guard did NOT block notebook writes
- `notifyOnCompletion: "immediate"` triggered notification

- [ ] **Step 5: Verify infrastructure guard — negative test**

Create a task that should be blocked:

```bash
curl -X POST http://localhost:4321/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Infrastructure guard test",
    "instructions": "Read the content of brain/CLAUDE.md and write a modified version back to the same file",
    "type": "immediate",
    "sourceType": "manual",
    "createdBy": "user"
  }'
```

Check: Task log shows infrastructure guard denied Write to `brain/CLAUDE.md`.

- [ ] **Step 6: Document results in test-tasks.md**

Record pass/fail for each task, note any issues found.

- [ ] **Step 7: Commit test results**

```bash
git add docs/sprints/m6.9-s4-agentic-task-executor/test-tasks.md
git commit -m "test: agentic task executor E2E verification"
```

---

## Dependency Graph

```
Task 1 (PoC defer_loading)     ─→ informs Task 7 MCP config
Task 2 (timezone utility)      ─→ Task 5 (working Nina prompt)
Task 3 (infrastructure hooks)  ─→ Task 7 (wired into executor)
Task 4 (extend createBrainQuery) ─→ Task 7 (uses extended API)
Task 5 (working Nina prompt)   ─→ Task 7 (used as system prompt)
Task 6 (task folder structure)  ─→ Task 7 (cwd = task dir)
Task 7 (upgrade executor)      ─→ Task 10 (E2E tests)
Task 8 (notifyOnCompletion)    ─→ Task 10 (tested in task 3)
Task 9 (Playwright + uv)       ─→ Task 10 (tested in tasks 1-2)
```

**Parallelizable:** Tasks 1–4 can run in parallel. Tasks 5–6 can run in parallel. Task 8 can run in parallel with tasks 5–7. Task 9 can run in parallel with tasks 5–8.

**Sequential gates:** Task 7 blocks on 2–6. Task 10 blocks on 7–9.
