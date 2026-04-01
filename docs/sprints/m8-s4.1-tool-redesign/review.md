# M8-S4.1: Tool Redesign — Review

**Reviewer:** CTO + Claude Opus 4.6 (Tech Lead)
**Date:** 2026-03-31
**Verdict:** PASS

## What Was Done

Split `store_image` (one generic tool) into two purpose-built tools:
- `create_chart` — SVG data visualization, no network access
- `fetch_image` — URL image retrieval, all security concentrated here

Updated visual presenter skill with purpose-specific guidance, added standing order for visual communication to hatching, updated augmentation hook.

## E2E Verification (Browser + WhatsApp)

| Test | Result |
|------|--------|
| `create_chart` explicit ("show it in a chart") | PASS |
| `fetch_image` ("cat with hat") | PASS |
| Augmentation hook fallback (AQI data) | PASS |
| WhatsApp image delivery | PASS |

## Issues Found and Fixed During Sprint

- Haiku analysis too conservative → replaced with deterministic heuristic
- SVG sanitization: unescaped `&` and `°` → added pre-processing
- WhatsApp agentDir resolution: relative path wrong → directory walk-up
- Dead base64 code in fetch_image → removed (code review)

## Test Results

880 tests pass, 0 failures.
