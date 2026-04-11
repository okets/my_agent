# M9.5-S6: Screenshot Pipeline

> **Status:** Approved design, pending implementation plan
> **Spec date:** 2026-04-11
> **Parent spec:** `docs/design/capability-framework-v2.md` (S6 section)
> **Prior art:** `docs/superpowers/specs/2026-03-29-m8-desktop-automation-design.md` (Screenshot Tagging & Retention)

---

## Problem

The screenshot interceptor middleware (built in S1, wired in S3) only **detects** base64 images in MCP tool results — it logs but does not store them. Desktop screenshots never reach VAS. Meanwhile, Playwright screenshots are stored via a dedicated bridge (`PlaywrightScreenshotBridge`). This creates two problems:

1. **Desktop screenshots are invisible to the user.** They exist only in the brain's context window, never rendered in chat or job timelines.
2. **No unified pipeline.** Each image-producing capability must build its own storage path. Adding a new capability (e.g., image generation) means writing another bridge.

The M8 design spec proposed agent tagging (`keep`/`skip`) + pixel-diff fallback for filtering intermediate screenshots. That design assumed an inner `desktop_task` action loop. Post-M9.5-S3, the brain calls individual `desktop_*` tools directly via SDK — there is no inner loop. The tagging approach needs adaptation.

## Solution

**Store all screenshots. Let the brain curate.**

A single generic interceptor runs on every PostToolUse result. If the result contains a base64 image, the interceptor stores it in VAS and injects the URL back into the tool result. The brain — which already reasons about every screenshot to decide its next action — selects which screenshot URLs to include when composing its reply or job summary. No tagging system, no pixel diff, no per-capability schema changes.

This replaces the M8 tag/filter design with a simpler model that leverages the brain's existing reasoning.

---

## Prerequisites

### Task 0: Verify `tool_response` Shape

Before any implementation, run a test with a real SDK session where a desktop MCP tool returns a screenshot. Log the exact shape of `input.tool_response` as received by the PostToolUse hook.

**Why:** The SDK declares `tool_response: unknown`. The interceptor assumes MCP format (`{ content: [{ type: 'image', data: '...' }] }`), but the SDK may transform MCP results to Anthropic API format (`{ type: 'image', source: { type: 'base64', data: '...' } }`). If the shape assumption is wrong, the entire pipeline fails silently.

**How:** Add a temporary `console.log(JSON.stringify(input.tool_response, null, 2))` to the existing PostToolUse hook in `session-manager.ts`, call `desktop_screenshot` via the dashboard, read the log. Remove the temporary log after.

**Outcome:** The exact shape determines how `findImageContent()` must be written. Implementation proceeds only after this is known.

### Prior Sprint Items

S4 resolved the crash monitoring dead code (S3-I1: removed) and the enabled-gate bypass (S3-I2: fixed with `c.enabled` predicate in MCP factory registration). No carryover items affect S6.

---

## Architecture

### Pipeline Flow

```
MCP Tool (desktop, playwright, any)
  → returns base64 image in tool result
    → PostToolUse hook fires
      → Interceptor detects image (hasScreenshot)
      → Extracts base64 (extractImage)
      → Parses metadata from text content block (description, width, height)
      → Infers source from tool name (desktop_* → "desktop", browser_* → "playwright", else → "generated")
      → Stores in VAS: vas.store(Buffer.from(base64, 'base64'), metadata) → Screenshot { id, filename, url }
      → Returns updatedMCPToolOutput: original content + appended text block "Screenshot URL: /api/assets/screenshots/ss-xxx.png"
        → Brain sees image (for reasoning) AND URL (for referencing)
          → Brain composes reply/summary with selected screenshot URLs as markdown images
            → Ref scanner indexes URLs in conversation turns and job summaries
              → Dashboard renders images inline (existing markdown pipeline + lightbox)
                → VAS cleanup removes unreferenced screenshots after 7 days
```

### Components Modified

| Component | File | Change |
|-----------|------|--------|
| Screenshot interceptor | `packages/core/src/capabilities/mcp-middleware.ts` | Add `storeAndInject()` method accepting a `store` callback (not a VAS import — core must not depend on dashboard). Extract → call store callback → return `updatedMCPToolOutput`. |
| PostToolUse hook | `packages/dashboard/src/agent/session-manager.ts` | Fix `tool_result` → `tool_response` bug. Change matcher from `desktop_.*` to catch-all. Call `storeAndInject()` with a closure that wraps `vas.store()`. |
| Automation executor | `packages/dashboard/src/automations/automation-executor.ts` | Wire PostToolUse hook in `buildJobHooks()` (currently only has Stop hooks). Add Playwright MCP server factory for workers. Add curation instruction to worker prompt. |
| Desktop capability instructions | `.my_agent/capabilities/desktop-x11/CAPABILITY.md` | Add screenshot curation guidance for brain. |
| Source detection | `packages/core/src/capabilities/mcp-middleware.ts` | Tool name prefix → `ScreenshotSource` mapping. |
| Image format detection | `packages/core/src/capabilities/mcp-middleware.ts` | `findImageContent()` must handle both MCP format (`{ type: 'image', data }`) and Anthropic API format (`{ type: 'image', source: { type: 'base64', data } }`). Task 0 determines which the SDK actually passes, but supporting both makes the interceptor robust. |

### Components NOT Modified

| Component | Why |
|-----------|-----|
| VAS (`visual-action-service.ts`) | `store()` already accepts `Buffer` + `ScreenshotMetadata`. No schema changes needed. |
| Ref scanner (`app.ts:553-566`) | Already indexes screenshot URLs in conversation turns and job summaries. |
| Dashboard rendering | Markdown pipeline already allows `<img>`, lightbox already works on `.chat-md img`. |
| Desktop MCP server | No tool schema changes. The text content block JSON already carries `description`, `scaleFactor`, `width`, `height`. |
| `ScreenshotMetadata` / `Screenshot` types | Existing fields sufficient. No tag fields added. |
| `PlaywrightScreenshotBridge` | Continues to work as-is. The bridge's `browser_screenshot_and_store` tool stores directly via VAS and returns images in Anthropic API format — the interceptor's `hasScreenshot()` won't match it (different content block shape), so no duplicate storage risk. Bridge deprecation is out of scope; once the generic interceptor handles `@playwright/mcp` tool results via PostToolUse, the bridge becomes redundant but harmless. |

### Source Detection Map

```typescript
function inferSource(toolName: string): ScreenshotSource {
  if (toolName.startsWith('desktop_')) return 'desktop'
  if (toolName.startsWith('browser_') || toolName.startsWith('playwright_')) return 'playwright'
  return 'generated'
}
```

Extensible: add prefixes as new capabilities arrive.

### `storeAndInject()` Signature and DI

The interceptor lives in `packages/core` but VAS lives in `packages/dashboard`. To avoid a cross-package dependency, `storeAndInject()` accepts a `store` callback:

```typescript
type StoreCallback = (image: Buffer, metadata: ScreenshotMetadata) => { id: string; filename: string }

interface StoreAndInjectResult {
  hookSpecificOutput?: {
    hookEventName: 'PostToolUse'
    updatedMCPToolOutput: {
      content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
    }
  }
}

function storeAndInject(
  toolResponse: unknown,
  toolName: string,
  store: StoreCallback,
): StoreAndInjectResult
```

At wiring time in `session-manager.ts` and `automation-executor.ts`, the caller passes a closure:

```typescript
const store: StoreCallback = (image, metadata) => {
  const ss = vas.store(image, metadata)
  return { id: ss.id, filename: ss.filename }
}
```

### Concrete `updatedMCPToolOutput` Shape

The return value appends a text block with the VAS URL to the original content array:

```typescript
return {
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    updatedMCPToolOutput: {
      content: [
        ...originalContent,
        { type: 'text', text: `Screenshot URL: /api/assets/screenshots/${screenshot.filename}` },
      ],
    },
  },
}
```

This shape mirrors MCP tool result format. Task 0 validates that the SDK accepts it and passes it through to the brain's context.

### Bug Fix: PostToolUse Field Name

The current hook in `session-manager.ts` checks `'tool_result' in input` but the SDK type `PostToolUseHookInput` uses `tool_response`. This is fixed as part of the wiring work — not a separate task.

### Metadata Parsing Fallbacks

When the text content block JSON cannot be parsed (missing, malformed, or absent fields):

| Field | Fallback | Rationale |
|-------|----------|-----------|
| `width` | `0` | Signals "unknown" — VAS stores it but UI can handle gracefully |
| `height` | `0` | Same |
| `description` | `undefined` | Optional field in `ScreenshotMetadata` |
| `source` | `inferSource(toolName)` | Always deterministic from tool name |

---

## Brain Curation

The brain is the curator. Two instruction points:

### Desktop Capability Instructions

Added to `.my_agent/capabilities/desktop-x11/CAPABILITY.md`:

> After completing a visual task, include the most relevant screenshot URL(s) as markdown images in your reply. Don't include every intermediate screenshot — pick the ones that show the result or key moments.

### Automation Worker Changes

Two changes to `automation-executor.ts`:

**1. Playwright MCP server for workers.** Currently workers only get `chart-tools` and `image-fetch-tools`. To exercise the screenshot pipeline, workers need `@playwright/mcp` when Playwright is available. Add the Playwright MCP server factory alongside the existing visual servers in the `workerMcpServers` block (gated on Playwright availability, same pattern as `chart-tools`).

**2. PostToolUse hook in `buildJobHooks()`.** Currently only wires a Stop hook. Add the same screenshot interceptor PostToolUse hook that `session-manager.ts` uses, with the VAS store callback.

**3. Curation instruction in worker prompt:**

> When your task involves visual output (screenshots, images), include the most relevant screenshot URL(s) as markdown images in your summary. Pick the result, not the journey.

### What the User Sees

| Context | Display |
|---------|---------|
| Conversation reply | Brain's markdown with selected screenshot(s) inline |
| Job timeline summary | Brain's markdown with selected screenshot(s) inline |
| VAS (all screenshots) | Accessible via debug/admin API; unreferenced ones cleaned after 7 days |

---

## Testing Strategy

### Unit Tests (packages/core)

| Test | What it verifies |
|------|-----------------|
| `storeAndInject()` with PNG image | VAS `store()` called with correct `Buffer`, metadata (`width`, `height`, `source`). Returns `updatedMCPToolOutput` with original content + URL text block. |
| `storeAndInject()` without image | Returns `{}`. VAS not called. |
| `storeAndInject()` with non-PNG image | Returns `{}`. Only PNG (base64 prefix `iVBORw0KGgo`) triggers storage. |
| Source detection | `desktop_click` → `"desktop"`, `browser_navigate` → `"playwright"`, `generate_image` → `"generated"`. |
| Metadata parsing | Extracts `description`, `width`, `height` from text content block JSON. Falls back to `width: 0, height: 0` if parsing fails. |
| Dual image format | Detects images in both MCP format (`{ type: 'image', data }`) and Anthropic API format (`{ type: 'image', source: { type: 'base64', data } }`). |

### Integration Test (packages/dashboard, headless App)

| Test | What it verifies |
|------|-----------------|
| Full PostToolUse chain | Wire interceptor with real VAS (temp dir). Mock MCP tool returns base64 PNG. Verify: file on disk, URL in `updatedMCPToolOutput`, JSONL index entry. |
| Ref scanner integration | Send a conversation turn containing a screenshot URL. Verify `vas.addRefs()` called with `conv/<id>`. |
| Automation path | Run a mock automation that returns an image tool result. Verify: VAS stores screenshot, job summary can reference it. |

### Smoke Test: CNN Homepage

**Prompt sent to brain via headless App:**

> "Schedule a one-time automation to run in 15 minutes: take a screenshot of cnn.com and show me the homepage."

**Expected flow:**
1. Brain creates a one-shot scheduled automation (15 min delay)
2. Test waits for / fast-forwards to trigger
3. Automation worker runs → Playwright navigates cnn.com → multiple screenshots (navigation, page load, final)
4. Worker composes job summary with the final homepage screenshot as a markdown image
5. Job completes

**Verify:**
- VAS has 2+ screenshots stored (intermediate + final)
- Job summary contains exactly 1 screenshot URL (the loaded homepage)
- That URL resolves to a valid PNG via `/api/assets/screenshots/ss-*.png`
- Ref scanner indexed the URL under `job/<automationId>/<jobId>`

**Why this test:**
- Exercises the automation path (not conversation — avoids Nina taking over)
- Requires scheduling (not immediate execution)
- Generates multiple screenshots but only one matters
- Validates brain curation end-to-end
- Runs against a real brain session (per S8 rule: no mocks for agent compliance)

### Smoke Test: KWrite Desktop Read

**Prompt sent to brain via dashboard chat (conversation path):**

> "Read the text from my unsaved work on KWrite, it is minimized."

**Expected flow:**
1. Brain calls `desktop_info(windows)` → finds KWrite window ID (screenshot generated)
2. Brain calls `desktop_focus_window` → brings KWrite to foreground (screenshot generated)
3. Brain calls `desktop_screenshot` → captures KWrite content (screenshot generated)
4. Brain reads the text, composes reply with the key screenshot showing KWrite content

**Verify:**
- VAS has 3+ screenshots stored (one per tool call that returns an image)
- Brain's conversation reply contains 1 screenshot URL (the KWrite content, not the intermediate focus/info steps)
- That URL resolves to a valid PNG via `/api/assets/screenshots/ss-*.png`
- Ref scanner indexed the URL under `conv/<conversationId>`
- Screenshot renders inline in the chat bubble in the dashboard

**Why this test:**
- Exercises the conversation path (complements the CNN automation path)
- Uses desktop MCP tools (not Playwright) — validates that both tool families flow through the same interceptor
- Multi-step desktop interaction generates several screenshots but only the result matters
- Validates brain curation in conversation context (not job summary)
- Runs against a real brain session with real desktop interaction

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| `tool_response` shape unknown | **Task 0 (prerequisite).** Log actual shape before any implementation. If SDK transforms MCP format, adjust `findImageContent()` accordingly. Both MCP and Anthropic API formats supported defensively. |
| `updatedMCPToolOutput` shape rejected by SDK | Task 0 also validates this — test that the brain receives the injected URL text block. Concrete shape specified in this spec. |
| Brain doesn't include screenshot URLs in replies | Curation instructions in capability + worker prompt. Smoke test validates. If brain consistently ignores URLs, escalate as design deviation. |
| Large images bloat VAS disk | Existing 7-day cleanup handles unreferenced screenshots. All screenshots are PNG (lossless) as produced by the tools — no re-encoding. |
| Catch-all matcher intercepts non-MCP tools (Bash, Read, etc.) | `hasScreenshot()` checks for `content[]` with `type: 'image'` — non-MCP tools don't return this shape. No false positives. |
| Duplicate storage for `browser_screenshot_and_store` | No risk: the bridge returns Anthropic API format images, interceptor's `hasScreenshot()` checks MCP format. Different content block shapes means no match. Documented in Components NOT Modified. |
| Smoke test flaky (network-dependent CNN load) | Use a stable URL fallback (e.g., `example.com`) if CNN fails. The test validates the pipeline, not the website. |

### Note: Ref Scanner Timing

Screenshot refs are added when conversation turns are persisted (`onTurnAppended`) or job summaries are written (`job:completed`), not during streaming. This means there's a brief window where a screenshot is unreferenced. The 7-day cleanup window makes this harmless — no action needed, but implementers should not expect immediate ref indexing.

---

## Out of Scope

- **Pixel-diff filtering** — replaced by brain curation
- **Agent tagging (`keep`/`skip`)** — replaced by brain curation
- **Screenshot thumbnails in conversation sidebar** — existing job timeline thumbnails work; conversation-specific thumbnail strip is a future enhancement
- **Image format conversion** — tools produce PNG, VAS stores PNG, no conversion needed
- **PlaywrightScreenshotBridge refactor** — continues to work independently; dedup with the generic interceptor is a future cleanup
