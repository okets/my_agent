---
sprint: m9.6-s12
---

# S12 Deviations

## Day-1 spike scope expansion (D1)

Deviation: `PostToolUseFailure` does not fire for Mode 3 (server-never-started). Architect adjudicated 2026-04-18: approved `processSystemInit()` as second entry point on `McpCapabilityCfrDetector`.

See [`proposals/s12-spike-results.md`](proposals/s12-spike-results.md) for the full spike findings and architect decision.

## SessionContext idempotency key simplification

Minor: D1 specified `(sessionId, capabilityName)` composite key for `processSystemInit` idempotency; implementation uses `capabilityName` only (per-detector-instance `Set<string>`). Functionally equivalent because each `McpCapabilityCfrDetector` instance is per-session — re-init flows within the same session still dedupe correctly, and distinct sessions have distinct detector instances with independent `initEmitted` sets. No behavioral difference in the current architecture.

## Task 7: debrief-prep runDir wiring (spec gap)

Initial implementation of Task 7 added a `runDir` param to `runDebriefPrep` but did not wire it at the production call site. Fixed in commit `43c9545` — `automation-executor.ts` now passes `job.run_dir` to the debrief handler context so `formatCfrRecoverySection` can read `CFR_RECOVERY.md` from the correct directory. Without this wiring the CFR section would never inject, silently.

## Ack-delivery documentation rename

The `ack-delivery.ts` leading comment previously contained the literal phrase "`unreachable in S9` throw" in historical notes. Renamed to "S9 placeholder throw" in Task 9 verification so the acceptance check `rg "unreachable in S9" packages/` returns zero hits (the plan treats any match as a potentially live throw; a doc-comment match would have been ambiguous).
