# M8-S4: Rich I/O -- External Review

**Reviewer:** Claude Opus 4.6 (external)
**Date:** 2026-03-31
**Verdict:** PASS with issues

---

## Spec Compliance

### 1. Deliverable Pipeline Fix -- PASS

- `deliverablePath` and `screenshotIds` added to `Job` type in `automation-types.ts`.
- Executor writes `deliverable.md` to `run_dir` when deliverable exists.
- `automation-processor.ts` reads full deliverable from disk (not truncated 500-char summary).
- `handler-registry.ts` (debrief reporter) checks `deliverablePath` first, falls back to `status-report.md`, then `summary`.
- Job detail API route (`/api/jobs/:id`) returns `fullDeliverable` and `screenshotIds`.
- DB schema migrated with `ALTER TABLE` (safe try/catch for idempotency).

### 2. store_image MCP Tool -- PASS

- Three input modes (SVG, base64, URL) correctly implemented.
- SVG validation: checks `<svg` prefix, infers dimensions from `viewBox` when `width`/`height` missing.
- Base64 validation: magic byte checks for PNG, JPEG, GIF.
- URL mode: Content-Type validation, magic byte validation, downscale to 4096px max.
- Returns `{ id, url, width, height }` as JSON text content block.
- `returnImage` returns MCP-format `{ type: "image", data, mimeType }` content block.
- MCP server wired in `app.ts` as `"image-tools"`.

### 3. Dashboard Rendering -- PASS

- DOMPurify configured with explicit `ADD_TAGS: ["img"]` and `ADD_ATTR: ["src", "alt", "width", "height"]`.
- Lightbox: delegated click handler on `.chat-md img`, overlay with escape key support.
- Broken image handling: `onerror="this.classList.add('img-broken')"` with CSS `display: none`.
- CSS: cursor pointer on images, hover opacity, lightbox overlay with backdrop blur.

### 4. Job Detail View -- PASS

- Job expansion fetches full deliverable via `/api/jobs/:id` on first click.
- Full deliverable rendered as markdown (with `renderMarkdown()`) instead of plain `x-text`.
- Screenshot thumbnail strip from `screenshotIds` with graceful 404 handling via `onerror`.

### 5. WhatsApp Outbound Images -- PASS

- Markdown image parsing with `extractMarkdownImages()` / `stripMarkdownImages()`.
- Image resolution via `resolveImagePath()` (VAS path lookup).
- First image sent with caption (cleaned text), subsequent images sent without caption.
- Graceful degradation: missing files are skipped, falls back to text-only if all images fail.
- Helper functions exported from plugin for testability.

### 6. Visual Presenter Skill -- PASS

- Brain-level skill with `store_image` tool dependency declared.
- SVG guidelines match spec (explicit dimensions, inline styles, system fonts, no foreignObject).
- Tokyo Night color palette included.
- Rules: images augment text, max 3 per response, skip silently if unsure.

### 7. VAS Cleanup Invocation -- PASS (skipped correctly)

- Decision D4 correctly identifies this was already implemented in S3.5.

### 8. VAS onScreenshot Unsubscribe -- PASS

- `onScreenshot()` now returns `() => void` unsubscribe function.
- Executor calls `unsubscribe()` after query completes.
- `ScreenshotSnapshot` protocol type extended with new source values.

---

## Critical Issues

None.

---

## Important Issues

### I1: SSRF -- no private IP filtering on URL fetch

`fetchImage()` in `image-server.ts` accepts any `http://` or `https://` URL with no validation against private/internal IP ranges (127.0.0.1, 10.x, 172.16-31.x, 192.168.x, 169.254.x, fd00::/8, etc.). Since the brain controls what URLs are passed, risk is limited to prompt injection scenarios, but it's still a defense-in-depth concern.

**Recommendation:** Add a private IP check after DNS resolution, or at minimum block `localhost` and `127.0.0.1` explicitly.

### I2: Redirect follows wrong HTTP module

In `fetchImage()`, the `httpModule` is selected once based on the original URL's protocol. If a redirect changes protocol (https to http or vice versa), the wrong Node.js module handles the redirected request. An `https://` to `http://` redirect would fail or behave incorrectly.

**Fix:** Re-select `httpModule` based on the redirect URL's protocol inside `makeRequest`.

### I3: No response size limit on URL fetch

`fetchImage()` accumulates chunks without a size limit. A malicious or misconfigured URL could return gigabytes of data and exhaust memory. The sharp downscale only applies after the full buffer is in memory.

**Recommendation:** Add a maximum response size (e.g., 50MB) and abort if exceeded.

### I4: WhatsApp image messages not cached for reaction context

The original `send()` method cached outgoing message IDs via `this.cacheMessage()` for reaction context. When sending images, the `sendMessage` results are not cached. This means reactions to image messages won't resolve correctly.

**Location:** `plugins/channel-whatsapp/src/plugin.ts`, the image sending loop.

---

## Minor Issues

### M1: Plan/implementation test divergence on returnImage format

The plan's test expected Anthropic API format (`source.type: "base64"`, `source.media_type: "image/png"`) but the implementation correctly uses MCP format (`data`, `mimeType`). The implementation is correct; the plan had the wrong format. Not a bug, but worth noting for plan accuracy.

### M2: Job detail inline click handler is dense

Decision D5 acknowledges this -- the `@click` handler in `index.html` for job expansion is a multi-statement inline expression. Works correctly but is hard to maintain. Consider extracting to a named function when refactoring the job list component.

### M3: Unused `parsed` variable in fetchImage

Line 80: `const parsed = new URL(reqUrl)` is created but only used for `parsed.origin` in redirect resolution. The variable shadows the outer `parsedUrl`. Minor but could cause confusion.

### M4: Missing test for URL mode (network dependency)

The test suite correctly avoids testing URL mode with real HTTP requests (no network in CI), but there's no mock/stub test for the URL fetch path. The `ftp://` rejection test only covers the scheme check. Consider adding a test with a mock HTTP server or at minimum testing the `fetchImage` error paths.

### M5: Roadmap S4 entry missing review/test-report links

The ROADMAP.md S4 entry only links `[plan]` but not `[review]` or `[test-report]`. These should be added after review artifacts are committed (the previous sprints all include these links).

---

## Test Coverage

### Strengths

- Image server handler thoroughly tested: all three modes, validation edge cases, returnImage.
- WhatsApp helpers have excellent coverage: single/multiple/empty image extraction, stripping, path resolution with filesystem tests.
- Deliverable pipeline has basic type/write verification.

### Gaps

- No integration test for the executor's screenshot collection via `onScreenshot`.
- No test for the `automation-processor.ts` full-deliverable-from-disk path.
- No test for the debrief reporter's `deliverablePath` fallback chain.
- No test for the job detail API route returning `fullDeliverable`.
- No mock test for `fetchImage` URL mode (only scheme rejection tested).
- No test for the DOMPurify configuration or lightbox behavior (frontend, would require browser tests).
- WhatsApp `send()` integration with image sending is not tested (would require Baileys mock).

### Assessment

24 new tests across 3 test files. Tests cover the core pure-function logic well. Integration testing is thin, which is acceptable for a sprint but should be addressed in E2E testing (Tasks 10-14 in the spec).

---

## Summary

Solid implementation that faithfully follows the design spec. The deliverable pipeline, image storage, dashboard rendering, and WhatsApp outbound changes are all well-structured and consistent. The important issues (SSRF filtering, redirect protocol, response size limit, message caching) are worth addressing but are not blocking -- they represent defense-in-depth improvements and an edge case in WhatsApp reaction context. No critical issues found.
