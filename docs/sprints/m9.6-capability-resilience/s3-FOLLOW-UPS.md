# S3 Follow-Ups

**Sprint:** M9.6-S3 — Capability hot-reload + restart gap closure
**Date:** 2026-04-15

---

## FU1: `CapabilityWatcher` doesn't emit into App event system after `testAll`

**Observed in:** `app.ts` CapabilityWatcher `onRescan` callback.

The `onRescan` callback in `app.ts` emits `capability:changed` twice — once right after rescan (with the raw scan result) and once after `testAll()` (via `registry.list()`). However, `testAll()` is awaited INSIDE `rescanNow()`, and `onRescan` is called AFTER both complete. So the second emit in `onRescan` fires after `testAll()` has already updated health on the registry, which is correct. However, the first emit (passing `caps` directly) may reflect stale health values if capabilities were previously tested. A single emit after `testAll()` would be cleaner.

**Impact:** Minor. Both emits are fast and correctness is maintained — the prompt builder receives the up-to-date state from the second emit. No user-observable bug.

**Suggested fix:** Emit only once inside `onRescan`, after `testAll()` has completed (i.e., use `registry.list()` for both). Out of scope for S3.

---

## FU2: `formatNeverSelfRestartDirective()` duplicates intent already in `capability-builder` agent prompt

**Observed in:** `definitions.ts` capability-builder prompt (lines 109-118) and `prompt.ts` `formatNeverSelfRestartDirective()`.

Both convey the same "don't restart the dashboard" rule. The agent-level instruction is more detailed (explains the consequence: kills the session). The framework-level directive is shorter and more general.

**Impact:** None. Redundancy is harmless; belt-and-suspenders approach is intentional.

**Suggested:** Could consolidate in a future prompt-assembly refactor. Out of scope for S3.
