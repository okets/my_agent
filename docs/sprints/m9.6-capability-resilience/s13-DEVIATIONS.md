---
sprint: m9.6-s13
date: 2026-04-18
---

# M9.6-S13 Deviations

## DEV-1 — "not found in registry" dispatch test uses two-call registry mock

**What:** The `dispatchReverify` test for "not found in registry" uses a registry that returns `available` on the first `get()` call (for `waitForAvailability`) then `undefined` on the second (for capDir resolution), rather than always returning `undefined`.

**Why:** The spec's always-undefined approach would cause `waitForAvailability` to poll for 10 seconds before timing out, then return `pass: false` via the "still unavailable" branch — testing the wrong code path. The two-call mock correctly reaches the intended `"not found in registry"` branch at the capDir resolution step.

**Impact:** None — the test correctly exercises the intended code path. Spec reviewer confirmed acceptable.
