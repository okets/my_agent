# M7-S9: E2E Test Suite

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Verify the full M7 automation stack works end-to-end using real services — no mocked business logic. Every test exercises actual automation machinery through AppHarness or Playwright.

**Spec:** `docs/superpowers/specs/2026-03-28-m7-s9-e2e-test-suite-design.md`

**Depends on:** S8 (debrief worker architecture)

**Baseline:** 82 test files, 740 tests passing, `npx tsc --noEmit` clean.

---

## Task 0: Extend AppHarness with automation support

**Files:**
- Modify: `packages/dashboard/tests/integration/app-harness.ts`

Wire up the real automation stack when `withAutomations: true` is passed.

- [ ] Step 1: Add `withAutomations?: boolean` to `AppHarnessOptions`
- [ ] Step 2: Import AutomationManager, AutomationJobService, AutomationExecutor, AutomationProcessor, AppAutomationService
- [ ] Step 3: When `withAutomations: true`:
  - Create `automations/` dir in temp agentDir
  - Get `ConversationDatabase` from `conversationManager.getConversationDb()`
  - Create `AutomationManager(automationsDir, db)`
  - Create `AutomationJobService(automationsDir, db)`
  - Create `AutomationExecutor({ automationManager, jobService, agentDir, db })`
  - Create `AutomationProcessor({ automationManager, executor, jobService, agentDir, onJobEvent })` — wire `onJobEvent` to `harness.emitter`
  - Create `AppAutomationService(manager, processor, jobService, harness)` → expose as `harness.automations`
- [ ] Step 4: Expose `automationsDir` getter, raw services (`automationManager`, `automationJobService`, etc.) as optional properties
- [ ] Step 5: Shutdown: clean up automation services
- [ ] Step 6: Verify existing tests still pass: `npx vitest run`
- [ ] Step 7: Verify build: `npx tsc --noEmit`

**Commit:** `feat(m7-s9): extend AppHarness with real automation stack`

---

## Task 1: System automation lifecycle (headless)

**Files:**
- Create: `packages/dashboard/tests/integration/automation-e2e.test.ts`

Full path: manifest on disk → sync → built-in handler dispatch → job recorded → events emitted.

- [ ] Step 1: Set up `AppHarness.create({ withAutomations: true })` in `beforeEach`
- [ ] Step 2: Write a system automation manifest (`system: true`, `handler: "test-handler"`) to `harness.automationsDir`
- [ ] Step 3: Register a test handler via `registerHandler("test-handler", ...)` that returns `{ success: true, work: "test output", deliverable: null }`
- [ ] Step 4: Call `harness.automationManager!.syncAll()` → verify automation in DB with `system: true` and `handler` field
- [ ] Step 5: Fire via `harness.automations!.fire(id)` — assert handler was called, job `completed`, summary matches
- [ ] Step 6: Assert `job:created` and `job:completed` events emitted on `harness.emitter`
- [ ] Step 7: Verify build

**Commit:** `test(m7-s9): system automation lifecycle — real services`

---

## Task 2: System automation protection (headless)

**Same file as Task 1.**

- [ ] Step 1: Write system manifest to disk, sync
- [ ] Step 2: `harness.automationManager!.update(id, { name: "hacked" })` → expect throw
- [ ] Step 3: `harness.automationManager!.disable(id)` → expect throw
- [ ] Step 4: `harness.automations!.list({ excludeSystem: true })` does NOT include system automation
- [ ] Step 5: `harness.automations!.list()` DOES include it with `system: true`
- [ ] Step 6: Create a user automation via `harness.automations!.create(...)`, verify update/disable work
- [ ] Step 7: Verify build

**Commit:** `test(m7-s9): system automation protection — real services`

---

## Task 3: User automation lifecycle (headless)

**Same file as Task 1.**

SDK session path — mock `createBrainQuery` at module level (external boundary only).

- [ ] Step 1: Mock `createBrainQuery` via `vi.mock("@my-agent/core", ...)` — return mock async iterable with assistant message
- [ ] Step 2: `harness.automations!.create({ name: "Research", instructions: "Research a topic.", manifest: { trigger: [{ type: "manual" }] } })`
- [ ] Step 3: Fire via `harness.automations!.fire(id)`
- [ ] Step 4: Assert `createBrainQuery` was called
- [ ] Step 5: Assert job status is `completed`, summary contains response text
- [ ] Step 6: Assert `job:completed` event emitted
- [ ] Step 7: Verify build

**Commit:** `test(m7-s9): user automation lifecycle — real services`

---

## Task 4: Trigger types (headless)

**Same file as Task 1.**

All 4 trigger types fire automations through real services.

- [ ] Step 1: **Schedule trigger:** Create automation with `cron: "* * * * *"`. Create `AutomationScheduler` against harness services. Call `checkDueAutomations()`. Assert job created.
- [ ] Step 2: **Manual trigger:** `harness.automations!.fire(id)`. Assert job created.
- [ ] Step 3: **Watch trigger:** Create automation with watch trigger path. Emit synthetic file change. Assert automation fires.
- [ ] Step 4: **Channel trigger:** Create automation with channel hint. Call `db.getAutomationHints()`. Assert hint returned.
- [ ] Step 5: Verify build

**Commit:** `test(m7-s9): all 4 trigger types — real services`

---

## Task 5: HITL resume flow (headless)

**Same file as Task 1.**

- [ ] Step 1: Create user automation, fire with mock session returning `needs_review` text + session ID
- [ ] Step 2: Assert job status `needs_review`, `sdk_session_id` stored
- [ ] Step 3: `harness.automations!.resume(jobId, "user's answer")`
- [ ] Step 4: Assert job transitions to `completed`
- [ ] Step 5: Assert resume call passes user answer and session ID to `createBrainQuery`
- [ ] Step 6: Assert `needs_review` jobs NOT pruned by `jobService.pruneExpiredRunDirs(0)`
- [ ] Step 7: Assert `job:needs_review` and `job:completed` events emitted
- [ ] Step 8: Verify build

**Commit:** `test(m7-s9): HITL resume flow — real services`

---

## Task 6: Debrief pipeline mechanics (headless)

**Same file as Task 1.**

Test collection and adapter — not LLM summarization (that's Task 8).

- [ ] Step 1: Create user automation with `notify: debrief`, fire (mock session returns summary)
- [ ] Step 2: Assert `db.getDebriefPendingJobs(since24hAgo)` returns the completed job
- [ ] Step 3: Assert job has correct summary stored
- [ ] Step 4: Create `DebriefAutomationAdapter` against real services
- [ ] Step 5: Seed `morning-brief.md` on disk → `adapter.getDebriefOutput()` returns content
- [ ] Step 6: `adapter.hasRunToday("debrief-context")` returns false when no debrief job exists
- [ ] Step 7: Create completed debrief job for today → `adapter.hasRunToday("debrief-context")` returns true
- [ ] Step 8: Verify build

**Commit:** `test(m7-s9): debrief pipeline mechanics — real services`

---

## Task 7: Automation UI (Playwright)

**Files:**
- Create: `packages/dashboard/tests/browser/automation-ui.test.ts`

Playwright against running dashboard. Uses `@playwright/mcp` or direct Playwright API.

- [ ] Step 1: Create test file with `describe.skipIf(!process.env.DASHBOARD_URL)` gate
- [ ] Step 2: **Calendar tab:** Navigate → verify FullCalendar renders → verify timeline events appear with correct colors → click event opens detail → screenshot
- [ ] Step 3: **Settings tab:** Navigate → verify automation schedule editor renders → system automations read-only → user automations editable → no work-patterns section → screenshot
- [ ] Step 4: **Automation detail:** Navigate to automation detail → verify job history timeline → system automation has no edit/delete → screenshot
- [ ] Step 5: Save screenshots to `docs/sprints/m7-s9-e2e-test-suite/screenshots/`
- [ ] Step 6: Verify build

**Commit:** `test(m7-s9): automation UI — Playwright browser verification`

---

## Task 8: Built-in handlers produce real output (live)

**Files:**
- Create: `packages/dashboard/tests/live/helpers.ts`
- Create: `packages/dashboard/tests/live/handler-execution.test.ts`

Real LLM calls through built-in handlers. No mocks.

- [ ] Step 1: Create `helpers.ts` with `requireApiKey()` gate and shared setup utilities
- [ ] Step 2: Set up harness with `withAutomations: true`, seed notebook (daily log entries, properties, staging file)
- [ ] Step 3: Run `debrief-context` handler directly → assert `current-state.md` written with coherent content
- [ ] Step 4: Run `daily-summary` handler → assert summary file in `notebook/summaries/daily/`, coherent markdown
- [ ] Step 5: Run `weekly-summary` with 3 daily summaries seeded → assert cross-day summary
- [ ] Step 6: Run `monthly-summary` with weekly summary seeded → assert coherent monthly output

**Model:** Haiku
**Timeout:** 120s per test
**Gate:** `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`

**Commit:** `test(m7-s9): live E2E — built-in handlers with real Haiku`

---

## Task 9: User automation with real SDK session (live)

**Files:**
- Create: `packages/dashboard/tests/live/user-automation.test.ts`

Full chain with real SDK session — no mocks anywhere.

- [ ] Step 1: Set up harness with `withAutomations: true`, NO mock session
- [ ] Step 2: Create user automation: instructions "Write a single paragraph about the color blue. Keep it under 50 words."
- [ ] Step 3: Fire via `harness.automations!.fire(id)`
- [ ] Step 4: Assert job `completed`, summary non-empty and about blue
- [ ] Step 5: Assert `sdk_session_id` populated
- [ ] Step 6: Assert run directory created

**Model:** Haiku
**Timeout:** 60s
**Gate:** `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`

**Commit:** `test(m7-s9): live E2E — user automation with real SDK session`

---

## Task 10: HITL resume with real model (live)

**Files:**
- Create: `packages/dashboard/tests/live/hitl-live.test.ts`

Real needs_review → resume with actual LLM calls.

- [ ] Step 1: Create user automation: instructions "Ask the user: What is their favorite color? You MUST include the text 'needs_review' in your response."
- [ ] Step 2: Fire with real SDK session
- [ ] Step 3: Assert job status `needs_review`, summary contains a question
- [ ] Step 4: Resume with "My favorite color is green"
- [ ] Step 5: Assert job transitions to `completed`
- [ ] Step 6: Assert final output acknowledges "green"

**Model:** Sonnet (needs instruction following for needs_review)
**Timeout:** 120s
**Gate:** `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`

**Commit:** `test(m7-s9): live E2E — HITL resume with real Sonnet`

---

## Execution Order

```
Task 0   (AppHarness extension)         — infrastructure, blocks all others
Tasks 1-6 (headless E2E)               — parallel-safe, one test file
Task 7   (Playwright UI)               — independent, needs running dashboard
Tasks 8-10 (live LLM)                  — independent, needs API key
```

---

## Success Criteria

- [ ] AppHarness `withAutomations` wires real automation stack
- [ ] Tasks 1-6 pass in `npx vitest run tests/integration/automation-e2e.test.ts`
- [ ] Task 7 passes with running dashboard + Playwright
- [ ] Tasks 8-10 pass in `npx vitest run tests/live/`
- [ ] Existing 740-test suite still passes (zero regressions)
- [ ] `npx tsc --noEmit` clean
- [ ] Browser tests produce screenshot artifacts
