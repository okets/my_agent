# M7-S9: E2E Test Suite — Design Spec

> **Goal:** Verify the full M7 automation stack works end-to-end using real services — no mocked business logic. Every test exercises the actual automation machinery through AppHarness or Playwright.
>
> **Replaces:** The mocked unit/integration tests from S7 tasks 1-7, 10. Those remain on master as fast regression guards, but S9 proves the system actually works.
>
> **Depends on:** S8 (debrief worker architecture)

---

## Principles

1. **Real services, not mocks.** Tests wire up real AutomationManager, AutomationExecutor, AutomationProcessor, AutomationJobService, handler-registry — same initialization as `App.create()`.
2. **Mock only the boundary.** The SDK session (`createBrainQuery`) is the only mock for non-LLM tests. Live tests remove even that.
3. **Two test surfaces.** Headless App for backend automation logic. Playwright for dashboard UI.
4. **Gate, don't fail.** Live tests require `ANTHROPIC_API_KEY`. Playwright tests require a running dashboard. Both skip gracefully when unavailable.

---

## Infrastructure: AppHarness Automation Support

### What changes

Add `withAutomations: true` option to `AppHarness.create()`. When enabled, the harness wires up the full automation stack into a temp directory, mirroring the `App.create()` initialization sequence:

```
AppHarness
├── automations: AppAutomationService    ← NEW (mirrors App.automations)
├── automationManager: AutomationManager ← NEW
├── automationJobService: AutomationJobService ← NEW
├── automationExecutor: AutomationExecutor ← NEW
├── automationProcessor: AutomationProcessor ← NEW
├── conversations: AppConversationService
├── chat: AppChatService
├── debug: AppDebugService
├── ...existing services
```

### Initialization sequence (inside `AppHarness.create`)

1. Create `automations/` directory in temp agentDir
2. Get `ConversationDatabase` from `conversationManager.getConversationDb()`
3. Create `AutomationManager(automationsDir, db)`
4. Create `AutomationJobService(automationsDir, db)`
5. Create `AutomationExecutor({ automationManager, jobService, agentDir, db })`
6. Create `AutomationProcessor({ automationManager, executor, jobService, agentDir, onJobEvent })` — wire `onJobEvent` to `harness.emitter`
7. Create `AppAutomationService(manager, processor, jobService, harness.emitter)` → expose as `harness.automations`

### Mock session integration

For headless tests that exercise the SDK session path (user automations), `installMockSession` already patches `sessionRegistry`. The AutomationExecutor calls `createBrainQuery` directly (not through sessionRegistry), so we need a separate mock mechanism:

- Provide a `mockCreateBrainQuery` helper that patches the import for the test file
- Or: accept that non-LLM user automation tests still mock `createBrainQuery` at the module level (this is the SDK boundary, not business logic)

**Decision:** Mock `createBrainQuery` at module level for non-LLM tests. This is the external boundary — we're testing that our automation stack correctly orchestrates the call, not that Claude responds well. Live tests verify the full chain including Claude.

### Event wiring

`onJobEvent` in AutomationProcessor emits to `harness.emitter`, so tests can assert on `job:created`, `job:completed`, `job:failed`, `job:needs_review` events.

---

## Test Plan

### File layout

```
packages/dashboard/tests/
├── integration/
│   ├── app-harness.ts           ← MODIFIED (add withAutomations)
│   ├── mock-session.ts          ← existing
│   └── automation-e2e.test.ts   ← NEW (Tasks 1-6)
├── browser/
│   └── automation-ui.test.ts    ← NEW (Task 7, Playwright)
└── live/
    ├── helpers.ts               ← NEW (shared gate helpers)
    ├── handler-execution.test.ts ← NEW (Task 8)
    ├── user-automation.test.ts   ← NEW (Task 9)
    └── hitl-live.test.ts         ← NEW (Task 10)
```

---

### Task 0: Extend AppHarness with automation support

**File:** `packages/dashboard/tests/integration/app-harness.ts`

- Add `withAutomations?: boolean` to `AppHarnessOptions`
- When true, wire up full automation stack (Manager, JobService, Executor, Processor, AppAutomationService)
- Expose `harness.automations` (AppAutomationService) and raw services for direct access
- Wire `onJobEvent` to `harness.emitter` for event assertions
- Add `automationsDir` getter for tests that need to write manifest files
- Shutdown: stop sync service, clean up

**Validation:** Existing tests still pass unchanged.

---

### Task 1: System automation lifecycle (headless)

**File:** `packages/dashboard/tests/integration/automation-e2e.test.ts`

Test the full path: manifest file on disk → sync → DB indexing → built-in handler dispatch → job recorded.

- Write a system automation manifest to `harness.automationsDir`
- Register a test handler via `registerHandler()`
- Call `harness.automationManager.syncAll()`
- Verify automation appears in DB with `system: true` and `handler` field
- Fire via `harness.automations.fire(id)`
- Assert: handler was called, job status is `completed`, job summary matches handler output
- Assert: `job:created` and `job:completed` events emitted on `harness.emitter`

---

### Task 2: System automation protection (headless)

**Same file as Task 1.**

- Create a system automation (manifest with `system: true`)
- `harness.automations.create({ ..., manifest: { system: true } })` — expect throw (system automations come from manifests, not create API)
- Write system manifest to disk, sync
- Attempt `harness.automationManager.update(id, { name: "hacked" })` → expect throw
- Attempt `harness.automationManager.disable(id)` → expect throw
- `harness.automations.list({ excludeSystem: true })` does NOT include it
- `harness.automations.list()` DOES include it

---

### Task 3: User automation lifecycle (headless)

**Same file as Task 1.**

Test the SDK session path for user automations (no handler field).

- `harness.automations.create({ name: "Research", instructions: "...", manifest: { trigger: [{ type: "manual" }] } })`
- Fire via `harness.automations.fire(id)`
- Assert: `createBrainQuery` was called (module-level mock)
- Assert: job status is `completed`
- Assert: `job:completed` event emitted

---

### Task 4: Trigger types (headless)

**Same file as Task 1.**

All 4 trigger types fire automations through real services.

- **Schedule:** Create automation with `cron: "* * * * *"`. Create `AutomationScheduler` against harness services. Call `checkDueAutomations()`. Assert job created.
- **Manual:** `harness.automations.fire(id)`. Assert job created.
- **Watch:** Create automation with watch trigger. Emit synthetic file change through `WatchTriggerService`. Assert automation fires.
- **Channel:** Create automation with channel hint. Call `db.getAutomationHints()`. Assert hint returned. (Channel matching is Haiku-driven in PostResponseHooks — test the hint extraction, not the LLM matching.)

---

### Task 5: HITL resume flow (headless)

**Same file as Task 1.**

- Create user automation, fire it with mock session that returns `needs_review` text
- Assert job status is `needs_review`, `sdk_session_id` stored
- `harness.automations.resume(jobId, "user's answer")`
- Assert job transitions to `completed`
- Assert resume call passes user answer and session ID to `createBrainQuery`
- Assert `needs_review` jobs are NOT pruned by `jobService.pruneExpiredRunDirs(0)`
- Assert `job:needs_review` and `job:completed` events emitted

---

### Task 6: Debrief pipeline (headless)

**Same file as Task 1.**

Test the debrief collection and assembly chain — not the LLM summarization (that's Task 8).

The built-in handlers (`debrief-context`, `debrief-reporter`) call `queryModel` internally to generate summaries. For headless tests, we test the **pipeline mechanics** without LLM calls:

- Set up harness with `withAutomations: true`
- Create a user automation with `notify: debrief`, fire it (mock session returns output with summary)
- Verify `db.getDebriefPendingJobs(since)` returns the completed job
- Verify job has correct `notify` field and summary stored
- Test `createDebriefAutomationAdapter()` against real services:
  - Seed `morning-brief.md` on disk → `adapter.getDebriefOutput()` returns content
  - `adapter.hasRunToday("debrief-context")` returns false when no debrief job exists
  - Create a completed debrief job for today → `adapter.hasRunToday("debrief-context")` returns true

The full LLM-driven debrief chain (context assembly → Haiku → reporter → brief) is covered in Task 8.

---

### Task 7: Automation UI (Playwright)

**File:** `packages/dashboard/tests/browser/automation-ui.test.ts`

Playwright against the running dashboard (`DASHBOARD_URL` env var, default `http://localhost:4321`).

**Calendar tab:**
- Navigate to calendar tab
- Verify FullCalendar renders (container exists, no JS errors)
- Verify timeline events appear (completed=green, failed=red if any, projected=cyan)
- Click an event → verify automation detail opens
- Screenshot artifact

**Settings tab:**
- Navigate to settings
- Verify automation schedule editor renders
- System automations are read-only (no edit/delete controls)
- User automations have editable cron
- No old work-patterns section exists
- Screenshot artifact

**Automation detail:**
- Navigate to automation detail (via home widget or browser tab)
- Verify job history timeline renders
- System automation has no edit/delete controls
- Screenshot artifact

**Gate:** `describe.skipIf(!DASHBOARD_URL)` — skips when dashboard isn't running.

---

### Task 8: Built-in handlers produce real output (live)

**File:** `packages/dashboard/tests/live/handler-execution.test.ts`

Real LLM calls through built-in handlers. No mocks anywhere.

- Set up harness with `withAutomations: true` and realistic notebook (daily log entries, properties, staging file)
- Run `debrief-context` handler directly → assert `current-state.md` written with coherent content referencing seeded data
- Run `daily-summary` handler → assert summary file written to `notebook/summaries/daily/`, content is coherent markdown
- Run `weekly-summary` with 3 daily summaries seeded → assert cross-day summary
- Run `monthly-summary` with a weekly summary seeded → assert coherent monthly output

**Model:** Haiku (cost efficient)
**Timeout:** 120s per test
**Gate:** `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`

---

### Task 9: User automation with real SDK session (live)

**File:** `packages/dashboard/tests/live/user-automation.test.ts`

Fire a user automation through the full chain with a real SDK session.

- Create user automation: `instructions: "Write a single paragraph about the color blue. Keep it under 50 words."`
- Fire via `harness.automations.fire(id)`
- Assert: job `completed`, summary is non-empty and about blue
- Assert: `sdk_session_id` populated
- Assert: run directory created with session artifacts

**Model:** Haiku
**Timeout:** 60s
**Gate:** `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`

---

### Task 10: HITL resume with real model (live)

**File:** `packages/dashboard/tests/live/hitl-live.test.ts`

Real needs_review → resume flow with actual LLM calls.

- Create user automation: `instructions: "Ask the user: What is their favorite color? You MUST include the text 'needs_review' in your response to trigger the review flow."`
- Fire with real SDK session
- Assert job status is `needs_review`, summary contains a question
- Resume with: `"My favorite color is green"`
- Assert job transitions to `completed`
- Assert final output acknowledges "green"

**Model:** Sonnet (needs instruction following for needs_review detection)
**Timeout:** 120s
**Gate:** `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`

---

## Success Criteria

- [ ] AppHarness `withAutomations` wires real automation stack
- [ ] Tasks 1-6 pass in `npx vitest run tests/integration/automation-e2e.test.ts` (no API key needed)
- [ ] Task 7 passes with running dashboard + Playwright
- [ ] Tasks 8-10 pass in `npx vitest run tests/live/` (requires API key)
- [ ] Existing 740-test suite still passes (zero regressions)
- [ ] `npx tsc --noEmit` clean
- [ ] Browser tests produce screenshot artifacts
- [ ] Handler tests prove built-in handlers bypass SDK sessions with real services
- [ ] Live tests prove real Haiku/Sonnet output flows through the automation chain
- [ ] HITL live test proves needs_review → resume produces coherent follow-up

---

## Non-Goals

- Replacing the existing mocked tests (they stay as fast regression guards)
- Testing Claude's response quality (we test that the automation machinery works)
- Testing WhatsApp message split (that's a transport concern, not automation)
- Full CI integration (live tests are developer-run, not CI-gated)
