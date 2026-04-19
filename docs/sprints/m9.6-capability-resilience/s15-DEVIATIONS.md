# S15 Deviations

## D-EXT — MockTransport / AppHarness recording pattern (§2.7 substitution)

**Spec says:** §2.7 references a `MockTransport` recording approach in `app-harness.ts`.
**What was done:** All 4 E2E tests use the direct `cfr.emitFailure()` pattern — same as the S7 exit gate — with `emitAck` and `reprocessTurn` callbacks as recorders. No `MockTransport` added to AppHarness.
**Rationale (D2 in DECISIONS.md):** The direct-emit pattern tests recovery-loop correctness without requiring the full chat-service stack. It is the established pattern from S7 and is sufficient for the Phase 2 coverage bar. MockTransport would test the detection-trigger wiring, which is separately covered at the unit level (S10/S12/TTS unit tests).
**Risk:** None — both approaches exercise the same orchestrator paths. The substitution is defensible and was noted by the self-audit.

---

No other deviation proposals filed. All other scope within `plan-phase2-coverage.md §2.7` boundaries.

The following unplanned fixes were made but are within the spirit of the sprint (fixing pre-conditions for the exit gate to run):

1. **reverifyTextToAudio MP3 header fix** — pre-existing S13 bug discovered during TTS E2E test run. Fixed inline (see D7 in DECISIONS.md). No plan amendment needed — plan §Task 1.5 already anticipated finding and fixing pre-existing S13 bugs.

2. **reverify-tts.test.ts script fixture update** — test scripts used `$1` for output path; updated to `$2` to match new synthesize.sh arg contract. This is the test update anticipated in the plan's Task 1.5 guidance.

3. **Core dist rebuild** — Vitest resolves `@my-agent/core` from compiled dist. After source changes, `npx tsc` was required to make the E2E tests use the updated reverify logic. This is an operational note, not a deviation from scope.
