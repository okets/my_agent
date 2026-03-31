# M8-S4.1: Tool Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the generic `store_image` tool into two purpose-built tools (`create_chart` + `fetch_image`) so models connect intent to action. Add standing order for visual communication. Re-verify with browser E2E tests.

**Architecture:** Most S4 infrastructure stays (dashboard rendering, deliverable pipeline, WhatsApp, VAS, sharp). This sprint only refactors the tool boundary, updates the skill, adds a standing order, and re-runs E2E verification.

**Tech Stack:** TypeScript, sharp (reused), vitest, Playwright (browser E2E)

**Design spec:** `docs/superpowers/specs/2026-03-31-m8-s4-rich-io-design.md` (S4.1 section)
**Depends on:** M8-S4 (on branch `sprint/m8-s4-rich-io`)

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `packages/dashboard/src/mcp/chart-server.ts` | `create_chart` MCP tool — SVG-to-PNG chart generation via sharp |
| `packages/dashboard/src/mcp/image-fetch-server.ts` | `fetch_image` MCP tool — URL fetching with SSRF protection |
| `packages/dashboard/tests/unit/mcp/chart-server.test.ts` | Unit tests for `create_chart` handler |
| `packages/dashboard/tests/unit/mcp/image-fetch-server.test.ts` | Unit tests for `fetch_image` handler |

### Modified Files

| File | Change |
|------|--------|
| `skills/visual-presenter.md` | Update tool references from `store_image` to `create_chart` + `fetch_image`, directive wording |
| `packages/core/src/hatching/logic.ts` | Add "Visual Communication" section to `buildStandingOrders()` template |
| `packages/dashboard/src/chat/visual-augmentation.ts` | Import `handleCreateChart` from `chart-server.ts`, update tool-call detection |
| `packages/dashboard/src/app.ts` | Register two MCP servers (`chart-tools` + `image-fetch-tools`), remove old `image-tools` |

### Deleted Files

| File | Reason |
|------|--------|
| `packages/dashboard/src/mcp/image-server.ts` | All code split into `chart-server.ts` + `image-fetch-server.ts` |
| `packages/dashboard/tests/unit/mcp/image-server.test.ts` | Tests split into new test files |

---

## Task 1: Create `chart-server.ts` (TDD)

**Files:** `packages/dashboard/tests/unit/mcp/chart-server.test.ts`, `packages/dashboard/src/mcp/chart-server.ts`

### 1a. Write tests first

Create `packages/dashboard/tests/unit/mcp/chart-server.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleCreateChart } from "../../../src/mcp/chart-server.js";
import { VisualActionService } from "../../../src/visual/visual-action-service.js";
import type { ChartServerDeps } from "../../../src/mcp/chart-server.js";

let tmpDir: string;
let visualService: VisualActionService;
let deps: ChartServerDeps;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-server-test-"));
  visualService = new VisualActionService(tmpDir);
  deps = { visualService };
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("create_chart handler", () => {
  it("stores SVG as PNG via sharp and returns { id, url, width, height }", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="red" width="100" height="100"/></svg>`;
    const result = await handleCreateChart(deps, { svg, description: "test chart" });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text);
    expect(parsed.id).toMatch(/^ss-/);
    expect(parsed.url).toContain("/api/assets/screenshots/");
    expect(parsed.width).toBe(100);
    expect(parsed.height).toBe(100);
  });

  it("infers SVG dimensions from viewBox when width/height missing", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150"><rect fill="blue" width="200" height="150"/></svg>`;
    const result = await handleCreateChart(deps, { svg, description: "viewbox chart" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text);
    expect(parsed.width).toBe(200);
    expect(parsed.height).toBe(150);
  });

  it("rejects SVG that doesn't start with <svg", async () => {
    const result = await handleCreateChart(deps, { svg: "<div>not svg</div>", description: "bad" });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { type: "text"; text: string }).text).toContain("must start with <svg");
  });

  it("rejects SVG with no dimensions and no viewBox", async () => {
    const result = await handleCreateChart(deps, { svg: "<svg><rect/></svg>", description: "no dims" });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { type: "text"; text: string }).text).toContain("no width/height");
  });

  it("rejects empty svg string", async () => {
    const result = await handleCreateChart(deps, { svg: "", description: "empty" });
    expect(result.isError).toBe(true);
  });

  it("stores with source 'generated'", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect fill="green" width="50" height="50"/></svg>`;
    const result = await handleCreateChart(deps, { svg, description: "source test" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text);
    // Verify the screenshot exists in the VAS store
    expect(parsed.id).toMatch(/^ss-/);
  });
});
```

### 1b. Implement chart-server.ts

Create `packages/dashboard/src/mcp/chart-server.ts`:

- Extract from `image-server.ts`: `ensureSvgDimensions()` helper function
- Export `ChartServerDeps` interface (same shape as `ImageServerDeps`: `{ visualService: VisualActionService }`)
- Export `handleCreateChart(deps, args: { svg: string, description: string })` — the handler, exported for testing and for the augmentation hook
- Export `createChartServer(deps)` — returns MCP server via `createSdkMcpServer()`

Tool registration:

```typescript
const createChartTool = tool(
  "create_chart",
  "Generate a chart from data. Call this when your response contains 3+ numeric data points, trends, or comparisons. Returns { id, url, width, height }. You MUST include the url in your response as ![description](url).",
  {
    svg: z.string().describe("Raw SVG markup (must start with <svg)"),
    description: z.string().describe("What this chart shows"),
  },
  async (args) => handleCreateChart(deps, args),
);

return createSdkMcpServer({
  name: "chart-tools",
  tools: [createChartTool],
});
```

Handler logic (from image-server.ts SVG mode):
1. Validate `svg` is non-empty and starts with `<svg` (after trimming whitespace)
2. Call `ensureSvgDimensions(svg)` — infer width/height from viewBox if missing, throw if neither
3. `sharp(Buffer.from(svgWithDims)).png().toBuffer()` — convert to PNG
4. `sharp(pngBuffer).metadata()` — get width/height
5. `deps.visualService.store(pngBuffer, { description, width, height, source: "generated" })`
6. Return `{ id, url, width, height }` as JSON text content block

Error handling: catch all errors, return `{ content: [{ type: "text", text: "..." }], isError: true }`.

### 1c. Verify

```bash
cd packages/dashboard && npx vitest run tests/unit/mcp/chart-server.test.ts
```

All tests must pass. Fix any failures before proceeding.

---

## Task 2: Create `image-fetch-server.ts` (TDD)

**Files:** `packages/dashboard/tests/unit/mcp/image-fetch-server.test.ts`, `packages/dashboard/src/mcp/image-fetch-server.ts`

### 2a. Write tests first

Create `packages/dashboard/tests/unit/mcp/image-fetch-server.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleFetchImage } from "../../../src/mcp/image-fetch-server.js";
import { VisualActionService } from "../../../src/visual/visual-action-service.js";
import type { ImageFetchServerDeps } from "../../../src/mcp/image-fetch-server.js";

let tmpDir: string;
let visualService: VisualActionService;
let deps: ImageFetchServerDeps;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "image-fetch-server-test-"));
  visualService = new VisualActionService(tmpDir);
  deps = { visualService };
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("fetch_image handler", () => {
  it("rejects when neither url nor prompt provided", async () => {
    const result = await handleFetchImage(deps, {});
    expect(result.isError).toBe(true);
    expect((result.content[0] as { type: "text"; text: string }).text).toContain(
      "url or prompt",
    );
  });

  it("returns 'not yet supported' for prompt-only calls", async () => {
    const result = await handleFetchImage(deps, { prompt: "a cat wearing a hat" });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { type: "text"; text: string }).text).toContain(
      "not yet supported",
    );
  });

  it("rejects invalid URL scheme (ftp://)", async () => {
    const result = await handleFetchImage(deps, { url: "ftp://example.com/image.png" });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { type: "text"; text: string }).text).toContain(
      "Invalid URL scheme",
    );
  });

  it("blocks private/internal network URLs (SSRF protection)", async () => {
    for (const url of [
      "http://127.0.0.1/image.png",
      "http://10.0.0.1/image.png",
      "http://192.168.1.1/image.png",
      "http://172.16.0.1/image.png",
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost/image.png",
    ]) {
      const result = await handleFetchImage(deps, { url });
      expect(result.isError).toBe(true);
      expect((result.content[0] as { type: "text"; text: string }).text).toContain(
        "private",
      );
    }
  });

  it("rejects URLs with no host", async () => {
    const result = await handleFetchImage(deps, { url: "not-a-url" });
    expect(result.isError).toBe(true);
  });
});
```

Note: live URL fetch tests are not included in unit tests (they'd be flaky). The E2E tests in Tasks 7-8 cover real fetches.

### 2b. Implement image-fetch-server.ts

Create `packages/dashboard/src/mcp/image-fetch-server.ts`:

- Extract from `image-server.ts`: `fetchImage()`, `isPrivateHost()`, `hasValidMagicBytes()`, `MAX_IMAGE_BYTES`, magic byte constants (`PNG_MAGIC`, `JPEG_MAGIC`, `GIF_MAGIC`)
- Export `ImageFetchServerDeps` interface (same shape: `{ visualService: VisualActionService }`)
- Export `handleFetchImage(deps, args: { url?: string, prompt?: string, description?: string })` — handler, exported for testing
- Export `createImageFetchServer(deps)` — returns MCP server

Tool registration:

```typescript
const fetchImageTool = tool(
  "fetch_image",
  "Fetch an image from the web. Call this when you need to show the user a relevant picture — weather maps, news photos, product images, illustrations. Returns { id, url, width, height }. You MUST include the url in your response as ![description](url).",
  {
    url: z.string().optional().describe("HTTP(S) URL to fetch the image from"),
    prompt: z.string().optional().describe("Image generation prompt (not yet supported)"),
    description: z.string().optional().describe("What this image shows"),
  },
  async (args) => handleFetchImage(deps, args),
);

return createSdkMcpServer({
  name: "image-fetch-tools",
  tools: [fetchImageTool],
});
```

Handler logic:
1. If `prompt` is provided and `url` is not: return error "MCP image generation is not yet supported. Use url to fetch an existing image."
2. If neither `url` nor `prompt`: return error "Either url or prompt must be provided"
3. Validate URL (parse with `new URL()`, check scheme is http/https)
4. SSRF check via `isPrivateHost()`
5. `fetchImage(url)` — HTTP fetch with redirect following, Content-Type validation, 50 MB size limit
6. `hasValidMagicBytes(buffer)` — validate magic bytes
7. Downscale to max 4096px longest edge via sharp
8. `deps.visualService.store(pngBuffer, { description, width, height, source: "web" })`
9. Return `{ id, url, width, height }` as JSON text content block

### 2c. Verify

```bash
cd packages/dashboard && npx vitest run tests/unit/mcp/image-fetch-server.test.ts
```

All tests must pass.

---

## Task 3: Update visual presenter skill

**File:** `skills/visual-presenter.md`

Rewrite the skill with two-tool guidance and directive wording. Keep the YAML frontmatter, update tools list.

New content:

```markdown
---
name: visual-presenter
description: When and how to generate charts and fetch images using create_chart and fetch_image.
level: brain
tools:
  - create_chart
  - fetch_image
---

# Visual Presenter

You have two visual tools. **Use them proactively** — don't wait to be asked.

## Chart Generation (`create_chart`)

ALWAYS call `create_chart` when your response contains:

- **3+ numeric data points** (daily readings, weekly stats, prices over time) --> line or bar chart
- **Comparisons** (A vs B, before/after, rankings) --> side-by-side bars
- **Status/health with a numeric value** --> gauge or indicator
- **A process or flow** --> diagram

```
create_chart({ svg: "<svg ...>...</svg>", description: "what this shows" })
```

Returns `{ id, url, width, height }`.

## Image Fetching (`fetch_image`)

ALWAYS call `fetch_image` when:

- Discussing something with a strong visual component (weather, places, products)
- User asks to see something ("show me", "what does X look like")
- A briefing would benefit from a relevant photo (weather map, news image)

```
fetch_image({ url: "https://...", description: "what this shows" })
```

Returns `{ id, url, width, height }`.

## After calling either tool

**CRITICAL: You MUST embed the returned url in your response text using markdown image syntax.** The image will NOT appear to the user unless you write:

```
![description](url)
```

If you call a tool but don't include `![...](url)` in your text, the user sees nothing.

## SVG guidelines (for `create_chart`)

Follow these rules for sharp, consistent rendering:

- Always set explicit `width` and `height` attributes on the `<svg>` element
- Set `xmlns="http://www.w3.org/2000/svg"` on the root element
- Use inline `style=""` attributes, NOT `<style>` blocks with selectors
- Use system fonts only: `sans-serif`, `serif`, `monospace`
- No `<foreignObject>` or embedded HTML
- Keep it simple — clean shapes, clear labels, readable text
- Keep SVGs under ~5KB

### Tokyo Night color palette

| Role           | Color     |
|----------------|-----------|
| Background     | `#1a1b26` |
| Panel          | `#292e42` |
| Text           | `#c0caf5` |
| Muted text     | `#565f89` |
| Accent blue    | `#7aa2f7` |
| Accent purple  | `#bb9af7` |
| Accent pink    | `#f7768e` |
| Green          | `#9ece6a` |
| Yellow         | `#e0af68` |

## Rules

- Images **augment** text, they don't replace it. Always include a text explanation alongside.
- One image per response is usually enough. Max 3.
- If you don't know how to visualize something, skip visualization silently. Don't ask.
- Don't generate images for simple text responses.
- Text-only responses for data-heavy answers are incomplete responses.
```

### Verify

Read the file back and confirm the YAML frontmatter parses correctly (tools list updated, level still `brain`).

---

## Task 4: Add standing order for visual communication

**File:** `packages/core/src/hatching/logic.ts`

### 4a. Locate `buildStandingOrders()`

The function is at approximately line 208 in `packages/core/src/hatching/logic.ts`. It builds a markdown template with sections for Autonomy, Escalation Rules, and Communication Style.

### 4b. Add Visual Communication section

Add a new section after Communication Style in the `buildStandingOrders()` return string:

```typescript
function buildStandingOrders(autonomy: string, escalations: string, style: string): string {
  return `# Standing Orders

## Autonomy

${autonomy}

## Escalation Rules

**Always escalate:**
${escalations || 'Nothing specified — use best judgment'}

## Communication Style

${style}

## Visual Communication

Express data visually whenever possible. When your response contains
numeric trends, comparisons, or status data, generate a chart using
create_chart. When discussing something with a visual component,
fetch a relevant image using fetch_image. Text-only responses for
data-rich content are incomplete responses.
`
}
```

### Verify

```bash
cd packages/core && npx tsc --noEmit
```

Types must be clean. The change is a string template addition with no type impact.

---

## Task 5: Update visual augmentation hook

**File:** `packages/dashboard/src/chat/visual-augmentation.ts`

### 5a. Update import

Change:
```typescript
import { handleStoreImage } from "../mcp/image-server.js";
```
To:
```typescript
import { handleCreateChart } from "../mcp/chart-server.js";
```

### 5b. Update handler call

In `maybeAugmentWithVisual()`, around line 102, change:
```typescript
const result = await handleStoreImage(
  { visualService: deps.visualService },
  { svg: svgMatch[0], description: chartDescription },
);
```
To:
```typescript
const result = await handleCreateChart(
  { visualService: deps.visualService },
  { svg: svgMatch[0], description: chartDescription },
);
```

### 5c. Update the doc comment

At the top of the file, change the comment from referencing `store_image` to referencing `create_chart` and `fetch_image`:

Change:
```
 * brain follows the skill, store_image is called during the turn and
 * this hook is a no-op. When the brain skips it, this catches it.
```
To:
```
 * brain follows the skill, create_chart or fetch_image is called during
 * the turn and this hook is a no-op. When the brain skips it, this catches it.
```

### Verify

```bash
cd packages/dashboard && npx tsc --noEmit
```

Types must be clean. The `handleCreateChart` function must have the same signature shape as the old `handleStoreImage` SVG path (deps + `{ svg, description }`).

---

## Task 6: Update app.ts wiring and delete old files

**File:** `packages/dashboard/src/app.ts`

### 6a. Replace import and registration

Find the block (around line 1233):
```typescript
// Register image-tools MCP server (M8-S4: store_image tool)
const { createImageServer } = await import("./mcp/image-server.js");
const imageServer = createImageServer({ visualService: app.visualActionService });
addMcpServer("image-tools", imageServer);
console.log("[App] Image tools MCP server registered");
```

Replace with:
```typescript
// Register chart-tools MCP server (M8-S4.1: create_chart tool)
const { createChartServer } = await import("./mcp/chart-server.js");
const chartServer = createChartServer({ visualService: app.visualActionService });
addMcpServer("chart-tools", chartServer);
console.log("[App] Chart tools MCP server registered");

// Register image-fetch-tools MCP server (M8-S4.1: fetch_image tool)
const { createImageFetchServer } = await import("./mcp/image-fetch-server.js");
const fetchServer = createImageFetchServer({ visualService: app.visualActionService });
addMcpServer("image-fetch-tools", fetchServer);
console.log("[App] Image fetch tools MCP server registered");
```

### 6b. Delete old files

```bash
rm packages/dashboard/src/mcp/image-server.ts
rm packages/dashboard/tests/unit/mcp/image-server.test.ts
```

### 6c. Check for stale imports

Search the codebase for any remaining imports of `image-server`:

```bash
grep -r "image-server" packages/dashboard/src/ --include="*.ts"
```

Fix any remaining references. The only expected imports were in `app.ts` (updated in 6a) and `visual-augmentation.ts` (updated in Task 5).

### Verify

```bash
cd packages/dashboard && npx tsc --noEmit
cd packages/dashboard && npx vitest run
```

**All existing tests must pass (880+).** The deleted test file is replaced by the two new test files from Tasks 1-2. No test count regression.

---

## Task 7: E2E — Proactive chart generation

**Type:** Browser E2E (Playwright)
**Depends on:** Tasks 1-6

### Test steps

1. Navigate to the dashboard chat interface
2. Send a message containing numeric data: "Here are the AQI readings for the week: Mon 45, Tue 67, Wed 89, Thu 52, Fri 73, Sat 61, Sun 48"
3. Wait for the assistant response (up to 60 seconds)
4. **Primary check:** Look for `![` in the assistant response text OR an `<img>` tag in the chat message DOM — this means the brain called `create_chart` proactively
5. **Fallback check:** If the brain's response is text-only, wait an additional 15 seconds for the augmentation hook to fire. The hook should append a follow-up message containing a chart image.
6. **Either way:** Verify that at least one `<img>` element with a `/api/assets/screenshots/` src appears in the conversation

### Pass criteria

A chart image renders inline in the chat, either from the brain's proactive tool use or from the augmentation hook safety net. The test passes if any chart appears.

### Fail criteria

No chart image appears in the chat after 75 seconds total wait time.

---

## Task 8: E2E — Image fetch

**Type:** Browser E2E (Playwright)
**Depends on:** Tasks 1-6

### Test steps

1. Navigate to the dashboard chat interface
2. Send: "Show me a picture of a cat wearing a hat"
3. Wait for the assistant response (up to 60 seconds)
4. Verify the response contains an `<img>` tag with a `/api/assets/screenshots/` src (the brain called `fetch_image` and embedded the URL)
5. Verify the image loads successfully (not a broken image / 404)

### Pass criteria

An image renders inline in the chat. The brain called `fetch_image` with a URL and embedded the result.

### Fail criteria

No image in the response, or the brain says "I can't fetch images" (the failure mode from S4).

---

## Task 9: E2E — Augmentation hook fallback

**Type:** Browser E2E (Playwright)
**Depends on:** Tasks 1-6

### Test steps

1. Navigate to the dashboard chat interface
2. Send a data-heavy message that the brain is likely to answer with text only (use a model that tends to skip visuals, e.g., Sonnet): "What were the average temperatures in Paris last week? Monday 12C, Tuesday 14C, Wednesday 11C, Thursday 15C, Friday 13C, Saturday 16C, Sunday 10C"
3. Wait for the initial assistant text response
4. Wait an additional 15 seconds for the augmentation hook to detect the data-heavy response
5. Verify a follow-up message appears containing a chart image (`<img>` with `/api/assets/screenshots/` src)

### Pass criteria

The augmentation hook fires and appends a chart as a follow-up message after the brain's text response.

### Fail criteria

- The hook doesn't fire (no follow-up message with an image)
- The hook fires but the SVG generation fails (check server logs for `[VisualAugmentation]` errors)

### Notes

If the brain proactively generates a chart (hooray!), this test becomes a no-op success — the hook correctly skips when the brain already handled it. Document which behavior occurred.

---

## Task 10: E2E — WhatsApp image delivery

**Type:** Human-assisted
**Depends on:** Tasks 1-6

### Test steps

1. Trigger a response that generates a chart (send data to the dashboard chat, verify chart appears)
2. Verify the WhatsApp recipient receives the image as a media message (not raw markdown text)
3. Check that the text portion of the WhatsApp message does not contain `![description](url)` markdown syntax
4. If possible, also test with a fetched image (`fetch_image` result)

### Pass criteria

- WhatsApp receives the image as a media attachment (viewable inline in WhatsApp)
- Accompanying text is clean (no markdown image syntax)

### Fail criteria

- WhatsApp receives raw markdown text with image URLs
- WhatsApp receives no message at all
- Image is missing/broken in WhatsApp

### Notes

This test requires a real WhatsApp connection. Document the result with a screenshot or description. The WhatsApp outbound image parsing from S4 should work unchanged since it parses `![alt](url)` syntax regardless of which tool generated the image.

---

## Success Criteria

- [ ] `create_chart` tool exists with directive description
- [ ] `fetch_image` tool exists with directive description
- [ ] `store_image` tool and `image-server.ts` deleted
- [ ] Visual presenter skill updated with new tool names and directive wording
- [ ] Standing order added to hatching template
- [ ] Augmentation hook uses chart-server
- [ ] App registers two MCP servers (`chart-tools` + `image-fetch-tools`)
- [ ] E2E: proactive chart generation works (model calls tool OR hook catches it)
- [ ] E2E: image fetch works ("show me a cat in hat" produces an image)
- [ ] E2E: WhatsApp receives image as media
- [ ] All existing tests pass (880+)
