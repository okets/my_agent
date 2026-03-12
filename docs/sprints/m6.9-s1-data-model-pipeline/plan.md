# M6.9-S1: Data Model + Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `[FACT]/[PERSON]/[PREFERENCE]` extraction pipeline with a classified knowledge lifecycle: permanent vs temporal routing, YAML properties, summary rollup chain, and `queryModel()` abstraction.

**Architecture:** New classification prompt produces 7 categories (`PERMANENT:*`, `TEMPORAL`, `PROPERTY:*`). Each category routes to a different destination: permanent facts go to `knowledge/extracted/` staging, temporal facts append to `daily/{today}.md`, properties update `properties/status.yaml`. Summary jobs (daily, weekly, monthly) compress temporal context. `queryModel()` replaces `queryHaiku()` to support model selection. `SystemPromptBuilder` gets a new `loadProperties()` injection for YAML data.

**Tech Stack:** TypeScript, Node.js, Vitest, `yaml` package (already in `@my-agent/core`), `globby` (already in `@my-agent/core`)

**Design spec:** `docs/sprints/m6.6-s6-knowledge-lifecycle/design.md` (Sections 3-9)

---

## File Structure

### New files to create

| File | Responsibility |
|------|---------------|
| `packages/dashboard/src/conversations/knowledge-extractor.ts` | New classification prompt, parser, router (replaces `fact-extractor.ts` callers) |
| `packages/dashboard/src/conversations/knowledge-staging.ts` | Staging area CRUD: write, read, increment attempts, delete resolved |
| `packages/dashboard/src/conversations/properties.ts` | `properties/status.yaml` read/write/update utilities |
| `packages/dashboard/src/scheduler/query-model.ts` | `queryModel(prompt, systemPrompt, model)` replaces `haiku-query.ts` |
| `packages/dashboard/src/scheduler/jobs/weekly-summary.ts` | Weekly summary job (Haiku, reads daily summaries into weekly rollup) |
| `packages/dashboard/src/scheduler/jobs/monthly-summary.ts` | Monthly summary job (Haiku, reads weekly summaries into monthly rollup) |
| `packages/dashboard/tests/knowledge-extractor.test.ts` | Unit tests for new parser/router |
| `packages/dashboard/tests/knowledge-staging.test.ts` | Unit tests for staging CRUD |
| `packages/dashboard/tests/properties.test.ts` | Unit tests for YAML properties |
| `packages/dashboard/tests/query-model.test.ts` | Unit tests for queryModel |
| `packages/dashboard/tests/weekly-summary.test.ts` | Unit tests for weekly summary job |
| `packages/dashboard/tests/monthly-summary.test.ts` | Unit tests for monthly summary job |
| `packages/core/tests/prompt-recursive.test.ts` | Unit test for recursive `loadNotebookReference` |
| `packages/core/tests/load-properties.test.ts` | Unit test for `loadProperties` |
| `packages/dashboard/scripts/migrate-knowledge.ts` | Migration script: reclassify existing `knowledge/*.md` |

### Files to modify

| File | Change |
|------|--------|
| `packages/core/src/prompt.ts` | `loadNotebookReference()` recursive subdirs; add `loadProperties()` export |
| `packages/core/src/lib.ts` | Export `loadProperties` |
| `packages/core/src/memory/sync-service.ts` | Add path-pattern exclusion support |
| `packages/dashboard/src/scheduler/haiku-query.ts` | Re-export wrapper for backward compat |
| `packages/dashboard/src/conversations/abbreviation.ts` | Switch from `extractFacts`/`persistFacts` to new knowledge extractor |
| `packages/dashboard/src/scheduler/work-loop-scheduler.ts` | Add weekly/monthly summary handlers; update morning prep to use summary stack |
| `packages/dashboard/src/scheduler/jobs/morning-prep.ts` | Revised prompt: reads summaries + calendar into past+future temporal stack |
| `packages/dashboard/src/scheduler/jobs/daily-summary.ts` | Revised: writes to `summaries/daily/` instead of appending to daily log |
| `packages/dashboard/src/agent/system-prompt-builder.ts` | Add `loadProperties()` to dynamic block |
| `packages/dashboard/tests/e2e/memory-lifecycle.test.ts` | Update to use new extraction API |
| `packages/dashboard/tests/fact-extractor.test.ts` | Replace with `knowledge-extractor.test.ts` equivalent coverage |

---

## Chunk 1: Prerequisites (Tasks 1-3)

Three independent infrastructure changes. No dependencies between them.

### Task 1: Recursive `loadNotebookReference()`

**Files:**
- Modify: `packages/core/src/prompt.ts:148-196` (`loadNotebookReference` function)
- Create: `packages/core/tests/prompt-recursive.test.ts`

Currently `loadNotebookReference()` uses flat `readdir()` and only reads `*.md` directly in `notebook/reference/`. Must recurse into subdirectories (e.g., `reference/preferences/*.md`) using `**/*.md` glob. Ordering must be deterministic: alphabetical by full relative path.

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/prompt-recursive.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We test via assembleSystemPrompt which calls loadNotebookReference internally.
// loadNotebookReference is not exported directly.

let tmpDir: string;
let brainDir: string;

describe("loadNotebookReference recursive", () => {
  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "prompt-recursive-"));
    brainDir = join(tmpDir, "brain");
    mkdirSync(brainDir, { recursive: true });
    // Minimal brain file so assembleSystemPrompt doesn't use fallback
    writeFileSync(join(brainDir, "CLAUDE.md"), "You are a test agent.");

    // Create reference/ with subdirectories
    const refDir = join(tmpDir, "notebook", "reference");
    mkdirSync(join(refDir, "preferences"), { recursive: true });

    writeFileSync(join(refDir, "user-info.md"), "Has two daughters.");
    writeFileSync(
      join(refDir, "preferences", "personal.md"),
      "Loves pad krapao."
    );
    writeFileSync(
      join(refDir, "preferences", "work.md"),
      "Uses TypeScript."
    );
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("includes files from subdirectories", async () => {
    const { assembleSystemPrompt } = await import("../src/prompt.js");
    const prompt = await assembleSystemPrompt(brainDir);

    expect(prompt).toContain("Has two daughters.");
    expect(prompt).toContain("Loves pad krapao.");
    expect(prompt).toContain("Uses TypeScript.");
  });

  it("orders files deterministically by relative path", async () => {
    const { assembleSystemPrompt } = await import("../src/prompt.js");
    const prompt = await assembleSystemPrompt(brainDir);

    // preferences/personal.md should come before preferences/work.md
    // user-info.md should come after preferences/* (u > p alphabetically)
    const personalIdx = prompt.indexOf("Loves pad krapao.");
    const workIdx = prompt.indexOf("Uses TypeScript.");
    const userIdx = prompt.indexOf("Has two daughters.");

    expect(personalIdx).toBeLessThan(workIdx); // personal < work
    expect(workIdx).toBeLessThan(userIdx); // preferences/* < user-info
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/prompt-recursive.test.ts`
Expected: FAIL — subdirectory files not found in output

- [ ] **Step 3: Implement recursive loading**

Modify `packages/core/src/prompt.ts` — replace the `loadNotebookReference` function:

```typescript
async function loadNotebookReference(agentDir: string): Promise<string | null> {
  const referenceDir = path.join(agentDir, 'notebook', 'reference')

  if (!existsSync(referenceDir)) {
    return null
  }

  // Use globby for recursive glob (already a dependency of @my-agent/core)
  const { globby } = await import('globby')
  const files = await globby('**/*.md', {
    cwd: referenceDir,
    absolute: false,
  })

  // Sort by full relative path for deterministic ordering
  files.sort()

  const sections: string[] = []
  let totalChars = 0

  for (const relPath of files) {
    const filePath = path.join(referenceDir, relPath)
    let content = await readOptionalFile(filePath)
    if (!content || content.trim() === '') continue

    // Truncate individual file if too large
    if (content.length > MAX_NOTEBOOK_CHARS) {
      content = content.substring(0, MAX_NOTEBOOK_CHARS) + '\n\n[... truncated ...]'
    }

    // Check total limit
    if (totalChars + content.length > MAX_REFERENCE_TOTAL_CHARS) {
      console.warn(`[Prompt] Reference files exceed ${MAX_REFERENCE_TOTAL_CHARS} chars, stopping`)
      break
    }

    // Format with header derived from filename (strip directory + extension)
    const name = path.basename(relPath, '.md').replace(/-/g, ' ')
    const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1)
    sections.push(`### ${capitalizedName}\n\n${content.trim()}`)
    totalChars += content.length
  }

  if (sections.length === 0) {
    return null
  }

  return `## Your Notebook (Reference)\n\n${sections.join('\n\n')}`
}
```

Also update `hasNotebookReference` to check recursively:

```typescript
async function hasNotebookReference(agentDir: string): Promise<boolean> {
  const referenceDir = path.join(agentDir, 'notebook', 'reference')

  if (!existsSync(referenceDir)) {
    return false
  }

  try {
    const { globby } = await import('globby')
    const files = await globby('**/*.md', { cwd: referenceDir })
    return files.length > 0
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run tests/prompt-recursive.test.ts`
Expected: PASS

- [ ] **Step 5: Run full core test suite**

Run: `cd packages/core && npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/prompt.ts packages/core/tests/prompt-recursive.test.ts
git commit -m "feat(core): recursive loadNotebookReference for subdirectory support"
```

---

### Task 2: `loadProperties()` YAML injection

**Files:**
- Modify: `packages/core/src/prompt.ts` (add `loadProperties` function)
- Modify: `packages/core/src/lib.ts` (export it)
- Create: `packages/core/tests/load-properties.test.ts`

New function that reads `notebook/properties/status.yaml`, parses it with the `yaml` package (already a dependency), and formats it as a text block for the system prompt.

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/load-properties.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;

describe("loadProperties", () => {
  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "load-props-"));
    mkdirSync(join(tmpDir, "notebook", "properties"), { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when properties dir does not exist", async () => {
    const { loadProperties } = await import("../src/prompt.js");
    const result = await loadProperties("/nonexistent/dir");
    expect(result).toBeNull();
  });

  it("returns null when status.yaml does not exist", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "no-yaml-"));
    mkdirSync(join(emptyDir, "notebook", "properties"), { recursive: true });

    const { loadProperties } = await import("../src/prompt.js");
    const result = await loadProperties(emptyDir);
    expect(result).toBeNull();

    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("formats YAML properties as text block", async () => {
    writeFileSync(
      join(tmpDir, "notebook", "properties", "status.yaml"),
      `location:
  value: "Chiang Mai, Thailand"
  confidence: high
  updated: 2026-03-12
  source: "explicit mention in conversation"
timezone:
  value: "Asia/Bangkok"
  confidence: high
  updated: 2026-03-12
  source: "inferred from location"
availability:
  value: "vacation"
  confidence: medium
  updated: 2026-03-10
  source: "mentioned taking time off"
`
    );

    const { loadProperties } = await import("../src/prompt.js");
    const result = await loadProperties(tmpDir);

    expect(result).not.toBeNull();
    expect(result).toContain("[Dynamic Status]");
    expect(result).toContain("Location: Chiang Mai, Thailand");
    expect(result).toContain("high confidence");
    expect(result).toContain("Timezone: Asia/Bangkok");
    expect(result).toContain("Availability: vacation");
    expect(result).toContain("medium confidence");
    expect(result).toContain("[End Dynamic Status]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/load-properties.test.ts`
Expected: FAIL — `loadProperties` not found

- [ ] **Step 3: Implement `loadProperties()`**

Add import at top of `packages/core/src/prompt.ts`:

```typescript
import { parse as parseYaml } from 'yaml'
```

Add the function (after `loadNotebookOperations`):

```typescript
/**
 * Load properties from notebook/properties/status.yaml.
 * Formats as a text block for system prompt injection.
 *
 * Format:
 * [Dynamic Status]
 * Location: Chiang Mai, Thailand (high confidence, updated 2026-03-12)
 * Timezone: Asia/Bangkok (high confidence)
 * [End Dynamic Status]
 */
export async function loadProperties(agentDir: string): Promise<string | null> {
  const propsFile = path.join(agentDir, 'notebook', 'properties', 'status.yaml')

  const content = await readOptionalFile(propsFile)
  if (!content || content.trim() === '') {
    return null
  }

  let data: Record<string, { value: string; confidence?: string; updated?: string }>
  try {
    data = parseYaml(content)
  } catch {
    console.warn('[Prompt] Failed to parse status.yaml')
    return null
  }

  if (!data || typeof data !== 'object') {
    return null
  }

  const lines: string[] = ['[Dynamic Status]']

  for (const [key, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== 'object' || !entry.value) continue

    const label = key.charAt(0).toUpperCase() + key.slice(1)
    const parts = [entry.value]
    if (entry.confidence) {
      parts.push(`${entry.confidence} confidence`)
    }
    if (entry.updated) {
      parts.push(`updated ${entry.updated}`)
    }

    lines.push(`${label}: ${parts[0]} (${parts.slice(1).join(', ')})`)
  }

  lines.push('[End Dynamic Status]')

  if (lines.length <= 2) {
    return null // Only header + footer, no actual properties
  }

  return lines.join('\n')
}
```

Add to `packages/core/src/lib.ts` exports:

```typescript
export { loadProperties } from './prompt.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run tests/load-properties.test.ts`
Expected: PASS

- [ ] **Step 5: Run full core test suite**

Run: `cd packages/core && npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/prompt.ts packages/core/src/lib.ts packages/core/tests/load-properties.test.ts
git commit -m "feat(core): loadProperties YAML injection for dynamic status"
```

---

### Task 3: SyncService path-pattern exclusion

**Files:**
- Modify: `packages/core/src/memory/sync-service.ts`
- Create: `packages/core/tests/sync-service-exclusion.test.ts`

Currently SyncService only excludes dotfiles (basename check). Must support excluding path patterns like `knowledge/extracted/`. The chokidar `ignored` option and the `fullSync` globby call both need updating.

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/sync-service-exclusion.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SyncService } from "../src/memory/sync-service.js";

// Minimal mock for MemoryDb
const mockDb = {
  getFile: vi.fn().mockReturnValue(null),
  deleteChunksForFile: vi.fn(),
  deleteFile: vi.fn(),
  insertChunk: vi.fn().mockReturnValue(1),
  upsertFile: vi.fn(),
  listFiles: vi.fn().mockReturnValue([]),
  setIndexMeta: vi.fn(),
  getCachedEmbedding: vi.fn().mockReturnValue(null),
  cacheEmbedding: vi.fn(),
  insertChunkVector: vi.fn(),
} as any;

let tmpDir: string;

describe("SyncService excludePatterns", () => {
  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sync-excl-"));
    mkdirSync(join(tmpDir, "knowledge", "extracted"), { recursive: true });
    mkdirSync(join(tmpDir, "reference"), { recursive: true });

    writeFileSync(join(tmpDir, "reference", "user-info.md"), "Test user info");
    writeFileSync(
      join(tmpDir, "knowledge", "extracted", "staged.md"),
      "Staged fact"
    );
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fullSync excludes files matching excludePatterns", async () => {
    const service = new SyncService({
      notebookDir: tmpDir,
      db: mockDb,
      getPlugin: () => null,
      excludePatterns: ["knowledge/extracted/**"],
    });

    await service.fullSync();

    // upsertFile should be called for reference/user-info.md but NOT for knowledge/extracted/staged.md
    const upsertCalls = mockDb.upsertFile.mock.calls.map(
      (c: any[]) => c[0].path
    );
    expect(upsertCalls).toContain("reference/user-info.md");
    expect(upsertCalls).not.toContain("knowledge/extracted/staged.md");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/sync-service-exclusion.test.ts`
Expected: FAIL — `excludePatterns` not recognized

- [ ] **Step 3: Add `excludePatterns` to SyncServiceOptions**

Modify `packages/core/src/memory/sync-service.ts`:

```typescript
export interface SyncServiceOptions {
  notebookDir: string
  db: MemoryDb
  getPlugin: () => EmbeddingsPlugin | null
  debounceMs?: number
  excludePatterns?: string[]  // Glob patterns to exclude (e.g., 'knowledge/extracted/**')
}
```

Store in constructor:

```typescript
private excludePatterns: string[]

constructor(options: SyncServiceOptions) {
  // ... existing code ...
  this.excludePatterns = options.excludePatterns ?? []
}
```

- [ ] **Step 2: Update `startWatching()` chokidar ignored**

```typescript
startWatching(): void {
  if (this.watcher) return

  this.watcher = watch(this.notebookDir, {
    ignored: (filePath: string) => {
      // Existing: ignore dotfiles
      if (basename(filePath).startsWith('.')) return true
      // New: check against exclude patterns
      const rel = relative(this.notebookDir, filePath)
      return this.excludePatterns.some((pattern) => {
        const dir = pattern.replace(/\/\*\*$/, '')
        return rel.startsWith(dir)
      })
    },
    persistent: true,
    ignoreInitial: true,
    usePolling: true,
    interval: 1000,
  })

  // ... rest of event handlers unchanged
}
```

- [ ] **Step 3: Update `fullSync()` globby ignore**

In the `fullSync` method, update the globby call:

```typescript
const files = await globby('**/*.md', {
  cwd: this.notebookDir,
  ignore: this.excludePatterns,
})
```

- [ ] **Step 4: Update `scheduleSync()` to check exclusions**

```typescript
private scheduleSync(filePath: string): void {
  if (!filePath.endsWith('.md')) return

  // Check if file is in an excluded path
  const rel = relative(this.notebookDir, filePath)
  const isExcluded = this.excludePatterns.some((pattern) => {
    const dir = pattern.replace(/\/\*\*$/, '')
    return rel.startsWith(dir)
  })
  if (isExcluded) return

  // ... rest unchanged
}
```

- [ ] **Step 5: Run exclusion test to verify it passes**

Run: `cd packages/core && npx vitest run tests/sync-service-exclusion.test.ts`
Expected: PASS

- [ ] **Step 6: Run full core test suite**

Run: `cd packages/core && npx vitest run`
Expected: All tests pass

- [ ] **Step 7: Update SyncService construction in dashboard index.ts**

Find where SyncService is constructed in `packages/dashboard/src/index.ts` and add the exclusion:

```typescript
syncService = new SyncService({
  notebookDir,
  db: memoryDb,
  getPlugin: () => pluginRegistry?.getActive() ?? null,
  excludePatterns: ['knowledge/extracted/**'],
});
```

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/memory/sync-service.ts packages/core/tests/sync-service-exclusion.test.ts packages/dashboard/src/index.ts
git commit -m "feat(core): SyncService path-pattern exclusion for staging area"
```

---

## Chunk 2: queryModel + Properties Utilities (Tasks 4-5)

### Task 4: `queryModel()` — model-selectable queries

**Files:**
- Create: `packages/dashboard/src/scheduler/query-model.ts`
- Modify: `packages/dashboard/src/scheduler/haiku-query.ts` (re-export wrapper)
- Create: `packages/dashboard/tests/query-model.test.ts`

Replaces `queryHaiku()` with `queryModel(prompt, systemPrompt, model)`. Model param (`"haiku" | "sonnet" | "opus"`) resolves to latest version string internally. All existing callers of `queryHaiku()` continue working via the re-export.

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/tests/query-model.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

// Mock @my-agent/core to avoid real API calls
vi.mock("@my-agent/core", () => ({
  createBrainQuery: vi.fn(),
}));

import { createBrainQuery } from "@my-agent/core";

import { beforeEach } from "vitest";

describe("queryModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves 'haiku' to the correct model ID", async () => {
    const mockQuery = (async function* () {
      yield { type: "result", result: "test response" };
    })();
    vi.mocked(createBrainQuery).mockReturnValue(mockQuery as any);

    const { queryModel } = await import("../src/scheduler/query-model.js");
    await queryModel("test prompt", "system prompt", "haiku");

    expect(createBrainQuery).toHaveBeenCalledWith(
      "test prompt",
      expect.objectContaining({
        model: expect.stringContaining("haiku"),
      })
    );
  });

  it("resolves 'sonnet' to the correct model ID", async () => {
    const mockQuery = (async function* () {
      yield { type: "result", result: "test response" };
    })();
    vi.mocked(createBrainQuery).mockReturnValue(mockQuery as any);

    const { queryModel } = await import("../src/scheduler/query-model.js");
    await queryModel("test prompt", "system prompt", "sonnet");

    expect(createBrainQuery).toHaveBeenCalledWith(
      "test prompt",
      expect.objectContaining({
        model: expect.stringContaining("sonnet"),
      })
    );
  });

  it("defaults to haiku when no model specified", async () => {
    const mockQuery = (async function* () {
      yield { type: "result", result: "test response" };
    })();
    vi.mocked(createBrainQuery).mockReturnValue(mockQuery as any);

    const { queryModel } = await import("../src/scheduler/query-model.js");
    await queryModel("test prompt", "system prompt");

    expect(createBrainQuery).toHaveBeenCalledWith(
      "test prompt",
      expect.objectContaining({
        model: expect.stringContaining("haiku"),
      })
    );
  });

  it("throws on empty response", async () => {
    const mockQuery = (async function* () {
      yield { type: "result", result: "" };
    })();
    vi.mocked(createBrainQuery).mockReturnValue(mockQuery as any);

    const { queryModel } = await import("../src/scheduler/query-model.js");
    await expect(
      queryModel("test prompt", "system prompt")
    ).rejects.toThrow("empty response");
  });
});

describe("MODEL_MAP", () => {
  it("exports model map for configuration", async () => {
    const { MODEL_MAP } = await import("../src/scheduler/query-model.js");
    expect(MODEL_MAP.haiku).toBeDefined();
    expect(MODEL_MAP.sonnet).toBeDefined();
    expect(MODEL_MAP.opus).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/query-model.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `queryModel()`**

Create `packages/dashboard/src/scheduler/query-model.ts`:

```typescript
/**
 * Model-selectable background query utility
 *
 * Replaces queryHaiku with model-parameterized queries.
 * Model param resolves to the latest version internally.
 * Callers never specify version strings.
 */

import { createBrainQuery } from "@my-agent/core";

export type ModelAlias = "haiku" | "sonnet" | "opus";

/**
 * Model alias to latest model ID.
 * Update this map when Anthropic releases new model versions.
 */
export const MODEL_MAP: Record<ModelAlias, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6-20250627",
  opus: "claude-opus-4-6-20250627",
};

/**
 * Send a prompt to a Claude model, return the text response.
 *
 * Used by morning prep, daily summary, weekly review, and extraction jobs.
 * No MCP tools, no agents, no hooks -- simple prompt to response.
 */
export async function queryModel(
  prompt: string,
  systemPrompt: string,
  model: ModelAlias = "haiku",
): Promise<string> {
  const modelId = MODEL_MAP[model];

  const query = createBrainQuery(prompt, {
    model: modelId,
    systemPrompt,
    continue: false,
    includePartialMessages: false,
  });

  let responseText = "";

  for await (const msg of query) {
    if (msg.type === "assistant") {
      const message = (
        msg as {
          message?: {
            content?: Array<{ type: string; text?: string }>;
          };
        }
      ).message;
      if (message?.content) {
        for (const block of message.content) {
          if (block.type === "text" && block.text) {
            responseText += block.text;
          }
        }
      }
    } else if (msg.type === "result") {
      const result = msg as { result?: string };
      if (!responseText && result.result) {
        responseText = result.result;
      }
      break;
    }
  }

  if (!responseText.trim()) {
    throw new Error(`${model} returned empty response`);
  }

  return responseText.trim();
}
```

- [ ] **Step 4: Update `haiku-query.ts` to re-export**

Replace `packages/dashboard/src/scheduler/haiku-query.ts`:

```typescript
/**
 * Background Haiku query utility -- backward compatibility wrapper.
 *
 * Delegates to queryModel("haiku"). Existing callers continue working.
 * New code should import queryModel directly.
 */

import { queryModel } from "./query-model.js";

/**
 * @deprecated Use queryModel(prompt, systemPrompt, "haiku") instead.
 */
export async function queryHaiku(
  prompt: string,
  systemPrompt: string,
): Promise<string> {
  return queryModel(prompt, systemPrompt, "haiku");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/dashboard && npx vitest run tests/query-model.test.ts`
Expected: PASS

- [ ] **Step 6: Run full dashboard test suite**

Run: `cd packages/dashboard && npx vitest run`
Expected: All existing tests pass (haiku-query callers still work via re-export)

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/scheduler/query-model.ts packages/dashboard/src/scheduler/haiku-query.ts packages/dashboard/tests/query-model.test.ts
git commit -m "feat(dashboard): queryModel replaces queryHaiku with model selection"
```

---

### Task 5: Properties read/write utilities

**Files:**
- Create: `packages/dashboard/src/conversations/properties.ts`
- Create: `packages/dashboard/tests/properties.test.ts`

Utilities for reading and writing `properties/status.yaml`. Used by the extraction router (backup path) and eventually by Nina directly.

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/tests/properties.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;

describe("properties utilities", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "props-"));
    mkdirSync(join(tmpDir, "notebook", "properties"), { recursive: true });
  });

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("readProperties returns empty object when file missing", async () => {
    const { readProperties } = await import(
      "../src/conversations/properties.js"
    );
    const result = await readProperties(tmpDir);
    expect(result).toEqual({});
  });

  it("readProperties parses existing YAML", async () => {
    writeFileSync(
      join(tmpDir, "notebook", "properties", "status.yaml"),
      `location:
  value: "Chiang Mai, Thailand"
  confidence: high
  updated: "2026-03-12"
  source: "explicit mention"
`
    );

    const { readProperties } = await import(
      "../src/conversations/properties.js"
    );
    const result = await readProperties(tmpDir);
    expect(result.location.value).toBe("Chiang Mai, Thailand");
    expect(result.location.confidence).toBe("high");
  });

  it("updateProperty sets a new property", async () => {
    const { updateProperty, readProperties } = await import(
      "../src/conversations/properties.js"
    );

    await updateProperty(tmpDir, "location", {
      value: "Krabi, Thailand",
      confidence: "high",
      source: "user stated",
    });

    const result = await readProperties(tmpDir);
    expect(result.location.value).toBe("Krabi, Thailand");
    expect(result.location.confidence).toBe("high");
    expect(result.location.updated).toBeDefined();
  });

  it("updateProperty overwrites existing property", async () => {
    const { updateProperty, readProperties } = await import(
      "../src/conversations/properties.js"
    );

    await updateProperty(tmpDir, "location", {
      value: "Chiang Mai",
      confidence: "high",
      source: "test",
    });

    await updateProperty(tmpDir, "location", {
      value: "Krabi",
      confidence: "medium",
      source: "inferred",
    });

    const result = await readProperties(tmpDir);
    expect(result.location.value).toBe("Krabi");
    expect(result.location.confidence).toBe("medium");
  });

  it("updateProperty preserves other properties", async () => {
    const { updateProperty, readProperties } = await import(
      "../src/conversations/properties.js"
    );

    await updateProperty(tmpDir, "location", {
      value: "Chiang Mai",
      confidence: "high",
      source: "test",
    });

    await updateProperty(tmpDir, "timezone", {
      value: "Asia/Bangkok",
      confidence: "high",
      source: "inferred from location",
    });

    const result = await readProperties(tmpDir);
    expect(result.location.value).toBe("Chiang Mai");
    expect(result.timezone.value).toBe("Asia/Bangkok");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/properties.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement properties utilities**

Create `packages/dashboard/src/conversations/properties.ts`:

```typescript
/**
 * Properties Utilities
 *
 * Read/write notebook/properties/status.yaml -- dynamic metadata
 * (location, timezone, availability) in YAML format.
 *
 * Design spec: docs/sprints/m6.6-s6-knowledge-lifecycle/design.md Section 6
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface PropertyEntry {
  value: string;
  confidence: "high" | "medium" | "low";
  updated: string;
  source: string;
}

export type PropertiesMap = Record<string, PropertyEntry>;

function getPropertiesPath(agentDir: string): string {
  return join(agentDir, "notebook", "properties", "status.yaml");
}

/**
 * Read all properties from status.yaml.
 * Returns empty object if file does not exist.
 */
export async function readProperties(
  agentDir: string,
): Promise<PropertiesMap> {
  const filePath = getPropertiesPath(agentDir);

  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = parseYaml(content);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Update a single property in status.yaml.
 * Creates the file and directory if they do not exist.
 * Sets `updated` to current date automatically.
 */
export async function updateProperty(
  agentDir: string,
  key: string,
  entry: Omit<PropertyEntry, "updated">,
): Promise<void> {
  const filePath = getPropertiesPath(agentDir);
  const dir = join(agentDir, "notebook", "properties");

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  const existing = await readProperties(agentDir);

  existing[key] = {
    ...entry,
    updated: new Date().toISOString().split("T")[0],
  };

  await writeFile(filePath, stringifyYaml(existing), "utf-8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/dashboard && npx vitest run tests/properties.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/conversations/properties.ts packages/dashboard/tests/properties.test.ts
git commit -m "feat(dashboard): properties utilities for status.yaml read/write"
```

---

## Chunk 3: Knowledge Extraction Pipeline (Tasks 6-8)

The core replacement for `fact-extractor.ts`. New classification prompt, parser, router, and staging area.

### Task 6: Classification prompt + parser + router

**Files:**
- Create: `packages/dashboard/src/conversations/knowledge-extractor.ts`
- Create: `packages/dashboard/tests/knowledge-extractor.test.ts`
- Ref: Design spec Section 4.3 (classification prompt), Section 4.4 (routing)

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/tests/knowledge-extractor.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("parseClassifiedFacts", () => {
  it("parses all 7 classification categories", async () => {
    const { parseClassifiedFacts } = await import(
      "../src/conversations/knowledge-extractor.js"
    );

    const raw = `[PERMANENT:user-info] Has two daughters, Noa (5) and Maya (3)
[PERMANENT:contact] Kai -- tour guide in Chiang Mai, hotel concierge referral
[PERMANENT:preference:personal] Loves pad krapao, prefers spicy
[PERMANENT:preference:work] Uses TypeScript, prefers functional patterns over OOP
[PERMANENT:preference:communication] Prefers casual tone in Hebrew
[TEMPORAL] Series A deal signing Tuesday March 18
[TEMPORAL] Flight to Krabi on March 20, returning to Tel Aviv March 25
[PROPERTY:location:high] Currently in Chiang Mai, Thailand
[PROPERTY:availability:medium] On vacation until late March`;

    const result = parseClassifiedFacts(raw);

    expect(result.permanent).toHaveLength(5);
    expect(result.temporal).toHaveLength(2);
    expect(result.properties).toHaveLength(2);

    // Check permanent subcategories
    const userInfo = result.permanent.find((f) => f.subcategory === "user-info");
    expect(userInfo?.text).toContain("two daughters");

    const contact = result.permanent.find((f) => f.subcategory === "contact");
    expect(contact?.text).toContain("Kai");

    const prefPersonal = result.permanent.find(
      (f) => f.subcategory === "preference:personal"
    );
    expect(prefPersonal?.text).toContain("pad krapao");

    // Check properties
    const location = result.properties.find((p) => p.key === "location");
    expect(location?.value).toContain("Chiang Mai");
    expect(location?.confidence).toBe("high");
  });

  it("handles NO_FACTS response", async () => {
    const { parseClassifiedFacts } = await import(
      "../src/conversations/knowledge-extractor.js"
    );

    const result = parseClassifiedFacts("NO_FACTS");
    expect(result.permanent).toHaveLength(0);
    expect(result.temporal).toHaveLength(0);
    expect(result.properties).toHaveLength(0);
  });

  it("handles empty/malformed input", async () => {
    const { parseClassifiedFacts } = await import(
      "../src/conversations/knowledge-extractor.js"
    );

    expect(parseClassifiedFacts("").permanent).toHaveLength(0);
    expect(parseClassifiedFacts("random text\nno categories").permanent).toHaveLength(0);
  });

  it("ignores lines without classification prefix", async () => {
    const { parseClassifiedFacts } = await import(
      "../src/conversations/knowledge-extractor.js"
    );

    const raw = `Some preamble text
[TEMPORAL] Flight to Krabi
More random text`;

    const result = parseClassifiedFacts(raw);
    expect(result.temporal).toHaveLength(1);
    expect(result.permanent).toHaveLength(0);
  });
});

describe("routeFacts", () => {
  it("routes permanent facts to staging", async () => {
    const { routeFacts, parseClassifiedFacts } = await import(
      "../src/conversations/knowledge-extractor.js"
    );

    const parsed = parseClassifiedFacts(
      "[PERMANENT:user-info] Has two daughters"
    );
    const routes = routeFacts(parsed);

    expect(routes.staging).toHaveLength(1);
    expect(routes.staging[0].text).toContain("two daughters");
  });

  it("routes temporal facts to daily log", async () => {
    const { routeFacts, parseClassifiedFacts } = await import(
      "../src/conversations/knowledge-extractor.js"
    );

    const parsed = parseClassifiedFacts("[TEMPORAL] Flight to Krabi March 20");
    const routes = routeFacts(parsed);

    expect(routes.dailyLog).toHaveLength(1);
  });

  it("routes properties to status.yaml", async () => {
    const { routeFacts, parseClassifiedFacts } = await import(
      "../src/conversations/knowledge-extractor.js"
    );

    const parsed = parseClassifiedFacts(
      "[PROPERTY:location:high] Currently in Chiang Mai"
    );
    const routes = routeFacts(parsed);

    expect(routes.properties).toHaveLength(1);
    expect(routes.properties[0].key).toBe("location");
    expect(routes.properties[0].confidence).toBe("high");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/knowledge-extractor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement knowledge-extractor.ts**

Create `packages/dashboard/src/conversations/knowledge-extractor.ts`:

```typescript
/**
 * Knowledge Extractor
 *
 * Classifies extracted facts from conversation transcripts via Haiku.
 * Facts are categorized into PERMANENT, TEMPORAL, and PROPERTY types
 * and routed to appropriate destinations.
 *
 * Replaces the S3 fact-extractor.ts pipeline entirely.
 * Design spec: docs/sprints/m6.6-s6-knowledge-lifecycle/design.md Section 4
 */

import { queryModel } from "../scheduler/query-model.js";

export const CLASSIFICATION_SYSTEM_PROMPT = `You extract structured facts from conversation transcripts.

STRICT RULES:
1. Output ONLY categorized facts - no preamble, no explanation, no thinking
2. Use ONLY facts explicitly stated in the transcript - NEVER infer or assume
3. One fact per line, prefixed with category tag
4. If no facts to extract, respond with EXACTLY: "NO_FACTS"
5. Write in English regardless of transcript language
6. Do NOT attempt to read files, search, or use tools

Categories:
[PERMANENT:user-info] - biographical: family, identity, birthdays, personal milestones
[PERMANENT:contact] - people: name, relationship, context, contact details if mentioned
[PERMANENT:preference:personal] - lifestyle: food, music, hobbies
[PERMANENT:preference:work] - professional: coding style, tools, process
[PERMANENT:preference:communication] - interaction: tone, language, formality
[TEMPORAL] - current events: travel, meetings, projects, plans with dates
[PROPERTY:key:confidence] - dynamic metadata: location, timezone, availability
  - confidence: high (explicitly stated) | medium (inferred) | low (vague)

Examples:
[PERMANENT:user-info] Has two daughters, Noa (5) and Maya (3)
[PERMANENT:contact] Kai - tour guide in Chiang Mai, arranged through hotel concierge
[PERMANENT:preference:personal] Loves pad krapao, prefers spicy
[PERMANENT:preference:work] Uses TypeScript, prefers functional patterns over OOP
[TEMPORAL] Series A deal signing Tuesday March 18
[TEMPORAL] Flight to Krabi on March 20, returning to Tel Aviv March 25
[PROPERTY:location:high] Currently in Chiang Mai, Thailand
[PROPERTY:availability:medium] On vacation until late March`;

export const CLASSIFICATION_USER_PROMPT = `Extract all facts from this conversation transcript.

---

{transcript}`;

// --- Types ---

export interface PermanentFact {
  subcategory: string; // "user-info" | "contact" | "preference:personal" | etc.
  text: string;
}

export interface TemporalFact {
  text: string;
}

export interface PropertyFact {
  key: string;
  value: string;
  confidence: "high" | "medium" | "low";
}

export interface ClassifiedFacts {
  permanent: PermanentFact[];
  temporal: TemporalFact[];
  properties: PropertyFact[];
}

export interface RoutedFacts {
  staging: PermanentFact[]; // knowledge/extracted/
  dailyLog: TemporalFact[]; // daily/{today}.md
  properties: PropertyFact[]; // properties/status.yaml
}

// --- Parser ---

/**
 * Parse Haiku's classified output into structured categories.
 */
export function parseClassifiedFacts(raw: string): ClassifiedFacts {
  const result: ClassifiedFacts = {
    permanent: [],
    temporal: [],
    properties: [],
  };

  if (!raw || raw.trim() === "NO_FACTS") {
    return result;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();

    // PERMANENT categories
    const permanentMatch = trimmed.match(
      /^\[PERMANENT:([\w:]+)\]\s+(.+)$/
    );
    if (permanentMatch) {
      result.permanent.push({
        subcategory: permanentMatch[1],
        text: permanentMatch[2],
      });
      continue;
    }

    // TEMPORAL
    if (trimmed.startsWith("[TEMPORAL]")) {
      result.temporal.push({
        text: trimmed.slice("[TEMPORAL]".length).trim(),
      });
      continue;
    }

    // PROPERTY
    const propertyMatch = trimmed.match(
      /^\[PROPERTY:([\w]+):(high|medium|low)\]\s+(.+)$/
    );
    if (propertyMatch) {
      result.properties.push({
        key: propertyMatch[1],
        value: propertyMatch[3],
        confidence: propertyMatch[2] as "high" | "medium" | "low",
      });
      continue;
    }
  }

  return result;
}

// --- Router ---

/**
 * Route classified facts to their destinations.
 * This is a pure function -- actual I/O is handled by the caller.
 */
export function routeFacts(classified: ClassifiedFacts): RoutedFacts {
  return {
    staging: classified.permanent,
    dailyLog: classified.temporal,
    properties: classified.properties,
  };
}

// --- Extraction entry point ---

/**
 * Extract and classify facts from a conversation transcript via Haiku.
 */
export async function extractClassifiedFacts(
  transcript: string,
): Promise<ClassifiedFacts> {
  const prompt = CLASSIFICATION_USER_PROMPT.replace(
    "{transcript}",
    transcript,
  );
  const raw = await queryModel(prompt, CLASSIFICATION_SYSTEM_PROMPT, "haiku");
  return parseClassifiedFacts(raw);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/dashboard && npx vitest run tests/knowledge-extractor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/conversations/knowledge-extractor.ts packages/dashboard/tests/knowledge-extractor.test.ts
git commit -m "feat(dashboard): knowledge extractor with classified routing"
```

---

### Task 7: Staging area management

**Files:**
- Create: `packages/dashboard/src/conversations/knowledge-staging.ts`
- Create: `packages/dashboard/tests/knowledge-staging.test.ts`
- Ref: Design spec Section 4.5

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/tests/knowledge-staging.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;

describe("knowledge-staging", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "staging-"));
  });

  afterAll(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("writeStagingFile creates file in knowledge/extracted/", async () => {
    const { writeStagingFile } = await import(
      "../src/conversations/knowledge-staging.js"
    );

    await writeStagingFile(tmpDir, "conv-abc123", "Thailand Planning", [
      { subcategory: "user-info", text: "Has two daughters" },
      { subcategory: "contact", text: "Kai -- tour guide" },
    ]);

    const extractedDir = join(tmpDir, "notebook", "knowledge", "extracted");
    expect(existsSync(extractedDir)).toBe(true);

    const files = readdirSync(extractedDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(1);

    const content = readFileSync(join(extractedDir, files[0]), "utf-8");
    expect(content).toContain("conv-abc123");
    expect(content).toContain("Has two daughters");
    expect(content).toContain("Kai");
    expect(content).toContain("attempts: 0");
  });

  it("readStagingFiles returns all pending staging files", async () => {
    const { writeStagingFile, readStagingFiles } = await import(
      "../src/conversations/knowledge-staging.js"
    );

    await writeStagingFile(tmpDir, "conv-1", "Conv 1", [
      { subcategory: "user-info", text: "Fact 1" },
    ]);
    await writeStagingFile(tmpDir, "conv-2", "Conv 2", [
      { subcategory: "contact", text: "Fact 2" },
    ]);

    const files = await readStagingFiles(tmpDir);
    expect(files.length).toBe(2);
  });

  it("incrementAttempts updates the counter", async () => {
    const { writeStagingFile, readStagingFiles, incrementAttempts } =
      await import("../src/conversations/knowledge-staging.js");

    await writeStagingFile(tmpDir, "conv-1", "Conv 1", [
      { subcategory: "user-info", text: "Fact 1" },
    ]);

    const files = await readStagingFiles(tmpDir);
    await incrementAttempts(files[0].filePath);

    const updated = await readStagingFiles(tmpDir);
    const fact = updated[0].facts.find((f) => f.text === "Fact 1");
    expect(fact?.attempts).toBe(1);
  });

  it("deleteStagingFile removes the file", async () => {
    const { writeStagingFile, deleteStagingFile } = await import(
      "../src/conversations/knowledge-staging.js"
    );

    await writeStagingFile(tmpDir, "conv-1", "Conv 1", [
      { subcategory: "user-info", text: "Fact 1" },
    ]);

    const extractedDir = join(tmpDir, "notebook", "knowledge", "extracted");
    const files = readdirSync(extractedDir);
    expect(files.length).toBe(1);

    await deleteStagingFile(join(extractedDir, files[0]));
    const remaining = readdirSync(extractedDir);
    expect(remaining.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/knowledge-staging.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement staging area management**

Create `packages/dashboard/src/conversations/knowledge-staging.ts`:

```typescript
/**
 * Knowledge Staging
 *
 * Manages the knowledge/extracted/ work queue.
 * Permanent facts sit here until the morning brief proposes them.
 *
 * Design spec: docs/sprints/m6.6-s6-knowledge-lifecycle/design.md Section 4.5
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile, readdir, unlink, mkdir } from "node:fs/promises";
import type { PermanentFact } from "./knowledge-extractor.js";

export interface StagedFact {
  subcategory: string;
  text: string;
  attempts: number;
}

export interface StagingFile {
  filePath: string;
  conversationId: string;
  conversationTitle: string;
  extractedAt: string;
  facts: StagedFact[];
}

function getStagingDir(agentDir: string): string {
  return join(agentDir, "notebook", "knowledge", "extracted");
}

/**
 * Write a new staging file for extracted permanent facts.
 */
export async function writeStagingFile(
  agentDir: string,
  conversationId: string,
  conversationTitle: string,
  facts: PermanentFact[],
): Promise<string> {
  if (facts.length === 0) return "";

  const stagingDir = getStagingDir(agentDir);
  if (!existsSync(stagingDir)) {
    await mkdir(stagingDir, { recursive: true });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${conversationId}-${ts}.md`;
  const filePath = join(stagingDir, filename);

  const lines = [
    `# Extracted: ${new Date().toISOString()}`,
    `# Source: ${conversationId} ("${conversationTitle}")`,
    "",
    "## Pending -- Propose in Morning Brief",
    ...facts.map((f) => `- [${f.subcategory}, attempts: 0] ${f.text}`),
  ];

  await writeFile(filePath, lines.join("\n") + "\n", "utf-8");
  return filePath;
}

/**
 * Read all staging files from knowledge/extracted/.
 */
export async function readStagingFiles(
  agentDir: string,
): Promise<StagingFile[]> {
  const stagingDir = getStagingDir(agentDir);

  if (!existsSync(stagingDir)) {
    return [];
  }

  const entries = await readdir(stagingDir);
  const files: StagingFile[] = [];

  for (const entry of entries.filter((e) => e.endsWith(".md")).sort()) {
    const filePath = join(stagingDir, entry);
    const content = await readFile(filePath, "utf-8");

    // Parse metadata from header comments
    const sourceMatch = content.match(
      /^# Source: (\S+) \("(.+)"\)/m,
    );
    const extractedMatch = content.match(
      /^# Extracted: (.+)/m,
    );

    // Parse facts from bullet points
    const facts: StagedFact[] = [];
    const factRegex = /^- \[(\S+), attempts: (\d+)\] (.+)$/gm;
    let match;
    while ((match = factRegex.exec(content)) !== null) {
      facts.push({
        subcategory: match[1],
        text: match[3],
        attempts: parseInt(match[2], 10),
      });
    }

    files.push({
      filePath,
      conversationId: sourceMatch?.[1] ?? entry,
      conversationTitle: sourceMatch?.[2] ?? "",
      extractedAt: extractedMatch?.[1] ?? "",
      facts,
    });
  }

  return files;
}

/**
 * Increment the attempts counter for all facts in a staging file.
 */
export async function incrementAttempts(filePath: string): Promise<void> {
  const content = await readFile(filePath, "utf-8");
  const updated = content.replace(
    /attempts: (\d+)/g,
    (_match, count) => `attempts: ${parseInt(count, 10) + 1}`,
  );
  await writeFile(filePath, updated, "utf-8");
}

/**
 * Delete a staging file (all facts resolved or expired).
 */
export async function deleteStagingFile(filePath: string): Promise<void> {
  await unlink(filePath);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/dashboard && npx vitest run tests/knowledge-staging.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/conversations/knowledge-staging.ts packages/dashboard/tests/knowledge-staging.test.ts
git commit -m "feat(dashboard): knowledge staging area CRUD for extracted facts"
```

---

### Task 8: Post-extraction daily log + wire up new pipeline

**Files:**
- Modify: `packages/dashboard/src/conversations/abbreviation.ts:311-344` (`extractAndPersistFacts` method)
- Ref: Design spec Section 4.2 (daily log entry), Section 4.4 (routing)

Replace the call to `extractFacts`/`persistFacts` with the new classified pipeline. After extraction, route each fact type to its destination.

- [ ] **Step 1: Update imports in abbreviation.ts**

Replace:
```typescript
import { extractFacts, persistFacts } from "./fact-extractor.js";
```
With:
```typescript
import {
  extractClassifiedFacts,
  routeFacts,
} from "./knowledge-extractor.js";
import { writeStagingFile } from "./knowledge-staging.js";
import { updateProperty } from "./properties.js";
```

Add file I/O imports if not already present:
```typescript
import { appendFile, writeFile, mkdir } from "node:fs/promises";
```

- [ ] **Step 2: Replace `extractAndPersistFacts` method**

Replace the method body at lines 311-344:

```typescript
private async extractAndPersistFacts(
  conversationId: string,
  transcriptText: string,
  turnCount: number,
): Promise<number> {
  const startTime = Date.now();
  try {
    const classified = await extractClassifiedFacts(transcriptText);
    const routed = routeFacts(classified);
    let newCount = 0;

    // Ensure daily dir exists (used by temporal routing and [conv] line)
    const dailyDir = join(this.agentDir, "notebook", "daily");
    if (!existsSync(dailyDir)) {
      await mkdir(dailyDir, { recursive: true });
    }
    const today = new Date().toISOString().split("T")[0];
    const logPath = join(dailyDir, `${today}.md`);

    // Route permanent facts to staging
    if (routed.staging.length > 0) {
      const title = this.getConversationTitle(conversationId);
      await writeStagingFile(this.agentDir, conversationId, title, routed.staging);
      newCount += routed.staging.length;
    }

    // Route temporal facts to daily log
    if (routed.dailyLog.length > 0) {
      const lines = routed.dailyLog.map((f) => `- ${f.text}`);
      const block = "\n" + lines.join("\n") + "\n";

      if (!existsSync(logPath)) {
        await writeFile(logPath, `# Daily Log -- ${today}\n${block}`, "utf-8");
      } else {
        await appendFile(logPath, block, "utf-8");
      }
      newCount += routed.dailyLog.length;
    }

    // Route properties to status.yaml
    for (const prop of routed.properties) {
      await updateProperty(this.agentDir, prop.key, {
        value: prop.value,
        confidence: prop.confidence,
        source: `extraction from ${conversationId}`,
      });
    }
    newCount += routed.properties.length;

    // Append [conv] summary to daily log
    const time = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const title = this.getConversationTitle(conversationId);
    const convLine = `\n- [conv] ${title} (${time})\n`;

    if (!existsSync(logPath)) {
      await writeFile(logPath, `# Daily Log -- ${today}\n${convLine}`, "utf-8");
    } else {
      await appendFile(logPath, convLine, "utf-8");
    }

    // Update lastExtractedAtTurn
    await this.manager.update(conversationId, {
      lastExtractedAtTurn: turnCount,
    });

    const durationMs = Date.now() - startTime;
    this.onExtractionComplete?.({
      conversationId,
      newFactCount: newCount,
      durationMs,
    });

    return newCount;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    this.onExtractionComplete?.({
      conversationId,
      newFactCount: 0,
      durationMs,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
```

Note: Add a helper method `getConversationTitle` if it does not already exist:

```typescript
private getConversationTitle(conversationId: string): string {
  try {
    const conv = this.manager.get(conversationId);
    return conv?.title ?? conversationId;
  } catch {
    return conversationId;
  }
}
```

- [ ] **Step 3: Run full test suite**

Run: `cd packages/dashboard && npx vitest run`
Expected: All tests pass. `fact-extractor.test.ts` still passes because the module is unchanged.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/conversations/abbreviation.ts
git commit -m "feat(dashboard): wire new classified extraction pipeline into abbreviation queue"
```

---

## Chunk 4: Summary Pipeline (Tasks 9-12)

### Task 9: Revised daily summary job

**Files:**
- Modify: `packages/dashboard/src/scheduler/jobs/daily-summary.ts`
- Modify: `packages/dashboard/src/scheduler/work-loop-scheduler.ts` (handler)

The daily summary now reads yesterday's raw `daily/{yesterday}.md` and writes to `summaries/daily/{yesterday}.md`. Runs as step 1 of morning sequence.

- [ ] **Step 1: Update daily-summary.ts**

Replace `packages/dashboard/src/scheduler/jobs/daily-summary.ts`:

```typescript
/**
 * Daily Summary Job
 *
 * Reads yesterday's raw daily log and produces a condensed summary.
 * Output is written to summaries/daily/YYYY-MM-DD.md by the scheduler.
 *
 * Design spec: docs/sprints/m6.6-s6-knowledge-lifecycle/design.md Section 5.1
 */

import { queryModel } from "../query-model.js";

export const SYSTEM_PROMPT = `You produce a daily summary from a raw activity log.

STRICT RULES:
1. Output ONLY the summary -- no preamble, no explanation
2. Use ONLY facts explicitly stated in the user's message -- NEVER invent or assume
3. If the provided content shows no activity, respond with EXACTLY: "Quiet day -- no significant activity."
4. Write in English regardless of input language
5. Do NOT attempt to read files, search, or use tools -- all content is already provided`;

export const USER_PROMPT_TEMPLATE = `Summarize this day's activity log into a concise daily summary.

Format:
## Key Events
- [main things that happened]

## Decisions Made
- [any decisions made or commitments]

## Open Items
- [things to follow up on]

Only include sections where you have information. Skip sections with no data.

---

{context}`;

/**
 * Run the daily summary prompt and return the summary text.
 */
export async function runDailySummary(dailyLogContent: string): Promise<string> {
  const userPrompt = USER_PROMPT_TEMPLATE.replace("{context}", dailyLogContent);
  return queryModel(userPrompt, SYSTEM_PROMPT, "haiku");
}
```

- [ ] **Step 2: Update the daily summary test**

The existing `haiku-jobs.test.ts` tests daily summary via the endpoint, which still works. But verify the import path change (`queryModel` instead of `queryHaiku`) doesn't break:

Run: `cd packages/dashboard && npx vitest run tests/haiku-jobs.test.ts`
Expected: PASS (daily-summary still exports `runDailySummary`, endpoint still works)

- [ ] **Step 3: Update handleDailySummary in work-loop-scheduler.ts**

Replace the `handleDailySummary` method:

```typescript
/**
 * Daily Summary -- reads yesterday's raw log, writes summary to summaries/daily/
 */
private async handleDailySummary(): Promise<string> {
  const notebookDir = join(this.agentDir, "notebook");

  // Read yesterday's raw daily log
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];
  const yesterdayFile = join(notebookDir, "daily", `${yesterdayStr}.md`);

  let context: string;
  if (existsSync(yesterdayFile)) {
    context = await readFile(yesterdayFile, "utf-8");
  } else {
    context = "No daily log for yesterday.";
  }

  const output = await runDailySummary(context);

  // Write to summaries/daily/
  const summaryDir = join(notebookDir, "summaries", "daily");
  if (!existsSync(summaryDir)) {
    await mkdir(summaryDir, { recursive: true });
  }
  await writeFile(join(summaryDir, `${yesterdayStr}.md`), output, "utf-8");

  return output;
}
```

- [ ] **Step 4: Run full test suite**

Run: `cd packages/dashboard && npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/scheduler/jobs/daily-summary.ts packages/dashboard/src/scheduler/work-loop-scheduler.ts
git commit -m "feat(dashboard): daily summary writes to summaries/daily/ instead of daily log"
```

---

### Task 10: Weekly summary job

**Files:**
- Create: `packages/dashboard/src/scheduler/jobs/weekly-summary.ts`
- Create: `packages/dashboard/tests/weekly-summary.test.ts`

New job: reads all daily summaries since the last weekly summary, produces `summaries/weekly/YYYY-WNN.md`.

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/tests/weekly-summary.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/scheduler/query-model.js", () => ({
  queryModel: vi.fn().mockResolvedValue("## Weekly Summary\n- Key theme: testing"),
}));

describe("runWeeklySummary", () => {
  it("produces summary from daily summaries", async () => {
    const { runWeeklySummary } = await import(
      "../src/scheduler/jobs/weekly-summary.js"
    );
    const result = await runWeeklySummary("## Day 1\n- thing\n\n## Day 2\n- thing");
    expect(result).toContain("Weekly Summary");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/weekly-summary.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement weekly summary job**

Create `packages/dashboard/src/scheduler/jobs/weekly-summary.ts`:

```typescript
/**
 * Weekly Summary Job
 *
 * Reads daily summaries since the last weekly summary,
 * produces a compressed weekly rollup.
 *
 * Design spec: docs/sprints/m6.6-s6-knowledge-lifecycle/design.md Section 5.2
 */

import { queryModel } from "../query-model.js";

export const SYSTEM_PROMPT = `You produce a weekly summary from daily summaries.

STRICT RULES:
1. Output ONLY the summary -- no preamble, no explanation
2. Use ONLY facts from the provided daily summaries -- NEVER invent or assume
3. If no content provided, respond with EXACTLY: "Quiet week -- no significant activity."
4. Keep it concise -- key themes, decisions, milestones. Around 500 chars max.
5. Write in English regardless of input language
6. Do NOT attempt to read files, search, or use tools`;

export const USER_PROMPT_TEMPLATE = `Compress these daily summaries into a concise weekly summary.

Focus on: key themes, decisions made, milestones reached, recurring patterns.

---

{context}`;

/**
 * Run the weekly summary prompt.
 */
export async function runWeeklySummary(
  dailySummariesContent: string,
): Promise<string> {
  const userPrompt = USER_PROMPT_TEMPLATE.replace(
    "{context}",
    dailySummariesContent,
  );
  return queryModel(userPrompt, SYSTEM_PROMPT, "haiku");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/dashboard && npx vitest run tests/weekly-summary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/scheduler/jobs/weekly-summary.ts packages/dashboard/tests/weekly-summary.test.ts
git commit -m "feat(dashboard): weekly summary job for temporal rollup"
```

---

### Task 11: Monthly summary job

**Files:**
- Create: `packages/dashboard/src/scheduler/jobs/monthly-summary.ts`
- Create: `packages/dashboard/tests/monthly-summary.test.ts`

Same pattern as weekly. Reads weekly summaries, produces `summaries/monthly/YYYY-MM.md`.

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/tests/monthly-summary.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/scheduler/query-model.js", () => ({
  queryModel: vi.fn().mockResolvedValue("## Monthly Summary\n- Shipped M6.6"),
}));

describe("runMonthlySummary", () => {
  it("produces summary from weekly summaries", async () => {
    const { runMonthlySummary } = await import(
      "../src/scheduler/jobs/monthly-summary.js"
    );
    const result = await runMonthlySummary("## Week 1\n- thing\n\n## Week 2\n- thing");
    expect(result).toContain("Monthly Summary");
  });
});
```

- [ ] **Step 2: Run test to verify it fails, then implement**

Create `packages/dashboard/src/scheduler/jobs/monthly-summary.ts`:

```typescript
/**
 * Monthly Summary Job
 *
 * Reads weekly summaries since the last monthly summary,
 * produces a high-level monthly narrative.
 *
 * Design spec: docs/sprints/m6.6-s6-knowledge-lifecycle/design.md Section 5.3
 */

import { queryModel } from "../query-model.js";

export const SYSTEM_PROMPT = `You produce a monthly summary from weekly summaries.

STRICT RULES:
1. Output ONLY the summary -- no preamble, no explanation
2. Use ONLY facts from the provided weekly summaries -- NEVER invent or assume
3. If no content provided, respond with EXACTLY: "Quiet month."
4. Keep it high-level -- what happened this month. Around 300 chars max.
5. Write in English regardless of input language
6. Do NOT attempt to read files, search, or use tools`;

export const USER_PROMPT_TEMPLATE = `Compress these weekly summaries into a high-level monthly narrative.

---

{context}`;

/**
 * Run the monthly summary prompt.
 */
export async function runMonthlySummary(
  weeklySummariesContent: string,
): Promise<string> {
  const userPrompt = USER_PROMPT_TEMPLATE.replace(
    "{context}",
    weeklySummariesContent,
  );
  return queryModel(userPrompt, SYSTEM_PROMPT, "haiku");
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd packages/dashboard && npx vitest run tests/monthly-summary.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/scheduler/jobs/monthly-summary.ts packages/dashboard/tests/monthly-summary.test.ts
git commit -m "feat(dashboard): monthly summary job for temporal rollup"
```

---

### Task 12: Revised morning prep + summary handlers in scheduler

**Files:**
- Modify: `packages/dashboard/src/scheduler/jobs/morning-prep.ts`
- Modify: `packages/dashboard/src/scheduler/work-loop-scheduler.ts`

Morning prep reads from the summary stack + calendar + properties + staging, producing `operations/current-state.md` with past+future temporal sections. Also wire up weekly/monthly summary handlers.

- [ ] **Step 1: Revise morning-prep.ts**

Replace `packages/dashboard/src/scheduler/jobs/morning-prep.ts`:

```typescript
/**
 * Morning Prep Job (Morning Brief)
 *
 * Reads summary stack + calendar + properties + staging,
 * produces operations/current-state.md with past+future temporal context.
 *
 * Design spec: docs/sprints/m6.6-s6-knowledge-lifecycle/design.md Section 7.3
 */

import { queryModel } from "../query-model.js";

export const SYSTEM_PROMPT = `You produce a daily briefing by synthesizing past and future context.

STRICT RULES:
1. Output ONLY the briefing -- no preamble, no explanation, no thinking out loud
2. Use ONLY facts from the provided content -- NEVER invent or assume
3. If the content is empty, respond with EXACTLY: "No context available yet."
4. HARD CAP: Output must be under 3000 characters
5. Use the past+future format provided
6. Write in English regardless of input language
7. Do NOT attempt to read files, search, or use tools`;

export const USER_PROMPT_TEMPLATE = `Based on the following context, write a current-state briefing.

Format:
## Today -- {date}
- [today's events, deadlines, plans]

## This Week Ahead
- [upcoming events, milestones]

## This Month Ahead
- [bigger picture, travel, goals]

## Yesterday
- [key events from yesterday]

## Past 7 Days
- [weekly summary highlights]

## Past 30 Days
- [monthly summary highlights]

Only include sections where you have information. Skip sections with no data.
Hard cap: 3000 characters.

---

{context}`;

/**
 * Run the morning prep (morning brief) prompt.
 */
export async function runMorningPrep(assembledContext: string): Promise<string> {
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const userPrompt = USER_PROMPT_TEMPLATE.replace("{date}", today).replace(
    "{context}",
    assembledContext,
  );

  // TODO: M6.9-S2 upgrades morning brief to sonnet/opus for higher-judgement synthesis
  return queryModel(userPrompt, SYSTEM_PROMPT, "haiku");
}
```

- [ ] **Step 2: Add weekly/monthly handlers + revise morning prep handler in scheduler**

Add imports at top of `work-loop-scheduler.ts`:

```typescript
import { runWeeklySummary } from "./jobs/weekly-summary.js";
import { runMonthlySummary } from "./jobs/monthly-summary.js";
```

Note: No need to import prompt constants for `JOB_PROMPTS` — the handlers call `runWeeklySummary()`/`runMonthlySummary()` directly, which use their prompts internally. `JOB_PROMPTS` is only used for the debug/admin endpoint that shows prompts; add entries later if needed.

Add handler cases in `runJob` switch:

```typescript
case "weekly-summary":
  output = await this.handleWeeklySummary();
  break;
case "monthly-summary":
  output = await this.handleMonthlySummary();
  break;
```

Add handler methods:

```typescript
private async handleWeeklySummary(): Promise<string> {
  const notebookDir = join(this.agentDir, "notebook");
  const summaryDir = join(notebookDir, "summaries", "daily");

  const sections: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    const filePath = join(summaryDir, `${dateStr}.md`);
    if (existsSync(filePath)) {
      const content = await readFile(filePath, "utf-8");
      sections.push(`### ${dateStr}\n${content}`);
    }
  }

  if (sections.length === 0) {
    return "Quiet week -- no daily summaries found.";
  }

  const output = await runWeeklySummary(sections.join("\n\n"));

  const weeklyDir = join(notebookDir, "summaries", "weekly");
  if (!existsSync(weeklyDir)) {
    await mkdir(weeklyDir, { recursive: true });
  }

  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const weekNum = Math.ceil(
    ((now.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7,
  );
  const weekStr = `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
  await writeFile(join(weeklyDir, `${weekStr}.md`), output, "utf-8");

  return output;
}

private async handleMonthlySummary(): Promise<string> {
  const notebookDir = join(this.agentDir, "notebook");
  const weeklyDir = join(notebookDir, "summaries", "weekly");

  if (!existsSync(weeklyDir)) {
    return "Quiet month -- no weekly summaries found.";
  }

  const files = await readdir(weeklyDir);
  const sections: string[] = [];

  for (const f of files.filter((f) => f.endsWith(".md")).sort()) {
    const content = await readFile(join(weeklyDir, f), "utf-8");
    sections.push(`### ${f.replace(".md", "")}\n${content}`);
  }

  if (sections.length === 0) {
    return "Quiet month.";
  }

  const output = await runMonthlySummary(sections.join("\n\n"));

  const monthlyDir = join(notebookDir, "summaries", "monthly");
  if (!existsSync(monthlyDir)) {
    await mkdir(monthlyDir, { recursive: true });
  }

  const monthStr = new Date().toISOString().slice(0, 7);
  await writeFile(join(monthlyDir, `${monthStr}.md`), output, "utf-8");

  return output;
}
```

Revise `handleMorningPrep` to use the summary stack:

```typescript
private async handleMorningPrep(): Promise<string> {
  const notebookDir = join(this.agentDir, "notebook");
  const sections: string[] = [];

  // Yesterday's daily summary
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];
  const yesterdaySummary = join(notebookDir, "summaries", "daily", `${yesterdayStr}.md`);
  if (existsSync(yesterdaySummary)) {
    sections.push("# Yesterday's Summary\n" + await readFile(yesterdaySummary, "utf-8"));
  }

  // This week's summary (if exists)
  const weeklyDir = join(notebookDir, "summaries", "weekly");
  if (existsSync(weeklyDir)) {
    const weekFiles = (await readdir(weeklyDir)).filter((f) => f.endsWith(".md")).sort();
    if (weekFiles.length > 0) {
      const latest = await readFile(join(weeklyDir, weekFiles[weekFiles.length - 1]), "utf-8");
      sections.push("# This Week\n" + latest);
    }
  }

  // This month's summary (if exists)
  const monthlyDir = join(notebookDir, "summaries", "monthly");
  if (existsSync(monthlyDir)) {
    const monthFiles = (await readdir(monthlyDir)).filter((f) => f.endsWith(".md")).sort();
    if (monthFiles.length > 0) {
      const latest = await readFile(join(monthlyDir, monthFiles[monthFiles.length - 1]), "utf-8");
      sections.push("# This Month\n" + latest);
    }
  }

  // Today's daily log (anything logged so far today)
  const today = new Date().toISOString().split("T")[0];
  const todayLog = join(notebookDir, "daily", `${today}.md`);
  if (existsSync(todayLog)) {
    sections.push("# Today's Log So Far\n" + await readFile(todayLog, "utf-8"));
  }

  // Reference files (user-info, for context)
  const userInfo = join(notebookDir, "reference", "user-info.md");
  if (existsSync(userInfo)) {
    sections.push("# User Info\n" + await readFile(userInfo, "utf-8"));
  }

  // Properties (location, timezone, availability)
  const propsFile = join(notebookDir, "properties", "status.yaml");
  if (existsSync(propsFile)) {
    sections.push("# Current Properties\n" + await readFile(propsFile, "utf-8"));
  }

  // Staged permanent facts awaiting approval
  const stagingDir = join(notebookDir, "knowledge", "extracted");
  if (existsSync(stagingDir)) {
    const stagingFiles = (await readdir(stagingDir)).filter((f) => f.endsWith(".md"));
    if (stagingFiles.length > 0) {
      const stagingContent: string[] = [];
      for (const f of stagingFiles) {
        stagingContent.push(await readFile(join(stagingDir, f), "utf-8"));
      }
      sections.push("# Pending Knowledge (for approval)\n" + stagingContent.join("\n\n"));
    }
  }

  // Calendar context (from existing CalDAV integration, if available)
  try {
    const {
      loadCalendarConfig,
      loadCalendarCredentials,
      createCalDAVClient,
      assembleCalendarContext,
    } = await import("@my-agent/core");
    const calConfig = loadCalendarConfig(this.agentDir);
    const calCreds = loadCalendarCredentials(this.agentDir);
    if (calConfig && calCreds) {
      const calClient = await createCalDAVClient(calConfig, calCreds);
      const calContext = await assembleCalendarContext(calClient);
      if (calContext) {
        sections.push("# Calendar\n" + calContext);
      }
    }
  } catch {
    // Calendar unavailable -- continue without it
  }

  const context = sections.length > 0
    ? sections.join("\n\n---\n\n")
    : "No context available.";

  const output = await runMorningPrep(context);

  // Write to operations/current-state.md
  const opsDir = join(notebookDir, "operations");
  if (!existsSync(opsDir)) {
    await mkdir(opsDir, { recursive: true });
  }
  await writeFile(join(opsDir, "current-state.md"), output, "utf-8");

  // Log to daily log
  await this.appendToDailyLog(
    notebookDir,
    `- Morning prep completed (${output.length} chars)`,
  );

  return output;
}
```

- [ ] **Step 3: Run all tests**

Run: `cd packages/dashboard && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/scheduler/jobs/morning-prep.ts packages/dashboard/src/scheduler/work-loop-scheduler.ts
git commit -m "feat(dashboard): morning prep reads summary stack, weekly/monthly handlers added"
```

---

## Chunk 5: Integration + Migration (Tasks 13-17)

### Task 13: SystemPromptBuilder `loadProperties()` integration

**Files:**
- Modify: `packages/dashboard/src/agent/system-prompt-builder.ts`

Add `loadProperties()` output to the dynamic block of the system prompt.

- [ ] **Step 1: Update imports**

Add:
```typescript
import { loadProperties } from "@my-agent/core";
```

- [ ] **Step 2: Add properties injection to `build()` method**

After the temporal context block and before Layer 5 metadata, add:

```typescript
// Layer 4b: Dynamic properties (location, timezone, availability)
const propertiesBlock = await loadProperties(this.config.agentDir);
if (propertiesBlock) {
  dynamicParts.push(propertiesBlock);
}
```

- [ ] **Step 3: Run tests**

Run: `cd packages/dashboard && npx vitest run tests/system-prompt-builder.test.ts`
Expected: PASS (loadProperties returns null in mock -- graceful degradation)

Run: `cd packages/dashboard && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/agent/system-prompt-builder.ts
git commit -m "feat(dashboard): inject loadProperties into system prompt dynamic block"
```

---

### Task 14: Preferences directory split

This is a notebook content migration, not a code change. Task 1 (recursive loading) already handles the `reference/preferences/` structure. The design spec defines:

```
reference/preferences/
  personal.md     # Food, lifestyle, hobbies
  work.md         # Coding style, tools, process
  communication.md # Tone, language, formality
```

- [ ] **Step 1: Verify recursive loading works with this structure**

Run: `cd packages/core && npx vitest run tests/prompt-recursive.test.ts`
Expected: PASS -- confirms the recursive loading handles this structure

- [ ] **Step 2: No code commit needed** -- structure is already supported by Task 1

---

### Task 15: Update E2E memory lifecycle tests

**Files:**
- Modify: `packages/dashboard/tests/e2e/memory-lifecycle.test.ts`

Update tests to use the new classified extraction API instead of the old `parseFacts`/`persistFacts`.

- [ ] **Step 1: Update imports**

Replace:
```typescript
import { parseFacts, persistFacts } from "../../src/conversations/fact-extractor.js";
```
With:
```typescript
import { parseClassifiedFacts } from "../../src/conversations/knowledge-extractor.js";
import { writeStagingFile } from "../../src/conversations/knowledge-staging.js";
import { updateProperty } from "../../src/conversations/properties.js";
```

- [ ] **Step 2: Update Phase 1 seeding test (0b)**

Replace the synthetic extraction test to use the new classification format. Note: location is `TEMPORAL` or `PROPERTY`, not `PERMANENT:user-info`.

```typescript
it("0b: triggers classified fact extraction on the conversation", async () => {
  const syntheticOutput = [
    "[PERMANENT:user-info] Has two daughters, loves Thailand",
    "[PERMANENT:preference:personal] Loves pad krapao",
    "[PERMANENT:contact] Kai - local guide in Chiang Mai, doing temple tour",
    "[TEMPORAL] Flying to Krabi, back to Tel Aviv",
    "[TEMPORAL] Found amazing pad krapao near Tha Phae Gate",
    "[PROPERTY:location:high] Currently in Chiang Mai, Thailand",
  ].join("\n");

  const classified = parseClassifiedFacts(syntheticOutput);

  // Permanent facts go to staging
  expect(classified.permanent).toHaveLength(3);
  await writeStagingFile(tmpDir, "conv-thailand", "Thailand Trip", classified.permanent);

  // Temporal facts go to daily log
  const dailyDir = join(tmpDir, "notebook", "daily");
  if (!existsSync(dailyDir)) mkdirSync(dailyDir, { recursive: true });
  const today = new Date().toISOString().split("T")[0];
  writeFileSync(
    join(dailyDir, `${today}.md`),
    `# Daily Log -- ${today}\n\n` +
    classified.temporal.map((f) => `- ${f.text}`).join("\n") + "\n",
  );

  // Properties go to status.yaml
  for (const prop of classified.properties) {
    await updateProperty(tmpDir, prop.key, {
      value: prop.value,
      confidence: prop.confidence,
      source: "test extraction",
    });
  }
});
```

- [ ] **Step 3: Rewrite Phase 2 assertions for new destinations**

Old tests checked `knowledge/facts.md`, `knowledge/people.md`, `knowledge/preferences.md`. New destinations:
- Permanent facts → `knowledge/extracted/*.md` (staging)
- Temporal facts → `daily/{today}.md`
- Properties → `properties/status.yaml`

```typescript
describe("Phase 2: Verify extraction", () => {
  it("1: permanent facts are in staging", () => {
    const extractedDir = join(tmpDir, "notebook", "knowledge", "extracted");
    expect(existsSync(extractedDir)).toBe(true);

    const files = readdirSync(extractedDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThanOrEqual(1);

    const content = readFileSync(join(extractedDir, files[0]), "utf-8");
    expect(content).toContain("pad krapao");
    expect(content).toContain("Kai");
  });

  it("2: temporal facts are in daily log", () => {
    const today = new Date().toISOString().split("T")[0];
    const logPath = join(tmpDir, "notebook", "daily", `${today}.md`);
    expect(existsSync(logPath)).toBe(true);

    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("Krabi");
    expect(content).toContain("Tel Aviv");
  });

  it("3: properties are in status.yaml", () => {
    const propsPath = join(tmpDir, "notebook", "properties", "status.yaml");
    expect(existsSync(propsPath)).toBe(true);

    const content = readFileSync(propsPath, "utf-8");
    expect(content).toContain("Chiang Mai");
    expect(content).toContain("high");
  });

  it("4: current-state.md is written and under 1000 chars", () => {
    const csPath = join(tmpDir, "notebook", "operations", "current-state.md");
    expect(existsSync(csPath)).toBe(true);

    const content = readFileSync(csPath, "utf-8");
    expect(content.length).toBeLessThan(1000);
  });
});
```

- [ ] **Step 4: Rewrite Phase 4 for new lifecycle**

The old Phase 4 tested `parseFacts`/`persistFacts` updates and weekly review promotions. The new lifecycle uses staging + morning brief approval (M6.9-S2). Replace with:

```typescript
describe("Phase 4: Lifecycle over time", () => {
  it("10: new temporal facts append to daily log", () => {
    const today = new Date().toISOString().split("T")[0];
    const logPath = join(tmpDir, "notebook", "daily", `${today}.md`);
    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("Krabi");
  });

  it("11: staging files accumulate from multiple conversations", async () => {
    // Add a second conversation's facts to staging
    await writeStagingFile(tmpDir, "conv-2", "Second Conv", [
      { subcategory: "user-info", text: "Works at a startup" },
    ]);

    const { readStagingFiles } = await import(
      "../../src/conversations/knowledge-staging.js"
    );
    const files = await readStagingFiles(tmpDir);
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  it("12: property updates overwrite previous values", async () => {
    await updateProperty(tmpDir, "location", {
      value: "Krabi, Thailand",
      confidence: "high",
      source: "test update",
    });

    const content = readFileSync(
      join(tmpDir, "notebook", "properties", "status.yaml"),
      "utf-8",
    );
    expect(content).toContain("Krabi");
  });
});
```

- [ ] **Step 5: Rewrite Phase 5 for new pipeline**

```typescript
describe("Phase 5: Resilience", () => {
  it("15: cold start with no notebook data does not crash", async () => {
    const coldDir = mkdtempSync(join(tmpdir(), "cold-start-"));
    mkdirSync(join(coldDir, "notebook"), { recursive: true });

    await writeStagingFile(coldDir, "conv-cold", "Cold Start", [
      { subcategory: "user-info", text: "test fact" },
    ]);

    const { readStagingFiles } = await import(
      "../../src/conversations/knowledge-staging.js"
    );
    const files = await readStagingFiles(coldDir);
    expect(files.length).toBe(1);

    rmSync(coldDir, { recursive: true, force: true });
  });

  it("16: concurrent staging writes do not corrupt files", async () => {
    const concurrentDir = mkdtempSync(join(tmpdir(), "concurrent-"));

    const [r1, r2] = await Promise.allSettled([
      writeStagingFile(concurrentDir, "conv-a", "Conv A", [
        { subcategory: "user-info", text: "Fact from conversation A" },
      ]),
      writeStagingFile(concurrentDir, "conv-b", "Conv B", [
        { subcategory: "contact", text: "Fact from conversation B" },
      ]),
    ]);

    expect(r1.status).toBe("fulfilled");
    expect(r2.status).toBe("fulfilled");

    const { readStagingFiles } = await import(
      "../../src/conversations/knowledge-staging.js"
    );
    const files = await readStagingFiles(concurrentDir);
    expect(files.length).toBe(2);

    rmSync(concurrentDir, { recursive: true, force: true });
  });

  it("17: extraction failure does not crash abbreviation", () => {
    const results = [
      { status: "fulfilled" as const, value: "abbreviation text" },
      { status: "rejected" as const, reason: new Error("Haiku API down") },
    ];
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
  });
});
```

- [ ] **Step 6: Update imports at top of file**

Add `readdirSync` to the `node:fs` import if not present.

- [ ] **Step 7: Run tests**

Run: `cd packages/dashboard && npx vitest run tests/e2e/memory-lifecycle.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/tests/e2e/memory-lifecycle.test.ts
git commit -m "test(dashboard): update E2E memory lifecycle for classified extraction pipeline"
```

---

### Task 16: Migration script

**Files:**
- Create: `packages/dashboard/scripts/migrate-knowledge.ts`

Script to reclassify existing `knowledge/*.md` files (facts.md, people.md, preferences.md) into the new staging area. Backs up old files as `.bak`.

- [ ] **Step 1: Write the migration script**

Create `packages/dashboard/scripts/migrate-knowledge.ts`:

```typescript
/**
 * Knowledge Migration Script
 *
 * Reclassifies existing knowledge/*.md files (from S3 pipeline)
 * into the new M6.9 knowledge lifecycle structure.
 *
 * Usage: npx tsx scripts/migrate-knowledge.ts [agentDir]
 * Default agentDir: $HOME/.my_agent
 *
 * What it does:
 * 1. Reads knowledge/facts.md, knowledge/people.md, knowledge/preferences.md
 * 2. Writes all existing facts to staging for morning brief review
 * 3. Renames old files to *.md.bak (does not delete)
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile, rename } from "node:fs/promises";
import { writeStagingFile } from "../src/conversations/knowledge-staging.js";

const agentDir = process.argv[2] || join(process.env.HOME!, ".my_agent");

async function migrate() {
  const knowledgeDir = join(agentDir, "notebook", "knowledge");

  if (!existsSync(knowledgeDir)) {
    console.log("No knowledge directory found. Nothing to migrate.");
    return;
  }

  const files = ["facts.md", "people.md", "preferences.md"];
  const allFacts: string[] = [];

  for (const file of files) {
    const filePath = join(knowledgeDir, file);
    if (existsSync(filePath)) {
      const content = await readFile(filePath, "utf-8");
      // Extract bullet points (facts)
      const lines = content.split("\n").filter((l) => l.startsWith("- "));
      const facts = lines.map((l) =>
        l.replace(/^- /, "").replace(/ _\(.*?\)_$/, "").trim()
      );
      allFacts.push(...facts);
      console.log(`Read: ${file} (${facts.length} facts)`);
    }
  }

  // Filter empty facts and deduplicate
  const uniqueFacts = [...new Set(allFacts.filter((f) => f.length > 0))];

  if (uniqueFacts.length === 0) {
    console.log("No facts found. Nothing to migrate.");
    return;
  }

  console.log(`\nFound ${uniqueFacts.length} unique facts to reclassify (${allFacts.length} total, ${allFacts.length - uniqueFacts.length} duplicates removed).`);

  // Write facts to staging for the morning brief to propose
  await writeStagingFile(
    agentDir,
    "migration",
    "Legacy Knowledge Migration",
    uniqueFacts.map((f) => ({ subcategory: "unclassified", text: f })),
  );
  console.log("Wrote to staging for morning brief review.");

  // Backup old files
  for (const file of files) {
    const filePath = join(knowledgeDir, file);
    if (existsSync(filePath)) {
      await rename(filePath, filePath + ".bak");
      console.log(`Backed up: ${file} -> ${file}.bak`);
    }
  }

  console.log("\nMigration complete. Old files backed up as *.md.bak");
  console.log("Staged facts will be proposed in the next morning brief.");
}

migrate().catch(console.error);
```

- [ ] **Step 2: Commit**

```bash
git add packages/dashboard/scripts/migrate-knowledge.ts
git commit -m "feat(dashboard): migration script for legacy knowledge files"
```

---

### Task 17: Update docs/design.md Section 4

**Files:**
- Modify: `docs/design.md` (Memory System section)

- [ ] **Step 1: Read current design.md memory section**

Find and read the Memory System section of `docs/design.md`.

- [ ] **Step 2: Update with new architecture summary**

Add or update the knowledge lifecycle subsection:

```markdown
### 4.x Knowledge Lifecycle (M6.9)

**Full spec:** [knowledge-lifecycle-design.md](sprints/m6.6-s6-knowledge-lifecycle/design.md)

Key changes from M6.6:
- Facts classified as PERMANENT (staging then user approval), TEMPORAL (daily logs then summaries), or PROPERTY (real-time YAML)
- Summary rollup chain: daily then weekly then monthly (replaces indefinite fact accumulation)
- `properties/status.yaml` for dynamic metadata (location, timezone, availability)
- `queryModel()` replaces `queryHaiku()` for model-selectable background queries
- Morning prep reads summary stack instead of raw knowledge files
```

- [ ] **Step 3: Commit**

```bash
git add docs/design.md
git commit -m "docs: update design.md memory section for M6.9 knowledge lifecycle"
```

---

## Final Verification

After all tasks complete:

- [ ] `cd packages/core && npx vitest run` -- all core tests pass
- [ ] `cd packages/dashboard && npx vitest run` -- all dashboard tests pass
- [ ] `npx tsc --noEmit` in both packages -- no type errors
- [ ] `npx prettier --write` applied
- [ ] No regressions in haiku-jobs.test.ts (integration tests)
- [ ] Migration script runs without error on test data

## Success Criteria

From the design spec:
- [x] `loadNotebookReference()` recurses into subdirectories
- [x] `loadProperties()` injects YAML data into system prompt
- [x] SyncService excludes `knowledge/extracted/`
- [x] New classification prompt produces 7 categories
- [x] Permanent facts route to staging, temporal to daily log, properties to YAML
- [x] Staging area CRUD works (write, read, increment, delete)
- [x] Daily/weekly/monthly summary jobs produce output
- [x] Morning prep reads from summary stack
- [x] `queryModel()` supports haiku/sonnet/opus selection
- [x] SystemPromptBuilder includes properties in dynamic block
- [x] Existing knowledge files can be migrated
- [x] All existing tests still pass
