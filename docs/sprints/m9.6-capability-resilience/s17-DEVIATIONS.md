# M9.6-S17 DEVIATIONS

## DV1: Budget test interim ceiling

**Spec:** Budget test should assert `spawnCount === 3` and `toBeLessThanOrEqual(4)` post-S17.

**Interim:** Task 4 (state machine) committed the test with `toBeLessThanOrEqual(5)` ceiling because the reflect block was still present in the orchestrator at that point.

**Resolution:** Task 5 deleted the reflect block and updated the budget test to `expect(spawnCount).toBe(3)` and `toBeLessThanOrEqual(4)`. The interim state was on the branch for < 30 minutes between commits.

---

## DV2: `smokeOutput` field not plumbed through to automation-executor

**Spec:** The `smokeOutput` field was added to `AutomationSpec` and the `## Smoke Output` section added to the fix prompt.

**Status:** `automation-executor.ts` receives `AutomationSpec.smokeOutput` via `spawnAutomation` but does not currently pass it anywhere — it is available in the spec object for future routing. The prompt itself already contains the smoke output, so the fix agent has the data it needs. Threading `smokeOutput` through to the job runner for structured access is a FOLLOW-UP item (see s17-FOLLOW-UPS.md).
