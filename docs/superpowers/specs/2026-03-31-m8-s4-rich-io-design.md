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

## Visual Presenter Skill

Brain-level skill teaching Nina to proactively use visuals:

**When to generate visuals:**
- Data with trends → SVG line/bar chart
- Comparisons → SVG side-by-side bars
- Status/health → SVG gauge or indicator
- Processes/flows → SVG diagram
- Briefings → include relevant web images (weather, news, maps)

**SVG guidelines (for sharp rendering):**
- Always set explicit `width` and `height` attributes on `<svg>`
- Use inline `style=""` attributes, not `<style>` blocks with selectors
- Use system fonts: `sans-serif`, `serif`, `monospace`
- No `<foreignObject>` or embedded HTML
- Keep it simple — clean shapes, clear labels, readable text

**Rules:**
- Images augment text, don't replace it. Always include a text explanation alongside.
- If you don't know how to visualize something, skip visualization. Don't ask.

---

## Visual Augmentation Hook

Post-response safety net for proactive visual communication. The visual presenter skill tells the brain to use `store_image` proactively, but models don't always follow. The hook catches data-heavy responses that lack visuals.

**Flow:**
1. Brain responds to user message (text only)
2. Post-response hook fires, checks: was `store_image` called during this turn?
3. If yes → no-op (brain followed the skill)
4. If no → quick heuristic check (3+ numbers in response?)
5. If passes → Haiku analyzes: "does this have chartable trend/comparison data?"
6. If YES → Haiku generates SVG chart → `store_image` → append as follow-up message

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

External MCP image generators already work with the current architecture: they return base64 content blocks, Nina calls `store_image({ data })` to persist. No framework changes needed — just the skill update.

---

## Sprint Tasks (High-Level)

| # | Task | Scope |
|---|---|---|
| 1 | Deliverable pipeline fix | Write `deliverable.md`, add `deliverablePath` to Job, update processor + debrief reporter |
| 2 | `store_image` MCP tool | Three input modes, sharp SVG→PNG, URL fetch + downscale, magic byte validation |
| 3 | Dashboard chat image rendering | Verify/fix DOMPurify, test markdown images inline, lightbox on click |
| 4 | Job detail view | Render full deliverable as markdown with images |
| 5 | Job timeline thumbnails | `screenshotIds` on Job, thumbnail strip, graceful 404 handling |
| 6 | Conversation restore images | Verify attachment + VAS image persistence on reload |
| 7 | WhatsApp outbound images | Parse markdown images, send via Baileys, strip syntax from text |
| 8 | Visual presenter skill | Brain skill for proactive visual communication + SVG guidelines |
| 9 | VAS cleanup invocation | Startup + periodic cleanup calls |
| 10 | E2E: image persistence | Upload image, close conversation, reopen, verify rendering |
| 11 | E2E: debrief with chart | One-off automation generates SVG chart, brief includes it, dashboard renders |
| 12 | E2E: job thumbnail lifecycle | Create, display, expire gracefully |
| 13 | E2E: web image search | Search for cat in hat, download, render in chat |
| 14 | E2E: WhatsApp image | Send image to WhatsApp, human verifies receipt (human-assisted) |

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
*Sprint: M8-S4 (Rich I/O)*
