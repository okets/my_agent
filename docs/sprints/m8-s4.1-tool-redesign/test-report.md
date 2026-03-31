# M8-S4.1: Tool Redesign — Test Report

**Date:** 2026-03-31
**Test runner:** vitest + Playwright (browser E2E)

## Unit Tests

**880 pass, 0 failures, 8 skipped (live tests)**

### New/Modified Test Files

| File | Tests | Status |
|------|-------|--------|
| `tests/unit/mcp/chart-server.test.ts` | 5 | Pass |
| `tests/unit/mcp/image-fetch-server.test.ts` | 3 | Pass |
| `tests/unit/mcp/image-server.test.ts` | — | Deleted (replaced by above) |

### Chart Server Tests
- SVG → PNG conversion (valid SVG with explicit dimensions)
- SVG dimension inference from viewBox
- Rejects non-SVG input
- Returns `{ id, url, width, height }` shape
- Description passed through to VAS

### Image Fetch Server Tests
- Rejects invalid URL scheme (ftp://)
- Blocks private/internal IPs (SSRF — 6 addresses tested)
- Rejects empty URL

## Browser E2E Tests (Playwright)

All tests run via Playwright MCP against the live dashboard at `http://100.71.154.24:4321`.

### T7: Proactive chart generation

**Test:** Ask "How was the AQI in Chiang Mai this week?" — no mention of charts.

**Result:** Brain responds with text data (AQI readings: 151-164, 263, 164). Brain does NOT call `create_chart` proactively. Visual augmentation hook fires → detects bulleted data with 3+ numbers → Haiku generates SVG bar chart → chart appended as follow-up message.

**Screenshot:** `screenshots/12-hook-fallback-working.png`
**Verdict:** PASS (via hook fallback)

### T7b: Explicit chart request

**Test:** After text response, user says "show it in a chart".

**Result:** Brain calls `create_chart` with SVG, embeds `![chart](url)` in response. Chart renders inline.

**Screenshot:** `screenshots/10-create-chart-explicit.png`
**Verdict:** PASS

### T8: Image fetch — cat with hat

**Test:** Ask "Show me a picture of a cat with a hat".

**Result:** Brain web-searches, finds image URL, calls `fetch_image`, embeds inline. Image renders in chat with "One dapper cat" text.

**Screenshot:** `screenshots/11-cat-with-hat.png`
**Verdict:** PASS

### T9: Temperature chart (hook fallback)

**Test:** Ask "How was the temperature in Chiang Mai this week?"

**Result:** Brain responds with temperature data. Hook detects bulleted list with numbers → Haiku generates "Chiang Mai Temperature (March 24-31)" chart with highs/lows lines.

**Screenshot:** `screenshots/13-temperature-chart.png`
**Verdict:** PASS

### T10: WhatsApp image delivery

**Test:** Send "What's the weather forecast for Pattaya next week?" via WhatsApp.

**Result:** Brain responds with weather data on WhatsApp. Hook generates chart. Chart delivered as WhatsApp media message.

**Verdict:** PASS (after fixing agentDir resolution)

### T10b: WhatsApp image fetch

**Test:** Send "Show me a dog in a swimsuit" via WhatsApp.

**Result:** Brain web-searches, fetches image via `fetch_image`, sends as WhatsApp media. Image arrives correctly.

**Verdict:** PASS WITH CONCERN — intermediate thinking text concatenated into WhatsApp message (known issue, documented in review.md)

## Lightbox Verification

| Test | Result |
|------|--------|
| Click image → lightbox overlay | PASS |
| Escape key closes lightbox | PASS |
| Broken image URL → hidden (no broken icon) | PASS (CSS `.img-broken`) |

**Screenshot:** `screenshots/07-lightbox-open.png`
