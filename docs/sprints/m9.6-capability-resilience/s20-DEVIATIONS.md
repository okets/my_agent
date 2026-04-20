---
sprint: M9.6-S20
---

# S20 Deviations

## DEV-1 — Exit-gate helpers extracted into shared module (additive)

**Type:** Additive scope
**Plan reference:** §2.5.2 (exit-gate E2E tests)
**Reason:** The four phase-2 test files each duplicated ~150 lines of identical setup (isolated agentDir creation, capability stack wiring, orchestrator construction, polling helpers, assertion helpers). Extracting to `cfr-exit-gate-helpers.ts` was necessary to keep the two new exit-gate tests maintainable and to avoid a fifth copy of the same boilerplate. The extraction is purely additive — existing phase-2 test files are unchanged and continue to pass.
**Impact:** One new file (`cfr-exit-gate-helpers.ts`); no behaviour change to existing tests or production code.

## DEV-3 — Exit-gate tests use `.enabled`-missing as the broken state (easiest failure mode)

**Type:** Scope simplification
**Plan reference:** §2.5.2
**Reason:** The plan implied a more substantial corruption — a typo in `config.yaml`, a broken `CAPABILITY.md` field, or a script bug under `scripts/` — chosen so the fix-mode agent would have to diagnose and patch. The implementation used `.enabled` missing instead, because: (a) it is a genuine production failure mode (registry surfaces it as `not-enabled` symptom); (b) it is reproducible and reversible without touching real plug files; (c) it exercises the full orchestrator → spawnAutomation → Claude Code → reverify → reprocessTurn pipeline end-to-end. The fix (`touch <path>`) is the simplest possible repair and the test CLAUDE.md explicitly tells the agent the exact path, making this a constrained scaffolded test rather than a true adversarial scenario. A more adversarial test (config/script corruption) would require rolling back real plug files and is out of scope for S20.
**Impact:** The exit-gate tests verify the orchestration chain and the S20 terse-deliverable contract are wired correctly. They do NOT verify fix-mode's ability to diagnose and repair an opaque failure. That harder scenario is deferred to a future sprint (see s20-FOLLOW-UPS.md FU-1/FU-2 for related deferrals).

## DEV-2 — `MockTransport` class added to both `app-harness.ts` and helpers (intentional duplication)

**Type:** Structural
**Plan reference:** §2.5.2
**Reason:** `app-harness.ts` is the integration test harness (used by non-E2E tests); `cfr-exit-gate-helpers.ts` is the E2E helper module. Both needed `MockTransport` for their respective contexts. Merging them would create a cross-layer import dependency. The two implementations are identical; the duplication is acceptable given the separation of concerns.
**Impact:** None — two isolated class definitions, no shared mutable state.
