# S17 — Orchestrator Iteration Investigation

**Date:** 2026-04-19
**Finding:** Root cause confirmed — single issue, not compound.

## Root Cause

`automation-executor.ts` sets `job.status = "completed"` for successful SDK runs (line ~671 and ~979). `awaitAutomation` in `app.ts` recognises `KNOWN_TERMINAL = {"done", "failed", "needs_review", "interrupted", "cancelled"}` — `"completed"` is absent.

Result: the loop hits the unknown-status branch, logs a warning, and returns `{status: "failed"}`.

The orchestrator receives `executeResult.status === "failed"` for every successful fix-mode attempt. `executeSuccess = false`. The attempt is recorded as `verificationResult: "fail"`, `nextAction(session, {type: "EXECUTE_JOB_DONE", success: false})` is called, and the loop iterates. All three attempts run even when attempt 1 landed a correct fix.

## Source-vs-adapter decision (Step 1.4a)

Grepped for all consumers of `"completed"` in production code:

```
packages/dashboard/src/mcp/debrief-automation-adapter.ts: status: "completed"
packages/dashboard/src/app.ts: status: "completed"
packages/dashboard/src/mcp/automation-server.ts: status: "completed" (×2)
packages/dashboard/src/automations/automation-executor.ts: finalStatus = "completed" (×3 sites)
packages/dashboard/src/automations/automation-job-service.ts: | "completed" (Job type union)
```

`"completed"` is the canonical job status for successful automation runs throughout the codebase. It's part of the `Job` type union in `automation-job-service.ts:67`. Changing the source to emit `"done"` would require updating the `Job` type and all downstream consumers.

**Decision: adapter fix.** Add `"completed"` to `KNOWN_TERMINAL` and normalise to `"done"` in the return value. This is the minimal, least-disruptive fix.

Additional evidence: the E2E test files already contain `const mappedStatus = job.status === "completed" ? "done" : job.status` — the same mapping (`cfr-phase2-stt-replay.test.ts`, `cfr-phase2-tts-replay.test.ts`, `cfr-incident-replay.test.ts`, `cfr-phase2-browser-synthetic.test.ts`, `cfr-phase2-desktop-synthetic.test.ts`). The fix was already applied in tests but never made it into the production closure.

## Secondary hypothesis ruled out

`dispatchReverify` calls `watcher.rescanNow()` at line 334 before reading capability state. Stale-watcher is NOT a contributing factor — reverify always gets current state.

## Smoke output source (Step 5.4a)

`failure.detail` is populated by the invoker from `msg` (the execFile error message) on `execution-error` and `timeout` failures. Node's execFile error message includes stderr: "Command failed: /path/to/smoke.sh\n{stderr}". So for script execution failures, `detail` IS essentially the smoke output. For `not-enabled`/`not-installed`, `detail` is a short descriptive message — still informative as smoke context. Wiring `failure.detail` as `smokeOutput` is correct.

## Expected impact

Per-attempt wall-time drops to single-attempt territory: ~122 s (TTS) and ~113 s (browser-chrome) instead of 480 s / 652 s accumulated over 3 spurious attempts. Both plugs were Branch B/C only because of this bug.

Item B bug has likely existed since Phase 1 — every CFR fix-mode run has been iterating 3 times. Phase 1 S7 STT exit gate (142 s) is roughly consistent with 3 iterations of ~50 s each.
