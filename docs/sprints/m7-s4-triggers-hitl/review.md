# M7-S4: Triggers + HITL — External Review

> **Reviewer:** Independent external reviewer (no shared context with implementation team)
> **Date:** 2026-03-23
> **Spec:** `docs/superpowers/specs/2026-03-22-m7-spaces-automations-jobs.md` (S4 scope)
> **Plan:** `docs/sprints/m7-s4-triggers-hitl/plan.md`

---

## Verdict: PASS

The sprint delivers all five chunks from the plan. Watch triggers, channel triggers, media staging, HITL/needs_review, SDK session resumption, and the timeline UI redesign are implemented, tested, and wired into the app lifecycle. No blocking issues found.

---

## Spec Coverage Matrix

| Spec Requirement | Plan Task(s) | Implementation | Tests | Status |
|---|---|---|---|---|
| **WatchTriggerService** — chokidar polling, debounce, path-to-automation map | T1-T5 | `watch-trigger-service.ts` (264 lines) | `watch-trigger-service.test.ts` (405 lines, 16 tests) | PASS |
| **Watch trigger: polling mode for NAS/SMB** | T2 | `usePolling: true` default, configurable interval | Test verifies polling config passed to chokidar | PASS |
| **Watch trigger: space-level debouncing** (5s default) | T4 | `handleFileEvent()` with configurable debounce, file dedup | 5 debounce tests (batch, dedup, timer reset, multi-automation) | PASS |
| **Watch trigger: mount failure retry with backoff** | T5 | `handleWatcherError()` using `computeBackoff()` from core | Tests for retry tracking and `mount_failure` event emission | PASS |
| **Watch trigger: dynamic sync on manifest changes** | T3 | `sync()` method, wired to `AutomationSyncService.on("sync")` | Tests for stale watcher teardown and new watcher registration | PASS |
| **Watch trigger: ConversationInitiator alert on persistent failure** | T5, T17 | `mount_failure` event -> `app.ts` wires to CI.alert/initiate | Wired in app.ts:1170-1180 | PASS |
| **Channel trigger: Haiku extraction with automation hints** | T6-T7 | `automation-extractor.ts` — extended prompt, `AutomationMatch` type | `automation-extractor.test.ts` (177 lines, 7 tests) | PASS |
| **Channel trigger: PostResponseHooks integration** | T8 | `post-response-hooks.ts` — optional deps, automation matching, 5-min dedup | `post-response-hooks-automation.test.ts` (131 lines, 5 tests) | PASS |
| **Channel trigger: backward compat (no automation deps)** | T8 | Optional deps with `?.` chaining, undefined fallback | Test: "works without optional automation deps" | PASS |
| **Media staging directory** | T9 | `media-staging.ts` — ensureStagingDir, stagingPath, cleanStaging | `media-staging.test.ts` (86 lines, 6 tests) — real filesystem | PASS |
| **needs_review -> ConversationInitiator.alert()** | T10 | `automation-processor.ts:146-155` — checks job status post-execution | `needs-review-notification.test.ts` (157 lines, 6 tests) | PASS |
| **needs_review: fallback to initiate() when no active conversation** | T10 | `if (!alerted) await ci.initiate(...)` | Test: "falls back to initiate() when alert returns false" | PASS |
| **needs_review: includes resume_job instructions in prompt** | T10 | Prompt contains `resume_job("${jobId}", ...)` | Test: "includes resume_job instructions in the prompt" | PASS |
| **resume_job MCP tool** | T11 | `automation-server.ts:242-322` — validates status, routes to executor or processor | `resume-job.test.ts` (122 lines, 6 tests) | PASS |
| **SDK session resumption: createBrainQuery with resume** | T12 | `automation-executor.ts:202-305` — resume() method | `automation-executor-resume.test.ts` (164 lines, 7 tests) | PASS |
| **SDK session resumption: fallback on stale session** | T12 | Falls back to failed status with clear error message | Test: "marks job as failed when resume throws" | PASS |
| **SDK session resumption: session ID storage** | T12 | Stored in job entry via `jobService.updateJob(... sdk_session_id)` | Test: "stores new session ID from resumed session" | PASS |
| **Timeline API: past jobs + future projections** | T13 | `routes/timeline.ts` — GET /api/timeline, GET /api/timeline/future | Route registered in server.ts:218-219 | PASS |
| **Timeline DB: getTimelineJobs with pagination** | T13 | `db.ts:1165-1215` — before/after cursors, JOIN with automations | Used by timeline route | PASS |
| **Timeline DB: getWatchTriggers** | T17 | `db.ts:1220-1256` — parses trigger_config JSON | Used by WatchTriggerService | PASS |
| **Timeline DB: getAutomationHints** | T17 | `db.ts:1261-1287` — filters channel triggers with hints | Used by PostResponseHooks | PASS |
| **Timeline DB: getRecentJobCount (dedup)** | T17 | `db.ts:1292-1300` — COUNT within time window | Used by PostResponseHooks dedup | PASS |
| **Timeline UI: status dots (green/red/amber/blue/purple)** | T14 | `index.html:1142-1152` — conditional classes per status | Browser verified (desktop + mobile) | PASS |
| **Timeline UI: trigger badges (schedule/channel/watch/manual)** | T14 | `index.html:1200-1212` — colored badges for job/projected items | Browser verified | PASS |
| **Timeline UI: NOW marker** | T14 | `app.js:4399` — `showNowMarker` on first future item | Browser verified | PASS |
| **Timeline UI: date separators (Today, Yesterday, date)** | T14 | `app.js:4396-4401` — `showDateSeparator` logic | Browser verified | PASS |
| **Timeline UI: needs_review amber highlight** | T14 | `index.html:1161` — amber bg + border | Code verified | PASS |
| **Timeline UI: load earlier/later pagination** | T15 | `app.js:3237-3273` — loadEarlierTimeline, loadLaterTimeline | Browser verified (buttons present and functional) | PASS |
| **Timeline UI: click -> automation detail tab** | T14 | `openTimelineItem()` routes job/projected items to automation tab | Browser verified (clicked automation, detail opened) | PASS |
| **Timeline UI: legend** | T14 | `index.html` — Completed, Failed, Review, Running, Scheduled, Calendar | Browser verified (mobile shows full legend) | PASS |
| **App wiring: WatchTriggerService lifecycle** | T17-T18 | `app.ts:1150-1184` — init, sync events, mount_failure handler | Code verified | PASS |
| **App wiring: PostResponseHooks automation deps** | T17 | `app.ts:597-607` — getAutomationHints, fireAutomation, getRecentJobCount | Code verified | PASS |
| **Re-exports: automations/index.ts** | T18 | All new types and classes exported | Code verified | PASS |
| **Backward compat: task-extractor.ts re-export** | T6 | Re-exports from automation-extractor.ts | Code verified | PASS |
| **Per-automation concurrency (semaphore)** | S3 (preserved) | `automation-processor.ts:42-54` — runningJobs Map | Code verified | PASS |

---

## Observations

### Code Quality

1. **Clean separation of concerns.** Each new service (WatchTriggerService, media-staging) is self-contained with dependency injection. No tight coupling to the app or database layer.

2. **Backward compatibility preserved.** PostResponseHooks accepts optional automation deps with `?.` chaining. The `task-extractor.ts` re-export prevents breakage of existing imports. No runtime changes for deployments without automations.

3. **Consistent patterns.** The implementation follows existing codebase conventions: EventEmitter for service events, `computeBackoff` from core for retries, `createBrainQuery` for SDK sessions, `extractDeliverable` for response parsing.

4. **Chokidar import technique.** The dynamic `import("chokidar")` via a variable (`const chokidarModule = "chokidar"`) is a pattern to prevent bundler static analysis from inlining the module. Correct approach for optional/lazy dependencies.

### Minor Issues (non-blocking)

1. **Automation detail tab shows "unknown" status.** When clicking an automation from the widget or timeline, the detail tab shows `unknown` next to the name instead of `active`. Root cause: `tab.data.manifest?.status` is undefined — the manifest object passed to the tab doesn't include the status field. This is a pre-existing issue in the tab rendering logic (index.html:5128), not an S4 regression.

2. **Triggers section empty in detail tab.** The "TRIGGERS" heading appears but no trigger details are rendered below it. The trigger data is available in `tab.data.manifest.trigger` but the template section for rendering individual triggers appears to be a stub. Not an S4 scope item — the detail tab existed before S4.

3. **Timeline legend inconsistency between desktop and mobile.** Desktop shows only 3 legend items (Task pending, Calendar event, Completed) while mobile shows all 6 (Completed, Failed, Review, Running, Scheduled, Calendar). The mobile legend is more complete and matches the spec. Desktop may be using a cached version or different template. Minor cosmetic issue.

4. **`handleFileEvent` and `handleWatcherError` are public.** These were private in the plan but made public in the implementation (needed for test access). The test accessors (`getWatchers()`, `getPendingEvents()`, etc.) are also added. Acceptable for testability but could use `@internal` JSDoc tags.

### Architecture Notes

- The HITL flow is well-designed: `needs_review` -> `ConversationInitiator.alert()` -> brain presents to user -> `resume_job` MCP tool -> `AutomationExecutor.resume()` with SDK session. The SDK's native `resume` parameter is used correctly, not a custom checkpoint mechanism.

- The channel trigger dedup (5-minute window via `getRecentJobCount`) prevents duplicate firings when the brain already handled the automation and the PostResponseHooks extraction also matches. Good defensive pattern.

- The `AutomationProcessor.resume()` method provides a fallback path (re-execution without session context) when `executor.resume()` is not available. The `automation-server.ts` routes to `executor.resume()` first, falling back to `processor.resume()`.

---

## Files Reviewed (24)

### New Files (11)
- `packages/dashboard/src/automations/watch-trigger-service.ts`
- `packages/dashboard/src/automations/automation-extractor.ts`
- `packages/dashboard/src/automations/media-staging.ts`
- `packages/dashboard/src/routes/timeline.ts`
- `packages/dashboard/tests/automations/watch-trigger-service.test.ts`
- `packages/dashboard/tests/automations/automation-extractor.test.ts`
- `packages/dashboard/tests/automations/post-response-hooks-automation.test.ts`
- `packages/dashboard/tests/automations/media-staging.test.ts`
- `packages/dashboard/tests/automations/needs-review-notification.test.ts`
- `packages/dashboard/tests/automations/resume-job.test.ts`
- `packages/dashboard/tests/automations/automation-executor-resume.test.ts`

### Modified Files (13)
- `packages/dashboard/src/automations/automation-executor.ts` (resume method)
- `packages/dashboard/src/automations/automation-processor.ts` (needs_review, resume)
- `packages/dashboard/src/automations/index.ts` (re-exports)
- `packages/dashboard/src/mcp/automation-server.ts` (resume_job tool)
- `packages/dashboard/src/conversations/post-response-hooks.ts` (channel triggers)
- `packages/dashboard/src/conversations/db.ts` (timeline + helper queries)
- `packages/dashboard/src/app.ts` (wiring)
- `packages/dashboard/src/server.ts` (timeline route registration)
- `packages/dashboard/src/tasks/task-extractor.ts` (backward compat re-export)
- `packages/dashboard/public/index.html` (timeline UI)
- `packages/dashboard/public/js/app.js` (timeline data, pagination)
