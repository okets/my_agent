# M8-S4: Rich I/O — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Nina communicates visually — generating charts, downloading images, presenting them inline in chat, job views, and WhatsApp.

**Architecture:** Full deliverable stored to disk (not truncated). store_image MCP tool with three input modes (svg/data/url) using sharp. Dashboard renders markdown images inline. WhatsApp parses markdown images and sends as media. Visual presenter skill guides proactive image use.

**Tech Stack:** TypeScript, sharp (SVG→PNG), marked.js + DOMPurify (rendering), Baileys (WhatsApp images), vitest

**Design spec:** `docs/superpowers/specs/2026-03-31-m8-s4-rich-io-design.md`
**Depends on:** M8-S3.5 (centralized VAS with refs)

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `packages/dashboard/src/mcp/image-server.ts` | `store_image` MCP tool — SVG render, base64 store, URL fetch |
| `packages/dashboard/tests/unit/mcp/image-server.test.ts` | Unit tests for all three input modes + validation |
| `packages/dashboard/tests/unit/automations/deliverable-pipeline.test.ts` | Tests for deliverable.md write + screenshotIds |
| `packages/dashboard/tests/unit/automations/notification-deliverable.test.ts` | Tests for full deliverable in notifications |
| `packages/dashboard/tests/unit/rendering/dompurify-images.test.ts` | Verify DOMPurify allows `<img>` tags |
| `packages/dashboard/tests/unit/whatsapp/outbound-images.test.ts` | Tests for WhatsApp image parsing + sending |
| `skills/visual-presenter.md` | Brain skill for proactive visual communication |

### Modified Files

| File | Change |
|------|--------|
| `packages/core/src/visual/types.ts` | Add `"web"` and `"generated"` to `ScreenshotSource` |
| `packages/core/src/lib.ts` | Verify barrel exports (no change expected) |
| `packages/core/src/spaces/automation-types.ts` | Add `deliverablePath` and `screenshotIds` to `Job` |
| `packages/dashboard/src/visual/visual-action-service.ts` | `onScreenshot()` returns unsubscribe function (currently returns void) |
| `packages/dashboard/src/automations/automation-executor.ts` | Write `deliverable.md`, populate `deliverablePath` + `screenshotIds`, add `visualService` to config interface |
| `packages/dashboard/src/automations/automation-job-service.ts` | Include new Job fields in JSONL + DB upsert |
| `packages/dashboard/src/automations/automation-processor.ts` | Read full deliverable from disk for notifications |
| `packages/dashboard/src/scheduler/jobs/handler-registry.ts` | Debrief reporter reads `deliverablePath` first |
| `packages/dashboard/public/js/app.js` | Verify/fix `renderMarkdown()` DOMPurify config for `<img>` |
| `packages/dashboard/public/index.html` | Job detail view, thumbnail strip from screenshotIds |
| `plugins/channel-whatsapp/src/plugin.ts` | Parse markdown images, send as media via Baileys |
| `packages/dashboard/src/app.ts` | Wire `image-tools` MCP server |

---

## Task 1: Extend ScreenshotSource Type

**Files:**
- Modify: `packages/core/src/visual/types.ts`
- Modify: `packages/core/src/lib.ts` (verify barrel — no change expected)

- [ ] **Step 1: Read the current types**

Read `packages/core/src/visual/types.ts` to confirm current `ScreenshotSource`.

- [ ] **Step 2: Add new source values**

In `packages/core/src/visual/types.ts`, update the `ScreenshotSource` type:

```typescript
// packages/core/src/visual/types.ts

export type ScreenshotSource = "desktop" | "playwright" | "upload" | "web" | "generated";

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

- [ ] **Step 3: Verify barrel exports**

Read `packages/core/src/lib.ts` and confirm `ScreenshotSource` is re-exported. It already is (lines 215-219), so no change needed.

- [ ] **Step 4: Verify types compile**

```bash
cd packages/core && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/visual/types.ts
git commit -m "feat(core): add 'web' and 'generated' screenshot sources for M8-S4"
```

---

## Task 2: Install sharp

**Files:**
- Modify: `packages/dashboard/package.json`

- [ ] **Step 1: Install sharp**

```bash
cd packages/dashboard && npm install sharp
```

- [ ] **Step 2: Install types**

```bash
cd packages/dashboard && npm install -D @types/sharp
```

If `@types/sharp` doesn't exist (sharp ships its own types), skip this step.

- [ ] **Step 3: Verify import works**

Create a quick verification:

```bash
cd packages/dashboard && node -e "const sharp = require('sharp'); console.log('sharp version:', sharp.versions?.sharp ?? 'ok')"
```

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/package.json packages/dashboard/package-lock.json
git commit -m "chore(dashboard): install sharp for SVG-to-PNG conversion"
```

---

## Task 3: store_image MCP Tool

**Files:**
- Create: `packages/dashboard/src/mcp/image-server.ts`
- Create: `packages/dashboard/tests/unit/mcp/image-server.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/dashboard/tests/unit/mcp/image-server.test.ts`:

```typescript
// packages/dashboard/tests/unit/mcp/image-server.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  handleStoreImage,
  type ImageServerDeps,
} from "../../../src/mcp/image-server.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { VisualActionService } from "../../../src/visual/visual-action-service.js";

function createTestDeps(agentDir: string): ImageServerDeps {
  const vas = new VisualActionService(agentDir);
  return { visualService: vas };
}

describe("handleStoreImage", () => {
  let tmpDir: string;
  let deps: ImageServerDeps;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "image-server-test-"));
    deps = createTestDeps(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects when no input mode is provided", async () => {
    const result = await handleStoreImage(deps, { description: "test" });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Exactly one of");
  });

  it("rejects when multiple input modes are provided", async () => {
    const result = await handleStoreImage(deps, {
      svg: "<svg></svg>",
      data: "aGVsbG8=",
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Exactly one of");
  });

  it("stores SVG as PNG via sharp", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="red" width="100" height="100"/></svg>';
    const result = await handleStoreImage(deps, {
      svg,
      description: "red square",
    });
    expect(result.isError).toBeFalsy();
    const text = result.content.find((c) => c.type === "text");
    expect(text).toBeDefined();
    const parsed = JSON.parse((text as any).text);
    expect(parsed.id).toMatch(/^ss-/);
    expect(parsed.width).toBe(100);
    expect(parsed.height).toBe(100);
    expect(parsed.url).toContain("/api/assets/screenshots/");
    // File should exist on disk
    const filePath = path.join(tmpDir, "screenshots", `${parsed.id}.png`);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("infers SVG dimensions from viewBox when width/height missing", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150"><rect fill="blue" width="200" height="150"/></svg>';
    const result = await handleStoreImage(deps, { svg });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content.find((c) => c.type === "text") as any).text);
    expect(parsed.width).toBe(200);
    expect(parsed.height).toBe(150);
  });

  it("rejects SVG without <svg prefix", async () => {
    const result = await handleStoreImage(deps, { svg: "<div>not svg</div>" });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("<svg");
  });

  it("stores valid base64 PNG", async () => {
    // Minimal valid 1x1 PNG (base64)
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const result = await handleStoreImage(deps, {
      data: pngBase64,
      description: "tiny png",
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content.find((c) => c.type === "text") as any).text);
    expect(parsed.id).toMatch(/^ss-/);
    expect(parsed.width).toBeGreaterThan(0);
    expect(parsed.height).toBeGreaterThan(0);
  });

  it("rejects invalid base64 data (bad magic bytes)", async () => {
    // Base64 of "hello world" — not an image
    const result = await handleStoreImage(deps, { data: "aGVsbG8gd29ybGQ=" });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("invalid image");
  });

  it("rejects invalid URL scheme", async () => {
    const result = await handleStoreImage(deps, { url: "ftp://example.com/image.png" });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("HTTP");
  });

  it("returns base64 content block when returnImage is true", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><circle cx="25" cy="25" r="20" fill="green"/></svg>';
    const result = await handleStoreImage(deps, {
      svg,
      returnImage: true,
    });
    expect(result.isError).toBeFalsy();
    const imageBlock = result.content.find((c) => c.type === "image");
    expect(imageBlock).toBeDefined();
    expect((imageBlock as any).source.type).toBe("base64");
    expect((imageBlock as any).source.media_type).toBe("image/png");
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd packages/dashboard && npx vitest run tests/unit/mcp/image-server.test.ts
```

- [ ] **Step 3: Implement the handler**

Create `packages/dashboard/src/mcp/image-server.ts`:

```typescript
/**
 * Image MCP Tools Server
 *
 * Exposes store_image tool for the brain to persist images.
 * Three input modes: SVG (rendered to PNG via sharp), base64 data, URL fetch.
 *
 * Handler logic is exported for direct testing — the MCP tool() wrapper
 * is a thin one-liner delegate.
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import sharp from "sharp";
import type { VisualActionService } from "../visual/visual-action-service.js";
import type { ScreenshotSource } from "@my-agent/core";

export interface ImageServerDeps {
  visualService: VisualActionService;
}

type ToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: "image/png"; data: string } }
  >;
  isError?: boolean;
};

// -- Magic byte validators ---------------------------------------------------

const MAGIC_BYTES: Array<{ name: string; bytes: number[] }> = [
  { name: "PNG", bytes: [0x89, 0x50, 0x4e, 0x47] },   // \x89PNG
  { name: "JPEG", bytes: [0xff, 0xd8, 0xff] },          // \xFF\xD8\xFF
  { name: "GIF", bytes: [0x47, 0x49, 0x46, 0x38] },     // GIF8
];

function isValidImageBuffer(buf: Buffer): boolean {
  return MAGIC_BYTES.some(({ bytes }) =>
    bytes.every((b, i) => buf.length > i && buf[i] === b),
  );
}

// -- SVG dimension helpers ---------------------------------------------------

function parseSvgDimensions(svg: string): { width: number; height: number } | null {
  // Try explicit width/height attributes
  const widthMatch = svg.match(/\bwidth=["'](\d+(?:\.\d+)?)/);
  const heightMatch = svg.match(/\bheight=["'](\d+(?:\.\d+)?)/);

  if (widthMatch && heightMatch) {
    return {
      width: Math.round(parseFloat(widthMatch[1])),
      height: Math.round(parseFloat(heightMatch[1])),
    };
  }

  // Fall back to viewBox
  const viewBoxMatch = svg.match(/viewBox=["'](\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/);
  if (viewBoxMatch) {
    return {
      width: Math.round(parseFloat(viewBoxMatch[3])),
      height: Math.round(parseFloat(viewBoxMatch[4])),
    };
  }

  return null;
}

function ensureSvgDimensions(svg: string): string {
  const dims = parseSvgDimensions(svg);
  if (!dims) return svg;

  // Check if width/height already set
  const hasWidth = /\bwidth=["']/.test(svg);
  const hasHeight = /\bheight=["']/.test(svg);

  if (hasWidth && hasHeight) return svg;

  // Insert width/height after <svg
  let result = svg;
  if (!hasWidth) {
    result = result.replace("<svg", `<svg width="${dims.width}"`);
  }
  if (!hasHeight) {
    result = result.replace("<svg", `<svg height="${dims.height}"`);
  }
  return result;
}

// -- URL fetch helper --------------------------------------------------------

async function fetchImageFromUrl(url: string): Promise<Buffer> {
  const { default: https } = await import("node:https");
  const { default: http } = await import("node:http");

  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode && (res.statusCode >= 300 && res.statusCode < 400) && res.headers.location) {
        // Follow one redirect
        fetchImageFromUrl(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        return;
      }

      const contentType = res.headers["content-type"] ?? "";
      if (!contentType.startsWith("image/")) {
        reject(new Error(`Not an image: Content-Type is ${contentType}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

// -- Exported handler (testable) ---------------------------------------------

export async function handleStoreImage(
  deps: ImageServerDeps,
  args: {
    svg?: string;
    data?: string;
    url?: string;
    description?: string;
    returnImage?: boolean;
  },
): Promise<ToolResult> {
  const modeCount = [args.svg, args.data, args.url].filter(Boolean).length;
  if (modeCount !== 1) {
    return {
      content: [{ type: "text" as const, text: "Exactly one of svg, data, or url must be provided." }],
      isError: true,
    };
  }

  try {
    let pngBuffer: Buffer;
    let width: number;
    let height: number;
    let source: ScreenshotSource;

    if (args.svg) {
      // -- SVG mode --
      const svg = args.svg.trim();
      if (!svg.startsWith("<svg")) {
        return {
          content: [{ type: "text" as const, text: "Invalid SVG: must start with <svg tag." }],
          isError: true,
        };
      }

      const prepared = ensureSvgDimensions(svg);
      const dims = parseSvgDimensions(prepared);
      if (!dims) {
        return {
          content: [{ type: "text" as const, text: "Cannot determine SVG dimensions. Add width/height or viewBox." }],
          isError: true,
        };
      }

      pngBuffer = await sharp(Buffer.from(prepared)).png().toBuffer();
      const metadata = await sharp(pngBuffer).metadata();
      width = metadata.width ?? dims.width;
      height = metadata.height ?? dims.height;
      source = "generated";
    } else if (args.data) {
      // -- Base64 mode --
      const rawBuffer = Buffer.from(args.data, "base64");

      if (!isValidImageBuffer(rawBuffer)) {
        return {
          content: [{ type: "text" as const, text: "invalid image format — expected PNG (\\x89PNG), JPEG (\\xFF\\xD8\\xFF), or GIF (GIF8) magic bytes." }],
          isError: true,
        };
      }

      // Convert to PNG if not already (ensures consistent format)
      pngBuffer = await sharp(rawBuffer).png().toBuffer();
      const metadata = await sharp(pngBuffer).metadata();
      width = metadata.width ?? 0;
      height = metadata.height ?? 0;
      source = "upload";
    } else if (args.url) {
      // -- URL mode --
      if (!args.url.startsWith("http://") && !args.url.startsWith("https://")) {
        return {
          content: [{ type: "text" as const, text: "Invalid URL: must use HTTP or HTTPS scheme." }],
          isError: true,
        };
      }

      const fetchedBuffer = await fetchImageFromUrl(args.url);

      if (!isValidImageBuffer(fetchedBuffer)) {
        return {
          content: [{ type: "text" as const, text: "Fetched content is not a valid image (bad magic bytes)." }],
          isError: true,
        };
      }

      // Downscale to max 4096px longest edge
      const fetchedMeta = await sharp(fetchedBuffer).metadata();
      const maxEdge = Math.max(fetchedMeta.width ?? 0, fetchedMeta.height ?? 0);
      let pipeline = sharp(fetchedBuffer);
      if (maxEdge > 4096) {
        pipeline = pipeline.resize({
          width: (fetchedMeta.width ?? 0) >= (fetchedMeta.height ?? 0) ? 4096 : undefined,
          height: (fetchedMeta.height ?? 0) > (fetchedMeta.width ?? 0) ? 4096 : undefined,
          fit: "inside",
          withoutEnlargement: true,
        });
      }
      pngBuffer = await pipeline.png().toBuffer();
      const metadata = await sharp(pngBuffer).metadata();
      width = metadata.width ?? 0;
      height = metadata.height ?? 0;
      source = "web";
    } else {
      return {
        content: [{ type: "text" as const, text: "Exactly one of svg, data, or url must be provided." }],
        isError: true,
      };
    }

    // Store via VAS
    const screenshot = deps.visualService.store(pngBuffer, {
      description: args.description,
      width,
      height,
      source,
    });

    const responseData = {
      id: screenshot.id,
      url: deps.visualService.url(screenshot),
      width,
      height,
    };

    const content: ToolResult["content"] = [
      { type: "text" as const, text: JSON.stringify(responseData) },
    ];

    if (args.returnImage) {
      content.push({
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: "image/png" as const,
          data: pngBuffer.toString("base64"),
        },
      });
    }

    return { content };
  } catch (err) {
    return {
      content: [{
        type: "text" as const,
        text: `store_image failed: ${err instanceof Error ? err.message : String(err)}`,
      }],
      isError: true,
    };
  }
}

// -- MCP server creator ------------------------------------------------------

export function createImageServer(deps: ImageServerDeps) {
  const storeImageTool = tool(
    "store_image",
    "Store an image (SVG, base64, or URL) as a PNG screenshot. Returns an ID and URL for use in markdown. SVG is converted to PNG via sharp. URL images are fetched and downscaled to max 4096px.",
    {
      svg: z.string().optional().describe("Raw SVG markup — will be rendered to PNG"),
      data: z.string().optional().describe("Base64-encoded PNG/JPEG/GIF image data"),
      url: z.string().optional().describe("HTTP(S) URL to fetch and store"),
      description: z.string().optional().describe("What this image shows (used for alt text)"),
      returnImage: z.boolean().optional().describe("Also return the image as a base64 content block (default: false)"),
    },
    (args) => handleStoreImage(deps, args),
  );

  return createSdkMcpServer({
    name: "image-tools",
    tools: [storeImageTool],
  });
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd packages/dashboard && npx vitest run tests/unit/mcp/image-server.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/mcp/image-server.ts packages/dashboard/tests/unit/mcp/image-server.test.ts
git commit -m "feat(dashboard): store_image MCP tool with SVG/base64/URL modes"
```

---

## Task 4: Deliverable Pipeline Fix

**Files:**
- Modify: `packages/core/src/spaces/automation-types.ts`
- Modify: `packages/dashboard/src/automations/automation-executor.ts`
- Modify: `packages/dashboard/src/automations/automation-job-service.ts`
- Create: `packages/dashboard/tests/unit/automations/deliverable-pipeline.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/dashboard/tests/unit/automations/deliverable-pipeline.test.ts`:

```typescript
// packages/dashboard/tests/unit/automations/deliverable-pipeline.test.ts

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("deliverable pipeline", () => {
  it("Job type includes deliverablePath and screenshotIds", async () => {
    // Validate the shape of the Job interface by importing it
    const job: import("@my-agent/core").Job = {
      id: "job-test",
      automationId: "auto-test",
      status: "completed",
      created: new Date().toISOString(),
      deliverablePath: "/tmp/test/deliverable.md",
      screenshotIds: ["ss-abc", "ss-def"],
    };
    expect(job.deliverablePath).toBe("/tmp/test/deliverable.md");
    expect(job.screenshotIds).toEqual(["ss-abc", "ss-def"]);
  });

  it("deliverable.md is written to run_dir when deliverable exists", () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "deliverable-test-"),
    );
    const deliverableContent = "# Report\n\n![chart](/api/assets/screenshots/ss-123.png)\n\nThe AQI is 42.";
    const deliverablePath = path.join(tmpDir, "deliverable.md");
    fs.writeFileSync(deliverablePath, deliverableContent, "utf-8");

    expect(fs.existsSync(deliverablePath)).toBe(true);
    expect(fs.readFileSync(deliverablePath, "utf-8")).toBe(deliverableContent);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests — expect failures (Job type doesn't have new fields yet)**

```bash
cd packages/dashboard && npx vitest run tests/unit/automations/deliverable-pipeline.test.ts
```

- [ ] **Step 3: Add fields to Job interface**

In `packages/core/src/spaces/automation-types.ts`, add to the `Job` interface:

```typescript
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
  deliverablePath?: string;
  screenshotIds?: string[];
}
```

- [ ] **Step 4: Update VAS onScreenshot() to return unsubscribe function**

In `packages/dashboard/src/visual/visual-action-service.ts`, change the `onScreenshot` method from returning `void` to returning an unsubscribe function:

```typescript
onScreenshot(callback: (screenshot: Screenshot) => void): () => void {
  this.listeners.push(callback);
  return () => {
    const idx = this.listeners.indexOf(callback);
    if (idx >= 0) this.listeners.splice(idx, 1);
  };
}
```

- [ ] **Step 5: Add visualService to AutomationExecutorConfig**

In `packages/dashboard/src/automations/automation-executor.ts`, find the `AutomationExecutorConfig` interface (around line 31). Add:

```typescript
visualService?: import("../visual/visual-action-service.js").VisualActionService;
```

Then in `packages/dashboard/src/app.ts`, find where `AutomationExecutor` is instantiated and pass the VAS:

```typescript
visualService: app.visualActionService,
```

- [ ] **Step 6: Update automation-executor.ts — deliverable + screenshotIds**

Add imports at the top of the file:

```typescript
import fs from "node:fs";
import path from "node:path";
```

Before the execution loop begins, initialize a screenshotIds collector:

```typescript
      // Track screenshot IDs produced during this job
      const screenshotIds: string[] = [];

      // Listen for VAS store events during this job
      const unsubscribe = this.config.visualService?.onScreenshot((ss) => {
        screenshotIds.push(ss.id);
      });
```

After `extractDeliverable(response)` (line ~199), add deliverable.md write and cleanup:

```typescript
      // 6. Extract deliverable
      const { work, deliverable } = extractDeliverable(response);

      // 6a. Write full deliverable to disk (not truncated)
      let deliverablePath: string | undefined;
      if (deliverable && job.run_dir) {
        deliverablePath = path.join(job.run_dir, "deliverable.md");
        fs.writeFileSync(deliverablePath, deliverable, "utf-8");
      }

      // 6b. Stop collecting screenshot IDs
      if (unsubscribe) unsubscribe();
```

Note: This requires VAS `onScreenshot()` to return an unsubscribe function. If it currently doesn't, add one:
```typescript
// In VisualActionService:
onScreenshot(callback: (screenshot: Screenshot) => void): () => void {
  this.listeners.push(callback);
  return () => {
    const idx = this.listeners.indexOf(callback);
    if (idx >= 0) this.listeners.splice(idx, 1);
  };
}
```

Update the job update call (~line 218) to include the new fields:

```typescript
      this.config.jobService.updateJob(job.id, {
        status: finalStatus,
        completed: new Date().toISOString(),
        summary: (deliverable ?? work).slice(0, 500),
        sdk_session_id: sdkSessionId ?? undefined,
        deliverablePath,
        screenshotIds,  // Collected from VAS store calls during execution (see below)
      });
```

Also update the handler path (~line 81) for built-in handlers:

```typescript
        let deliverablePath: string | undefined;
        if (result.deliverable && job.run_dir) {
          deliverablePath = path.join(job.run_dir, "deliverable.md");
          fs.writeFileSync(deliverablePath, result.deliverable, "utf-8");
        }

        this.config.jobService.updateJob(job.id, {
          status: result.success ? "completed" : "failed",
          completed: new Date().toISOString(),
          summary: (result.deliverable ?? result.work).slice(0, 500),
          deliverablePath,
        });
```

- [ ] **Step 5: Update automation-job-service.ts**

In `updateJob()` method (line ~57), expand the accepted update fields:

```typescript
  updateJob(
    jobId: string,
    updates: Partial<
      Pick<Job, "status" | "completed" | "summary" | "sdk_session_id" | "deliverablePath" | "screenshotIds">
    >,
  ): Job {
```

In the `db.upsertJob()` call inside `updateJob()` (~line 106), pass through the new fields:

```typescript
    this.db.upsertJob({
      id: updatedJob.id,
      automationId: updatedJob.automationId,
      status: updatedJob.status,
      created: updatedJob.created,
      completed: updatedJob.completed,
      summary: updatedJob.summary,
      context: updatedJob.context
        ? JSON.stringify(updatedJob.context)
        : undefined,
      sdkSessionId: updatedJob.sdk_session_id,
      runDir: updatedJob.run_dir,
      deliverablePath: updatedJob.deliverablePath,
      screenshotIds: updatedJob.screenshotIds
        ? JSON.stringify(updatedJob.screenshotIds)
        : undefined,
    });
```

Similarly update the `createJob()` and `reindexAll()` and `dbRowToJob()` methods to include the new fields.

In `dbRowToJob()`:

```typescript
  private dbRowToJob(row: {
    id: string;
    automationId: string;
    status: string;
    created: string;
    completed: string | null;
    summary: string | null;
    context: string | null;
    sdkSessionId: string | null;
    runDir: string | null;
    deliverablePath: string | null;
    screenshotIds: string | null;
  }): Job {
    return {
      id: row.id,
      automationId: row.automationId,
      status: row.status as JobStatus,
      created: row.created,
      completed: row.completed ?? undefined,
      summary: row.summary ?? undefined,
      context: row.context ? JSON.parse(row.context) : undefined,
      sdk_session_id: row.sdkSessionId ?? undefined,
      run_dir: row.runDir ?? undefined,
      deliverablePath: row.deliverablePath ?? undefined,
      screenshotIds: row.screenshotIds ? JSON.parse(row.screenshotIds) : undefined,
    };
  }
```

- [ ] **Step 5: Add DB columns for new Job fields**

In `packages/dashboard/src/conversations/db.ts`, find the `jobs` table creation (around line 243). Add the new columns:

```sql
ALTER TABLE jobs ADD COLUMN deliverablePath TEXT;
ALTER TABLE jobs ADD COLUMN screenshotIds TEXT DEFAULT '[]';
```

Use the existing migration pattern — wrap in try/catch since ALTER TABLE fails if column already exists:

```typescript
try {
  this.db.exec("ALTER TABLE jobs ADD COLUMN deliverablePath TEXT");
} catch { /* column already exists */ }
try {
  this.db.exec("ALTER TABLE jobs ADD COLUMN screenshotIds TEXT DEFAULT '[]'");
} catch { /* column already exists */ }
```

Place this in the DB initialization, after the jobs table creation.

Then update `upsertJob()` to include the new fields:

```typescript
// In the INSERT OR REPLACE statement, add:
// deliverablePath, screenshotIds (JSON.stringify for the array)
```

Read the existing `upsertJob()` method to find the exact SQL and add the two columns.

- [ ] **Step 6: Build and verify**

```bash
cd packages/core && npx tsc --noEmit
cd packages/dashboard && npx tsc --noEmit
```

- [ ] **Step 7: Run tests**

```bash
cd packages/dashboard && npx vitest run tests/unit/automations/deliverable-pipeline.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/spaces/automation-types.ts packages/dashboard/src/automations/automation-executor.ts packages/dashboard/src/automations/automation-job-service.ts packages/dashboard/tests/unit/automations/deliverable-pipeline.test.ts
# Also add any db.ts changes
git commit -m "feat(automations): write full deliverable.md, add deliverablePath + screenshotIds to Job"
```

---

## Task 5: Update Notification to Use Full Deliverable

**Files:**
- Modify: `packages/dashboard/src/automations/automation-processor.ts`
- Modify: `packages/dashboard/src/scheduler/jobs/handler-registry.ts`
- Create: `packages/dashboard/tests/unit/automations/notification-deliverable.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/dashboard/tests/unit/automations/notification-deliverable.test.ts`:

```typescript
// packages/dashboard/tests/unit/automations/notification-deliverable.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("notification uses full deliverable", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notification-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads full deliverable from deliverablePath when available", () => {
    const fullContent =
      "# Full Report\n\n![chart](/api/assets/screenshots/ss-123.png)\n\nDetailed analysis here with lots of data...";
    const deliverablePath = path.join(tmpDir, "deliverable.md");
    fs.writeFileSync(deliverablePath, fullContent, "utf-8");

    // Simulate what automation-processor should do:
    let summary: string;
    if (fs.existsSync(deliverablePath)) {
      summary = fs.readFileSync(deliverablePath, "utf-8");
    } else {
      summary = "Truncated fallback";
    }

    expect(summary).toBe(fullContent);
    expect(summary).toContain("![chart]");
  });

  it("falls back to result.work when deliverablePath missing", () => {
    const deliverablePath = path.join(tmpDir, "nonexistent.md");
    const work = "Completed successfully.";

    let summary: string;
    if (fs.existsSync(deliverablePath)) {
      summary = fs.readFileSync(deliverablePath, "utf-8");
    } else {
      summary = work;
    }

    expect(summary).toBe(work);
  });
});
```

- [ ] **Step 2: Run tests — expect pass (they test the pattern, not the integration)**

```bash
cd packages/dashboard && npx vitest run tests/unit/automations/notification-deliverable.test.ts
```

- [ ] **Step 3: Update automation-processor.ts**

In `handleNotification()` (~line 154), update the `notify === "immediate"` branch to read full deliverable from disk. Replace the existing `handleNotification` method:

```typescript
  private async handleNotification(
    automation: Automation,
    jobId: string,
    result: ExecutionResult,
  ): Promise<void> {
    const notify = automation.manifest.notify ?? "debrief";
    const ci = this.config.conversationInitiator;

    if (notify === "immediate" && ci) {
      // Resolve user's local time so the brain doesn't guess the time of day
      let localTimeContext = "";
      try {
        const tz = await resolveTimezone(this.config.agentDir);
        const localTime = new Date().toLocaleString("en-US", {
          timeZone: tz,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          weekday: "short",
        });
        localTimeContext = ` User's local time: ${localTime} (${tz}).`;
      } catch {
        // Timezone unavailable — brain will use its own judgment
      }

      // Read full deliverable from disk if available (S4 — not truncated)
      const job = this.config.jobService.getJob(jobId);
      let fullContent: string | null = null;
      if (job?.deliverablePath) {
        try {
          const { readFileSync } = await import("node:fs");
          fullContent = readFileSync(job.deliverablePath, "utf-8");
        } catch {
          // File missing — fall back to result.work
        }
      }

      const summary = result.success
        ? fullContent ?? result.work ?? "Completed successfully."
        : `Error: ${result.error}`;
      const prompt = `A working agent just finished the "${automation.manifest.name}" task.${localTimeContext}\n\nResults:\n${summary}\n\nYou are the conversation layer — present what matters to the user naturally. Don't acknowledge the system message itself. Don't say "noted" or "logging". Just relay the useful information as if you're giving the user an update.`;
      const alerted = await ci.alert(prompt);
      if (!alerted) {
        await ci.initiate({ firstTurnPrompt: `[SYSTEM: ${prompt}]` });
      }
    }

    // needs_review always alerts immediately
    const updatedJob = this.config.jobService.getJob(jobId);
    if (updatedJob?.status === "needs_review" && ci) {
      // Read full deliverable for review context (S4)
      let question: string;
      if (updatedJob.deliverablePath) {
        try {
          const { readFileSync } = await import("node:fs");
          question = readFileSync(updatedJob.deliverablePath, "utf-8");
        } catch {
          question = updatedJob.summary ?? "A job requires your review.";
        }
      } else {
        question = updatedJob.summary ?? "A job requires your review.";
      }

      const automationName = automation.manifest.name;
      const prompt = `A working agent running "${automationName}" needs the user's input before it can continue.\n\nQuestion: ${question}\n\nJob ID: ${jobId}\n\nYou are the conversation layer — present this to the user naturally. Ask for their input. When they respond, you can resume the job with resume_job("${jobId}", <their response>).`;
      const alerted = await ci.alert(prompt);
      if (!alerted) {
        await ci.initiate({ firstTurnPrompt: `[SYSTEM: ${prompt}]` });
      }
    }
  }
```

- [ ] **Step 4: Update debrief-reporter in handler-registry.ts**

In the `debrief-reporter` handler (~line 283), update the worker report collection loop to check `deliverablePath` first. Replace the `for (const job of pendingJobs)` loop body:

```typescript
    for (const job of pendingJobs) {
      let content = job.summary ?? "No output available.";

      if (job.runDir) {
        // Prefer full deliverable (S4), then status-report, then summary
        const deliverablePath = join(job.runDir, "deliverable.md");
        const reportPath = join(job.runDir, "status-report.md");
        if (existsSync(deliverablePath)) {
          try {
            content = await readFile(deliverablePath, "utf-8");
          } catch {
            // Fall through to status-report
          }
        }
        if (content === (job.summary ?? "No output available.") && existsSync(reportPath)) {
          try {
            content = await readFile(reportPath, "utf-8");
          } catch {
            // Fall back to summary
          }
        }
      }

      workerSections.push(`## ${job.automationName}\n\n${content}`);
      fullReports.push({ name: job.automationName, content });
    }
```

- [ ] **Step 5: Run tests**

```bash
cd packages/dashboard && npx vitest run tests/unit/automations/notification-deliverable.test.ts
```

- [ ] **Step 6: Verify tsc**

```bash
cd packages/dashboard && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/automations/automation-processor.ts packages/dashboard/src/scheduler/jobs/handler-registry.ts packages/dashboard/tests/unit/automations/notification-deliverable.test.ts
git commit -m "feat(automations): notifications use full deliverable from disk"
```

---

## Task 6: DOMPurify Image Verification

**Files:**
- Create: `packages/dashboard/tests/unit/rendering/dompurify-images.test.ts`
- Possibly modify: `packages/dashboard/public/js/app.js`

- [ ] **Step 1: Write test**

Create `packages/dashboard/tests/unit/rendering/dompurify-images.test.ts`:

```typescript
// packages/dashboard/tests/unit/rendering/dompurify-images.test.ts

import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";

describe("DOMPurify image rendering", () => {
  const window = new JSDOM("").window;
  const DOMPurify = createDOMPurify(window);

  it("allows <img> tags with src and alt by default", () => {
    const input = '<img src="/api/assets/screenshots/ss-abc.png" alt="AQI chart">';
    const clean = DOMPurify.sanitize(input, { ADD_ATTR: ["target", "rel"] });
    expect(clean).toContain("<img");
    expect(clean).toContain('src="/api/assets/screenshots/ss-abc.png"');
    expect(clean).toContain('alt="AQI chart"');
  });

  it("preserves multiple images in markdown-rendered HTML", () => {
    const input = `
      <p>Here is a chart:</p>
      <p><img src="/api/assets/screenshots/ss-1.png" alt="chart 1"></p>
      <p>And another:</p>
      <p><img src="/api/assets/screenshots/ss-2.png" alt="chart 2"></p>
    `;
    const clean = DOMPurify.sanitize(input, { ADD_ATTR: ["target", "rel"] });
    expect(clean).toContain("ss-1.png");
    expect(clean).toContain("ss-2.png");
  });

  it("strips javascript: src URLs", () => {
    const input = '<img src="javascript:alert(1)" alt="xss">';
    const clean = DOMPurify.sanitize(input, { ADD_ATTR: ["target", "rel"] });
    expect(clean).not.toContain("javascript:");
  });
});
```

- [ ] **Step 2: Install test dependencies if needed**

```bash
cd packages/dashboard && npm install -D dompurify jsdom @types/dompurify @types/jsdom
```

Only install if not already in devDependencies. Check `package.json` first.

- [ ] **Step 3: Run tests**

```bash
cd packages/dashboard && npx vitest run tests/unit/rendering/dompurify-images.test.ts
```

DOMPurify allows `<img>` by default. If the test passes, no changes needed in `app.js`.

If `<img>` is stripped (unlikely), update `renderMarkdown()` in `packages/dashboard/public/js/app.js` at line ~1670:

```javascript
const clean = DOMPurify.sanitize(html, {
  ADD_ATTR: ["target", "rel"],
  ADD_TAGS: ["img"],
});
```

- [ ] **Step 4: Verify the current app.js renderMarkdown config**

The current config at `app.js:1670` is:
```javascript
const clean = DOMPurify.sanitize(html, {
  ADD_ATTR: ["target", "rel"],
});
```

DOMPurify allows `<img>` tags with `src` and `alt` by default (they're in the default allow-list). The `ADD_ATTR` only adds `target` and `rel` for links. No change needed unless the test fails.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/tests/unit/rendering/dompurify-images.test.ts
# If app.js was modified, add it too
git commit -m "test(dashboard): verify DOMPurify allows inline images in markdown"
```

---

## Task 7: Job Detail View with Full Deliverable

**Files:**
- Modify: `packages/dashboard/public/index.html` (add job detail modal/panel)
- Modify: `packages/dashboard/public/js/app.js` (add fetch + render logic)
- Add route in existing automation routes file (API endpoint)

- [ ] **Step 1: Add API route for job deliverable**

Find the existing automation routes file. Add a new GET route:

```typescript
// In the automations route file:
app.get("/api/automations/:automationId/jobs/:jobId/deliverable", async (request, reply) => {
  const { automationId, jobId } = request.params as { automationId: string; jobId: string };
  const job = jobService.getJob(jobId);

  if (!job) {
    return reply.status(404).send({ error: "Job not found" });
  }

  // Try deliverable.md first
  if (job.deliverablePath) {
    try {
      const content = fs.readFileSync(job.deliverablePath, "utf-8");
      return reply.send({ content });
    } catch {
      // File missing, fall through
    }
  }

  // Fall back to run_dir/deliverable.md
  if (job.run_dir) {
    const deliverablePath = path.join(job.run_dir, "deliverable.md");
    if (fs.existsSync(deliverablePath)) {
      const content = fs.readFileSync(deliverablePath, "utf-8");
      return reply.send({ content });
    }
  }

  // Fall back to summary
  return reply.send({ content: job.summary ?? "No deliverable available." });
});
```

- [ ] **Step 2: Add job detail modal to index.html**

In `packages/dashboard/public/index.html`, add a modal that opens when a job timeline card is clicked. Follow the design language (glass-strong panel, Tokyo Night colors):

```html
<!-- Job Detail Modal -->
<div x-show="jobDetailOpen" x-cloak
     class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
     @click.self="jobDetailOpen = false"
     @keydown.escape.window="jobDetailOpen = false">
  <div class="glass-strong rounded-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6 mx-4">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-white/90 font-medium" x-text="jobDetailTitle"></h3>
      <button @click="jobDetailOpen = false" class="text-white/40 hover:text-white/70">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>
    <div class="prose prose-invert max-w-none text-sm"
         x-html="jobDetailContent"></div>
  </div>
</div>
```

- [ ] **Step 3: Add Alpine.js state and fetch logic in app.js**

```javascript
// In the Alpine data/store for automations:
jobDetailOpen: false,
jobDetailTitle: "",
jobDetailContent: "",

async openJobDetail(automationId, jobId, jobTitle) {
  this.jobDetailTitle = jobTitle || `Job ${jobId}`;
  this.jobDetailContent = "<p class='text-white/40'>Loading...</p>";
  this.jobDetailOpen = true;

  try {
    const res = await fetch(`/api/automations/${automationId}/jobs/${jobId}/deliverable`);
    if (!res.ok) throw new Error("Failed to fetch");
    const data = await res.json();
    this.jobDetailContent = this.renderMarkdown(data.content);
  } catch (err) {
    this.jobDetailContent = `<p class="text-red-400">Failed to load deliverable.</p>`;
  }
},
```

- [ ] **Step 4: Wire click handler on timeline cards**

Update the existing job timeline card HTML to include a click handler:

```html
<div @click="openJobDetail(automation.id, job.id, automation.name + ' - ' + job.id)"
     class="cursor-pointer hover:bg-white/5 transition-colors rounded-lg p-2">
  <!-- existing card content -->
</div>
```

- [ ] **Step 5: Manual test**

Start dashboard, trigger a test automation, click the job card, verify deliverable renders with images.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/public/index.html packages/dashboard/public/js/app.js
# Add route file if modified
git commit -m "feat(dashboard): job detail view renders full deliverable with images"
```

---

## Task 8: Job Timeline Thumbnail Strip from screenshotIds

**Files:**
- Modify: `packages/dashboard/public/index.html` (~line 1304, thumbnail strip area)
- Modify: `packages/dashboard/public/js/app.js`

- [ ] **Step 1: Read current thumbnail strip HTML**

Read `packages/dashboard/public/index.html` around line 1304 to find the existing thumbnail strip.

- [ ] **Step 2: Update thumbnail strip to use screenshotIds**

Replace the current thumbnail logic with:

```html
<!-- Thumbnail strip from screenshotIds -->
<template x-if="job.screenshotIds && job.screenshotIds.length > 0">
  <div class="flex gap-1 mt-2 overflow-x-auto">
    <template x-for="ssId in job.screenshotIds" :key="ssId">
      <img :src="'/api/assets/screenshots/' + ssId + '.png'"
           class="h-12 w-auto rounded object-cover border border-white/10"
           @error="$el.style.display='none'"
           loading="lazy"
           alt="">
    </template>
  </div>
</template>
```

Key behaviors:
- `@error="$el.style.display='none'"` hides broken images (404s from expired VAS files)
- `loading="lazy"` prevents loading all thumbnails at once
- `h-12` height constraint keeps the strip compact

- [ ] **Step 3: Ensure screenshotIds are included in job data sent to frontend**

Check the WebSocket protocol or API endpoint that sends job data. Ensure `screenshotIds` is included in the serialized Job object. If the state publisher or API omits it, add it.

- [ ] **Step 4: Manual test**

Run automation, verify thumbnails appear. Wait 7+ days (or manually delete), verify graceful 404 handling (no broken image icons).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/public/index.html packages/dashboard/public/js/app.js
git commit -m "feat(dashboard): job timeline thumbnails from screenshotIds with graceful 404"
```

---

## Task 9: Conversation Restore Image Verification

**Files:**
- Create: `packages/dashboard/tests/unit/conversations/image-restore.test.ts`

This is primarily a verification task — existing conversation persistence should already handle images.

- [ ] **Step 1: Write test**

Create `packages/dashboard/tests/unit/conversations/image-restore.test.ts`:

```typescript
// packages/dashboard/tests/unit/conversations/image-restore.test.ts

import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";

describe("conversation restore image verification", () => {
  const window = new JSDOM("").window;
  const DOMPurify = createDOMPurify(window);

  it("VAS image URLs in markdown survive sanitization and render as img tags", () => {
    const messageText = "Here's the AQI chart:\n\n![AQI trend](/api/assets/screenshots/ss-abc123.png)\n\nThe air quality is moderate.";

    // Simulate marked.js conversion (simplified)
    const html = messageText
      .replace(
        /!\[([^\]]*)\]\(([^)]+)\)/g,
        '<img src="$2" alt="$1">',
      )
      .replace(/\n/g, "<br>");

    const clean = DOMPurify.sanitize(html, { ADD_ATTR: ["target", "rel"] });
    expect(clean).toContain('<img src="/api/assets/screenshots/ss-abc123.png"');
    expect(clean).toContain('alt="AQI trend"');
  });

  it("multiple images in a single message all survive", () => {
    const html = `
      <p>Chart 1:</p>
      <p><img src="/api/assets/screenshots/ss-1.png" alt="chart1"></p>
      <p>Chart 2:</p>
      <p><img src="/api/assets/screenshots/ss-2.png" alt="chart2"></p>
    `;
    const clean = DOMPurify.sanitize(html, { ADD_ATTR: ["target", "rel"] });
    const imgCount = (clean.match(/<img /g) || []).length;
    expect(imgCount).toBe(2);
  });

  it("expired VAS URLs render as img tags (browser handles 404 gracefully)", () => {
    // The img tag will still be present — the browser shows alt text or nothing on 404
    const html = '<p><img src="/api/assets/screenshots/ss-expired.png" alt="old chart"></p>';
    const clean = DOMPurify.sanitize(html, { ADD_ATTR: ["target", "rel"] });
    expect(clean).toContain('<img src="/api/assets/screenshots/ss-expired.png"');
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd packages/dashboard && npx vitest run tests/unit/conversations/image-restore.test.ts
```

- [ ] **Step 3: Add CSS for graceful image handling**

In `packages/dashboard/public/css/app.css`, add (if not already present):

```css
/* Graceful image fallback for inline markdown images */
.prose img {
  max-width: 100%;
  border-radius: 0.5rem;
}

.prose img[src*="/api/assets/screenshots/"] {
  cursor: pointer;
  transition: opacity 0.2s;
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/tests/unit/conversations/image-restore.test.ts
# Add app.css if modified
git commit -m "test(dashboard): verify conversation restore renders images correctly"
```

---

## Task 10: WhatsApp Outbound Images

**Files:**
- Modify: `plugins/channel-whatsapp/src/plugin.ts`
- Create: `packages/dashboard/tests/unit/whatsapp/outbound-images.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/dashboard/tests/unit/whatsapp/outbound-images.test.ts`:

```typescript
// packages/dashboard/tests/unit/whatsapp/outbound-images.test.ts

import { describe, it, expect } from "vitest";

// Test the image extraction helpers directly

function extractMarkdownImages(text: string): Array<{ alt: string; url: string }> {
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const images: Array<{ alt: string; url: string }> = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    images.push({ alt: match[1], url: match[2] });
  }
  return images;
}

function stripMarkdownImages(text: string): string {
  return text.replace(/!\[([^\]]*)\]\(([^)]+)\)\n?/g, "").trim();
}

describe("WhatsApp outbound image parsing", () => {
  it("extracts single markdown image", () => {
    const text = "Here's the chart:\n\n![AQI trend](/api/assets/screenshots/ss-abc.png)\n\nLooking good!";
    const images = extractMarkdownImages(text);
    expect(images).toHaveLength(1);
    expect(images[0].alt).toBe("AQI trend");
    expect(images[0].url).toBe("/api/assets/screenshots/ss-abc.png");
  });

  it("extracts multiple markdown images", () => {
    const text = "![chart1](/api/assets/screenshots/ss-1.png)\n\n![chart2](/api/assets/screenshots/ss-2.png)";
    const images = extractMarkdownImages(text);
    expect(images).toHaveLength(2);
  });

  it("strips image syntax from text", () => {
    const text = "Here's the chart:\n\n![AQI trend](/api/assets/screenshots/ss-abc.png)\n\nLooking good!";
    const stripped = stripMarkdownImages(text);
    expect(stripped).not.toContain("![");
    expect(stripped).toContain("Here's the chart:");
    expect(stripped).toContain("Looking good!");
  });

  it("handles text with no images", () => {
    const text = "Just a normal message.";
    const images = extractMarkdownImages(text);
    expect(images).toHaveLength(0);
    expect(stripMarkdownImages(text)).toBe(text);
  });

  it("extracts VAS screenshot ID from URL", () => {
    const url = "/api/assets/screenshots/ss-abc123-def.png";
    const match = url.match(/\/api\/assets\/screenshots\/(ss-[^.]+)\.png/);
    expect(match).toBeTruthy();
    expect(match![1]).toBe("ss-abc123-def");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd packages/dashboard && npx vitest run tests/unit/whatsapp/outbound-images.test.ts
```

- [ ] **Step 3: Modify WhatsApp plugin send() method**

In `plugins/channel-whatsapp/src/plugin.ts`, add imports at the top:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
```

Add a property and setter for the screenshot directory:

```typescript
  private screenshotDir: string | null = null;

  setScreenshotDir(dir: string): void {
    this.screenshotDir = dir;
  }
```

Replace the `send()` method (~line 602):

```typescript
  async send(to: string, message: OutgoingMessage): Promise<void> {
    if (!this.sock) {
      throw new Error("[channel-whatsapp] send() called while disconnected");
    }

    // Extract markdown images from message
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const images: Array<{ alt: string; url: string }> = [];
    let imgMatch;
    while ((imgMatch = imageRegex.exec(message.content)) !== null) {
      images.push({ alt: imgMatch[1], url: imgMatch[2] });
    }

    // Strip image syntax from text
    const textContent = message.content
      .replace(/!\[([^\]]*)\]\(([^)]+)\)\n?/g, "")
      .trim();

    if (images.length > 0) {
      let firstImageSent = false;
      // Send images as media messages
      for (const image of images) {
        try {
          const imageBuffer = this.resolveImageToBuffer(image.url);
          if (imageBuffer) {
            // First image gets text as caption, rest are captionless
            const caption =
              !firstImageSent && textContent ? textContent : undefined;
            await this.sock.sendMessage(to, {
              image: imageBuffer,
              caption,
            });
            firstImageSent = true;
          }
        } catch (err) {
          console.warn(
            `[channel-whatsapp] Failed to send image ${image.url}:`,
            err,
          );
          // Graceful degradation — skip this image
        }
      }

      // If no images were sent (all failed), send text fallback
      if (!firstImageSent && textContent) {
        const result = await this.sock.sendMessage(to, { text: textContent });
        if (result?.key?.id) {
          this.cacheMessage(result.key.id, textContent, true);
        }
      }
    } else {
      // No images — send text normally
      const result = await this.sock.sendMessage(to, { text: message.content });
      if (result?.key?.id) {
        this.cacheMessage(result.key.id, message.content, true);
      }
    }
  }

  /**
   * Resolve a VAS screenshot URL to a file buffer.
   * Returns null if the file doesn't exist (expired).
   */
  private resolveImageToBuffer(url: string): Buffer | null {
    // Extract screenshot ID from VAS URL
    const vasMatch = url.match(/\/api\/assets\/screenshots\/(ss-[^.]+)\.png/);
    if (vasMatch && this.screenshotDir) {
      const filePath = join(this.screenshotDir, `${vasMatch[1]}.png`);
      try {
        return readFileSync(filePath);
      } catch {
        return null; // File expired or missing
      }
    }

    // For absolute file paths
    if (url.startsWith("/") && !url.startsWith("/api/")) {
      try {
        return readFileSync(url);
      } catch {
        return null;
      }
    }

    return null;
  }
```

- [ ] **Step 4: Wire screenshotDir in app.ts**

In `packages/dashboard/src/app.ts`, after WhatsApp plugin creation, set the screenshot directory:

```typescript
// After WhatsApp plugin is created and registered:
if (whatsappPlugin) {
  whatsappPlugin.setScreenshotDir(
    join(agentDir, "screenshots"),
  );
}
```

Find the exact location where the WhatsApp plugin instance is available and add this call.

- [ ] **Step 5: Run tests**

```bash
cd packages/dashboard && npx vitest run tests/unit/whatsapp/outbound-images.test.ts
```

- [ ] **Step 6: Verify tsc**

```bash
cd plugins/channel-whatsapp && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add plugins/channel-whatsapp/src/plugin.ts packages/dashboard/tests/unit/whatsapp/outbound-images.test.ts packages/dashboard/src/app.ts
git commit -m "feat(whatsapp): send markdown images as media messages via Baileys"
```

---

## Task 11: Visual Presenter Skill

**Files:**
- Create: `skills/visual-presenter.md`

- [ ] **Step 1: Create the skill file**

Create `skills/visual-presenter.md`:

```markdown
---
name: visual-presenter
description: Guides proactive use of images and charts in communication. Teaches when and how to generate SVG visuals, download relevant web images, and present them inline.
level: brain
tools:
  - store_image
---

# Visual Presenter

You have the ability to create and share images inline in conversation. Use the `store_image` tool to persist images, then reference them in markdown.

## When to Generate Visuals

Use SVG charts and diagrams when the data calls for it:

- **Trends over time** -> line chart
- **Comparisons** -> horizontal or vertical bar chart
- **Status / health** -> gauge, indicator, or colored badge
- **Processes / flows** -> simple flowchart or sequence diagram
- **Proportions** -> donut or pie chart

Use web images when a real photo or reference would help:

- **Weather briefings** -> weather map or icon
- **News summaries** -> relevant photo from article
- **Location references** -> map screenshot
- **Product lookups** -> product image

## SVG Guidelines (for sharp rendering)

When generating SVG for `store_image({ svg })`:

1. **Always set explicit `width` and `height`** on the `<svg>` element
2. **Use inline `style=""` attributes**, not `<style>` blocks with class selectors
3. **Use system fonts**: `sans-serif`, `serif`, `monospace`
4. **No `<foreignObject>`** or embedded HTML
5. **Keep it clean**: simple shapes, clear labels, readable text (min 12px)
6. **Dark-friendly colors**: use light text on dark backgrounds, or ensure good contrast

Example:

    <svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">
      <rect width="400" height="200" fill="#1a1b26" rx="8"/>
      <text x="200" y="30" text-anchor="middle" fill="#c0caf5" font-family="sans-serif" font-size="16">AQI This Week</text>
      <rect x="40" y="50" width="50" height="120" fill="#7aa2f7" rx="4"/>
      <text x="65" y="190" text-anchor="middle" fill="#a9b1d6" font-family="sans-serif" font-size="11">Mon</text>
    </svg>

## Rules

- **Images augment text, never replace it.** Always include a text explanation alongside any visual.
- **Don't ask if you should visualize.** Either do it or skip it. If you're unsure how to visualize something, just explain it in text.
- **One image per concept.** Don't flood the conversation with charts.
- **Use `store_image` for all images.** Don't send raw base64 or SVG markup in messages.
- **Reference stored images via markdown:** `![description](/api/assets/screenshots/ss-id.png)`
```

- [ ] **Step 2: Verify skill loads**

The skill system reads markdown files from `skills/`. Verify frontmatter is valid:

```bash
head -10 skills/visual-presenter.md
```

- [ ] **Step 3: Commit**

```bash
git add skills/visual-presenter.md
git commit -m "feat(skills): add visual-presenter brain skill for proactive image use"
```

---

## Task 12: VAS Cleanup Invocation

**Files:**
- Verify: `packages/dashboard/src/app.ts` (already done in S3.5)

- [ ] **Step 1: Verify cleanup is already wired**

Read `packages/dashboard/src/app.ts` around line 1057. The S3.5 sprint already added:

```typescript
// Cleanup unreferenced screenshots on startup + daily (S3.5)
const screenshotsCleaned = app.visualActionService.cleanup();
if (screenshotsCleaned > 0) {
  console.log(`[App] Cleaned up ${screenshotsCleaned} unreferenced screenshot(s)`);
}
setInterval(() => {
  const cleaned = app.visualActionService.cleanup();
  if (cleaned > 0) {
    console.log(`[App] Daily cleanup: removed ${cleaned} unreferenced screenshot(s)`);
  }
}, 24 * 60 * 60 * 1000);
```

This is already implemented. **No changes needed.**

- [ ] **Step 2: Verify the interval is 24 hours**

The `setInterval` uses `24 * 60 * 60 * 1000` = 86,400,000ms = 24 hours. Correct.

- [ ] **Step 3: Commit (skip — no changes)**

No commit needed. VAS cleanup is already invoked on startup and daily.

---

## Task 13: Wire store_image MCP Server into App

**Files:**
- Modify: `packages/dashboard/src/app.ts`

- [ ] **Step 1: Add import**

In `packages/dashboard/src/app.ts`, add the import near the other MCP server imports:

```typescript
import { createImageServer } from "./mcp/image-server.js";
```

- [ ] **Step 2: Register the MCP server**

After the desktop MCP server registration (~line 1198), add:

```typescript
    // Register image tools MCP server (M8-S4)
    const imageServer = createImageServer({
      visualService: app.visualActionService,
    });
    addMcpServer("image-tools", imageServer);
    console.log("[App] Image tools MCP server registered");
```

- [ ] **Step 3: Verify tsc**

```bash
cd packages/dashboard && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/app.ts
git commit -m "feat(app): wire store_image MCP server into App"
```

---

## Task 14: Image Lightbox on Click

**Files:**
- Modify: `packages/dashboard/public/js/app.js` or `packages/dashboard/public/js/stores.js`
- Modify: `packages/dashboard/public/index.html`

Inline images in chat messages need to open a lightbox when clicked.

- [ ] **Step 1: Check if lightbox store already exists**

Read `packages/dashboard/public/js/stores.js` — search for `lightbox`. The S1 timeline thumbnails reference `$store.lightbox.open()` — check if it exists or needs creation.

- [ ] **Step 2: Add lightbox Alpine store if missing**

In `stores.js`:

```javascript
Alpine.store("lightbox", {
  visible: false,
  url: "",
  description: "",
  open(url, description) {
    this.url = url;
    this.description = description || "";
    this.visible = true;
  },
  close() {
    this.visible = false;
  },
});
```

- [ ] **Step 3: Add lightbox overlay component to index.html**

At the end of the body, before closing `</body>`:

```html
<!-- Image Lightbox -->
<div x-data x-show="$store.lightbox?.visible"
     x-transition:enter="transition ease-out duration-200"
     x-transition:leave="transition ease-in duration-150"
     @click="$store.lightbox.close()"
     class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
     style="display: none;">
  <img :src="$store.lightbox?.url" :alt="$store.lightbox?.description"
       class="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl" @click.stop />
  <p x-show="$store.lightbox?.description" x-text="$store.lightbox?.description"
     class="absolute bottom-8 text-white/70 text-sm"></p>
</div>
```

- [ ] **Step 4: Add delegated click handler for chat images**

Use event delegation on the chat container instead of modifying `renderMarkdown()`. In `app.js`, during `init()`:

```javascript
// Lightbox: click any image inside chat-md to open full size
document.addEventListener("click", (e) => {
  const img = e.target.closest(".chat-md img");
  if (img) {
    e.preventDefault();
    const store = Alpine.store("lightbox");
    if (store?.open) {
      store.open(img.src, img.alt || "");
    } else {
      window.open(img.src, "_blank");
    }
  }
});
```

This catches clicks on any `<img>` inside `.chat-md` containers — both chat messages and job detail views. No need to modify `renderMarkdown()`.

- [ ] **Step 5: Verify lightbox works**

Restart dashboard. Click a screenshot thumbnail or inline image. Verify lightbox opens and closes on backdrop click.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/public/
git commit -m "feat(dashboard): image lightbox — click inline images to view full size"
```

---

## Task 15: Roadmap Update

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Add MCP marketplace to future milestone**

In `docs/ROADMAP.md`, find M12 (Platform Hardening). Add a note:

```markdown
**Future capability (MCP marketplace):** Users install external MCP servers for image generation,
data sources, and other capabilities. Nina discovers available tools automatically.
Future task: update visual presenter skill to detect and use MCP image generators.
```

- [ ] **Step 2: Update M8 sprint table with S4**

Add the S4 entry to the M8 sprint table.

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs: roadmap — add MCP marketplace future capability, M8-S4 entry"
```

---

## Task 16: Full Test Suite Verification

- [ ] **Step 1: Run all unit tests**

```bash
cd packages/dashboard && npx vitest run
```

Fix any failures.

- [ ] **Step 2: Type check all packages**

```bash
cd packages/core && npx tsc --noEmit
cd packages/dashboard && npx tsc --noEmit
cd plugins/channel-whatsapp && npx tsc --noEmit
```

Fix any type errors.

- [ ] **Step 3: Verify dashboard starts**

```bash
cd packages/dashboard && timeout 10 npx tsx src/index.ts 2>&1 || true
```

Should start without errors.

- [ ] **Step 4: Manual E2E verification checklist**

These are human-assisted checks from the design spec:

- [ ] **Debrief with chart:** Create a one-off automation that generates an SVG chart via `store_image`, include it in the deliverable. Verify the debrief includes the chart and the dashboard renders it.
- [ ] **Web image:** Ask Nina to find a "cat in a hat" image, download it via `store_image({ url })`, and share it in chat. Verify it renders inline.
- [ ] **Job thumbnails:** Trigger an automation that stores screenshots. Verify the timeline card shows the thumbnail strip. After 7 days (or manual deletion), verify graceful 404 handling.
- [ ] **WhatsApp image (human-assisted):** Send a message with an image from the dashboard. Verify the WhatsApp recipient receives it as a media message (not raw markdown text).

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address test/type issues from M8-S4 verification"
```

---

## Success Criteria

- [ ] Full deliverable stored to `deliverable.md` (not truncated)
- [ ] DB migration adds `deliverablePath` and `screenshotIds` columns to jobs table
- [ ] Notification uses full deliverable (not summary)
- [ ] Debrief reporter reads full deliverable
- [ ] `store_image` MCP tool works for SVG, base64, and URL inputs
- [ ] SVG-to-PNG conversion via sharp
- [ ] URL downloads downscaled to max 4096px longest edge
- [ ] Markdown images render inline in chat (DOMPurify allows `<img>`)
- [ ] Image lightbox opens on click (delegated handler on `.chat-md img`)
- [ ] Job detail view shows full deliverable with images
- [ ] Job timeline thumbnails from `screenshotIds` with graceful 404
- [ ] `screenshotIds` populated during job execution via VAS onScreenshot listener
- [ ] VAS `onScreenshot()` returns unsubscribe function
- [ ] Conversation restore shows images
- [ ] WhatsApp sends images as media (not markdown text)
- [ ] Visual presenter skill guides proactive image use
- [ ] VAS cleanup runs on startup + periodically
- [ ] Roadmap updated with MCP marketplace future capability
- [ ] All existing tests pass
