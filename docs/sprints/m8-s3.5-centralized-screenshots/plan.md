# M8-S3.5: Centralized Screenshot Storage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace distributed per-context screenshot folders with a single central `.my_agent/screenshots/` folder. Ref-based lifecycle: referenced screenshots live, unreferenced expire after 7 days.

**Architecture:** Single folder + JSONL index (DB table deferred). Producers store without context. Refs added when screenshots become visible. Context deletion removes refs. Cleanup deletes unreferenced > 7 days.

**Design spec:** `docs/superpowers/specs/2026-03-31-centralized-screenshot-storage-design.md`
**Depends on:** M8-S1, M8-S2, M8-S3
**Refactors:** S1's VisualActionService, S3's PlaywrightBridge, S1's asset routes

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `packages/dashboard/tests/unit/visual/visual-action-service-v2.test.ts` | Full TDD test suite for rewritten VAS |
| `packages/dashboard/tests/unit/visual/ref-lifecycle.test.ts` | Ref management + cleanup lifecycle tests |

### Modified Files

| File | Change |
|------|--------|
| `packages/core/src/visual/types.ts` | Remove `AssetContext`, `ScreenshotTag`, `CaptureOptions`, `ScreenshotIndex`. New: `ScreenshotSource`, `ScreenshotMetadata`, `Screenshot` |
| `packages/core/src/lib.ts` | Update barrel exports — remove old type names, ensure new types are exported (NOTE: core barrel is `lib.ts`, not `index.ts`) |
| `packages/dashboard/src/visual/visual-action-service.ts` | Complete rewrite: single folder, JSONL index, ref-based lifecycle |
| `packages/dashboard/src/routes/asset-routes.ts` | Replace two routes with single `/api/assets/screenshots/:filename` |
| `packages/dashboard/src/desktop/computer-use-service.ts` | Remove context param from store calls, remove tag logic, remove pixel diff imports |
| `packages/dashboard/src/playwright/playwright-screenshot-bridge.ts` | Remove context param from storeFromBase64, remove hardcoded context in MCP tool |
| `packages/dashboard/src/ws/protocol.ts` | Update `ScreenshotSnapshot` — remove contextType/contextId/tag, add refs/source |
| `packages/dashboard/src/state/state-publisher.ts` | Update screenshot publish shape |
| `packages/dashboard/src/app.ts` | Update VAS instantiation, onScreenshot listener shape, ref wiring |

### Deleted Files

| File | Reason |
|------|--------|
| `packages/dashboard/src/visual/screenshot-tagger.ts` | Tags replaced by refs — pixel diff no longer needed |
| `packages/dashboard/tests/unit/visual/screenshot-tagger.test.ts` | Tests for deleted module |
| `packages/dashboard/tests/unit/visual/visual-action-service.test.ts` | Replaced by v2 test file |

---

## Task 1: Update Core Types

**Files:**
- Modify: `packages/core/src/visual/types.ts`
- Modify: `packages/core/src/lib.ts` (the actual barrel export — NOT `index.ts`)

- [ ] **Step 1: Read the current types file AND the barrel export**

Read `packages/core/src/visual/types.ts` and `packages/core/src/lib.ts` to confirm current exports. The barrel is `lib.ts` (per `package.json` "main": "dist/lib.js"), not `index.ts`.

- [ ] **Step 2: Replace all types**

Replace the entire contents of `packages/core/src/visual/types.ts` with:

```typescript
// packages/core/src/visual/types.ts

export type ScreenshotSource = "desktop" | "playwright" | "upload";

export interface ScreenshotMetadata {
  description?: string;
  width: number;
  height: number;
  source: ScreenshotSource;
}

export interface Screenshot {
  id: string;
  filename: string;
  path: string;
  timestamp: string;
  width: number;
  height: number;
  sizeBytes: number;
  source: ScreenshotSource;
  description?: string;
  refs: string[];
}
```

- [ ] **Step 3: Update core barrel exports**

Update `packages/core/src/lib.ts` — this is the actual barrel (NOT `index.ts`). Remove any re-exports of `AssetContext`, `ScreenshotTag`, `CaptureOptions`, `ScreenshotIndex`. Ensure `Screenshot`, `ScreenshotMetadata`, `ScreenshotSource` are exported. Also update `packages/core/src/visual/index.ts` if it exists as an intermediate re-export.

- [ ] **Step 4: Verify types compile**

Run: `cd packages/core && npx tsc --noEmit`
Expected: May fail if consumers still import old types — that is expected, fixed in subsequent tasks.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/visual/types.ts
git commit -m "refactor(core): replace per-context screenshot types with ref-based types"
```

---

## Task 2: Rewrite VisualActionService

**Files:**
- Rewrite: `packages/dashboard/src/visual/visual-action-service.ts`
- Create: `packages/dashboard/tests/unit/visual/visual-action-service-v2.test.ts`
- Delete: `packages/dashboard/tests/unit/visual/visual-action-service.test.ts`
- Delete: `packages/dashboard/src/visual/screenshot-tagger.ts`
- Delete: `packages/dashboard/tests/unit/visual/screenshot-tagger.test.ts`

**TDD approach:** Write full test suite first, then implement.

- [ ] **Step 1: Write the test file**

```typescript
// packages/dashboard/tests/unit/visual/visual-action-service-v2.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { VisualActionService } from "../../../src/visual/visual-action-service.js";
import type { Screenshot, ScreenshotMetadata } from "@my-agent/core";

describe("VisualActionService (v2 — centralized)", () => {
  let agentDir: string;
  let vas: VisualActionService;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "vas-v2-"));
    vas = new VisualActionService(agentDir);
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  // ── store ──

  describe("store", () => {
    it("stores a PNG file and returns Screenshot metadata", () => {
      const image = Buffer.from("fake-png");
      const metadata: ScreenshotMetadata = {
        description: "test screenshot",
        width: 1920,
        height: 1080,
        source: "desktop",
      };

      const ss = vas.store(image, metadata);

      expect(ss.id).toMatch(/^ss-/);
      expect(ss.filename).toBe(`${ss.id}.png`);
      expect(ss.path).toBe(join(agentDir, "screenshots", ss.filename));
      expect(existsSync(ss.path)).toBe(true);
      expect(ss.width).toBe(1920);
      expect(ss.height).toBe(1080);
      expect(ss.source).toBe("desktop");
      expect(ss.description).toBe("test screenshot");
      expect(ss.sizeBytes).toBe(image.byteLength);
      expect(ss.refs).toEqual([]);
    });

    it("appends to index.jsonl", () => {
      const image = Buffer.from("data");
      vas.store(image, { width: 100, height: 100, source: "desktop" });
      vas.store(image, { width: 100, height: 100, source: "playwright" });

      const indexPath = join(agentDir, "screenshots", "index.jsonl");
      const lines = readFileSync(indexPath, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(2);

      const first = JSON.parse(lines[0]);
      expect(first.source).toBe("desktop");
      const second = JSON.parse(lines[1]);
      expect(second.source).toBe("playwright");
    });

    it("fires onScreenshot listeners", () => {
      const received: Screenshot[] = [];
      vas.onScreenshot((ss) => received.push(ss));

      vas.store(Buffer.from("x"), { width: 10, height: 10, source: "upload" });

      expect(received).toHaveLength(1);
      expect(received[0].source).toBe("upload");
    });
  });

  // ── get ──

  describe("get", () => {
    it("returns a screenshot by ID", () => {
      const ss = vas.store(Buffer.from("data"), {
        width: 100,
        height: 100,
        source: "desktop",
      });

      const found = vas.get(ss.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(ss.id);
    });

    it("returns null for unknown ID", () => {
      expect(vas.get("ss-nonexistent")).toBeNull();
    });
  });

  // ── addRef / removeRefs ──

  describe("refs", () => {
    it("addRef adds a ref to a screenshot", () => {
      const ss = vas.store(Buffer.from("data"), {
        width: 100,
        height: 100,
        source: "desktop",
      });
      expect(ss.refs).toEqual([]);

      vas.addRef(ss.id, "conv/abc");

      const updated = vas.get(ss.id);
      expect(updated!.refs).toEqual(["conv/abc"]);
    });

    it("addRef does not duplicate refs", () => {
      const ss = vas.store(Buffer.from("data"), {
        width: 100,
        height: 100,
        source: "desktop",
      });

      vas.addRef(ss.id, "conv/abc");
      vas.addRef(ss.id, "conv/abc");

      expect(vas.get(ss.id)!.refs).toEqual(["conv/abc"]);
    });

    it("removeRefs removes all refs matching a prefix", () => {
      const ss1 = vas.store(Buffer.from("a"), {
        width: 100,
        height: 100,
        source: "desktop",
      });
      const ss2 = vas.store(Buffer.from("b"), {
        width: 100,
        height: 100,
        source: "desktop",
      });

      vas.addRef(ss1.id, "job/auto-1/job-1");
      vas.addRef(ss1.id, "conv/main");
      vas.addRef(ss2.id, "job/auto-1/job-2");

      // Delete all refs for automation auto-1
      vas.removeRefs("job/auto-1");

      expect(vas.get(ss1.id)!.refs).toEqual(["conv/main"]);
      expect(vas.get(ss2.id)!.refs).toEqual([]);
    });
  });

  // ── listByRef ──

  describe("listByRef", () => {
    it("returns screenshots with refs matching a prefix", () => {
      const ss1 = vas.store(Buffer.from("a"), {
        width: 100,
        height: 100,
        source: "desktop",
      });
      const ss2 = vas.store(Buffer.from("b"), {
        width: 100,
        height: 100,
        source: "playwright",
      });

      vas.addRef(ss1.id, "conv/main");
      vas.addRef(ss2.id, "job/auto-1/job-1");

      const convScreenshots = vas.listByRef("conv/");
      expect(convScreenshots).toHaveLength(1);
      expect(convScreenshots[0].id).toBe(ss1.id);

      const jobScreenshots = vas.listByRef("job/auto-1");
      expect(jobScreenshots).toHaveLength(1);
      expect(jobScreenshots[0].id).toBe(ss2.id);
    });
  });

  // ── listUnreferenced ──

  describe("listUnreferenced", () => {
    it("returns screenshots with empty refs", () => {
      vas.store(Buffer.from("a"), {
        width: 100,
        height: 100,
        source: "desktop",
      });
      const ss2 = vas.store(Buffer.from("b"), {
        width: 100,
        height: 100,
        source: "desktop",
      });
      vas.addRef(ss2.id, "conv/x");

      const unreferenced = vas.listUnreferenced();
      expect(unreferenced).toHaveLength(1);
      expect(unreferenced[0].refs).toEqual([]);
    });
  });

  // ── url ──

  describe("url", () => {
    it("returns the serving URL for a screenshot", () => {
      const ss = vas.store(Buffer.from("data"), {
        width: 100,
        height: 100,
        source: "desktop",
      });

      expect(vas.url(ss)).toBe(`/api/assets/screenshots/${ss.filename}`);
    });
  });

  // ── delete ──

  describe("delete", () => {
    it("deletes the file and removes from index", () => {
      const ss = vas.store(Buffer.from("data"), {
        width: 100,
        height: 100,
        source: "desktop",
      });

      expect(existsSync(ss.path)).toBe(true);

      vas.delete(ss.id);

      expect(existsSync(ss.path)).toBe(false);
      expect(vas.get(ss.id)).toBeNull();
    });
  });

  // ── cleanup ──

  describe("cleanup", () => {
    it("deletes unreferenced screenshots older than maxAge", () => {
      // Store a screenshot with a timestamp in the past
      const ss = vas.store(Buffer.from("old"), {
        width: 100,
        height: 100,
        source: "desktop",
      });

      // Manually backdate the timestamp in the index
      const indexPath = join(agentDir, "screenshots", "index.jsonl");
      const content = readFileSync(indexPath, "utf-8");
      const oldTimestamp = new Date(
        Date.now() - 8 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const backdated = content.replace(ss.timestamp, oldTimestamp);
      require("fs").writeFileSync(indexPath, backdated);

      // Reload index after manual edit
      vas = new VisualActionService(agentDir);

      const deleted = vas.cleanup(7 * 24 * 60 * 60 * 1000);
      expect(deleted).toBe(1);
      expect(existsSync(ss.path)).toBe(false);
    });

    it("does not delete referenced screenshots regardless of age", () => {
      const ss = vas.store(Buffer.from("referenced"), {
        width: 100,
        height: 100,
        source: "desktop",
      });
      vas.addRef(ss.id, "conv/main");

      // Backdate
      const indexPath = join(agentDir, "screenshots", "index.jsonl");
      const content = readFileSync(indexPath, "utf-8");
      const oldTimestamp = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const backdated = content.replace(ss.timestamp, oldTimestamp);
      require("fs").writeFileSync(indexPath, backdated);
      vas = new VisualActionService(agentDir);

      const deleted = vas.cleanup(7 * 24 * 60 * 60 * 1000);
      expect(deleted).toBe(0);
      expect(existsSync(ss.path)).toBe(true);
    });

    it("defaults to 7-day maxAge", () => {
      const ss = vas.store(Buffer.from("recent"), {
        width: 100,
        height: 100,
        source: "desktop",
      });

      // Recent screenshot should not be deleted
      const deleted = vas.cleanup();
      expect(deleted).toBe(0);
      expect(existsSync(ss.path)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/unit/visual/visual-action-service-v2.test.ts`
Expected: FAIL — API mismatch with old VAS.

- [ ] **Step 3: Delete old files**

```bash
rm packages/dashboard/src/visual/screenshot-tagger.ts
rm packages/dashboard/tests/unit/visual/screenshot-tagger.test.ts
rm packages/dashboard/tests/unit/visual/visual-action-service.test.ts
```

- [ ] **Step 4: Rewrite VisualActionService**

```typescript
// packages/dashboard/src/visual/visual-action-service.ts
/**
 * VisualActionService — centralized screenshot storage with ref-based lifecycle.
 *
 * All screenshots land in a single folder: {agentDir}/screenshots/
 * One index.jsonl file is the source of truth.
 * Producers store without context. Refs are added later when screenshots
 * become visible in conversations/jobs. Unreferenced screenshots expire
 * after 7 days.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Screenshot, ScreenshotMetadata } from "@my-agent/core";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export class VisualActionService {
  private listeners: Array<(screenshot: Screenshot) => void> = [];
  private readonly screenshotDir: string;
  private readonly indexPath: string;

  constructor(private agentDir: string) {
    this.screenshotDir = path.join(agentDir, "screenshots");
    this.indexPath = path.join(this.screenshotDir, "index.jsonl");
  }

  onScreenshot(callback: (screenshot: Screenshot) => void): void {
    this.listeners.push(callback);
  }

  /**
   * Store a screenshot PNG buffer to disk, append to JSONL index, return Screenshot.
   * No context needed — screenshot starts with empty refs.
   */
  store(image: Buffer, metadata: ScreenshotMetadata): Screenshot {
    const id = `ss-${randomUUID()}`;
    const filename = `${id}.png`;

    fs.mkdirSync(this.screenshotDir, { recursive: true });

    const filePath = path.join(this.screenshotDir, filename);
    fs.writeFileSync(filePath, image);

    const screenshot: Screenshot = {
      id,
      filename,
      path: filePath,
      timestamp: new Date().toISOString(),
      width: metadata.width,
      height: metadata.height,
      sizeBytes: image.byteLength,
      source: metadata.source,
      description: metadata.description,
      refs: [],
    };

    this.appendToIndex(screenshot);

    for (const listener of this.listeners) {
      listener(screenshot);
    }

    return screenshot;
  }

  /**
   * Add a ref to a screenshot (e.g. "conv/abc", "job/auto-1/job-5").
   * No-op if the ref already exists or the screenshot is not found.
   */
  addRef(screenshotId: string, ref: string): void {
    const entries = this.readIndex();
    let found = false;

    const updated = entries.map((entry) => {
      if (entry.id === screenshotId) {
        found = true;
        if (!entry.refs.includes(ref)) {
          return { ...entry, refs: [...entry.refs, ref] };
        }
      }
      return entry;
    });

    if (found) {
      this.writeIndex(updated);
    }
  }

  /**
   * Remove all refs matching a prefix from all screenshots.
   * E.g. removeRefs("job/auto-1") removes "job/auto-1/job-1", "job/auto-1/job-2", etc.
   */
  removeRefs(refPrefix: string): void {
    const entries = this.readIndex();
    let changed = false;

    const updated = entries.map((entry) => {
      const filteredRefs = entry.refs.filter(
        (r) => !r.startsWith(refPrefix),
      );
      if (filteredRefs.length !== entry.refs.length) {
        changed = true;
        return { ...entry, refs: filteredRefs };
      }
      return entry;
    });

    if (changed) {
      this.writeIndex(updated);
    }
  }

  /**
   * Get a screenshot by ID. Returns null if not found.
   */
  get(id: string): Screenshot | null {
    const entries = this.readIndex();
    return entries.find((e) => e.id === id) ?? null;
  }

  /**
   * List screenshots with refs matching a prefix.
   */
  listByRef(refPrefix: string): Screenshot[] {
    return this.readIndex().filter((e) =>
      e.refs.some((r) => r.startsWith(refPrefix)),
    );
  }

  /**
   * List unreferenced screenshots (refs.length === 0).
   */
  listUnreferenced(): Screenshot[] {
    return this.readIndex().filter((e) => e.refs.length === 0);
  }

  /**
   * Get the serving URL for a screenshot.
   */
  url(screenshot: Screenshot): string {
    return `/api/assets/screenshots/${screenshot.filename}`;
  }

  /**
   * Delete a screenshot file + remove from index.
   */
  delete(id: string): void {
    const entries = this.readIndex();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;

    try {
      fs.unlinkSync(entry.path);
    } catch {
      // File may already be gone
    }

    this.writeIndex(entries.filter((e) => e.id !== id));
  }

  /**
   * Run cleanup — delete unreferenced screenshots older than maxAge.
   * Returns the number of files deleted.
   */
  cleanup(maxAgeMs: number = SEVEN_DAYS_MS): number {
    const entries = this.readIndex();
    const now = Date.now();
    let deleted = 0;
    const kept: Screenshot[] = [];

    for (const entry of entries) {
      const age = now - new Date(entry.timestamp).getTime();
      if (entry.refs.length === 0 && age >= maxAgeMs) {
        try {
          fs.unlinkSync(entry.path);
        } catch {
          // File may already be gone
        }
        deleted++;
      } else {
        kept.push(entry);
      }
    }

    if (deleted > 0) {
      this.writeIndex(kept);
    }

    return deleted;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private readIndex(): Screenshot[] {
    if (!fs.existsSync(this.indexPath)) {
      return [];
    }

    const content = fs.readFileSync(this.indexPath, "utf-8").trim();
    if (!content) return [];

    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Screenshot);
  }

  private writeIndex(entries: Screenshot[]): void {
    fs.mkdirSync(this.screenshotDir, { recursive: true });

    if (entries.length === 0) {
      try {
        fs.unlinkSync(this.indexPath);
      } catch {
        // noop
      }
      return;
    }

    fs.writeFileSync(
      this.indexPath,
      entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf-8",
    );
  }

  private appendToIndex(screenshot: Screenshot): void {
    fs.mkdirSync(this.screenshotDir, { recursive: true });
    fs.appendFileSync(
      this.indexPath,
      JSON.stringify(screenshot) + "\n",
    );
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/unit/visual/visual-action-service-v2.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git rm packages/dashboard/src/visual/screenshot-tagger.ts
git rm packages/dashboard/tests/unit/visual/screenshot-tagger.test.ts
git rm packages/dashboard/tests/unit/visual/visual-action-service.test.ts
git add packages/dashboard/src/visual/visual-action-service.ts
git add packages/dashboard/tests/unit/visual/visual-action-service-v2.test.ts
git commit -m "refactor(dashboard): rewrite VAS — single folder, ref-based lifecycle, no tags"
```

---

## Task 3: Simplify Asset Serving Route

**Files:**
- Modify: `packages/dashboard/src/routes/asset-routes.ts`

- [ ] **Step 1: Read current asset-routes.ts**

Read `packages/dashboard/src/routes/asset-routes.ts` to confirm current two-route structure.

- [ ] **Step 2: Replace with single route**

```typescript
// packages/dashboard/src/routes/asset-routes.ts
/**
 * Asset serving routes for stored screenshots.
 *
 * Single route serves all screenshots from the central folder:
 *   {agentDir}/screenshots/{filename}
 */

import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";

/** Reject path segments that could be used for directory traversal. */
function isSafe(segment: string): boolean {
  return !segment.includes("..") && !segment.includes("/") && !segment.includes("\\");
}

export async function registerAssetRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // GET /api/assets/screenshots/:filename
  fastify.get<{
    Params: { filename: string };
  }>(
    "/api/assets/screenshots/:filename",
    async (request, reply) => {
      const { filename } = request.params;

      if (!isSafe(filename)) {
        return reply.code(400).send({ error: "Invalid path segment" });
      }

      const filePath = join(
        fastify.agentDir,
        "screenshots",
        filename,
      );

      try {
        await access(filePath);
      } catch {
        return reply.code(404).send({ error: "File not found" });
      }

      return reply
        .type("image/png")
        .send(createReadStream(filePath));
    },
  );
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean (or only errors from other files not yet updated).

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/routes/asset-routes.ts
git commit -m "refactor(dashboard): single asset route — /api/assets/screenshots/:filename"
```

---

## Task 4: Update ComputerUseService

**Files:**
- Modify: `packages/dashboard/src/desktop/computer-use-service.ts`
- Modify: `packages/dashboard/tests/unit/desktop/computer-use-service.test.ts`

- [ ] **Step 1: Read current computer-use-service.ts**

Read `packages/dashboard/src/desktop/computer-use-service.ts` to confirm current imports and store calls.

- [ ] **Step 2: Remove old imports and types**

Remove these imports:
- `AssetContext` from `@my-agent/core`
- `ScreenshotTag` from `@my-agent/core`
- `computeDiffRatio, DIFF_THRESHOLD` from `../visual/screenshot-tagger.js`

- [ ] **Step 3: Update ComputerUseTask interface**

Remove `context: AssetContext` from `ComputerUseTask`. The service no longer needs to know where screenshots belong.

Update `ComputerUseResult.screenshots` array type — remove `tag` field:

```typescript
export interface ComputerUseResult {
  success: boolean;
  summary: string;
  screenshots: Array<{ id: string; filename: string; path: string }>;
  actionsPerformed: number;
  error?: string;
}
```

- [ ] **Step 4: Update store calls**

Replace all `this.vas.store(buffer, { context: task.context, ... }, tag)` calls with:

```typescript
this.vas.store(buffer, {
  description: "Initial screenshot",
  width: display.width,
  height: display.height,
  source: "desktop",
})
```

For each store call:
- Remove the `context` field from the metadata object
- Add `source: "desktop"`
- Remove the third `tag` argument entirely

Update the screenshots array push to remove `tag`:

```typescript
screenshots.push({ id: ss.id, filename: ss.filename, path: ss.path });
```

- [ ] **Step 5: Remove pixel diff tagging logic**

In the action loop, remove the tag determination block:

```typescript
// DELETE THIS BLOCK:
// let tag: ScreenshotTag;
// const agentTag = input.screenshot_tag as string | undefined;
// if (agentTag === "keep" || agentTag === "skip") {
//   tag = agentTag;
// } else {
//   const ratio = computeDiffRatio(buffer, previousBuffer ?? buffer);
//   tag = previousBuffer === null || ratio >= DIFF_THRESHOLD ? "keep" : "skip";
// }
```

Also remove the `previousBuffer` variable and its assignments — it was only used for pixel diff.

Remove `screenshotTag: tag` from the JSONL audit log entry.

- [ ] **Step 6: Update existing tests**

Update `packages/dashboard/tests/unit/desktop/computer-use-service.test.ts`:
- Remove `AssetContext` imports and any `context` fields in test task objects
- Remove `ScreenshotTag` references
- Update mock VAS `store()` signature — now `store(image, metadata)` with no tag param
- Remove any assertions on `tag` in screenshot results
- Update `ComputerUseTask` test objects — remove `context` field

- [ ] **Step 7: Run tests**

Run: `cd packages/dashboard && npx vitest run tests/unit/desktop/computer-use-service.test.ts`
Expected: PASS.

- [ ] **Step 8: Verify types compile**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean (or only errors from other files not yet updated).

- [ ] **Step 9: Commit**

```bash
git add packages/dashboard/src/desktop/computer-use-service.ts packages/dashboard/tests/unit/desktop/computer-use-service.test.ts
git commit -m "refactor(dashboard): ComputerUseService — context-free store, no tags, no pixel diff"
```

---

## Task 5: Update PlaywrightScreenshotBridge

**Files:**
- Modify: `packages/dashboard/src/playwright/playwright-screenshot-bridge.ts`
- Modify: `packages/dashboard/tests/unit/playwright/playwright-screenshot-bridge.test.ts`

- [ ] **Step 1: Read current bridge file**

Read `packages/dashboard/src/playwright/playwright-screenshot-bridge.ts`.

- [ ] **Step 2: Remove old imports and types**

Remove imports of `AssetContext`, `ScreenshotTag` from `@my-agent/core`.

Replace the `StoreOptions` interface:

```typescript
interface StoreOptions {
  description?: string;
  width?: number;
  height?: number;
}
```

- [ ] **Step 3: Update storeFromBase64**

```typescript
storeFromBase64(base64Data: string, options: StoreOptions): Screenshot {
  const image = Buffer.from(base64Data, "base64");

  return this.vas.store(image, {
    description: options.description ?? "Playwright browser screenshot",
    width: options.width ?? 1280,
    height: options.height ?? 720,
    source: "playwright",
  });
}
```

- [ ] **Step 4: Update MCP tool — remove hardcoded context**

In `createMcpServer()`, replace the `storeFromBase64` call:

```typescript
bridge.storeFromBase64(base64, {
  description:
    args.description ??
    `Playwright: ${args.url ?? "current page"}`,
  width: viewport.width,
  height: viewport.height,
});
```

The `context: { type: "conversation", id: "active" }` line is deleted entirely. The MCP tool no longer needs to know about contexts.

- [ ] **Step 5: Update existing tests**

Update `packages/dashboard/tests/unit/playwright/playwright-screenshot-bridge.test.ts`:
- Remove `AssetContext` imports and `context` params from `storeFromBase64()` calls
- Remove tag assertions — screenshots no longer have tags
- Update test assertions for new `Screenshot` shape (has `refs: []` and `source` instead of `tag` and `context`)
- Remove any `mkdirSync` calls for conversation/job directories — VAS now uses single `screenshots/` folder
- Update `beforeEach` to create `join(agentDir, "screenshots")` instead of per-context dirs

- [ ] **Step 6: Run tests**

Run: `cd packages/dashboard && npx vitest run tests/unit/playwright/playwright-screenshot-bridge.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify types compile**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean (or only errors from other files not yet updated).

- [ ] **Step 8: Commit**

```bash
git add packages/dashboard/src/playwright/playwright-screenshot-bridge.ts packages/dashboard/tests/unit/playwright/playwright-screenshot-bridge.test.ts
git commit -m "refactor(dashboard): PlaywrightBridge — context-free store, source: playwright"
```

---

## Task 6: Wire Ref Management into Conversation Lifecycle

**Files:**
- Modify: `packages/dashboard/src/chat/chat-service.ts` — transcript write (add ref on message persist)
- Modify: `packages/dashboard/src/chat/chat-handler.ts` — conversation deletion handler (lines 219-240, calls `app.chat.deleteConversation`)
- Modify: `packages/dashboard/src/conversations/manager.ts` — `delete()` method (lines 322-331)
- Modify: `packages/dashboard/src/automations/automation-manager.ts` — automation deletion
- Modify: `packages/dashboard/src/automations/automation-processor.ts` — job completion (add ref if deliverable has screenshots)

This task connects screenshot refs to conversation and job lifecycle events. The exact integration points are identified below.

- [ ] **Step 1: Read the transcript write path**

Read `packages/dashboard/src/chat/chat-service.ts` — find where messages are persisted to the transcript. This is likely in a method like `addMessage()` or `appendTurn()`. That's where we scan for screenshot URLs and call `addRef`.

- [ ] **Step 2: Add ref on message write**

When a message is written to a conversation transcript and it contains a screenshot URL (matching `/api/assets/screenshots/ss-*.png`), extract the screenshot ID and call:

```typescript
vas.addRef(screenshotId, `conv/${conversationId}`);
```

Pattern to match: `/api/assets/screenshots/(ss-[a-f0-9-]+)\.png/`

- [ ] **Step 3: Remove refs on conversation deletion**

In `packages/dashboard/src/conversations/manager.ts`, method `delete()` (around line 322). Add before or after the existing cleanup:

```typescript
// Remove screenshot refs for this conversation
app.visualActionService.removeRefs(`conv/${id}`);
```

Alternatively, add to the cleanup handlers in `chat-handler.ts` line 225 (the `deleteConversation` call already passes cleanup callbacks like `deleteAttachments` — add a `removeScreenshotRefs` callback).

- [ ] **Step 4: Remove refs on automation deletion**

In `packages/dashboard/src/automations/automation-manager.ts`, find the delete method. Add:

```typescript
app.visualActionService.removeRefs(`job/${automationId}`);
```

- [ ] **Step 5: Add ref on job completion**

In `packages/dashboard/src/automations/automation-processor.ts`, find where job completion is handled (the `handleJobComplete` or similar method where `summary`/`deliverable` is set). Scan the deliverable for screenshot URLs and add refs:

```typescript
const screenshotPattern = /\/api\/assets\/screenshots\/(ss-[a-f0-9-]+)\.png/g;
let match;
while ((match = screenshotPattern.exec(deliverable)) !== null) {
  vas.addRef(match[1], `job/${automationId}/${jobId}`);
}
```

- [ ] **Step 6: Verify types compile**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 7: Commit**

```bash
git add -u
git commit -m "feat(dashboard): wire ref management into conversation + automation lifecycle"
```

---

## ~~Task 7: Add screenshots Table to agent.db~~ — DEFERRED

**Deferred.** The JSONL index handles all current operations. Adding a DB table introduces dual-write sync, schema migration, and rebuild logic — complexity not justified at current screenshot volume. Will add when we need fast queries (e.g., dashboard search/filter across all screenshots).

The JSONL-only approach is consistent with how the system started for jobs before DB indexing was added.

---

## Task 8: Update Frontend + WebSocket Protocol

**Files:**
- Modify: `packages/dashboard/src/ws/protocol.ts`
- Modify: `packages/dashboard/src/state/state-publisher.ts`
- Modify: `packages/dashboard/src/app.ts` (onScreenshot listener)
- Modify: Frontend files (Alpine store, index.html) as needed

- [ ] **Step 1: Update ScreenshotSnapshot in protocol.ts**

Replace:

```typescript
export interface ScreenshotSnapshot {
  id: string;
  filename: string;
  url: string;
  timestamp: string;
  contextType: "job" | "conversation";
  contextId: string;
  automationId?: string;
  tag: "keep" | "skip";
  description?: string;
  width: number;
  height: number;
}
```

With:

```typescript
export interface ScreenshotSnapshot {
  id: string;
  filename: string;
  url: string;
  timestamp: string;
  source: "desktop" | "playwright" | "upload";
  description?: string;
  width: number;
  height: number;
  refs: string[];
}
```

- [ ] **Step 2: Update StatePublisher screenshot publish**

Update the `publishScreenshot` method to accept and broadcast the new shape.

- [ ] **Step 3: Update onScreenshot listener in app.ts**

Replace:

```typescript
app.visualActionService.onScreenshot((screenshot) => {
  app.statePublisher!.publishScreenshot({
    id: screenshot.id,
    filename: screenshot.filename,
    url: app.visualActionService.url(screenshot),
    timestamp: screenshot.timestamp,
    contextType: screenshot.context.type,
    contextId: screenshot.context.id,
    automationId: screenshot.context.automationId,
    tag: screenshot.tag,
    description: screenshot.description,
    width: screenshot.width,
    height: screenshot.height,
  });
});
```

With:

```typescript
app.visualActionService.onScreenshot((screenshot) => {
  app.statePublisher!.publishScreenshot({
    id: screenshot.id,
    filename: screenshot.filename,
    url: app.visualActionService.url(screenshot),
    timestamp: screenshot.timestamp,
    source: screenshot.source,
    description: screenshot.description,
    width: screenshot.width,
    height: screenshot.height,
    refs: screenshot.refs,
  });
});
```

- [ ] **Step 4: Update Alpine store (if applicable)**

If there is a frontend Alpine store that filters screenshots by `contextType`/`contextId`, update it to filter by ref prefix instead. For example:

```javascript
forConversation(conversationId) {
  return this.screenshots.filter(ss =>
    ss.refs.some(r => r.startsWith(`conv/${conversationId}`))
  );
}

forJob(automationId, jobId) {
  return this.screenshots.filter(ss =>
    ss.refs.some(r => r.startsWith(`job/${automationId}/${jobId}`))
  );
}
```

- [ ] **Step 5: Verify types compile**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 6: Commit**

```bash
git add -u
git commit -m "feat(dashboard): update frontend + WS protocol for ref-based screenshots"
```

---

## Task 9: Cleanup Job + Deleted Automation Test

**Files:**
- Create: `packages/dashboard/tests/unit/visual/ref-lifecycle.test.ts`

Three lifecycle tests that verify the ref-based cleanup behavior end-to-end.

- [ ] **Step 1: Write the test file**

```typescript
// packages/dashboard/tests/unit/visual/ref-lifecycle.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { VisualActionService } from "../../../src/visual/visual-action-service.js";

describe("Screenshot ref lifecycle", () => {
  let agentDir: string;
  let vas: VisualActionService;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "ref-lifecycle-"));
    vas = new VisualActionService(agentDir);
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("automation deletion: screenshots become unreferenced and expire", () => {
    // 1. Create screenshots referenced by a job
    const ss1 = vas.store(Buffer.from("a"), {
      width: 100,
      height: 100,
      source: "desktop",
    });
    const ss2 = vas.store(Buffer.from("b"), {
      width: 100,
      height: 100,
      source: "desktop",
    });
    vas.addRef(ss1.id, "job/auto-1/job-1");
    vas.addRef(ss2.id, "job/auto-1/job-2");

    // 2. Delete the automation — removes all job/auto-1 refs
    vas.removeRefs("job/auto-1");

    expect(vas.get(ss1.id)!.refs).toEqual([]);
    expect(vas.get(ss2.id)!.refs).toEqual([]);

    // 3. Screenshots still exist (within 7-day window)
    expect(existsSync(ss1.path)).toBe(true);
    expect(existsSync(ss2.path)).toBe(true);

    // 4. Backdate and cleanup — now they expire
    const indexPath = join(agentDir, "screenshots", "index.jsonl");
    let content = readFileSync(indexPath, "utf-8");
    const oldTimestamp = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    ).toISOString();
    content = content.replace(
      new RegExp(ss1.timestamp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      oldTimestamp,
    );
    content = content.replace(
      new RegExp(ss2.timestamp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      oldTimestamp,
    );
    require("fs").writeFileSync(indexPath, content);
    vas = new VisualActionService(agentDir);

    const deleted = vas.cleanup();
    expect(deleted).toBe(2);
    expect(existsSync(ss1.path)).toBe(false);
    expect(existsSync(ss2.path)).toBe(false);
  });

  it("one-off automation: create, screenshot, delete, cleanup", () => {
    // 1. Screenshot from a one-off automation
    const ss = vas.store(Buffer.from("oneoff"), {
      description: "One-off task screenshot",
      width: 1920,
      height: 1080,
      source: "desktop",
    });
    vas.addRef(ss.id, "job/oneoff-auto/job-1");

    // 2. Automation deleted
    vas.removeRefs("job/oneoff-auto");

    // 3. Now unreferenced
    expect(vas.listUnreferenced()).toHaveLength(1);

    // 4. Cleanup with 0ms maxAge (immediate)
    const deleted = vas.cleanup(0);
    expect(deleted).toBe(1);
    expect(vas.get(ss.id)).toBeNull();
  });

  it("cross-ref: screenshot survives if referenced by another context", () => {
    // Screenshot referenced by both a conversation and a job
    const ss = vas.store(Buffer.from("shared"), {
      width: 100,
      height: 100,
      source: "desktop",
    });
    vas.addRef(ss.id, "conv/main");
    vas.addRef(ss.id, "job/auto-1/job-1");

    // Delete the automation refs
    vas.removeRefs("job/auto-1");

    // Still referenced by conversation
    expect(vas.get(ss.id)!.refs).toEqual(["conv/main"]);

    // Cleanup should NOT delete it
    const deleted = vas.cleanup(0);
    expect(deleted).toBe(0);
    expect(existsSync(ss.path)).toBe(true);

    // Now delete conversation ref too
    vas.removeRefs("conv/main");
    expect(vas.get(ss.id)!.refs).toEqual([]);

    // Now it should be cleaned up
    const deleted2 = vas.cleanup(0);
    expect(deleted2).toBe(1);
    expect(existsSync(ss.path)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/unit/visual/ref-lifecycle.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/tests/unit/visual/ref-lifecycle.test.ts
git commit -m "test(dashboard): ref lifecycle tests — automation deletion, one-off, cross-ref"
```

---

## Task 10: Update App Wiring

**Files:**
- Modify: `packages/dashboard/src/app.ts`

- [ ] **Step 1: Read app.ts for VAS instantiation and related wiring**

Read `packages/dashboard/src/app.ts` around the VAS construction, PlaywrightBridge construction, and ComputerUseService construction.

- [ ] **Step 2: Update VAS instantiation**

The `new VisualActionService(agentDir)` call should still work as-is (constructor signature unchanged). Verify no other arguments are passed.

- [ ] **Step 3: Update PlaywrightBridge construction**

The `new PlaywrightScreenshotBridge(this.visualActionService)` call should still work as-is. Verify.

- [ ] **Step 4: Update ComputerUseService construction**

Verify `new ComputerUseService(client, backend, app.visualActionService)` still works with the updated VAS API.

- [ ] **Step 5: Remove any old imports**

Remove any imports of `AssetContext`, `ScreenshotTag`, `CaptureOptions` from app.ts if present.

- [ ] **Step 6: Verify types compile**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/app.ts
git commit -m "refactor(dashboard): update App wiring for centralized VAS"
```

---

## Task 11: Full Test Suite Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full dashboard test suite**

Run: `cd packages/dashboard && npx vitest run`
Expected: All tests pass, no regressions.

- [ ] **Step 2: Run TypeScript check on all packages**

Run: `cd packages/dashboard && npx tsc --noEmit && cd ../core && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 3: Verify dashboard starts**

Run: `systemctl --user restart nina-dashboard.service && sleep 2 && systemctl --user status nina-dashboard.service`
Expected: Active (running).

- [ ] **Step 4: Smoke test**

1. Store a screenshot via desktop control — verify it lands in `.my_agent/screenshots/`
2. Verify the screenshot appears at `/api/assets/screenshots/{filename}`
3. Verify the WebSocket broadcasts the new shape (source, refs instead of contextType, tag)
4. Delete a conversation that references a screenshot — verify the ref is removed
5. Run cleanup — verify unreferenced old screenshots are deleted

---

## Success Criteria

- [ ] Single screenshot folder: all screenshots in `.my_agent/screenshots/`
- [ ] Single JSONL index: `.my_agent/screenshots/index.jsonl` is source of truth
- [ ] ~~`screenshots` table in `agent.db`~~ — DEFERRED (JSONL sufficient at current volume)
- [ ] Producers store without context — `store(image, metadata)` with no `AssetContext`
- [ ] Refs added when screenshots become visible (transcript write, job completion)
- [ ] Refs removed on context deletion (conversation delete, automation delete)
- [ ] Unreferenced screenshots expire after 7 days (cleanup with `maxAgeMs` default)
- [ ] Referenced screenshots live as long as any ref exists
- [ ] Cross-referenced screenshots survive partial ref removal
- [ ] Single asset route: `/api/assets/screenshots/:filename`
- [ ] No pixel diff, no tags, no `ScreenshotTag` type anywhere
- [ ] No `AssetContext` type anywhere
- [ ] `ScreenshotSnapshot` WebSocket payload uses `source` + `refs` (not `contextType`/`tag`)
- [ ] Frontend queries by ref prefix (not by contextType/contextId)
- [ ] All existing tests pass
- [ ] `tsc --noEmit` clean across core and dashboard packages
- [ ] Dashboard starts and serves screenshots correctly

**Explicitly deferred:**
- Migration of existing per-context screenshot folders to central folder (can be a one-time script)
- Full DB-backed query performance optimization (JSONL is fine for expected volume)
