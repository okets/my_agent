# M8-S4: Rich I/O — CTO Review

**Reviewer:** CTO + Claude Opus 4.6 (Tech Lead)
**Date:** 2026-03-31
**Verdict:** FAIL — architecture needs redesign before shipping

---

## What Was Built

All 16 plan tasks were implemented, tests pass (880), types clean:

- **Deliverable pipeline**: full `deliverable.md` to disk, `deliverablePath` + `screenshotIds` on Job
- **`store_image` MCP tool**: SVG/base64/URL modes, sharp conversion, SSRF protection
- **Dashboard rendering**: DOMPurify img support, lightbox, job detail with full deliverable
- **WhatsApp outbound images**: parse markdown → Baileys media
- **Visual presenter skill**: brain-level, Tokyo Night palette, SVG guidelines
- **Visual augmentation hook**: post-response Haiku chart generation (safety net)
- **Model selector persistence**: localStorage fix
- **Brain-level skill loading**: framework `skills/` with `level: brain` frontmatter

## What Was Verified (Browser E2E)

| Test | Result |
|------|--------|
| `store_image` SVG → sharp → PNG → VAS → serve | **PASS** |
| Inline image in chat (when explicitly asked) | **PASS** |
| Lightbox click + Escape close | **PASS** |
| Graceful 404 for expired images | **PASS** (CSS `img-broken`) |
| Visual augmentation hook (AQI chart) | **PASS** — Haiku auto-generated chart |
| Proactive visual use (brain calls `store_image` unprompted) | **FAIL** — neither Sonnet nor Opus |
| "Show me a picture of a cat with hat" (URL fetch) | **FAIL** — brain said "I can't fetch images" |

## Why It Failed

### Problem 1: `store_image` is the wrong abstraction

One generic tool trying to serve three different use cases:
- **Charts/graphs** from data (SVG generation)
- **Web images** from URLs (fetch + store)
- **Raw image storage** (base64 passthrough)

The brain doesn't connect "I have AQI data" to "I should call store_image." The tool name doesn't signal intent. When asked for a picture, the brain doesn't realize `store_image({ url })` can fetch images.

### Problem 2: Proactive visual use requires a safety net

Even with the skill in the system prompt, both Sonnet and Opus skip chart generation when they can answer with text. The post-response hook (Haiku) works as a safety net but adds latency and cost. A better tool name would reduce reliance on the hook.

### Problem 3: Security concerns are mixed

URL fetching (SSRF risk, size limits, redirect attacks) lives in the same tool as SVG chart generation (zero network risk). Security review is harder when concerns are co-located.

---

## Proposed Architecture: Two Purpose-Built Tools

### `create_chart` — Data Visualization (no network, no security surface)

```
create_chart({
  data: [...],           // Structured data points
  type: "bar" | "line" | "gauge" | "diagram",
  title: string,
  description?: string,
})
```

**Or** accept raw SVG for custom visuals:

```
create_chart({ svg: "<svg>...</svg>", description: string })
```

- **No URL fetching, no base64, no network access**
- Brain sees data → tool name matches intent → higher proactive call rate
- The visual augmentation hook calls this directly
- SVG guidelines enforced in tool, not just skill

### `fetch_image` — URL Retrieval (all security here)

```
fetch_image({
  url: string,           // HTTP(S) URL to fetch
  description?: string,
})
```

- All SSRF protection, size limits, Content-Type validation concentrated here
- Brain sees "show me a picture" → web search → finds URL → `fetch_image`
- Future: pluggable backends (DALL-E, Flux via MCP marketplace)
- Clear security boundary for auditing

### Impact on existing work

| Component | Change needed |
|-----------|--------------|
| `image-server.ts` | Split into `chart-server.ts` + `image-fetch-server.ts` |
| Visual presenter skill | Update tool names, separate chart vs image guidance |
| Visual augmentation hook | Call `create_chart` handler instead of raw SVG generation |
| Tool descriptions | Purpose-specific — models will call them more reliably |
| Tests | Split accordingly, add structured data input tests |
| WhatsApp outbound | No change (renders `![](url)` regardless of source) |
| Dashboard rendering | No change (renders `<img>` regardless of source) |
| Deliverable pipeline | No change |

### What stays from S4

Most of the sprint work is reusable:
- Dashboard rendering (DOMPurify, lightbox, job detail) — **keep as-is**
- Deliverable pipeline — **keep as-is**
- WhatsApp outbound images — **keep as-is**
- VAS integration, sharp conversion — **keep, refactor into new tools**
- Visual augmentation hook — **keep, point at `create_chart`**
- SSRF protection, size limits — **move to `fetch_image` only**

### What needs redesign

- `store_image` → split into `create_chart` + `fetch_image`
- Visual presenter skill → separate "when to chart" vs "when to fetch"
- Tool descriptions → purpose-specific for better model behavior
- Consider: should `create_chart` accept structured JSON data (not just SVG)?

---

## Recommendation

**S4.1 sprint**: Refactor tools, re-verify with the same E2E tests. Most code carries forward — this is a tool boundary redesign, not a rewrite. Estimate: 1 sprint.

The pipeline infrastructure (VAS, sharp, dashboard rendering, WhatsApp, lightbox, deliverable pipeline, augmentation hook) is solid and proven. The issue is tool design, not plumbing.

---

## External Review Issues (addressed during sprint)

These were flagged by the automated external reviewer and fixed:

1. ~~SSRF risk~~ — Private IP filtering added
2. ~~Redirect protocol mismatch~~ — Per-redirect module selection
3. ~~No response size limit~~ — 50 MB cap added
4. ~~WhatsApp image messages not cached~~ — `cacheMessage()` added

---

## Test Results

- **880 tests pass**, 0 failures, 8 skipped (live tests)
- 25 new tests across 3 test files
- TypeScript: clean (core + dashboard)

---

*Sprint failed by CTO decision — tool architecture needs redesign before shipping.*
*All infrastructure work is preserved on branch `sprint/m8-s4-rich-io`.*
