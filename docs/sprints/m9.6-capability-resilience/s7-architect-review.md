# S7 Architect Review — E2E Incident Replay + Exit Gate

**Reviewer:** The architect
**Branch:** `sprint/m9.6-s7-e2e-incident-replay`
**Review date:** 2026-04-16
**Plan reviewed against:** [`plan.md`](plan.md) §9

---

## Verdict: **REJECTED — exit gate does not pass**

The S7 exit gate test has never been executed end-to-end. It has been declared passing on the basis of "the test compiles, the assertions look right, and the fixture is in place." I ran the test twice on this machine (where the fixture audio and `stt-deepgram` capability both exist — i.e. `canRun === true`) and got 2/2 failures both times.

**The milestone's entire purpose is proving the incident class is closed. That proof does not exist.** The roadmap commit (`b5ce1224`, marking M9.6 done) is incorrect and must be reverted.

---

## Evidence

### Run 1 — vitest without env loading

```
cd packages/dashboard && npx vitest run tests/e2e/cfr-incident-replay --testTimeout=180000
```

- **Tests: 2/2 failed** in 4.48s
- Root cause: `Error: No Anthropic authentication configured. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN` at `brain.ts:71`
- All 3 Sonnet execute spawns failed identically → surrender on iteration-3
- `.enabled` never created → assertion at line 343 fails
- `reprocessCalledWith` stays null → assertion at line 374 fails

### Run 2 — with `.env` loaded

```
node --env-file=.env $(which npx) vitest run tests/e2e/cfr-incident-replay --testTimeout=180000
```

- **Tests: 2/2 failed** in 6.31s
- Auth cleared, but all 3 Sonnet executes now fail with: `Error: Claude Code process exited with code 1`
- Same cascade: 3 failures → surrender → `.enabled` never created → reprocessTurn never called

The test harness has a problem beyond authentication. Either the automation subprocess is missing environment / config the production `App` provides, or there's a real orchestrator issue that only surfaces under real execution.

---

## The external review's gap

`s7-test-report.md:40` explicitly documents:

> *"API keys (DEEPGRAM_API_KEY, ANTHROPIC_API_KEY) are NOT checked as skip conditions in the code... If the audio and capability exist but API keys are missing, the test will run and fail at runtime rather than skip gracefully."*

The external reviewer **knew the test would fail on any machine without API keys loaded** — and approved without running it. This is the inverse of what an exit gate review is for.

`s7-review.md` writes:

> *"The test is well-structured and exercises the correct end-to-end path"*
> *"The test proves the M9.6 exit gate conditions"*

Neither statement was actually verified. "Proves" is a claim about test results, not test code. No "Tests: N passed" line appears anywhere in the S7 artifacts — compare S1-S6 test-reports, which all have explicit pass counts.

This is how exit gates quietly ship half-working.

---

## Plan ↔ code audit (what was checked)

Setting aside execution: the test file's **structure** matches plan §9.1 — fixture isolation in temp agentDir, `.enabled` removal, real automation stack wiring, skip guard on audio + capability presence. The `describe.skipIf(!canRun)` guard is correct. The 120s timeout budget is reasonable for real API calls.

**But none of that matters if the test never passes.**

---

## Other issues

### F1 — `blockedCommands` remains vacuous after "fix"

Commit `7015e75` claims to address F1 from the external review by replacing the vacuous `expect(blockedCommands).toHaveLength(0)` with a "structural proof comment". Looking at the code at `tests/e2e/cfr-incident-replay.test.ts:354-362`:

```typescript
// Structural proof: if the fix automation had issued `systemctl restart`,
// the safety hook at packages/core/src/hooks/safety.ts would have blocked
// it and the job would have ended as "failed". Recovery would not have
// completed, and the "voice messages" assertion above would have failed.
// No surrender = no blocked command = no manual intervention.
expect(surrenderEmitted).toBe(false);
expect(emittedAcks).not.toContain("surrender");
expect(emittedAcks).not.toContain("surrender-budget");
```

This is a better shape than the vacuous counter, but the current test **does** surrender (because the automation subprocess dies for unrelated reasons), so these assertions fail for the wrong reason. The test cannot distinguish "surrendered because blocked command" from "surrendered because subprocess died." When the upstream failures are fixed, these assertions will work correctly.

### F2 — "all observations closed" claim is false

Commit `7015e75` title: *"close all open issues at milestone completion"*. The commit promotes the review verdict to "APPROVED (all observations closed)" without the test ever passing. That's a premature closure. Observations about test shape being cleaner don't substitute for execution evidence.

### F3 — S6 FU1 marked resolved without verification visible in S7 branch

Commit `7015e75` says *"Mark S6-FU1 resolved: transcribe.sh already emits confidence + duration_ms (found during S7 cleanup inspection)"*. The file is in `.my_agent/`, which can't be inspected from this branch's diff. Either way, this is an out-of-scope edit to S6's follow-ups from within S7's branch — the exit gate sprint shouldn't be reshaping prior sprints' follow-up state.

---

## Required before re-review

**Do not proceed to M10 until this passes.** Steps:

1. **Diagnose the `Claude Code process exited with code 1` failure.** Run with `CLAUDE_AGENT_SDK_DEBUG=1` or equivalent to capture the subprocess stderr. Likely candidates:
   - Missing `CLAUDE_CODE_OAUTH_TOKEN` vs `ANTHROPIC_API_KEY` mismatch. Check which one `@anthropic-ai/claude-agent-sdk` expects in this SDK version.
   - The `fakeApp` at `cfr-incident-replay.test.ts:197-205` may be missing hooks/services the real `App` provides that the automation depends on. Compare against `App.create()`'s full initialization.
   - The automation's working directory: `AutomationExecutor` may cd into the temp agentDir; check if the subprocess needs `CLAUDE_CODE_CWD` or similar.
   - `agentDir` passed to `AutomationExecutor` — does it need an `AGENTS.md` at `agentDir/` or only at `agentDir/brain/`? Current test writes to the latter.

2. **Add explicit auth verification to `canRun`.** Extend the skip guard:
   ```typescript
   const hasAuth = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN);
   const canRun = hasAudio && hasSttDeepgram && hasAuth;
   ```
   Without this, the test gives a false positive on any machine without keys — and as we saw, still fails for a different reason when keys are present, so the skip must be loud.

3. **Document the correct invocation command in the test file header.** Whatever command pattern (env file, env vars, both) actually makes the test pass — write it. `npm run test:e2e` script (F2 from external review) is fine if it encodes the right flags; check that the script contains the env loading.

4. **Run it. Capture the passing output.** The S7 test-report must show `Tests: 2 passed` just like S1-S6 reports did. No exit gate is complete without execution evidence.

5. **Only after passing:** update the roadmap. The current commit marking M9.6 done is based on unverified claims and must be reverted or amended.

---

## What I am not asking for

- Do not lower the test assertions. The assertions are correct; the test harness is the problem.
- Do not relax the skip guard to make CI green by default. An exit gate that always skips is not an exit gate.
- Do not delete the 120s timeout. Real API calls take time.

---

## Paper trail

- `s7-DECISIONS.md` — 5 decisions, thoughtful.
- `s7-DEVIATIONS.md` — 3 deviations (DEV1 audio in `.local/`, DEV2 JSONL assertion scope, DEV3 blockedCommands counter). All reasonable individually. None of them address execution evidence.
- `s7-FOLLOW-UPS.md` — 4 items, two marked resolved after-the-fact.
- `s7-review.md` — the most important failure mode of this milestone: an external reviewer approving an exit gate they did not run.
- `s7-test-report.md` — lists assertions, fixtures, and skip conditions. Contains the smoking-gun sentence at line 40 about API keys not being enforced.

Commit hygiene: 3 commits, conventional-style. Roadmap-done commit was premature and must be reverted post-fix.

---

## What to do next

1. **Revert the roadmap commit (`b5ce1224`'s roadmap diff).** M9.6 is not done. The roadmap claim is false.
2. **Diagnose and fix** per the 5 steps above.
3. **Re-run with real execution evidence** (pass count in the new test-report).
4. **Ping me** — I will re-run the test independently to confirm. An exit gate requires external verification by someone other than the implementer.

---

**Rejected. Exit gate must actually pass before M9.6 can be declared done.**
