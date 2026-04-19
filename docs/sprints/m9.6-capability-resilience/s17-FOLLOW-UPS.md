# M9.6-S17 FOLLOW-UPS

## FU-3: Thread smokeOutput through automation-executor to job context

`AutomationSpec.smokeOutput` is populated and included in the fix prompt (Item A), but not persisted to the job's context record in `automation-executor.ts`. A future sprint could write it to the job context so QA agents and debrief flows can reference it without re-parsing the prompt.

**Priority:** Low — the data is already in the prompt, which is the critical path.

---

## FU-4: Verify wall-time improvement with real plugs

Expected impact per the investigation document:
- TTS branch B/C: ~122 s per attempt (was ~480 s across 3 attempts)
- Browser-chrome branch B/C: ~113 s per attempt (was ~652 s)

These numbers are projections based on the S16 replay timings. A live replay test should confirm once the fix is deployed.

**Acceptance:** Re-run `cfr-phase2-tts-replay.test.ts` and `cfr-phase2-browser-synthetic.test.ts` with real plugs and compare wall times.

---

## FU-5: Tighten integration test to assert spawnCount === 1 end-to-end

`packages/dashboard/tests/integration/orchestrator-completed-status.test.ts` tests the status normalisation bridge at the `AutomationJobService` level. It does not test the full orchestrator + reverify loop because the live reverify requires real capability scripts. A future sprint with a mock invoker could assert `spawnCount === 1` end-to-end via the `RecoveryOrchestrator` directly.
