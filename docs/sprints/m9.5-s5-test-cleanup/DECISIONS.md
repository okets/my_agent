# M9.5-S5: Decisions Log

## D1: Nina's tool UX feedback (S4 deferred C4)

**Date:** 2026-04-11
**Full review:** `ninas-review.md`

**What she used:** `desktop_screenshot`, `desktop_info(windows)`, `desktop_click`, `desktop_key` (accidental — trying to focus a window).

**Biggest gap:** No `desktop_focus_window(windowId)` tool. She had window ID `0x0400000c` from `desktop_info` but couldn't focus it. Had to fumble with taskbar clicks instead. The X11 backend already implements `focusWindow()`.

**Coordinate confusion:** Screenshot is scaled down but she doesn't know the scale factor until she clicks wrong. Wants `scaleFactor` included with every screenshot response.

**Optional tools she'd reach for regularly:** `window_screenshot`, `find_element`, `OCR`. All stay optional but are high-value.

**Action items:**
1. Add `desktop_focus_window` as 8th required tool (Task 7) — she had window IDs but couldn't focus them
2. Include `scaleFactor` in screenshot metadata (Task 8) — she couldn't predict coordinate mapping
3. OCR, find_element, window_screenshot stay optional — high value but not minimum-viable
