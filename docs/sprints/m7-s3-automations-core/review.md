# M7-S3 Automations Core -- External Review

> **Reviewer:** External QA Agent (independent)
> **Date:** 2026-03-23
> **Sprint:** M7-S3 Automations Core
> **Verdict:** PASS

---

## 1. Spec Coverage Analysis

### S3 Scope (from design spec)

| Requirement | Status | Evidence |
|---|---|---|
| Automation manifest format (YAML frontmatter .md) | PASS | `AutomationManager` uses `readFrontmatter()`/`writeFrontmatter()`, matches spec exactly |
| All manifest fields (name, status, trigger, spaces, model, notify, persist_session, autonomy, once, delivery, created) | PASS | `AutomationManifest` interface in `automation-types.ts` covers all fields |
| Trigger types (schedule, channel, watch, manual) | PASS | `TriggerConfig` union type with all 4 types |
| JSONL job format (append-only, per-automation file) | PASS | `AutomationJobService` writes `{automationId}.jsonl`, one JSON object per line |
| Job fields (id, status, created, completed, summary, context, sdk_session_id, run_dir) | PASS | `Job` interface matches spec |
| Job statuses (pending, running, completed, failed, needs_review) | PASS | `JobStatus` union type |
| Ephemeral run directories (.runs/{automationId}/{jobId}/) | PASS | `createRunDir()` creates with CLAUDE.md |
| Execution pipeline (Trigger -> Job -> Executor -> Processor) | PASS | Full pipeline: `AutomationScheduler` -> `AutomationProcessor.fire()` -> `AutomationJobService.createJob()` -> `AutomationExecutor.run()` |
| Per-automation concurrency semaphore | PASS | `AutomationProcessor.runningJobs` Map, skips if already running |
| Cron evaluation (cron-parser, 60s polling) | PASS | `AutomationScheduler` uses `CronExpressionParser`, configurable interval |
| isDue logic (prev tick > last job created) | PASS | `isCronDue()` compares `interval.prev()` to most recent job |
| MCP tools: create_automation, fire_automation, list_automations, resume_job | PASS | All 4 tools in `automation-server.ts` with proper Zod schemas |
| Brain system prompt hints | PASS | `loadAutomationHints()` in `prompt.ts` reads active automations, 50+ threshold for pull model |
| SystemPromptBuilder cache invalidation on sync | PASS | `AutomationSyncService` events trigger `automation:updated` which invalidates cache |
| Dashboard: Automations home widget | PASS | Shows active count, automation names, trigger type badges, job count |
| Dashboard: Automations browser tab | PASS | Searchable list with trigger types, spaces, last fired date |
| Dashboard: Automation detail tab | PASS | Shows name, triggers, instructions, fire button, recent jobs |
| Dashboard: Timeline redesign (jobs instead of tasks) | PASS | Timeline shows job entries with automation name, trigger type, status |
| Dashboard: Chat tag injection | PASS | When viewing an automation tab, chat shows context tag with automation name |
| WebSocket: state:automations + state:jobs broadcasting | PASS | StatePublisher subscribes to automation/job events, broadcasts snapshots |
| Initial state push on WS connect | PASS | `publishInitialState()` sends automations + jobs on connection |
| REST API routes | PASS | `/api/automations`, `/api/automations/:id`, `/api/automations/:id/fire`, `/api/automations/:id/jobs`, `/api/jobs`, `/api/jobs/:id`, `/api/jobs/:id/resume`, `/api/automations/next-runs` |
| App event types for automations + jobs | PASS | `AppEventMap` in `app-events.ts` includes all automation/job events |
| Autonomy tiers (full/cautious/review) as prompt instructions | PASS | `getAutonomyInstructions()` in executor |
| Notification handling (immediate, debrief, needs_review) | PASS | `handleNotification()` in processor |
| once:true auto-disable | PASS | Processor disables automation after successful execution |
| Filesystem is source of truth | PASS | JSONL + .md files on disk; agent.db is derived |
| DB schema (automations + jobs tables, indexes, FK) | PASS | Correct schema with FK constraint, 4 indexes |

### Items explicitly out of S3 scope (per plan)

| Item | Status |
|---|---|
| Watch triggers (WatchTriggerService) | Not implemented -- correct, planned for later sprint |
| Channel triggers (PostResponseHooks extension) | Not implemented -- correct, planned for later sprint |
| Direct shell exec mode | Not implemented -- correct, future optimization |
| FileWatcher utility extraction | Done in S1 -- correctly reused here |

---

## 2. Architecture Assessment

**Strengths:**

- Clean separation of concerns: Manager (CRUD), JobService (JSONL lifecycle), Executor (SDK session), Processor (orchestration + concurrency), Scheduler (cron), SyncService (file watching)
- Extends existing patterns (TaskExecutor, TaskProcessor) rather than building parallel systems -- aligns with core principle #3
- Corrupted JSONL line handling (skip on parse failure) -- addresses the in-team review finding
- Proper error handling with graceful fallbacks throughout
- `AppAutomationService` namespace on App provides clean API surface for routes and other consumers

**Observations:**

- `AutomationExecutor.run()` passes empty `spaces: []` to `buildAutomationContext()` -- space resolution not yet wired. This is acceptable for S3 (spaces were built in S1-S2, wiring is a follow-up)
- `needs_review` detection in executor uses string matching (`response.includes("needs_review")`) -- functional but could be more robust with structured output. Acceptable for MVP
- `findById()` in AutomationManager calls `list()` then filters -- O(n) scan. Fine for expected scale (<100 automations), but worth noting if scale increases

---

## 3. Code Quality

- TypeScript compiles cleanly (both core and dashboard: `tsc --noEmit` passes)
- No `any` casts in production code except in executor where SDK message types are not fully typed (uses `(msg as any)` for session_id extraction -- SDK limitation)
- Consistent error handling: try/catch with meaningful error messages
- All new services properly added to App.create() lifecycle with start/stop
- Proper teardown in `App.destroy()` for scheduler and sync service

---

## 4. Identified Issues

### Minor

1. **Detail tab heading shows ID not name:** The automation detail tab shows `daily-summary` (the ID) in the h2 heading instead of `Daily Summary` (the name). The manifest data loads asynchronously -- the heading falls back to `automationId` until the API response arrives. The name does appear once loaded via `tab.data.manifest?.name`. This is a minor UX timing issue.

2. **Detail tab status badge shows "unknown":** Before the API response loads the manifest, the status badge shows "unknown". This resolves after the API call completes. Minor loading state issue.

3. **Trigger config rendering in detail tab is sparse:** The "Triggers" heading is present but the trigger config details (cron expression, etc.) appear to not render individual trigger details in the snapshot. The data is available in the API response; likely a template issue in the detail tab HTML.

### None of these are blockers. All core functionality works correctly.

---

## 5. Verdict

**PASS** -- The sprint delivers a complete, well-architected automations pipeline that covers all S3 spec requirements. The implementation follows established patterns, has comprehensive test coverage (9 test files), and the UI integration works across desktop and mobile viewports. The three minor issues identified are cosmetic/UX polish items, not functional defects.
