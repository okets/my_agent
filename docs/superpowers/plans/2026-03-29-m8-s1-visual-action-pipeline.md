# M8-S1: Visual Action Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared screenshot capture → store → serve → render pipeline that all visual features (desktop control, Playwright, rich I/O) will use.

**Architecture:** VisualActionService manages screenshot lifecycle. Types in `packages/core`, service in `packages/dashboard` (needs filesystem + event publishing). JSONL index per context directory. Fastify route for serving. StatePublisher broadcasts new screenshots. Dashboard renders in timeline and chat.

**Tech Stack:** TypeScript, Fastify (static serving), Alpine.js (frontend), vitest (testing), sharp (image comparison for pixel diff tagger)

**Design spec:** `docs/superpowers/specs/2026-03-29-m8-desktop-automation-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `packages/core/src/visual/types.ts` | Screenshot, AssetContext, CaptureOptions, ScreenshotMetadata, ScreenshotTag interfaces |
| `packages/core/src/visual/index.ts` | Re-exports |
| `packages/dashboard/src/visual/visual-action-service.ts` | Capture, store, list, url, publish — the pipeline |
| `packages/dashboard/src/visual/screenshot-tagger.ts` | Pixel diff fallback for untagged screenshots |
| `packages/dashboard/src/routes/asset-routes.ts` | Fastify route: `/api/assets/:contextType/:contextId/screenshots/:filename` |
| `packages/dashboard/tests/unit/visual/visual-action-service.test.ts` | Service unit tests |
| `packages/dashboard/tests/unit/visual/screenshot-tagger.test.ts` | Tagger unit tests |
| `packages/dashboard/tests/unit/routes/asset-routes.test.ts` | Route tests |

### Modified Files

| File | Change |
|------|--------|
| `packages/core/src/index.ts` | Re-export visual types |
| `packages/dashboard/src/ws/protocol.ts` | Add `ScreenshotSnapshot` type and `state:screenshots` message |
| `packages/dashboard/src/state/state-publisher.ts` | Add `publishScreenshot()` method |
| `packages/dashboard/src/server.ts` | Register asset routes |
| `packages/dashboard/public/js/stores.js` | Add `screenshots` Alpine store |
| `packages/dashboard/public/js/ws-client.js` | Handle `state:screenshots` events |
| `packages/dashboard/public/js/app.js` | Render screenshots in timeline items |

---

## Task 1: Screenshot Types

**Files:**
- Create: `packages/core/src/visual/types.ts`
- Create: `packages/core/src/visual/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create the types file**

```typescript
// packages/core/src/visual/types.ts

export type ScreenshotTag = "keep" | "skip";

export interface AssetContext {
  type: "job" | "conversation";
  id: string;
  automationId?: string; // For job context
}

export interface CaptureOptions {
  source: "desktop" | "window" | "region";
  windowId?: string;
  region?: { x: number; y: number; width: number; height: number };
  context: AssetContext;
  description?: string;
}

export interface ScreenshotMetadata {
  context: AssetContext;
  description?: string;
  width: number;
  height: number;
}

export interface Screenshot {
  id: string;
  filename: string;
  path: string;
  timestamp: string;
  context: AssetContext;
  tag: ScreenshotTag;
  description?: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface ScreenshotIndex {
  /** Append a screenshot entry to the JSONL index */
  append(screenshot: Screenshot): void;
  /** Read all entries from the JSONL index */
  readAll(): Screenshot[];
  /** Update the tag of a screenshot by ID */
  updateTag(id: string, tag: ScreenshotTag): void;
}
```

- [ ] **Step 2: Create the index re-export**

```typescript
// packages/core/src/visual/index.ts
export * from "./types.js";
```

- [ ] **Step 3: Add to core barrel export**

In `packages/core/src/index.ts`, add:

```typescript
export * from "./visual/index.js";
```

- [ ] **Step 4: Verify types compile**

Run: `cd packages/core && npx tsc --noEmit`
Expected: Clean, no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/visual/ packages/core/src/index.ts
git commit -m "feat(core): add visual action pipeline types"
```

---

## Task 2: VisualActionService — Core Implementation

**Files:**
- Create: `packages/dashboard/src/visual/visual-action-service.ts`
- Create: `packages/dashboard/tests/unit/visual/visual-action-service.test.ts`

- [ ] **Step 1: Write the test file with first test — store a screenshot**

```typescript
// packages/dashboard/tests/unit/visual/visual-action-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { VisualActionService } from "../../../src/visual/visual-action-service.js";
import type { AssetContext } from "@my-agent/core";

describe("VisualActionService", () => {
  let service: VisualActionService;
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "vas-test-"));
    // Create the directories the service expects
    mkdirSync(join(agentDir, "automations", ".runs", "auto-1", "job-1"), {
      recursive: true,
    });
    mkdirSync(join(agentDir, "conversations", "conv-1"), { recursive: true });
    service = new VisualActionService(agentDir);
  });

  describe("store()", () => {
    it("stores a screenshot and returns metadata", async () => {
      const image = Buffer.from("fake-png-data");
      const context: AssetContext = {
        type: "job",
        id: "job-1",
        automationId: "auto-1",
      };

      const screenshot = await service.store(image, {
        context,
        description: "Test screenshot",
        width: 1920,
        height: 1080,
      });

      expect(screenshot.id).toMatch(/^ss-/);
      expect(screenshot.context).toEqual(context);
      expect(screenshot.description).toBe("Test screenshot");
      expect(screenshot.width).toBe(1920);
      expect(screenshot.height).toBe(1080);
      expect(screenshot.sizeBytes).toBe(image.length);
      expect(screenshot.tag).toBe("keep"); // Default tag

      // File exists on disk
      const stored = readFileSync(screenshot.path);
      expect(stored).toEqual(image);
    });

    it("stores in conversation context directory", async () => {
      const image = Buffer.from("fake-png-data");
      const context: AssetContext = { type: "conversation", id: "conv-1" };

      const screenshot = await service.store(image, {
        context,
        width: 800,
        height: 600,
      });

      expect(screenshot.path).toContain("conversations/conv-1/screenshots/");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/unit/visual/visual-action-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement VisualActionService — store()**

```typescript
// packages/dashboard/src/visual/visual-action-service.ts
import { randomUUID } from "crypto";
import { mkdirSync, writeFileSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";
import type {
  Screenshot,
  ScreenshotMetadata,
  AssetContext,
  ScreenshotTag,
} from "@my-agent/core";

export class VisualActionService {
  constructor(private readonly agentDir: string) {}

  async store(
    image: Buffer,
    metadata: ScreenshotMetadata,
    tag: ScreenshotTag = "keep",
  ): Promise<Screenshot> {
    const id = `ss-${randomUUID()}`;
    const filename = `${id}.png`;
    const dir = this.screenshotDir(metadata.context);
    mkdirSync(dir, { recursive: true });

    const filePath = join(dir, filename);
    writeFileSync(filePath, image);

    const screenshot: Screenshot = {
      id,
      filename,
      path: filePath,
      timestamp: new Date().toISOString(),
      context: metadata.context,
      tag,
      description: metadata.description,
      width: metadata.width,
      height: metadata.height,
      sizeBytes: image.length,
    };

    this.appendToIndex(dir, screenshot);
    return screenshot;
  }

  list(context: AssetContext): Screenshot[] {
    const dir = this.screenshotDir(context);
    const indexPath = join(dir, "screenshots.jsonl");
    try {
      const content = readFileSync(indexPath, "utf-8").trim();
      if (!content) return [];
      return content.split("\n").map((line) => JSON.parse(line) as Screenshot);
    } catch {
      return [];
    }
  }

  url(screenshot: Screenshot): string {
    const { context } = screenshot;
    if (context.type === "job" && context.automationId) {
      return `/api/assets/job/${context.automationId}/${context.id}/screenshots/${screenshot.filename}`;
    }
    return `/api/assets/${context.type}/${context.id}/screenshots/${screenshot.filename}`;
  }

  updateTag(context: AssetContext, screenshotId: string, tag: ScreenshotTag): void {
    const dir = this.screenshotDir(context);
    const indexPath = join(dir, "screenshots.jsonl");
    try {
      const content = readFileSync(indexPath, "utf-8").trim();
      if (!content) return;
      const lines = content.split("\n").map((line) => {
        const entry = JSON.parse(line) as Screenshot;
        if (entry.id === screenshotId) {
          return JSON.stringify({ ...entry, tag });
        }
        return line;
      });
      writeFileSync(indexPath, lines.join("\n") + "\n", "utf-8");
    } catch {
      // Index doesn't exist — nothing to update
    }
  }

  private screenshotDir(context: AssetContext): string {
    if (context.type === "job" && context.automationId) {
      return join(
        this.agentDir,
        "automations",
        ".runs",
        context.automationId,
        context.id,
        "screenshots",
      );
    }
    return join(this.agentDir, "conversations", context.id, "screenshots");
  }

  private appendToIndex(dir: string, screenshot: Screenshot): void {
    const indexPath = join(dir, "screenshots.jsonl");
    appendFileSync(indexPath, JSON.stringify(screenshot) + "\n", "utf-8");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/dashboard && npx vitest run tests/unit/visual/visual-action-service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/visual/ packages/dashboard/tests/unit/visual/
git commit -m "feat(dashboard): VisualActionService — store and list screenshots"
```

---

## Task 3: VisualActionService — list, url, updateTag

**Files:**
- Modify: `packages/dashboard/tests/unit/visual/visual-action-service.test.ts`

- [ ] **Step 1: Add tests for list, url, and updateTag**

Append to the test file inside the `describe("VisualActionService")` block:

```typescript
  describe("list()", () => {
    it("returns stored screenshots in order", async () => {
      const context: AssetContext = {
        type: "job",
        id: "job-1",
        automationId: "auto-1",
      };
      const img = Buffer.from("data");

      await service.store(img, { context, width: 100, height: 100 });
      await service.store(img, {
        context,
        width: 200,
        height: 200,
        description: "second",
      });

      const screenshots = service.list(context);
      expect(screenshots).toHaveLength(2);
      expect(screenshots[0].width).toBe(100);
      expect(screenshots[1].description).toBe("second");
    });

    it("returns empty array for context with no screenshots", () => {
      const context: AssetContext = { type: "conversation", id: "no-such" };
      expect(service.list(context)).toEqual([]);
    });
  });

  describe("url()", () => {
    it("generates job asset URL", async () => {
      const context: AssetContext = {
        type: "job",
        id: "job-1",
        automationId: "auto-1",
      };
      const screenshot = await service.store(Buffer.from("x"), {
        context,
        width: 10,
        height: 10,
      });

      const url = service.url(screenshot);
      expect(url).toBe(
        `/api/assets/job/auto-1/job-1/screenshots/${screenshot.filename}`,
      );
    });

    it("generates conversation asset URL", async () => {
      const context: AssetContext = { type: "conversation", id: "conv-1" };
      const screenshot = await service.store(Buffer.from("x"), {
        context,
        width: 10,
        height: 10,
      });

      const url = service.url(screenshot);
      expect(url).toBe(
        `/api/assets/conversation/conv-1/screenshots/${screenshot.filename}`,
      );
    });
  });

  describe("updateTag()", () => {
    it("updates tag in the JSONL index", async () => {
      const context: AssetContext = {
        type: "job",
        id: "job-1",
        automationId: "auto-1",
      };
      const screenshot = await service.store(Buffer.from("x"), {
        context,
        width: 10,
        height: 10,
      });

      expect(screenshot.tag).toBe("keep");
      service.updateTag(context, screenshot.id, "skip");

      const listed = service.list(context);
      expect(listed[0].tag).toBe("skip");
    });
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/unit/visual/visual-action-service.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/tests/unit/visual/visual-action-service.test.ts
git commit -m "test(dashboard): VisualActionService — list, url, updateTag tests"
```

---

## Task 4: Screenshot Pixel Diff Tagger

**Files:**
- Create: `packages/dashboard/src/visual/screenshot-tagger.ts`
- Create: `packages/dashboard/tests/unit/visual/screenshot-tagger.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/dashboard/tests/unit/visual/screenshot-tagger.test.ts
import { describe, it, expect } from "vitest";
import { computeDiffRatio } from "../../../src/visual/screenshot-tagger.js";

describe("screenshot-tagger", () => {
  describe("computeDiffRatio()", () => {
    it("returns 0.0 for identical buffers", () => {
      const buf = Buffer.alloc(100, 128);
      expect(computeDiffRatio(buf, buf)).toBe(0);
    });

    it("returns 1.0 for completely different buffers", () => {
      const a = Buffer.alloc(100, 0);
      const b = Buffer.alloc(100, 255);
      expect(computeDiffRatio(a, b)).toBe(1);
    });

    it("returns ~0.5 for half-different buffers", () => {
      const a = Buffer.alloc(100, 0);
      const b = Buffer.alloc(100, 0);
      // Change second half
      for (let i = 50; i < 100; i++) b[i] = 255;
      const ratio = computeDiffRatio(a, b);
      expect(ratio).toBeGreaterThan(0.4);
      expect(ratio).toBeLessThan(0.6);
    });

    it("handles different length buffers by using shorter length", () => {
      const a = Buffer.alloc(50, 0);
      const b = Buffer.alloc(100, 255);
      // Should compare only first 50 bytes
      expect(computeDiffRatio(a, b)).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/unit/visual/screenshot-tagger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tagger**

```typescript
// packages/dashboard/src/visual/screenshot-tagger.ts
import type { ScreenshotTag } from "@my-agent/core";

/**
 * Compare two raw image buffers and return the fraction of bytes that differ.
 * This is a rough heuristic — not perceptual, just byte-level.
 * Used as a fallback when the agent doesn't tag a screenshot.
 */
export function computeDiffRatio(a: Buffer, b: Buffer): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let diffCount = 0;
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) diffCount++;
  }
  return diffCount / len;
}

/** Threshold above which a screenshot is considered a "milestone" (visual change). */
const DIFF_THRESHOLD = 0.15;

/**
 * Determine whether to keep an untagged screenshot based on pixel diff.
 * Agent tagging is primary; this is the fallback.
 */
export function tagByDiff(
  current: Buffer,
  previous: Buffer | null,
): ScreenshotTag {
  if (!previous) return "keep"; // First screenshot always kept
  const ratio = computeDiffRatio(current, previous);
  return ratio >= DIFF_THRESHOLD ? "keep" : "skip";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/unit/visual/screenshot-tagger.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add test for tagByDiff**

Append to the test file:

```typescript
import { tagByDiff } from "../../../src/visual/screenshot-tagger.js";

describe("tagByDiff()", () => {
  it("keeps the first screenshot (no previous)", () => {
    expect(tagByDiff(Buffer.alloc(100, 128), null)).toBe("keep");
  });

  it("skips when screenshots are similar", () => {
    const a = Buffer.alloc(1000, 100);
    const b = Buffer.alloc(1000, 100);
    // Change only 5% of bytes — below threshold
    for (let i = 0; i < 50; i++) b[i] = 200;
    expect(tagByDiff(b, a)).toBe("skip");
  });

  it("keeps when screenshots differ significantly", () => {
    const a = Buffer.alloc(1000, 0);
    const b = Buffer.alloc(1000, 0);
    // Change 30% of bytes — above threshold
    for (let i = 0; i < 300; i++) b[i] = 255;
    expect(tagByDiff(b, a)).toBe("keep");
  });
});
```

- [ ] **Step 6: Run all tagger tests**

Run: `cd packages/dashboard && npx vitest run tests/unit/visual/screenshot-tagger.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/visual/screenshot-tagger.ts packages/dashboard/tests/unit/visual/screenshot-tagger.test.ts
git commit -m "feat(dashboard): pixel diff screenshot tagger — fallback for untagged screenshots"
```

---

## Task 5: Asset Serving Route

**Files:**
- Create: `packages/dashboard/src/routes/asset-routes.ts`
- Create: `packages/dashboard/tests/unit/routes/asset-routes.test.ts`
- Modify: `packages/dashboard/src/server.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/dashboard/tests/unit/routes/asset-routes.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { registerAssetRoutes } from "../../../src/routes/asset-routes.js";

describe("asset-routes", () => {
  let fastify: ReturnType<typeof Fastify>;
  let agentDir: string;

  beforeEach(async () => {
    agentDir = mkdtempSync(join(tmpdir(), "asset-routes-"));
    fastify = Fastify();
    fastify.decorate("agentDir", agentDir);
    await registerAssetRoutes(fastify);
  });

  afterEach(async () => {
    await fastify.close();
  });

  it("serves a job screenshot", async () => {
    const dir = join(
      agentDir,
      "automations",
      ".runs",
      "auto-1",
      "job-1",
      "screenshots",
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "ss-123.png"), "fake-png");

    const response = await fastify.inject({
      method: "GET",
      url: "/api/assets/job/auto-1/job-1/screenshots/ss-123.png",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("fake-png");
  });

  it("serves a conversation screenshot", async () => {
    const dir = join(agentDir, "conversations", "conv-1", "screenshots");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "ss-456.png"), "fake-png");

    const response = await fastify.inject({
      method: "GET",
      url: "/api/assets/conversation/conv-1/screenshots/ss-456.png",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("fake-png");
  });

  it("returns 404 for missing screenshot", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/assets/conversation/conv-1/screenshots/nope.png",
    });

    expect(response.statusCode).toBe(404);
  });

  it("rejects path traversal attempts", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/assets/conversation/../../../etc/passwd/screenshots/x.png",
    });

    expect(response.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/unit/routes/asset-routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

```typescript
// packages/dashboard/src/routes/asset-routes.ts
import type { FastifyInstance } from "fastify";
import { join } from "path";
import { createReadStream, existsSync } from "fs";
import { lookup } from "mime-types";

export async function registerAssetRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // Job screenshots: /api/assets/job/:automationId/:jobId/screenshots/:filename
  fastify.get<{
    Params: {
      automationId: string;
      jobId: string;
      filename: string;
    };
  }>(
    "/api/assets/job/:automationId/:jobId/screenshots/:filename",
    async (request, reply) => {
      const { automationId, jobId, filename } = request.params;

      if (hasTraversal(automationId, jobId, filename)) {
        return reply.status(400).send({ error: "Invalid path" });
      }

      const filePath = join(
        fastify.agentDir,
        "automations",
        ".runs",
        automationId,
        jobId,
        "screenshots",
        filename,
      );

      return serveFile(filePath, reply);
    },
  );

  // Conversation screenshots: /api/assets/conversation/:contextId/screenshots/:filename
  fastify.get<{
    Params: {
      contextId: string;
      filename: string;
    };
  }>(
    "/api/assets/conversation/:contextId/screenshots/:filename",
    async (request, reply) => {
      const { contextId, filename } = request.params;

      if (hasTraversal(contextId, filename)) {
        return reply.status(400).send({ error: "Invalid path" });
      }

      const filePath = join(
        fastify.agentDir,
        "conversations",
        contextId,
        "screenshots",
        filename,
      );

      return serveFile(filePath, reply);
    },
  );
}

function hasTraversal(...segments: string[]): boolean {
  return segments.some((s) => s.includes("..") || s.includes("/") || s.includes("\\"));
}

async function serveFile(
  filePath: string,
  reply: import("fastify").FastifyReply,
) {
  if (!existsSync(filePath)) {
    return reply.status(404).send({ error: "Not found" });
  }

  const mimeType = lookup(filePath) || "application/octet-stream";
  return reply.type(mimeType).send(createReadStream(filePath));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/unit/routes/asset-routes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Register the route in server.ts**

In `packages/dashboard/src/server.ts`, add the import near other route imports:

```typescript
import { registerAssetRoutes } from "./routes/asset-routes.js";
```

And in the route registration section (near `registerTimelineRoutes`), add:

```typescript
await registerAssetRoutes(fastify);
```

- [ ] **Step 6: Verify full build compiles**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/routes/asset-routes.ts packages/dashboard/tests/unit/routes/asset-routes.test.ts packages/dashboard/src/server.ts
git commit -m "feat(dashboard): asset serving route for screenshots"
```

---

## Task 6: WebSocket Protocol — ScreenshotSnapshot Type

**Files:**
- Modify: `packages/dashboard/src/ws/protocol.ts`

- [ ] **Step 1: Read the current protocol.ts to find the exact insertion points**

Read `packages/dashboard/src/ws/protocol.ts` — find `JobSnapshot` interface and the `ServerMessage` union type.

- [ ] **Step 2: Add ScreenshotSnapshot interface**

After the `JobSnapshot` interface, add:

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

- [ ] **Step 3: Add state:screenshots to ServerMessage union**

In the `ServerMessage` type union, add:

```typescript
| {
    type: "state:screenshot";
    screenshot: ScreenshotSnapshot;
    timestamp: number;
  }
```

- [ ] **Step 4: Verify types compile**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/ws/protocol.ts
git commit -m "feat(dashboard): add ScreenshotSnapshot to WebSocket protocol"
```

---

## Task 7: StatePublisher — Screenshot Events

**Files:**
- Modify: `packages/dashboard/src/state/state-publisher.ts`

- [ ] **Step 1: Read state-publisher.ts to find exact patterns**

Read the file — find the import section, the class properties, and how other publish methods work (e.g., `publishJobs()`).

- [ ] **Step 2: Add screenshot publishing method**

Import the types at the top of the file:

```typescript
import type { ScreenshotSnapshot } from "../ws/protocol.js";
```

Add a new method to the `StatePublisher` class:

```typescript
publishScreenshot(snapshot: ScreenshotSnapshot): void {
  this.registry.broadcastToAll({
    type: "state:screenshot",
    screenshot: snapshot,
    timestamp: Date.now(),
  });
}
```

Note: No debouncing — screenshots are individual events, not bulk state updates.

- [ ] **Step 3: Verify types compile**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/state/state-publisher.ts
git commit -m "feat(dashboard): StatePublisher.publishScreenshot() — broadcast screenshot events"
```

---

## Task 8: VisualActionService — publish integration

**Files:**
- Modify: `packages/dashboard/src/visual/visual-action-service.ts`
- Modify: `packages/dashboard/tests/unit/visual/visual-action-service.test.ts`

- [ ] **Step 1: Add test for publish callback**

Add to the test file, inside the `describe("VisualActionService")` block:

```typescript
  describe("onScreenshot callback", () => {
    it("fires callback when screenshot is stored", async () => {
      const received: Screenshot[] = [];
      service.onScreenshot((ss) => received.push(ss));

      const context: AssetContext = {
        type: "job",
        id: "job-1",
        automationId: "auto-1",
      };
      await service.store(Buffer.from("data"), {
        context,
        width: 100,
        height: 100,
      });

      expect(received).toHaveLength(1);
      expect(received[0].width).toBe(100);
    });
  });
```

Add the `Screenshot` import at the top:

```typescript
import type { AssetContext, Screenshot } from "@my-agent/core";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/unit/visual/visual-action-service.test.ts`
Expected: FAIL — `onScreenshot` is not a function.

- [ ] **Step 3: Add the callback mechanism**

In `visual-action-service.ts`, add a listeners array and callback method:

```typescript
private listeners: Array<(screenshot: Screenshot) => void> = [];

onScreenshot(callback: (screenshot: Screenshot) => void): void {
  this.listeners.push(callback);
}
```

At the end of the `store()` method, before `return screenshot;`, add:

```typescript
for (const listener of this.listeners) {
  listener(screenshot);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/unit/visual/visual-action-service.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/visual/visual-action-service.ts packages/dashboard/tests/unit/visual/visual-action-service.test.ts
git commit -m "feat(dashboard): VisualActionService.onScreenshot() callback for event publishing"
```

---

## Task 9: Wire VisualActionService into App

**Files:**
- Modify: `packages/dashboard/src/app.ts`

- [ ] **Step 1: Read app.ts to find where services are created and where automation tools are wired**

Read `packages/dashboard/src/app.ts` — find the service instantiation section and the `subscribeToApp` pattern.

- [ ] **Step 2: Add VisualActionService to App**

Import at the top:

```typescript
import { VisualActionService } from "./visual/visual-action-service.js";
```

In the App class, add as a property:

```typescript
readonly visualActionService: VisualActionService;
```

In the constructor or factory method (follow the existing pattern), instantiate:

```typescript
this.visualActionService = new VisualActionService(this.agentDir);
```

Wire the screenshot callback to StatePublisher. Find where `statePublisher.subscribeToApp(app)` is called, and after it, add:

```typescript
this.visualActionService.onScreenshot((screenshot) => {
  if (statePublisher) {
    statePublisher.publishScreenshot({
      id: screenshot.id,
      filename: screenshot.filename,
      url: this.visualActionService.url(screenshot),
      timestamp: screenshot.timestamp,
      contextType: screenshot.context.type,
      contextId: screenshot.context.id,
      automationId: screenshot.context.automationId,
      tag: screenshot.tag,
      description: screenshot.description,
      width: screenshot.width,
      height: screenshot.height,
    });
  }
});
```

- [ ] **Step 3: Verify types compile**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/app.ts
git commit -m "feat(dashboard): wire VisualActionService into App + StatePublisher"
```

---

## Task 10: Frontend — Screenshots Store + WebSocket Handler

**Files:**
- Modify: `packages/dashboard/public/js/stores.js`
- Modify: `packages/dashboard/public/js/ws-client.js`

- [ ] **Step 1: Read stores.js to find the existing store pattern**

Read `packages/dashboard/public/js/stores.js` — find how `Alpine.store("jobs")` is defined.

- [ ] **Step 2: Add screenshots store**

In `stores.js`, add after the jobs store:

```javascript
Alpine.store("screenshots", {
  /** @type {Array<{id: string, filename: string, url: string, timestamp: string, contextType: string, contextId: string, automationId?: string, tag: string, description?: string, width: number, height: number}>} */
  items: [],

  /** Add a new screenshot (from WebSocket event) */
  add(screenshot) {
    this.items.push(screenshot);
  },

  /** Get keep-tagged screenshots for a specific job (default timeline view) */
  forJob(jobId) {
    return this.items.filter(
      (s) => s.contextType === "job" && s.contextId === jobId && s.tag === "keep",
    );
  },

  /** Get ALL screenshots for a specific job (for "show all" expander) */
  allForJob(jobId) {
    return this.items.filter(
      (s) => s.contextType === "job" && s.contextId === jobId,
    );
  },

  /** Get screenshots for a specific conversation (all tags — conversations are interactive) */
  forConversation(conversationId) {
    return this.items.filter(
      (s) => s.contextType === "conversation" && s.contextId === conversationId,
    );
  },
});
```

- [ ] **Step 3: Read ws-client.js to find the message handler switch**

Read `packages/dashboard/public/js/ws-client.js` — find the `switch (data.type)` block.

- [ ] **Step 4: Add state:screenshot handler**

In the switch block, add:

```javascript
case "state:screenshot":
  if (Alpine.store("screenshots")) {
    Alpine.store("screenshots").add(data.screenshot);
  }
  break;
```

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/public/js/stores.js packages/dashboard/public/js/ws-client.js
git commit -m "feat(dashboard): frontend screenshots store + WebSocket handler"
```

---

## Task 11: Frontend — Render Screenshots in Timeline

**Files:**
- Modify: `packages/dashboard/public/js/app.js`

- [ ] **Step 1: Read app.js to find the timeline item rendering**

Read `packages/dashboard/public/js/app.js` — find the `timelineItems` computed property and the HTML template that renders job items.

- [ ] **Step 2: Enhance timeline job items with screenshot thumbnails**

In the `timelineItems` computed getter, where job items are built, add a `screenshots` property:

```javascript
// Inside the job item construction, after the existing properties:
screenshots: Alpine.store("screenshots")?.forJob(job.id) || [],
```

- [ ] **Step 3: Find the timeline HTML template and add screenshot rendering**

In the dashboard HTML (likely `packages/dashboard/public/index.html`), find the timeline item template. Inside the job item rendering, after the summary text, add:

```html
<!-- Screenshot thumbnails (keep-tagged only by default) -->
<template x-if="item.screenshots && item.screenshots.length > 0">
  <div class="mt-2" x-data="{ showAll: false }">
    <div class="flex gap-2 overflow-x-auto">
      <template x-for="ss in (showAll ? $store.screenshots.allForJob(item.job.id) : item.screenshots)" :key="ss.id">
        <img
          :src="ss.url"
          :alt="ss.description || 'Screenshot'"
          :title="ss.description || new Date(ss.timestamp).toLocaleTimeString()"
          class="h-16 rounded border border-white/10 cursor-pointer hover:border-white/30 transition-colors"
          @click="$store.lightbox.open(ss.url, ss.description)"
        />
      </template>
    </div>
    <!-- "Show all" expander when there are more screenshots than the keep-tagged ones -->
    <template x-if="$store.screenshots.allForJob(item.job.id).length > item.screenshots.length">
      <button
        class="text-xs text-white/40 hover:text-white/60 mt-1"
        @click="showAll = !showAll"
        x-text="showAll
          ? 'Show fewer'
          : `Show all ${$store.screenshots.allForJob(item.job.id).length} screenshots`"
      ></button>
    </template>
  </div>
</template>
```

Note: The exact HTML location and class names must match the existing dashboard design language. Read the file first and follow the existing patterns (Tokyo Night colors, glass-strong panels).

- [ ] **Step 4: Restart dashboard and verify visually**

Run: `systemctl --user restart nina-dashboard.service`

Open the dashboard. There won't be screenshots yet, but verify:
- No JavaScript errors in console
- Timeline still renders correctly
- The screenshots store exists: type `Alpine.store("screenshots")` in browser console

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/public/js/app.js packages/dashboard/public/index.html
git commit -m "feat(dashboard): render screenshot thumbnails in job timeline"
```

---

## Task 12: Screenshot Retention Cleanup

**Files:**
- Modify: `packages/dashboard/src/visual/visual-action-service.ts`
- Modify: `packages/dashboard/tests/unit/visual/visual-action-service.test.ts`

- [ ] **Step 1: Write the test**

Add to the test file:

```typescript
  describe("cleanup()", () => {
    it("deletes skip-tagged screenshots older than retention period", async () => {
      const context: AssetContext = {
        type: "job",
        id: "job-1",
        automationId: "auto-1",
      };
      const img = Buffer.from("data");

      // Store two screenshots — one keep, one skip
      const kept = await service.store(img, {
        context,
        description: "kept",
        width: 100,
        height: 100,
      });
      const skipped = await service.store(
        img,
        { context, description: "skipped", width: 100, height: 100 },
        "skip",
      );

      // Run cleanup with 0ms retention (delete all skip immediately)
      const deleted = service.cleanup(context, 0);
      expect(deleted).toBe(1);

      // Kept screenshot still exists
      expect(existsSync(kept.path)).toBe(true);
      // Skipped screenshot is gone
      expect(existsSync(skipped.path)).toBe(false);

      // Index only has the kept entry
      const remaining = service.list(context);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].tag).toBe("keep");
    });

    it("does not delete skip-tagged screenshots within retention period", async () => {
      const context: AssetContext = {
        type: "job",
        id: "job-1",
        automationId: "auto-1",
      };
      const skipped = await service.store(
        Buffer.from("data"),
        { context, width: 100, height: 100 },
        "skip",
      );

      // Retention of 1 hour — screenshot was just created
      const deleted = service.cleanup(context, 60 * 60 * 1000);
      expect(deleted).toBe(0);
      expect(existsSync(skipped.path)).toBe(true);
    });

    it("never deletes screenshots with error/escalation descriptions", async () => {
      const context: AssetContext = {
        type: "job",
        id: "job-1",
        automationId: "auto-1",
      };
      const errorSs = await service.store(
        Buffer.from("data"),
        { context, description: "Error during: click submit", width: 100, height: 100 },
        "skip",
      );

      // 0ms retention — would delete normal skip screenshots
      const deleted = service.cleanup(context, 0);
      expect(deleted).toBe(0);
      expect(existsSync(errorSs.path)).toBe(true);
    });
  });
```

Add `existsSync` to the imports from `fs`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/unit/visual/visual-action-service.test.ts`
Expected: FAIL — `cleanup` is not a function.

- [ ] **Step 3: Implement cleanup**

Add to `VisualActionService`:

```typescript
/**
 * Delete skip-tagged screenshots older than retentionMs.
 * Rewrites the JSONL index to remove deleted entries.
 * Returns the number of files deleted.
 */
cleanup(context: AssetContext, retentionMs: number): number {
  const dir = this.screenshotDir(context);
  const screenshots = this.list(context);
  const now = Date.now();
  let deleted = 0;

  const kept: Screenshot[] = [];
  const protectedDescriptions = /error|escalat/i;
  for (const ss of screenshots) {
    const age = now - new Date(ss.timestamp).getTime();
    const isProtected = ss.description && protectedDescriptions.test(ss.description);
    if (ss.tag === "skip" && age > retentionMs && !isProtected) {
      try {
        unlinkSync(ss.path);
        deleted++;
      } catch {
        // File already gone — still remove from index
        deleted++;
      }
    } else {
      kept.push(ss);
    }
  }

  // Rewrite the index
  const indexPath = join(dir, "screenshots.jsonl");
  if (kept.length === 0) {
    try { unlinkSync(indexPath); } catch { /* noop */ }
  } else {
    writeFileSync(
      indexPath,
      kept.map((s) => JSON.stringify(s)).join("\n") + "\n",
      "utf-8",
    );
  }

  return deleted;
}
```

Add `unlinkSync` to the imports from `fs`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/unit/visual/visual-action-service.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/visual/visual-action-service.ts packages/dashboard/tests/unit/visual/visual-action-service.test.ts
git commit -m "feat(dashboard): screenshot retention cleanup — delete skip-tagged after retention period"
```

---

## Task 13: Full Test Suite Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full dashboard test suite**

Run: `cd packages/dashboard && npx vitest run`
Expected: All tests pass, no regressions.

- [ ] **Step 2: Run TypeScript check**

Run: `cd packages/dashboard && npx tsc --noEmit && cd ../core && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 3: Verify dashboard starts**

Run: `systemctl --user restart nina-dashboard.service && sleep 2 && systemctl --user status nina-dashboard.service`
Expected: Active (running).

---

## Success Criteria

- [ ] VisualActionService stores screenshots to context-appropriate directories
- [ ] JSONL index tracks screenshot metadata including tags
- [ ] Asset serving route returns screenshots via HTTP with path traversal protection
- [ ] WebSocket broadcasts screenshot events to dashboard
- [ ] Frontend stores screenshots and renders thumbnails in job timeline
- [ ] Pixel diff tagger provides fallback for untagged screenshots
- [ ] Retention cleanup deletes skip-tagged screenshots after configured period
- [ ] All existing tests still pass
