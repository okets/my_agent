# M7-S2: Tool Spaces

> **Milestone:** M7 — Spaces + Automations + Jobs
> **Sprint:** S2 of 5
> **Status:** Planned
> **Goal:** Tool invocation, I/O contracts, DECISIONS.md lifecycle, inline repair, tool-specific UI
> **Spec:** `docs/superpowers/specs/2026-03-22-m7-spaces-automations-jobs.md` (sections: Tool Lifecycle, Entities/Spaces, Dashboard UI/Space Detail Tab)
> **Depends on:** M7-S1 (Space entity, SpaceSyncService, Space detail tab, `list_spaces` MCP tool)

---

## Architecture

S2 adds the "tool" capability to spaces. A space becomes a tool when it has `runtime` + `entry` + `io` fields in SPACE.md. This sprint wires:

1. **Tool invocation** — shell convention `cd space && runtime run entry '{input}'` via Bash tool (agent-mode only, hooks preserved)
2. **I/O contract** — `io` field in SPACE.md frontmatter, parsed and displayed
3. **DECISIONS.md lifecycle** — creation template, append-on-modify, read-before-repair
4. **Maintenance rules** — `maintenance` section in SPACE.md (`on_failure`, `log`)
5. **Inline repair protocol** — one attempt per job, read DECISIONS.md first
6. **Tool creation template** — injected into Working Nina system prompt when creating tools
7. **Error detection hierarchy** — exit code, empty stdout, invalid JSON, semantic (LLM)
8. **UI** — "Run" button, I/O contract display, maintenance section, DECISIONS.md preview

### Tech Stack

- **Backend:** TypeScript, Node.js
- **Frontmatter:** `readFrontmatter()`/`writeFrontmatter()` from `packages/dashboard/src/metadata/frontmatter.ts`
- **UI:** Alpine.js + Tailwind CSS (CDN), Tokyo Night theme
- **Testing:** Vitest
- **MCP:** `tool()` + `createSdkMcpServer()` from `@anthropic-ai/claude-agent-sdk`

---

## Tasks

### Task 1 — Space type augmentation: add tool-specific fields (3 min)

**File:** `packages/core/src/spaces/types.ts` (created in S1)

Add tool-capability fields to the `Space` interface. These fields are optional — a space becomes a tool when all three are present.

```typescript
/** I/O contract for a tool space */
export interface SpaceIOContract {
  input: Record<string, string>;   // name -> type (string, number, file, etc.)
  output: Record<string, string>;  // name -> type (stdout, file, etc.)
}

/** Maintenance configuration for a tool space */
export interface SpaceMaintenance {
  on_failure: "fix" | "replace" | "alert";
  log: string;  // e.g. "DECISIONS.md"
}

export interface Space {
  // ... existing S1 fields (name, tags, path, runtime, created) ...
  entry?: string;                    // entry point file (e.g. "src/scraper.py")
  io?: SpaceIOContract;              // I/O contract
  maintenance?: SpaceMaintenance;    // maintenance rules
}
```

Add a predicate:

```typescript
/** A space is a tool when it has runtime + entry + io */
export function isToolSpace(space: Space): boolean {
  return !!(space.runtime && space.entry && space.io);
}
```

**Test:** `packages/core/tests/spaces/types.test.ts`

```bash
cd packages/core && npx vitest run tests/spaces/types.test.ts
```

Expected: `isToolSpace()` returns true only when all three fields present.

**Commit:** `feat(spaces): add tool-specific type fields (io, entry, maintenance)`

---

### Task 2 — SpaceSyncService: index tool fields into agent.db (4 min)

**File:** `packages/core/src/spaces/space-sync-service.ts` (created in S1)

Extend the sync service to parse and index the new fields from SPACE.md frontmatter:

- `entry` -> `spaces.entry` column (TEXT, nullable)
- `io` -> `spaces.io` column (TEXT, JSON-serialized)
- `maintenance` -> `spaces.maintenance` column (TEXT, JSON-serialized)

**File:** `packages/dashboard/src/conversations/db.ts`

Add the columns to the `spaces` table schema (S1 created the table with `name`, `path`, `tags`, `runtime`, `description`, `indexed_at`). Use `ALTER TABLE ADD COLUMN` migration pattern:

```typescript
// In initialize(), after existing spaces table creation:
try {
  this.db.exec(`ALTER TABLE spaces ADD COLUMN entry TEXT`);
} catch { /* column already exists */ }
try {
  this.db.exec(`ALTER TABLE spaces ADD COLUMN io TEXT`);
} catch { /* column already exists */ }
try {
  this.db.exec(`ALTER TABLE spaces ADD COLUMN maintenance TEXT`);
} catch { /* column already exists */ }
```

**Test:** `packages/core/tests/spaces/space-sync-service.test.ts` (extend S1 tests)

Create a temp SPACE.md with tool fields, run sync, verify agent.db has io/maintenance JSON.

```bash
cd packages/core && npx vitest run tests/spaces/space-sync-service.test.ts
```

Expected: Space with `runtime: uv`, `entry: src/scraper.py`, `io: {input: {url: string}, output: {results: file}}` synced correctly.

**Commit:** `feat(spaces): sync tool fields (entry, io, maintenance) to agent.db`

---

### Task 3 — DECISIONS.md read/write utilities (3 min)

**File:** `packages/dashboard/src/spaces/decisions.ts` (new)

Utilities for the DECISIONS.md lifecycle. DECISIONS.md is a plain markdown file (no frontmatter) with a chronological append pattern.

```typescript
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const DECISIONS_TEMPLATE = `# Decisions

Operational history for this tool. Agents read this before modifying or repairing.

---

`;

/** Ensure DECISIONS.md exists with template content */
export function ensureDecisionsFile(spaceDir: string): string {
  const filePath = path.join(spaceDir, "DECISIONS.md");
  if (!existsSync(filePath)) {
    writeFileSync(filePath, DECISIONS_TEMPLATE, "utf-8");
  }
  return filePath;
}

/** Read DECISIONS.md content. Returns empty string if not found. */
export function readDecisions(spaceDir: string): string {
  const filePath = path.join(spaceDir, "DECISIONS.md");
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf-8");
}

/** Append a decision entry with timestamp and category */
export function appendDecision(
  spaceDir: string,
  entry: { category: "created" | "modified" | "repaired" | "failed"; summary: string },
): void {
  const filePath = ensureDecisionsFile(spaceDir);
  const timestamp = new Date().toISOString();
  const line = `\n## ${timestamp} -- ${entry.category}\n\n${entry.summary}\n`;
  const content = readFileSync(filePath, "utf-8");
  writeFileSync(filePath, content + line, "utf-8");
}
```

**Test:** `packages/dashboard/tests/spaces/decisions.test.ts`

```bash
cd packages/dashboard && npx vitest run tests/spaces/decisions.test.ts
```

Expected: Creates template, appends entries, reads back chronologically.

**Commit:** `feat(spaces): DECISIONS.md read/write utilities`

---

### Task 4 — Tool invocation helper (5 min)

**File:** `packages/dashboard/src/spaces/tool-invoker.ts` (new)

Builds the shell command string for tool invocation and validates the result. This is NOT direct execution — it produces the command that Working Nina runs via the Bash tool (agent-mode only, hooks preserved).

```typescript
import type { Space, SpaceIOContract } from "@my-agent/core";

/** Runtime -> shell command prefix mapping */
const RUNTIME_COMMANDS: Record<string, string> = {
  uv: "uv run",
  node: "node",
  bash: "bash",
};

/** Build the shell invocation command for a tool space */
export function buildToolCommand(space: Space, input: Record<string, unknown>): string {
  if (!space.runtime || !space.entry) {
    throw new Error(`Space "${space.name}" is not a tool (missing runtime or entry)`);
  }
  const cmd = RUNTIME_COMMANDS[space.runtime];
  if (!cmd) {
    throw new Error(`Unsupported runtime: ${space.runtime}`);
  }
  const inputJson = JSON.stringify(input);
  // Shell convention from spec: cd space && runtime run entry '{input}'
  return `cd ${space.path} && ${cmd} ${space.entry} '${inputJson}'`;
}

/** Error detection hierarchy (spec section: Error detection hierarchy) */
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  errorType?: "exit_code" | "empty_stdout" | "invalid_json" | "semantic";
}

/** Classify tool output using the error detection hierarchy */
export function classifyToolOutput(
  exitCode: number,
  stdout: string,
  io?: SpaceIOContract,
): ToolResult {
  // 1. Exit code != 0 -> crash
  if (exitCode !== 0) {
    return { success: false, output: stdout, error: stdout, errorType: "exit_code" };
  }
  // 2. Empty stdout -> no results
  if (!stdout.trim()) {
    return { success: false, output: "", error: "Tool produced no output", errorType: "empty_stdout" };
  }
  // 3. If output type is stdout (JSON expected), validate JSON
  if (io?.output && Object.values(io.output).some((t) => t !== "file")) {
    try {
      JSON.parse(stdout);
    } catch {
      return { success: false, output: stdout, error: "Tool output is not valid JSON", errorType: "invalid_json" };
    }
  }
  // 4. Semantic issues -> detected by LLM at runtime (not here)
  return { success: true, output: stdout };
}
```

**Test:** `packages/dashboard/tests/spaces/tool-invoker.test.ts`

```bash
cd packages/dashboard && npx vitest run tests/spaces/tool-invoker.test.ts
```

Test cases:
- `buildToolCommand` with uv/node/bash runtimes
- `buildToolCommand` throws for missing runtime/entry
- `classifyToolOutput` returns correct errorType for each hierarchy level
- Valid JSON stdout with exit code 0 returns success

**Commit:** `feat(spaces): tool invocation helper and error detection hierarchy`

---

### Task 5 — Tool creation template for Working Nina prompt (4 min)

**File:** `packages/dashboard/src/tasks/working-nina-prompt.ts`

Add a "Tool Space Creation Guide" section that gets injected into the worker system prompt when the task involves creating a tool. This teaches the worker the SPACE.md format, directory conventions, and runtime setup commands.

```typescript
const TOOL_CREATION_GUIDE = `
## Tool Space Creation Guide

When creating a new tool space, follow this structure:

### Directory Layout
\`\`\`
.my_agent/spaces/{tool-name}/
  SPACE.md          # Manifest (YAML frontmatter + description)
  DECISIONS.md      # Operational history (created automatically)
  src/              # Source code
\`\`\`

### SPACE.md Format
\`\`\`yaml
---
name: tool-name
tags: [tool, category]
runtime: uv            # uv | node | bash
entry: src/main.py     # entry point relative to space dir
io:
  input:
    param_name: type   # string | number | file | boolean
  output:
    result_name: type  # stdout (JSON) | file (path)
maintenance:
  on_failure: fix      # fix | replace | alert
  log: DECISIONS.md
created: YYYY-MM-DD
---

# Tool Name

Description of what the tool does.

## Maintenance Rules

- Specific repair guidance for this tool
- What to check when things break
\`\`\`

### Runtime Setup
- **uv:** \`cd space && uv init && uv add dependencies\`
- **node:** \`cd space && npm init -y && npm install dependencies\`
- **bash:** No setup needed, ensure script is executable

### After Creation
1. Write SPACE.md with proper frontmatter
2. Initialize DECISIONS.md: log "created" entry with rationale
3. Bootstrap runtime (uv init, npm init, etc.)
4. Write source code
5. Test with sample input: cd space && runtime run entry '{sample_input}'
6. Verify output matches io.output contract
`;
```

Add `toolCreationGuide?: boolean` to `WorkingNinaPromptOptions` and conditionally include the guide:

```typescript
export interface WorkingNinaPromptOptions {
  taskTitle: string;
  taskId: string;
  taskDir?: string;
  calendarContext?: string;
  toolCreationGuide?: boolean;    // new
  spaceContexts?: string[];       // new -- SPACE.md contents for referenced spaces
}
```

Append the guide and space contexts to the prompt assembly array.

**Test:** `packages/dashboard/tests/tasks/working-nina-prompt.test.ts`

```bash
cd packages/dashboard && npx vitest run tests/tasks/working-nina-prompt.test.ts
```

Expected: Prompt includes "Tool Space Creation Guide" when `toolCreationGuide: true`, omitted when false.

**Commit:** `feat(prompt): add Tool Space Creation Guide to Working Nina prompt`

---

### Task 6 — Inline repair protocol context builder (4 min)

**File:** `packages/dashboard/src/spaces/repair-context.ts` (new)

Builds the repair context that gets injected into the worker prompt when a tool fails during a job. The worker reads DECISIONS.md + maintenance rules before attempting ONE repair.

```typescript
import { readDecisions } from "./decisions.js";
import type { Space, SpaceMaintenance } from "@my-agent/core";
import { readFrontmatter } from "../metadata/frontmatter.js";
import path from "node:path";

export interface RepairContext {
  /** Should the worker attempt repair? */
  shouldRepair: boolean;
  /** Repair instructions for the worker prompt */
  repairPrompt: string;
  /** Maintenance policy */
  policy: SpaceMaintenance["on_failure"];
}

/** Build repair context for a failed tool invocation */
export function buildRepairContext(space: Space, errorOutput: string): RepairContext {
  const policy = space.maintenance?.on_failure ?? "alert";

  if (policy === "alert") {
    return {
      shouldRepair: false,
      policy,
      repairPrompt: `Tool "${space.name}" failed. Policy is "alert" -- do NOT attempt repair. Report the failure.`,
    };
  }

  if (policy === "replace") {
    return {
      shouldRepair: false,
      policy,
      repairPrompt: `Tool "${space.name}" failed. Policy is "replace" -- create a new tool space to replace it. Deprecate the old one in DECISIONS.md.`,
    };
  }

  // policy === "fix"
  const decisions = readDecisions(space.path);
  const maintenanceRules = extractMaintenanceRules(space);

  return {
    shouldRepair: true,
    policy,
    repairPrompt: [
      `Tool "${space.name}" failed with error:`,
      "```",
      errorOutput,
      "```",
      "",
      "## Repair Protocol",
      "",
      "You have ONE attempt to fix this tool. Read the context below before making changes.",
      "",
      "### Maintenance Rules (from SPACE.md)",
      maintenanceRules || "(none specified)",
      "",
      "### Prior Decisions (from DECISIONS.md)",
      decisions || "(no prior decisions)",
      "",
      "### Instructions",
      "1. Diagnose the root cause based on the error and prior decisions",
      "2. Make the minimal fix needed",
      "3. Test with the same input that caused the failure",
      "4. If fixed: log the fix in DECISIONS.md, then continue the job",
      "5. If still broken: log the failure in DECISIONS.md, then fail the job",
    ].join("\n"),
  };
}

/** Extract maintenance rules from SPACE.md body (## Maintenance Rules section) */
function extractMaintenanceRules(space: Space): string {
  try {
    const spaceMdPath = path.join(space.path, "SPACE.md");
    const { body } = readFrontmatter(spaceMdPath);
    const match = body.match(/## Maintenance Rules\n([\s\S]*?)(?=\n## |\n---|\Z)/);
    return match ? match[1].trim() : "";
  } catch {
    return "";
  }
}
```

**Test:** `packages/dashboard/tests/spaces/repair-context.test.ts`

```bash
cd packages/dashboard && npx vitest run tests/spaces/repair-context.test.ts
```

Test cases:
- Policy "fix" -> shouldRepair true, prompt includes DECISIONS.md content
- Policy "alert" -> shouldRepair false, prompt says "do NOT attempt repair"
- Policy "replace" -> shouldRepair false, prompt says "create a new tool space"
- Missing DECISIONS.md -> still builds prompt with "(no prior decisions)"

**Commit:** `feat(spaces): inline repair protocol context builder`

---

### Task 7 — Verify `list_spaces` tag-based filtering for tools (3 min)

**File:** `packages/dashboard/tests/mcp/space-tools-server.test.ts` (extend S1 tests)

S1 built `list_spaces` with tag filtering. Verify it works for the tool discovery use case: `list_spaces({ tags: ["tool"] })` returns only spaces with `[tool]` in their tags.

Add test cases:
- 3 spaces: one with `tags: [tool, scraper]`, one with `tags: [data]`, one with `tags: [tool, dedup]`
- `list_spaces({ tags: ["tool"] })` returns 2 results
- `list_spaces({ tags: ["scraper"] })` returns 1 result
- `list_spaces({ runtime: "uv" })` returns only uv-runtime spaces
- Verify returned spaces include `io` and `maintenance` fields when present

```bash
cd packages/dashboard && npx vitest run tests/mcp/space-tools-server.test.ts
```

**Commit:** `test(spaces): verify list_spaces tag-based filtering for tool discovery`

---

### Task 8 — UI: I/O contract display in Space detail property view (5 min)

**File:** `packages/dashboard/public/index.html`

In the Space detail tab's property view (built in S1), add the I/O contract section. This shows when SPACE.md is selected and the space has an `io` field.

**Template pattern** (follows existing property row styling from S1):

```html
<!-- I/O Contract (tool spaces only) -->
<template x-if="tab.spaceData?.io">
  <div class="mt-4">
    <h4 class="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">I/O Contract</h4>

    <!-- Input -->
    <div class="mb-3">
      <span class="text-[10px] text-gray-500 uppercase">Input</span>
      <div class="mt-1 space-y-1">
        <template x-for="[name, type] in Object.entries(tab.spaceData.io.input || {})" :key="name">
          <div class="flex items-center gap-2 px-2 py-1 rounded bg-surface-800/50">
            <span class="text-sm text-gray-300 font-mono" x-text="name"></span>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400" x-text="type"></span>
          </div>
        </template>
      </div>
    </div>

    <!-- Output -->
    <div>
      <span class="text-[10px] text-gray-500 uppercase">Output</span>
      <div class="mt-1 space-y-1">
        <template x-for="[name, type] in Object.entries(tab.spaceData.io.output || {})" :key="name">
          <div class="flex items-center gap-2 px-2 py-1 rounded bg-surface-800/50">
            <span class="text-sm text-gray-300 font-mono" x-text="name"></span>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400" x-text="type"></span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
```

**Commit:** `feat(ui): I/O contract display in Space detail property view`

---

### Task 9 — UI: Maintenance section in Space detail property view (4 min)

**File:** `packages/dashboard/public/index.html`

Add maintenance section below the I/O contract. Shows `on_failure` as toggle pills and maintenance rules as a left-bordered list.

```html
<!-- Maintenance (tool spaces only) -->
<template x-if="tab.spaceData?.maintenance">
  <div class="mt-4">
    <h4 class="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Maintenance</h4>

    <!-- on_failure toggle pills -->
    <div class="flex gap-2 mb-3">
      <template x-for="option in ['fix', 'replace', 'alert']" :key="option">
        <button
          class="text-xs px-3 py-1 rounded-full border transition-colors"
          :class="tab.spaceData.maintenance.on_failure === option
            ? 'bg-violet-500/20 text-violet-300 border-violet-500/30'
            : 'text-gray-500 border-gray-700 hover:border-gray-600'"
          @click="updateMaintenancePolicy(tab, option)"
          x-text="option"
        ></button>
      </template>
    </div>

    <!-- Maintenance rules (extracted from SPACE.md body) -->
    <template x-if="tab.maintenanceRules?.length > 0">
      <div class="space-y-1">
        <template x-for="rule in tab.maintenanceRules" :key="rule">
          <div class="flex items-start gap-2 pl-3 border-l-2 border-violet-500/30 py-1">
            <span class="text-sm text-gray-300" x-text="rule"></span>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
```

**File:** `packages/dashboard/public/js/app.js`

Add `updateMaintenancePolicy()` method — uses existing PATCH `/api/spaces/:name` endpoint from S1:

```javascript
async updateMaintenancePolicy(tab, newPolicy) {
  const maintenance = { ...tab.spaceData.maintenance, on_failure: newPolicy };
  tab.spaceData.maintenance = maintenance;
  await this.updateSpaceField(tab.data.name, 'maintenance', maintenance);
},
```

**Commit:** `feat(ui): maintenance section with toggle pills in Space detail`

---

### ~~Task 10 — DROPPED: "Run" button~~

> **Dropped by CTO decision (2026-03-23).** Direct shell execution from the dashboard bypasses agent hooks, doesn't log to job history, and has no audit trail. Tool invocation will go through the agent (chat) once automations exist in S3. No value after M7 development is complete.

---

### Task 11 — UI: DECISIONS.md preview in tree panel (3 min)

**File:** `packages/dashboard/public/index.html`

When DECISIONS.md is selected in the Space detail file tree (built in S1), the right panel shows rendered markdown. S1 already handles file selection and content preview -- this task ensures DECISIONS.md gets a proper rendered view (not raw text).

Add a specialized view for DECISIONS.md with a "Decision History" header badge:

```html
<!-- DECISIONS.md selected: rendered decision history -->
<template x-if="tab.selectedFile === 'DECISIONS.md'">
  <div class="p-4 space-y-4 overflow-y-auto max-h-full">
    <div class="flex items-center gap-2 mb-3">
      <svg class="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
      <span class="text-xs font-medium text-amber-400 uppercase tracking-wider">Decision History</span>
    </div>
    <div class="prose prose-invert prose-sm max-w-none text-gray-300"
         x-html="renderMarkdown(tab.selectedFileContent)">
    </div>
  </div>
</template>
```

If no markdown renderer exists, use a whitespace-preserving view:

```html
<pre class="text-sm text-gray-300 whitespace-pre-wrap" x-text="tab.selectedFileContent"></pre>
```

**Commit:** `feat(ui): DECISIONS.md rendered preview in Space detail tree panel`

---

### Task 12 — Wire space contexts into Working Nina prompt (3 min)

**File:** `packages/dashboard/src/tasks/working-nina-prompt.ts`

When a task references spaces (e.g., an automation that uses tool spaces), inject the SPACE.md contents and maintenance rules into the worker system prompt. This gives the worker knowledge of the tools it can use.

Add to the prompt assembly array (after notebook context):

```typescript
// Space contexts (tool manifests + maintenance rules for referenced spaces)
if (options.spaceContexts && options.spaceContexts.length > 0) {
  sections.push("");
  sections.push("[Available Tool Spaces]");
  for (const ctx of options.spaceContexts) {
    sections.push(ctx);
    sections.push("---");
  }
  sections.push("[End Tool Spaces]");
}
```

**Test:** Extend `working-nina-prompt.test.ts` -- verify space contexts appear in assembled prompt.

```bash
cd packages/dashboard && npx vitest run tests/tasks/working-nina-prompt.test.ts
```

**Commit:** `feat(prompt): inject space contexts into Working Nina prompt`

---

### ~~Task 13 — DROPPED: WebSocket handler for tool operations~~

> **Dropped with Task 10.** No Run button means no need for `space:run_tool` WebSocket handler. Maintenance updates use the existing PATCH `/api/spaces/:name` endpoint from S1.

---

### Task 14 — Integration test: full tool lifecycle (5 min)

**File:** `packages/dashboard/tests/spaces/tool-lifecycle.test.ts` (new)

End-to-end test of the tool lifecycle:

1. Create a space directory with SPACE.md (tool fields: runtime=bash, entry=echo.sh, io contract)
2. Write a trivial `echo.sh`: `echo '{"result": "'$1'"}'`
3. Sync via SpaceSyncService -- verify indexed in agent.db with io/maintenance
4. `buildToolCommand()` produces correct shell command
5. Execute command, `classifyToolOutput()` returns success
6. Simulate failure -- `classifyToolOutput()` with exit code 1
7. `buildRepairContext()` with policy "fix" includes DECISIONS.md content
8. `appendDecision()` logs the repair -- verify in DECISIONS.md
9. `list_spaces({ tags: ["tool"] })` returns the space

```bash
cd packages/dashboard && npx vitest run tests/spaces/tool-lifecycle.test.ts
```

Expected: All 9 steps pass. Full tool creation to invocation to failure to repair to logging cycle verified.

**Commit:** `test(spaces): full tool lifecycle integration test`

---

## Summary

| # | Task | Files | Time |
|---|------|-------|------|
| 1 | Space type augmentation | `core/src/spaces/types.ts` | 3 min |
| 2 | SpaceSyncService tool field indexing | `core/src/spaces/space-sync-service.ts`, `dashboard/src/conversations/db.ts` | 4 min |
| 3 | DECISIONS.md utilities | `dashboard/src/spaces/decisions.ts` | 3 min |
| 4 | Tool invocation helper | `dashboard/src/spaces/tool-invoker.ts` | 5 min |
| 5 | Tool creation template in prompt | `dashboard/src/tasks/working-nina-prompt.ts` | 4 min |
| 6 | Inline repair protocol | `dashboard/src/spaces/repair-context.ts` | 4 min |
| 7 | Verify list_spaces filtering | `dashboard/tests/mcp/space-tools-server.test.ts` | 3 min |
| 8 | UI: I/O contract display | `dashboard/public/index.html` | 5 min |
| 9 | UI: Maintenance section | `dashboard/public/index.html`, `app.js` | 4 min |
| ~~10~~ | ~~DROPPED: Run button~~ | | |
| 11 | UI: DECISIONS.md preview | `dashboard/public/index.html` | 3 min |
| 12 | Space contexts in worker prompt | `dashboard/src/tasks/working-nina-prompt.ts` | 3 min |
| ~~13~~ | ~~DROPPED: WebSocket handlers~~ | | |
| 14 | Integration test | `dashboard/tests/spaces/tool-lifecycle.test.ts` | 5 min |
| | **Total** | | **46 min** |

## Test Commands

```bash
# Unit tests
cd packages/core && npx vitest run tests/spaces/

# Dashboard tests
cd packages/dashboard && npx vitest run tests/spaces/
cd packages/dashboard && npx vitest run tests/tasks/working-nina-prompt.test.ts
cd packages/dashboard && npx vitest run tests/mcp/space-tools-server.test.ts

# Full suite
cd packages/core && npx vitest run
cd packages/dashboard && npx vitest run
```

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| S1 not yet implemented -- all S2 tasks depend on S1 entities | High | Plan accounts for S1 deliverables; validate at sprint start |
| Direct shell execution from WebSocket handler bypasses agent hooks | Medium | "Run" button is for manual testing only; production invocation goes through Bash tool in agent mode |
| DECISIONS.md file format not enforced | Low | Convention-based; agents follow the template; no schema validation needed |
| `writeFrontmatter()` race condition if SpaceSyncService triggers mid-write | Low | Chokidar debounce (1.5s) prevents rapid re-reads |
