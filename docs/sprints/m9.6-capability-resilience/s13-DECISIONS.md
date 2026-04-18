---
sprint: m9.6-s13
date: 2026-04-18
---

# M9.6-S13 Decisions

## D1 — dispatchReverify replaces reverify() as entry point; reverify kept as deprecated alias

**Decision:** The old monolithic `reverify()` export is replaced by `dispatchReverify()`. The old name is kept as `export const reverify = dispatchReverify` for backward compatibility with existing tests that call `reverify` directly.

**Why:** S13 adds per-type routing — the monolith had hardcoded audio-to-text + availability fallback. A clean rename with alias avoids breaking the test suite while making the intent clear.

**Removal:** Alias removal deferred to Phase 3 (post-S16 fix-engine swap, S18 cleanup sprint per FU-1 in s13-FOLLOW-UPS.md).

## D2 — reverifyImageToText falls through to runSmokeFixture when ocr.sh absent

**Decision:** When `ocr.sh` is not present in the capability's `scripts/` folder, `reverifyImageToText` falls through to `runSmokeFixture` rather than failing.

**Why:** Some image-to-text installations might not ship `ocr.sh` in the template (template gap). Smoke fixture provides a reasonable availability check and can emit inconclusive (exit-2) correctly.

## D3 — verificationInputPath sourced from ReverifyResult (not computed in orchestrator)

**Decision:** `verificationInputPath` is populated by each reverifier and bubbled up through `ReverifyResult` rather than computed in the orchestrator.

**Why:** The reverifier is the only entity that knows which artifact it used for verification — audio path, script path, etc. Computing it in the orchestrator would require the orchestrator to have type-specific knowledge.

## D4 — readFileSync in reverifyTextToAudio/reverifyTextToImage uses static import

**Decision:** `readFileSync` is statically imported from `node:fs` alongside `existsSync`. An early draft used dynamic `await import("node:fs")` — replaced during code review (code quality review pass, Task 2).

**Why:** Node.js built-in modules are always available; dynamic import adds overhead with no benefit and obscures the dependency from static analysis.

## D5 — inconclusive (exit-2) from runSmokeFixture routes to RESTORED_TERMINAL

**Decision:** When `runSmokeFixture` returns `{ pass: true, inconclusive: true, recoveredContent: undefined }`, the orchestrator routes it to the `RESTORED_TERMINAL` path (terminal-fixed ack, no reprocess).

**Why:** Inconclusive means the external resource was unavailable — the capability might be healthy. Treating it as a success (terminal path, not surrender) avoids false positives while not triggering unnecessary retries.
