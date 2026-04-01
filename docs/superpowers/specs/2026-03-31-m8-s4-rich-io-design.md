# M8-S4: Rich I/O — Design Spec

> **Goal:** Nina communicates visually — generating charts, downloading images, and presenting them inline in chat, job views, and WhatsApp.
> **Date:** 2026-03-31
> **Status:** Draft

---

## Context

After S1-S3.5, the screenshot pipeline works: desktop control and Playwright produce screenshots, VAS stores them centrally, refs manage lifecycle. But images are only visible in timeline thumbnails — not in chat messages, not in job detail views, and not on WhatsApp.

Meanwhile, the deliverable pipeline has a 500-char summary truncation that loses image URLs. Job notifications pass `result.work` (not `result.deliverable`) to Conversation Nina. These infrastructure gaps block image delivery end-to-end.

S4 closes these gaps and adds new image sources: SVG chart generation and web image downloads. Nina becomes a visual communicator.

---

## Deliverable Pipeline Fix

### Problem

When a job completes, the executor truncates the deliverable to 500 chars for `job.summary`. This summary is the only thing passed to Conversation Nina and the debrief reporter. Image URLs (~60 chars each) get truncated away.

### Solution

**Store the full deliverable to disk.** When a job completes, the executor writes the full deliverable to `{run_dir}/deliverable.md`. The Job record gets a `deliverablePath` field.

| Field | Purpose | Length |
|---|---|---|
| `summary` | Timeline card preview | 500 chars (unchanged) |
| `deliverablePath` | Full output with images | Unlimited (on disk) |

**Consumers updated:**

| Consumer | Before | After |
|---|---|---|
| `automation-processor.ts` (notify) | Passes `result.work` | Reads full deliverable from disk |
| `debrief-reporter` | Reads `job.summary` or `status-report.md` | Reads `deliverablePath` first, falls back to `status-report.md`, then `summary` |
| `needs_review` flow | Shows `job.summary` | Shows full deliverable |
| Job detail view (dashboard) | Shows `summary` | Renders full deliverable as markdown with images |

---

## Image Sources

All images stored through VAS (`.my_agent/screenshots/`). One MCP tool with three input modes.

### `store_image` MCP Tool

```typescript
store_image({
  // Exactly one of:
  svg?: string,          // Raw SVG markup → converted to PNG via sharp
  data?: string,         // Base64-encoded PNG/JPEG/GIF
  url?: string,          // HTTP(S) URL to fetch

  description?: string,  // What this image shows
  returnImage?: boolean, // Return base64 content block (default: false)
})
```

**Returns:** `{ id: string, url: string, width: number, height: number }`

URL is immediately usable in markdown: `![description](/api/assets/screenshots/ss-abc.png)`

**Processing per input mode:**

| Mode | Processing | On failure |
|---|---|---|
| `svg` | Validate (`<svg` prefix), ensure width/height (infer from viewBox if missing), `sharp(svgBuffer).png().toBuffer()` | Return error with librsvg message |
| `data` | Decode base64, validate magic bytes (PNG: `\x89PNG`, JPEG: `\xFF\xD8\xFF`, GIF: `GIF8`) | Return error: invalid image format |
| `url` | HTTP fetch, validate Content-Type + magic bytes, downscale to max 4096px longest edge via sharp | Return error: fetch failed or not an image |

**New `ScreenshotSource` values:** `"generated"` (SVG renders), `"web"` (URL downloads). Added to existing `"desktop" | "playwright" | "upload"`.

**No size limit on storage.** VAS cleanup handles unreferenced images after 7 days. URL downloads are downscaled to max 4096px for display practicality. SVG and base64 stored as-is.

---

## Dashboard Rendering

### Chat Messages

Markdown images render inline in assistant message bubbles:

1. Nina writes `![AQI trend](/api/assets/screenshots/ss-abc.png)` in her response
2. `marked.js` converts to `<img src="..." alt="...">`
3. `DOMPurify` must allow `<img>` tags with `src`/`alt` (verify default allow-list; whitelist explicitly if needed)
4. CSS at `app.css:357` applies `max-width: 100%`, `border-radius: 0.5rem`
5. Click → lightbox

### Job Detail View

Currently shows `job.summary` (500 chars, text only). Updated:

- **Collapsed (timeline card):** Summary text + thumbnail strip of all screenshots taken during the job (see below)
- **Expanded (detail view):** Full deliverable rendered as markdown with inline images

### Job Timeline Thumbnails

The job timeline card shows a thumbnail strip of **all screenshots produced during the job**, ordered by timestamp. These are not refs — they're a peek into what happened.

- New Job record field: `screenshotIds: string[]` — populated by the executor as screenshots are stored during the job
- Frontend renders thumbnails from VAS URLs
- **Graceful decay:** After 7 days, unreferenced screenshots expire. If a VAS URL returns 404, the thumbnail is hidden (no broken image). The strip naturally shrinks to only referenced images over time.

### Conversation Restore

Loading an old conversation shows all messages including images:

- Transcript attachment metadata (`localPath`) resolved and rendered
- VAS image URLs in markdown text rendered via the same `<img>` path
- Graceful 404 handling for expired VAS images

---

## WhatsApp Outbound Images

Currently the WhatsApp plugin only sends `{ text: message.content }`. Markdown image URLs appear as raw text.

### Fix

Before sending, parse the message for markdown image syntax:

1. Extract `![alt](url)` patterns from the message text
2. For each image: resolve VAS URL to file buffer (`vas.get(id)` → `readFileSync(path)`)
3. Send via Baileys: `sendMessage(jid, { image: buffer, caption: cleanedText })`
4. Strip markdown image syntax from the text portion
5. Multiple images → separate WhatsApp messages (one image per message)

**Graceful degradation:** If VAS file is missing (expired), skip the image and send text only. No error to the user.

---

## Tool Redesign (S4.1 Course Correction)

S4 shipped `store_image` as a single generic tool. E2E testing proved models don't connect it to intent — when asked for a picture, the brain didn't realize `store_image({ url })` fetches images. When presenting data, it skipped chart generation because the tool name didn't signal "this is for charts."

### Two Purpose-Built Tools

**`create_chart`** — Data visualization. No network, no security surface.

```
create_chart({
  svg: string,              // Raw SVG markup
  description: string,      // What this chart shows
})
```

Or with structured data (future enhancement):

```
create_chart({
  data: [...],              // Structured data points
  type: "bar" | "line" | "gauge" | "diagram",
  title: string,
  description?: string,
})
```

- Brain sees data → tool name matches intent → higher proactive call rate
- SVG guidelines enforced in tool, not just skill
- The visual augmentation hook calls this directly
- No URL fetching, no base64, no network access

**`fetch_image`** — Image retrieval. All security concentrated here.

```
fetch_image({
  url?: string,             // HTTP(S) URL to fetch
  prompt?: string,          // For future MCP image generation
  description?: string,
})
```

- All SSRF protection, size limits, Content-Type validation here
- Brain sees "show me a picture" → web search → finds URL → `fetch_image`
- Future: `prompt` mode delegates to available MCP image gen tools
- Clear security boundary for auditing

### What Carries Forward From S4

| Component | Status |
|---|---|
| Dashboard rendering (DOMPurify, lightbox, job detail) | Keep as-is |
| Deliverable pipeline (deliverable.md, deliverablePath, screenshotIds) | Keep as-is |
| WhatsApp outbound images | Keep as-is |
| VAS integration, sharp conversion | Keep, refactor into new tools |
| Visual augmentation hook | Keep, point at `create_chart` |
| SSRF protection, size limits | Move to `fetch_image` only |
| SVG helpers (ensureSvgDimensions, etc.) | Move to `create_chart` |

### What Gets Redesigned

| File | Change |
|---|---|
| `packages/dashboard/src/mcp/image-server.ts` | Split into `chart-server.ts` + `image-fetch-server.ts` |
| `skills/visual-presenter.md` | Update tool names, separate chart vs image guidance |
| `packages/dashboard/src/chat/visual-augmentation.ts` | Import from chart-server instead of image-server |
| `packages/dashboard/src/app.ts` | Register two MCP servers instead of one |
| Tests | Split accordingly |

---

## Standing Order: Visual Communication

Visual expression is embedded as a **standing order** in `notebook/reference/standing-orders.md` — the same operational authority level as escalation rules and trust tiers. This is not a skill suggestion; it's a mandate.

```
## Visual Communication
Express data visually whenever possible. When your response contains
numeric trends, comparisons, or status data, generate a chart using
create_chart. When discussing something with a visual component,
fetch a relevant image using fetch_image. Text-only responses for
data-rich content are incomplete responses.
```

Three reinforcement layers for visual behavior:
1. **Standing order** — deepest operational instruction, always in system prompt
2. **Visual presenter skill** — detailed how-to guidance (SVG guidelines, tool usage, when to skip)
3. **Augmentation hook** — safety net catches what the model still misses

---

## Visual Presenter Skill (Updated for S4.1)

Brain-level skill with purpose-specific tool guidance:

**Chart generation (`create_chart`):**
- 3+ numeric data points → line or bar chart
- Comparisons → side-by-side bars
- Status/health with numeric value → gauge or indicator
- Processes/flows → diagram
- ALWAYS call `create_chart` when your response contains chartable data

**Image fetching (`fetch_image`):**
- Briefings → fetch relevant images (weather maps, news photos)
- User asks to see something → web search for URL → `fetch_image`
- Visual explanation needed → find a relevant image

**SVG guidelines (for sharp rendering):**
- Always set explicit `width` and `height` attributes on `<svg>`
- Use inline `style=""` attributes, not `<style>` blocks with selectors
- Use system fonts: `sans-serif`, `serif`, `monospace`
- No `<foreignObject>` or embedded HTML
- Keep it simple — clean shapes, clear labels, readable text

**Rules:**
- Images augment text, don't replace it. Always include a text explanation alongside.
- If you don't know how to visualize something, skip visualization silently.
- ALWAYS call `create_chart` when response has 3+ data points. ALWAYS call `fetch_image` when discussing something with a visual component.

---

## Visual Augmentation Hook

Post-response safety net for proactive visual communication. The standing order + skill tell the brain to use tools proactively, but models don't always follow. The hook catches data-heavy responses that lack visuals.

**Flow:**
1. Brain responds to user message (text only)
2. Post-response hook fires, checks: was `create_chart` or `fetch_image` called during this turn?
3. If yes → no-op (brain followed the directive)
4. If no → quick heuristic check (3+ numbers in response?)
5. If passes → Haiku analyzes: "does this have chartable trend/comparison data?"
6. If YES → Haiku generates SVG chart → `create_chart` handler → append as follow-up message

**Cost:** ~$0.003 per analysis (Haiku). ~$0.01 when chart is generated. No cost when brain uses visuals natively.

**Implementation:** `packages/dashboard/src/chat/visual-augmentation.ts`, wired via `PostResponseHooks`.

---

## VAS Cleanup Invocation

S3.5 built `cleanup()` but nothing calls it. S4 adds:

- **Startup:** `app.visualActionService.cleanup()` during App initialization
- **Periodic:** Run cleanup daily (via existing scheduler/automation system, or simple `setInterval`)

---

## Roadmap Updates

### MCP Image Generation Support (future)

Add to a future milestone (M9 or M12): **MCP marketplace/discovery** — users can install external MCP servers for image generation (DALL-E, Stable Diffusion, Flux, etc.). Nina gets image generation tools automatically.

**Future task:** Update the visual presenter skill to detect available MCP image generation tools and use them when appropriate (e.g., "I have a DALL-E MCP server available, I can generate an illustration for this concept").

External MCP image generators already work with the current architecture: they return base64 content blocks, Nina calls `fetch_image({ prompt })` or stores directly. No framework changes needed — just the skill update.

---

## Sprint Tasks (High-Level)

### S4 (completed, on branch — infrastructure)

| # | Task | Status |
|---|---|---|
| 1 | Deliverable pipeline fix | Done — `deliverable.md`, `deliverablePath`, `screenshotIds` |
| 2 | `store_image` MCP tool | Done — to be split in S4.1 |
| 3 | Dashboard chat image rendering | Done — DOMPurify, lightbox |
| 4 | Job detail view | Done — full deliverable with images |
| 5 | Job timeline thumbnails | Done — `screenshotIds`, graceful 404 |
| 6 | Conversation restore images | Done |
| 7 | WhatsApp outbound images | Done — Baileys media |
| 8 | Visual presenter skill | Done — to be updated in S4.1 |
| 9 | VAS cleanup invocation | Done (was already in S3.5) |
| 10 | Visual augmentation hook | Done — Haiku safety net |

### S4.1 (course correction — tool redesign)

| # | Task | Scope |
|---|---|---|
| 1 | Split `store_image` into `create_chart` + `fetch_image` | Refactor `image-server.ts` into two files, move SVG helpers to chart, move SSRF/fetch to image-fetch |
| 2 | Update visual presenter skill | Separate chart vs image guidance, update tool names, directive wording |
| 3 | Add standing order for visual communication | Add to `notebook/reference/standing-orders.md` template in hatching |
| 4 | Update visual augmentation hook | Import from `chart-server` instead of `image-server`, check for `create_chart`/`fetch_image` |
| 5 | Update app.ts wiring | Register two MCP servers instead of one, delete old image-server registration |
| 6 | Split and update tests | Split `image-server.test.ts` into chart + fetch tests |
| 7 | E2E: proactive chart generation | Ask Nina about data (AQI, weather) — verify she calls `create_chart` unprompted |
| 8 | E2E: image fetch | Ask Nina to show a cat in a hat — verify she calls `fetch_image` |
| 9 | E2E: augmentation hook fallback | Trigger data-heavy response without chart — verify hook catches it |
| 10 | E2E: WhatsApp image delivery | Human-assisted — verify image arrives as media |

### S4.2 (visual expression for Working Ninas)

Workers produce visual deliverables — charts in reports, fetched images in research.

**Architecture:** Two changes inside the automation executor:
1. Wire `chart-tools` + `image-fetch-tools` MCP servers to worker queries
2. Post-execution deliverable hook: if deliverable has chartable data but no images, Haiku generates a chart and appends it before job completion

**Data flow:**
```
Worker executes → produces deliverable text
  ├─ Worker called create_chart/fetch_image? → deliverable has images → done
  └─ Worker didn't? → hook checks: bulleted data + 3 numbers + no ![
       ├─ No chartable data → done
       └─ Chartable → Haiku SVG → create_chart → append to deliverable.md
Job completes with final deliverable (text + charts)
  → Debrief reads deliverablePath (images included)
  → Brain presents brief → WhatsApp sends as media
```

**What changes:**
- `automation-executor.ts` — add chart-tools + image-fetch-tools MCP servers to worker queries, add post-execution deliverable augmentation

**What doesn't change:**
- Conversation hook (stays for interactive chat)
- Dashboard rendering, WhatsApp outbound, debrief reporter
- Visual presenter skill (already level: brain, already loaded into worker prompts)

| # | Task | Scope |
|---|---|---|
| 1 | Wire chart-tools + image-fetch-tools MCP to workers | Add both MCP servers to executor's query config |
| 2 | Post-execution deliverable augmentation | After extractDeliverable, check for chartable data without images, Haiku generates chart, append to deliverable.md |
| 3 | E2E: one-off worker with data | Fire "sample memory usage every 30 seconds for 3 minutes and report back" — verify chart in deliverable |
| 4 | E2E: debrief flow | Fire debrief reporter, verify chart flows through to brief |
| 5 | E2E: WhatsApp delivery | Verify chart arrives as media on WhatsApp |

---

## Dependencies

- `sharp` npm package (image processing — SVG→PNG, downscaling)
- Existing VAS from S3.5
- Existing Baileys WhatsApp library
- `marked` + `DOMPurify` (already in dashboard frontend)

## Out of Scope

- Creative image generation via external APIs (future — MCP marketplace)
- HTML-to-image rendering (SVG covers chart/diagram needs)
- Voice (S5)
- Animated image support (static frames only)

---

*Spec written: 2026-03-31*
*Updated: 2026-03-31 — S4.1 course correction (tool redesign + standing order)*
*Sprint: M8-S4 + S4.1 (Rich I/O)*
