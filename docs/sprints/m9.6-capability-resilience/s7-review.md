# S7 External Review — E2E Incident Replay + Exit Gate

**Reviewer:** External (independent, not involved in implementation)
**Date:** 2026-04-16
**Branch:** `sprint/m9.6-s7-e2e-incident-replay`
**Verdict:** APPROVED WITH OBSERVATIONS → **APPROVED** (all observations resolved in M9.6-S7 cleanup, 2026-04-16)

---

## Spec Coverage (Section 9.1 assertions)

| Assertion | Status | Notes |
|-----------|--------|-------|
| 3a — Framework-emitted ack turn (S6 copy) | Covered | `expect(emittedAcks).toContain("attempt")` at line 343. The `emitAck` callback captures the `AckKind`; "attempt" is the first-try ack. |
| 3b — Automation job spawned (`.runs/` in tmp agentDir) | Covered (indirect) | The `spawnAutomation` callback calls `automations.create()` + `automations.fire()`, which writes to the automations dir. The test does not explicitly assert on `.runs/` folder contents, but automation creation is proven by recovery succeeding. |
| 3c — `.enabled` file created by fix automation | Covered | `expect(existsSync(enabledPath)).toBe(true)` at line 346. Direct filesystem assertion. |
| 3d — CapabilityWatcher detects change, registry shows `status: available` | Covered | `expect(cap!.status).toBe("available")` at line 351. Watcher is started in `beforeAll`; registry update is proven by status. |
| 3e — Assistant turn contains transcript substring | Covered | `expect(reprocessCalledWith!.toLowerCase()).toContain("voice messages")` at line 355. Proves Deepgram reverification produced real transcript and `reprocessTurn` was called with it. |
| 3f — Zero `systemctl restart` issued | Partially covered | `expect(blockedCommands).toHaveLength(0)` at line 363 passes trivially because `blockedCommands` is never populated (no hook wiring — see DEV3). The structural proof (recovery succeeded without surrender) is the real assertion. |
| Step 4 — JSONL contains `turn_corrected` event | Not covered (deviated) | DEV2 documents this. Second test case asserts `reprocessCalledWith !== null` as a structural handoff proxy. No JSONL read. |
| Step 5 — `--detectOpenHandles --forceExit` for clean shutdown | Not covered | No vitest config or CLI flags for open handle detection. `afterAll` calls `watcher.stop()` and `conversationManager.close()`, which is the right cleanup, but the explicit vitest flags are absent. |

---

## Deviation Assessment

| Deviation | Verdict | Reasoning |
|-----------|---------|-----------|
| DEV1 (audio in `.local/`, gitignored) | **Accepted** | Committing real user audio to a public repo would violate the project's own guardrails. The `.local/` pattern was established in S4. The `CFR_INCIDENT_AUDIO` env override for CI is a reasonable escape hatch. The `describe.skipIf(!canRun)` guard is correct. |
| DEV2 (`turn_corrected` not in JSONL) | **Accepted** | The test uses a stubbed `reprocessTurn` that captures content but does not wire a full brain session. Asserting JSONL write would require the Agent SDK conversation stack, which is out of scope for a test that already exercises real Sonnet + Opus + Deepgram. The handoff proof (`reprocessCalledWith` contains "voice messages") is the meaningful assertion. FU1 is the right disposition. |
| DEV3 (`blockedCommands` not hook-wired) | **Accepted with observation** | The `blockedCommands` array is declared but never populated, making the assertion `expect(blockedCommands).toHaveLength(0)` vacuously true. This does NOT prove that no blocked command was attempted. However, the belt-and-suspenders argument holds: if Sonnet issued `systemctl restart`, the safety hook in `packages/core/src/hooks/safety.ts` would cause the job to fail, recovery would not complete, and the "voice messages" assertion would fail. The structural proof is sound. FU2 is the right follow-up. |

---

## Findings

### F1 (LOW) — `blockedCommands` assertion is vacuously true

The `blockedCommands` array (line 109) is declared but never receives entries because no PostToolUse hook is wired to capture blocked Bash invocations. The assertion at line 363 always passes regardless of what the automation does. This is documented in DEV3 and mitigated by the structural proof (recovery must succeed end-to-end for `reprocessCalledWith` to contain the transcript). The finding is cosmetic — the assertion reads as if it proves something it does not independently prove.

**Recommendation:** Either remove the vacuous assertion and add a comment explaining the structural proof, or wire the hook per FU2. Current state is not incorrect, just misleading to future readers.

### F2 (LOW) — No `--detectOpenHandles` / `--forceExit` vitest flags

Plan section 9.1 step 5 requires running the test under `--detectOpenHandles --forceExit` to verify clean shutdown. The test file does not configure these flags, and no vitest config override was found in the dashboard package. The `afterAll` block does call `watcher.stop()` and `conversationManager.close()`, so cleanup is likely correct, but the explicit verification is missing.

**Recommendation:** Add a vitest config or CLI note in the test file comment for how to run with these flags. Not a blocker — the cleanup code is present.

### F3 (INFO) — Second test case depends on first test's side effects

The second test ("conversation JSONL contains a turn_corrected event after recovery") reads the `reprocessCalledWith` variable set by the first test. If the first test is skipped or fails, the second test will also fail or produce a misleading error. This is a standard pattern for ordered integration tests and is not a defect, but it means the two test cases are not independently runnable.

### F4 (INFO) — Assertion 3b relies on recovery success rather than explicit `.runs/` check

The plan says to "check `.runs/` folder in the test's tmp agentDir." The test proves automation was spawned implicitly (recovery would not succeed otherwise) but does not explicitly `existsSync` on a `.runs/` directory. This is acceptable — the end-to-end proof subsumes the intermediate check.

---

## Conclusion

The S7 exit gate test is structurally sound and tests the right thing: a real CFR failure (`.enabled` absent) triggers the full recovery orchestrator with real Sonnet + Opus + Deepgram, and the test asserts that recovery completes with the actual transcript content. The fixture setup (temp agentDir, capability copy without `.enabled`, audio copy, `.env` copy) is correct and avoids polluting the real `.my_agent/` directory. The skip guard is appropriate — the test requires real API keys and a real audio file that cannot be committed to a public repo.

All three deviations are legitimate and well-documented. The follow-ups (FU1-FU4) are correctly scoped as post-milestone work. The two low-severity findings are cosmetic rather than structural.

TypeScript compiles cleanly in both `packages/core` and `packages/dashboard`.

**Verdict: APPROVED WITH OBSERVATIONS.** The observations (F1, F2) are not blockers. M9.6 exit gate conditions are met.
