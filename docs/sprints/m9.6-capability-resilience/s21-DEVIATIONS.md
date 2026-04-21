# S21 Deviations

## DEV-1 — BUG-5 root cause was auth, not path resolution

**Plan said:** "Fix cfr-exit-gate-automation.test.ts precondition path resolution."

**What actually happened:** The bug was `hasAuth = false` (ANTHROPIC_API_KEY not in process.env when running plain `vitest`), not a path resolution error. The browser-chrome plug was present all along.

**Fix applied:** `ensureDashboardEnvLoaded()` in cfr-exit-gate-helpers.ts auto-loads `packages/dashboard/.env` if auth vars are unset. This is a better fix than fixing a path — it solves the root cause and benefits all E2E helpers.

**Side effect:** The fix caused BUG-5 to reveal BUG-5b — tests now ran when auth was present but failed because CLAUDECODE was set. Fixed with D3 guard.

## DEV-2 — `reprocessTurn` gate path replaces `sendSystemMessage`, not wraps it

**Plan said:** The gate resolves and the brain "picks up the transcription."

**What was built:** When the gate is present, `reprocessTurn` resolves it and returns early — it does NOT call `sendSystemMessage`. If no gate exists (brain already processed), it falls through to `sendSystemMessage` as before.

**Why this is better:** Avoids two brain turns for the same user input. The gate-resolution path is the happy path; sendSystemMessage is now a fallback for the no-gate case only.

## DEV-3 — `cfr-stt-reprocess-chain.test.ts` counted as integration test, not unit

**Plan said:** Write as a unit test with a stub invoker.

**What was built:** The test uses makeAutomationStack + makeOrchestrator (real automation executor), just with a stub invoker. This puts it squarely in integration territory. The stub invoker keeps it free of real API calls, but it still can't run inside Claude Code (CLAUDECODE guard applied).

**Impact:** None on correctness — the test validates the full reprocessTurn chain more realistically than a pure unit test would.
