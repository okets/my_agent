# M8-S4: Rich I/O -- Test Report

**Date:** 2026-03-31
**Test runner:** vitest
**Type check:** `tsc --noEmit` -- PASS (zero errors)

---

## Results

```
Test Files:  98 passed | 3 skipped (101)
Tests:       879 passed | 8 skipped (887)
Duration:    25.47s
```

All existing tests continue to pass. No regressions introduced.

---

## New Tests (24 tests across 3 files)

### `tests/unit/mcp/image-server.test.ts` (9 tests)

| # | Test | Covers |
|---|------|--------|
| 1 | rejects when no input mode provided | Input validation -- zero modes |
| 2 | rejects when multiple input modes provided | Input validation -- multiple modes |
| 3 | stores SVG as PNG via sharp | SVG mode -- render, store, verify file on disk |
| 4 | infers SVG dimensions from viewBox | SVG mode -- viewBox fallback for width/height |
| 5 | rejects SVG without `<svg` prefix | SVG mode -- invalid input |
| 6 | stores valid base64 PNG | Base64 mode -- valid 1x1 PNG |
| 7 | rejects invalid base64 data (bad magic bytes) | Base64 mode -- non-image data |
| 8 | rejects invalid URL scheme (ftp://) | URL mode -- scheme validation |
| 9 | returns base64 content block when returnImage is true | returnImage flag -- MCP image content block |

### `tests/unit/automations/deliverable-pipeline.test.ts` (3 tests)

| # | Test | Covers |
|---|------|--------|
| 1 | Job type includes deliverablePath and screenshotIds | Type-level verification of new Job fields |
| 2 | Job works without deliverablePath and screenshotIds | Backward compatibility -- optional fields |
| 3 | deliverable.md written to run_dir when deliverable exists | File write simulation matching executor behavior |

### `tests/unit/whatsapp/outbound-images.test.ts` (12 tests)

| # | Test | Covers |
|---|------|--------|
| 1 | extracts a single markdown image | extractMarkdownImages -- basic case |
| 2 | extracts multiple markdown images | extractMarkdownImages -- two images |
| 3 | returns empty array for text with no images | extractMarkdownImages -- no match |
| 4 | handles empty alt text | extractMarkdownImages -- edge case |
| 5 | strips image syntax and trims result | stripMarkdownImages -- basic case |
| 6 | strips multiple images | stripMarkdownImages -- multi-image |
| 7 | returns original text when no images present | stripMarkdownImages -- no match |
| 8 | collapses excessive newlines after stripping | stripMarkdownImages -- whitespace cleanup |
| 9 | resolves a valid screenshot path | resolveImagePath -- file exists |
| 10 | returns null for missing files | resolveImagePath -- graceful degradation |
| 11 | extracts filename from full URL path | resolveImagePath -- path parsing |
| 12 | does not throw on missing files | resolveImagePath -- error safety |

---

## Coverage Gaps

| Area | Gap | Risk |
|------|-----|------|
| URL fetch mode | No mock HTTP server test | Medium -- only scheme validation tested, not actual fetch/downscale |
| Executor screenshot collection | No test for `onScreenshot` subscription/unsubscribe during job | Low -- straightforward listener pattern |
| Processor full deliverable | No test for reading deliverable from disk in notification path | Medium -- core pipeline path untested |
| Debrief reporter fallback chain | No test for deliverablePath -> status-report.md -> summary | Medium -- logic change in handler-registry.ts |
| Job detail API | No test for `/api/jobs/:id` returning fullDeliverable | Low -- thin route, reads file |
| Dashboard rendering | No DOMPurify config test, no lightbox test | Low -- frontend, needs browser environment |
| WhatsApp send integration | No test for actual `send()` with images via Baileys | Medium -- complex flow with multiple code paths |
| DB migration | No test for ALTER TABLE idempotency | Low -- try/catch handles it |

---

## Verdict

24 new tests all pass. Test quality is good for pure function coverage (image server handler, markdown parsing helpers, file operations). Integration-level gaps exist in the deliverable pipeline consumers and WhatsApp send path, which should be covered by the E2E tests planned in Tasks 10-14 of the sprint spec.
