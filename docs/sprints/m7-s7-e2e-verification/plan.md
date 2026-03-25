# M7-S7: E2E Verification

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Verify the full M7 automation stack works end-to-end — from manifest on disk to handler execution to job history to UI. Covers the S6 system automations conversion, all 4 trigger types, HITL resume, and the debrief adapter.

**Philosophy:** Every test in this sprint should be a test that, if it had existed before S6, would have caught a regression. These are the tests we wish we'd had.

**Test approach:** Two tiers.
- **Unit/integration tests** (Tasks 1-7, 10): Fast, deterministic, mock sessions. Run in `npx vitest run`. These catch structural regressions.
- **Live E2E tests** (Tasks 11-14): Real LLM calls via the running dashboard service. Slower, non-deterministic, but catch real integration bugs that mocks hide. Tagged with `@live` describe blocks and gated behind `DASHBOARD_URL` env var — skip gracefully when dashboard isn't running. Use Haiku for cost efficiency except where Sonnet is required.

Nina isn't in production yet — tests can call the API freely.

**Spec:** `docs/superpowers/specs/2026-03-22-m7-spaces-automations-jobs.md`

**Depends on:** S6 (system automations + calendar rewire)

---

## Task 1: Handler registry dispatch — unit tests

**Files:**
- Create: `packages/dashboard/tests/unit/automations/handler-registry.test.ts`

Verify the core S6 mechanism: built-in handlers execute instead of SDK sessions.

- [ ] Step 1: Test `registerHandler` + `getHandler` — register a handler, retrieve it, confirm unknown keys return undefined
- [ ] Step 2: Test that all 5 expected handlers are registered on import (`debrief-prep`, `daily-summary`, `weekly-review`, `weekly-summary`, `monthly-summary`)
- [ ] Step 3: Test `AutomationExecutor.execute()` with a manifest that has `handler: "debrief-prep"` — confirm it calls the registered handler instead of spawning an SDK session (mock `createBrainQuery` and assert it's NOT called)
- [ ] Step 4: Test `AutomationExecutor.execute()` with an unknown handler key — confirm it throws
- [ ] Step 5: Test `AutomationExecutor.execute()` with a manifest WITHOUT a handler field — confirm it falls through to the SDK session path (assert `createBrainQuery` IS called)
- [ ] Step 6: Verify build

**Commit:** `test(m7-s7): handler registry dispatch — unit tests`

---

## Task 2: System automation protection — unit tests

**Files:**
- Create: `packages/dashboard/tests/unit/automations/system-automation-protection.test.ts`

Verify system automations can't be modified or deleted through any path.

- [ ] Step 1: Create a system automation (manifest with `system: true`) via `AutomationManager`
- [ ] Step 2: `manager.update(id, { name: "hacked" })` throws error
- [ ] Step 3: `manager.disable(id)` throws error
- [ ] Step 4: `db.listAutomations({ excludeSystem: true })` does NOT include it
- [ ] Step 5: `db.listAutomations()` (no filter) DOES include it, with `system: true` and `handler` populated
- [ ] Step 6: Create a user automation, confirm update/disable work normally
- [ ] Step 7: Verify build

**Commit:** `test(m7-s7): system automation protection — unit tests`

---

## Task 3: Debrief automation adapter — unit tests

**Files:**
- Create: `packages/dashboard/tests/unit/mcp/debrief-automation-adapter.test.ts`

Verify the adapter bridges DebriefSchedulerLike to the automation job system.

- [ ] Step 1: `hasRunToday("debrief-prep")` returns false when no jobs exist
- [ ] Step 2: Create a completed debrief job with today's date in the jobs table, confirm `hasRunToday` returns true
- [ ] Step 3: `getDebriefOutput()` returns the job's summary when a completed job exists
- [ ] Step 4: `getDebriefOutput()` returns null when no job exists
- [ ] Step 5: `handleDebriefPrep()` calls the registered `debrief-prep` handler and returns its output (mock the handler to avoid real file I/O)
- [ ] Step 6: Lazy initialization — confirm adapter works when `getJobService()` initially returns null, then returns a real service
- [ ] Step 7: Verify build

**Commit:** `test(m7-s7): debrief automation adapter — unit tests`

---

## Task 4: Work-patterns migration — integration test

**Files:**
- Create: `packages/dashboard/tests/e2e/work-patterns-migration.test.ts`

Verify that existing hatched agents with work-patterns.md get their automations created on upgrade.

- [ ] Step 1: Set up a temp agentDir with `notebook/config/work-patterns.md` containing the old format (jobs: debrief-prep, daily-summary with cadences)
- [ ] Step 2: Ensure `automations/` directory is empty
- [ ] Step 3: Call `migrateWorkPatternsToAutomations(agentDir)`
- [ ] Step 4: Assert automation manifest files were created in `automations/`:
  - `debrief.md` — user automation, handler: debrief-prep, cron derived from cadence
  - `system-daily-summary.md` — system: true, handler: daily-summary
  - `system-weekly-review.md` — system: true, disabled
  - `system-weekly-summary.md` — system: true, disabled
  - `system-monthly-summary.md` — system: true, disabled
- [ ] Step 5: Parse each manifest and verify frontmatter fields are valid
- [ ] Step 6: Call migration again — assert it's idempotent (doesn't duplicate files)
- [ ] Step 7: Test edge case: agentDir with NO work-patterns.md — migration is a no-op

**Commit:** `test(m7-s7): work-patterns migration — integration test`

---

## Task 5: Full automation lifecycle — integration test

**Files:**
- Create: `packages/dashboard/tests/e2e/automation-lifecycle.test.ts`

End-to-end test: manifest file → sync → DB indexing → scheduler trigger → executor → handler → job recorded.

- [ ] Step 1: Create a temp agentDir with an `automations/` directory
- [ ] Step 2: Write a system automation manifest file (`test-handler.md`) with `system: true`, `handler: "test-handler"`, cron trigger
- [ ] Step 3: Register a mock handler for `"test-handler"` that returns `{ success: true, work: "test output", deliverable: null }`
- [ ] Step 4: Create `AutomationManager` + `AutomationSyncService` → call `sync()` → verify automation appears in DB with `system: true` and `handler: "test-handler"`
- [ ] Step 5: Create `AutomationExecutor` → manually fire the automation → verify:
  - Job created in DB with status `"completed"`
  - Job summary matches handler output
  - Handler was called (not SDK session)
- [ ] Step 6: Create a user automation manifest (no `system`, no `handler`) → fire it → verify SDK session path is attempted (mock `createBrainQuery`)
- [ ] Step 7: Verify `listAutomations({ excludeSystem: true })` returns only the user automation

**Commit:** `test(m7-s7): full automation lifecycle — integration test`

---

## Task 6: Trigger type E2E — schedule, watch, channel, manual

**Files:**
- Create: `packages/dashboard/tests/e2e/trigger-types.test.ts`

Verify all 4 trigger types correctly fire automations.

- [ ] Step 1: **Schedule trigger**: Create automation with `cron: "* * * * *"` (every minute). Call `AutomationScheduler.checkDueAutomations()` directly. Verify a job is created.
- [ ] Step 2: **Manual trigger**: Fire automation via `AutomationProcessor.process()` with `context: { trigger: "manual" }`. Verify job completes.
- [ ] Step 3: **Watch trigger**: Create automation with `trigger: [{ type: "watch", path: "/tmp/test-watch" }]`. Emit a synthetic file change event. Verify the automation fires.
- [ ] Step 4: **Channel trigger**: Create automation with `trigger: [{ type: "channel", hint: "invoice" }]`. Verify `getAutomationHints()` returns the hint. (Channel trigger matching is done by Haiku in PostResponseHooks — test the hint extraction, not the LLM matching.)
- [ ] Step 5: Verify build

**Commit:** `test(m7-s7): trigger type E2E — schedule, watch, channel, manual`

---

## Task 7: HITL resume flow — integration test

**Files:**
- Create: `packages/dashboard/tests/e2e/hitl-resume.test.ts`

Verify the needs_review → user reply → resume_job chain.

- [ ] Step 1: Create an automation and fire it with a mock SDK session that returns `needs_review` status text
- [ ] Step 2: Verify job status is `"needs_review"` in DB
- [ ] Step 3: Call `AutomationProcessor.resume(jobId, "user's answer")` with a mock session that returns completed status
- [ ] Step 4: Verify job status transitions to `"completed"`
- [ ] Step 5: Verify the resume session receives the user's answer in its context
- [ ] Step 6: Verify `needs_review` jobs are NOT pruned by run directory cleanup

**Commit:** `test(m7-s7): HITL resume flow — integration test`

---

## Task 8: Calendar UI — browser verification

**Files:**
- Create: `packages/dashboard/tests/e2e/calendar-ui.test.ts`

Playwright browser test: verify calendar renders timeline data.

- [ ] Step 1: Start dashboard (or use running service)
- [ ] Step 2: Navigate to calendar tab
- [ ] Step 3: Verify FullCalendar renders (container element exists, no JS errors)
- [ ] Step 4: Insert test jobs into the timeline API (via direct DB insert or debug API)
- [ ] Step 5: Refresh calendar — verify events appear with correct colors (completed=green, failed=red, projected=cyan)
- [ ] Step 6: Click an event — verify it opens the automation detail tab
- [ ] Step 7: Take screenshot for review artifact

**Commit:** `test(m7-s7): calendar UI — browser verification`

---

## Task 9: Settings + automation detail UI — browser verification

**Files:**
- Create: `packages/dashboard/tests/e2e/settings-automations-ui.test.ts`

Playwright browser test: verify settings and automation detail tab.

- [ ] Step 1: Navigate to settings tab
- [ ] Step 2: Verify automation schedule editor renders (user automations with editable cron, system automations read-only)
- [ ] Step 3: Verify no work-patterns settings section exists
- [ ] Step 4: Navigate to automation detail tab (via automations widget click)
- [ ] Step 5: Verify job history timeline section renders
- [ ] Step 6: Verify system automation has no edit/delete controls
- [ ] Step 7: Take screenshots for review artifact

**Commit:** `test(m7-s7): settings + automation detail UI — browser verification`

---

## Task 10: Conversation initiator reply routing — regression test

**Files:**
- Create: `packages/dashboard/tests/e2e/conversation-initiator-routing.test.ts`

Regression test for the bug fixed before S6 — agent-initiated conversations must set `externalParty` and `channel` so replies route back.

- [ ] Step 1: Create a `ConversationInitiator` with mock transport (returns ownerJid and connected status)
- [ ] Step 2: Call `initiate()` → verify the created conversation has `externalParty` set to the owner JID
- [ ] Step 3: Verify the assistant turn stored has `channel` set to the transport ID
- [ ] Step 4: Simulate incoming reply: call `getByExternalParty(ownerJid)` → verify it finds the initiated conversation
- [ ] Step 5: Verify the force-new-conversation logic does NOT trigger (last turn channel matches incoming channel)
- [ ] Step 6: Test `alert()` path: inject into active conversation → verify assistant turn has `channel` set

**Commit:** `test(m7-s7): conversation initiator reply routing — regression test`

---

## Task 11: Live E2E — built-in handlers produce real output

**Files:**
- Create: `packages/dashboard/tests/live/handler-execution.test.ts`

Real LLM calls through the built-in handler chain. Verifies the full path: handler-registry → queryModel → createBrainQuery → Haiku API → structured output written to disk.

**Prerequisites:** Dashboard service running, `ANTHROPIC_API_KEY` set.

- [ ] Step 1: Set up a temp agentDir with realistic notebook structure (daily log with a few entries, a properties file, a staging file)
- [ ] Step 2: Run the `daily-summary` handler directly — verify:
  - Returns `{ success: true }` with non-empty `work`
  - Output is coherent markdown (not error text or empty)
  - Summary file was written to `notebook/summaries/daily/`
  - Took < 30s (Haiku should be fast)
- [ ] Step 3: Run the `debrief-prep` handler — verify:
  - Returns `{ success: true }` with non-empty `work`
  - Output written to `notebook/operations/current-state.md`
  - Output references data from the seeded notebook context
  - Staged fact attempt counters were incremented
- [ ] Step 4: Run `weekly-summary` handler with 3 daily summaries seeded — verify output summarizes across days
- [ ] Step 5: Run `monthly-summary` handler with a weekly summary seeded — verify coherent monthly output

**Timeout:** 120s per test (real API calls)

**Commit:** `test(m7-s7): live E2E — built-in handlers produce real output`

---

## Task 12: Live E2E — user automation with real SDK session

**Files:**
- Create: `packages/dashboard/tests/live/user-automation-execution.test.ts`

Fire a user automation (no `handler` field) through the full chain with a real SDK session. Verifies AutomationExecutor → createBrainQuery → real model response → job completion.

- [ ] Step 1: Write a user automation manifest: `name: "Test Research"`, `trigger: [{ type: manual }]`, instructions: "Write a single paragraph about the color blue. Keep it under 50 words."
- [ ] Step 2: Wire up real `AutomationExecutor` with real `createBrainQuery` (no mocks)
- [ ] Step 3: Fire the automation via `AutomationProcessor.process()`
- [ ] Step 4: Verify:
  - Job created with status `"completed"` (not failed, not needs_review)
  - Job summary is non-empty and contains text about blue
  - `sdk_session_id` is populated on the job
  - Run directory was created with session artifacts
- [ ] Step 5: Fire a second automation with instructions that should fail gracefully: "Respond with exactly: TASK_COMPLETE" — verify job completes (tests the status detection logic with real model output)

**Model:** Haiku (cheapest, fast enough)
**Timeout:** 60s per test

**Commit:** `test(m7-s7): live E2E — user automation with real SDK session`

---

## Task 13: Live E2E — HITL resume with real model

**Files:**
- Create: `packages/dashboard/tests/live/hitl-live.test.ts`

Real needs_review → resume flow with actual LLM calls. This is the flow that broke for the user (WhatsApp replies landing in wrong conversation) — test the automation side end-to-end.

- [ ] Step 1: Write a user automation with instructions: "Ask the user: What is their favorite color? Mark this as needs_review with the question."
- [ ] Step 2: Fire the automation with real SDK session
- [ ] Step 3: Verify job status is `"needs_review"` and summary contains a question
- [ ] Step 4: Resume the job with user response: "My favorite color is green"
- [ ] Step 5: Verify:
  - Job transitions to `"completed"`
  - Final output acknowledges the user's answer ("green" appears in output)
  - Session was resumed (not a new session — same `sdk_session_id`)
- [ ] Step 6: Verify the `resume_job` MCP tool path — call it via the MCP server tool handler with the job ID and user response, confirm it produces a result

**Model:** Sonnet (needs instruction following for needs_review detection)
**Timeout:** 120s per test

**Commit:** `test(m7-s7): live E2E — HITL resume with real model`

---

## Task 14: Live E2E — on-demand debrief through MCP tool

**Files:**
- Create: `packages/dashboard/tests/live/debrief-mcp.test.ts`

Test the full chain the user hits: brain calls `request_debrief` MCP tool → debrief adapter → handler registry → debrief-prep handler → Haiku → structured output.

- [ ] Step 1: Set up temp agentDir with notebook data (daily log, properties, calendar events if possible)
- [ ] Step 2: Create `DebriefAutomationAdapter` with a real `AutomationJobService`
- [ ] Step 3: Call `adapter.handleDebriefPrep()` — verify:
  - Returns non-empty string
  - Output is structured debrief (contains section headers)
  - Output references seeded notebook data
- [ ] Step 4: Call `adapter.hasRunToday("debrief-prep")` — should return false (on-demand debrief doesn't create a tracked job through the adapter currently; verify this is the expected behavior or fix it)
- [ ] Step 5: Call `adapter.handleDebriefPrep()` again — verify it produces a fresh result (no stale cache from the old WorkLoopScheduler)
- [ ] Step 6: Create the full MCP server via `createDebriefMcpServer(adapter)` and invoke the `request_debrief` tool — verify the tool response is valid JSON with a `debrief` field

**Model:** Haiku (debrief uses the model from preferences, default to haiku for tests)
**Timeout:** 120s per test

**Commit:** `test(m7-s7): live E2E — on-demand debrief through MCP tool`

---

## Live Test Infrastructure

All live tests share a common pattern:

```typescript
// packages/dashboard/tests/live/helpers.ts

const DASHBOARD_URL = process.env.DASHBOARD_URL || "http://localhost:4321";

export async function isDashboardReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${DASHBOARD_URL}/api/automations`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function requireDashboard() {
  return isDashboardReachable().then((ok) => {
    if (!ok) {
      console.warn("Dashboard not reachable — skipping live tests");
    }
    return ok;
  });
}

export function requireApiKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
```

Live tests use `describe.skipIf(!available)` so they pass silently in CI or when the dashboard isn't running. They only fail when explicitly invoked with the right environment.

Run live tests separately: `npx vitest run tests/live/`

---

## Summary

| # | Task | Type | LLM | Scope |
|---|------|------|-----|-------|
| 1 | Handler registry dispatch | Unit | Mock | Core S6 mechanism |
| 2 | System automation protection | Unit | Mock | Security boundary |
| 3 | Debrief automation adapter | Unit | Mock | WorkLoopScheduler replacement |
| 4 | Work-patterns migration | Integration | None | Upgrade path |
| 5 | Full automation lifecycle | Integration | Mock | Manifest → handler → job |
| 6 | Trigger types E2E | Integration | Mock | schedule, watch, channel, manual |
| 7 | HITL resume flow | Integration | Mock | needs_review → resume_job |
| 8 | Calendar UI | Browser | None | Timeline data in FullCalendar |
| 9 | Settings + detail UI | Browser | None | Automation schedule editor |
| 10 | Reply routing regression | Integration | Mock | ConversationInitiator fix |
| 11 | Built-in handler execution | **Live E2E** | **Haiku** | Handler → queryModel → real output |
| 12 | User automation execution | **Live E2E** | **Haiku** | SDK session → job completion |
| 13 | HITL resume with real model | **Live E2E** | **Sonnet** | needs_review → resume → completion |
| 14 | On-demand debrief via MCP | **Live E2E** | **Haiku** | Adapter → handler → MCP tool |

## Success Criteria

- [ ] Tasks 1-10 pass in `npx vitest run` (no API key required)
- [ ] Tasks 11-14 pass in `npx vitest run tests/live/` (requires running dashboard + API key)
- [ ] Browser tests produce screenshot artifacts
- [ ] Zero regressions in existing 931-test suite
- [ ] Handler registry test proves built-in handlers bypass SDK sessions
- [ ] Migration test proves idempotent upgrade path
- [ ] Reply routing test would have caught the pre-S6 bug
- [ ] Live tests prove real Haiku/Sonnet output flows through the handler chain correctly
- [ ] Live HITL test proves needs_review → resume produces coherent follow-up
- [ ] Live debrief test proves the adapter + MCP tool chain replaces WorkLoopScheduler without degradation
