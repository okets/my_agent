# M7-S6 External Review

**Verdict:** PASS WITH CONCERNS
**Reviewer:** External Review Agent (Opus)
**Date:** 2026-03-25
**Branch:** sprint/m7-s6-system-automations
**Commits:** 15 (14 sprint + 1 S7 plan)

## Spec Coverage

All major spec requirements addressed by this sprint are covered:

| Spec Requirement | Plan Task | Status |
|------------------|-----------|--------|
| `system` flag on AutomationManifest | Task 1 | Done |
| `handler` field on AutomationManifest | Task 1 | Done |
| DB schema migration (system + handler columns) | Task 1 | Done |
| Hide system automations from dashboard | Task 2 | Done |
| Hide system automations from MCP list_automations | Task 2 | Done |
| Hide system automations from brain prompt hints | Task 2 | Done |
| Built-in handler registry (handler dispatch) | Task 3 | Done |
| All 5 job handlers registered | Task 3 | Done |
| Debrief user automation template | Task 4 | Done |
| 4 system automation templates | Task 5 | Done |
| Timezone utility extraction | Task 6 | Done (minimal -- only exported `isValidTimezone`) |
| Remove WorkLoopScheduler | Task 7 | Done |
| Remove work-loop routes + settings routes | Task 7 | Done |
| Drop `work_loop_runs` table | Task 7 | Done |
| Calendar event source swap to timeline API | Task 8 | Done |
| Automation detail job history (timeline filter) | Task 9 | Done |
| Settings UI: automation schedule editor | Task 10 | Done |
| Hatching creates automation manifests | Task 11 | Done |
| System automation protection (403 on PATCH/DELETE) | Task 12 | Done |
| Work-patterns migration | Risk mitigation | Done |
| Debrief adapter (replaces WorkLoopScheduler for MCP) | Implicit | Done |

**Not in scope (deferred to S7):** E2E runtime verification, calendar visual testing.

## Code Review

### Well Done

- **Clean WorkLoopScheduler removal.** All imports, decorations, route registrations, and shutdown hooks removed from `app.ts`, `server.ts`, `index.ts`. No stale references remain in source files (only intentional comments and the DB migration DROP statement).
- **Idempotent DB migration.** The `PRAGMA table_info` check before `ALTER TABLE` is the correct pattern for SQLite column additions. The `DROP TABLE IF EXISTS work_loop_runs` is safe.
- **Handler registry design.** The `Map<string, BuiltInHandler>` pattern with `registerHandler`/`getHandler` is simple and effective. The handler dispatch in `AutomationExecutor.execute()` is cleanly integrated -- checks handler key first, falls through to SDK session path otherwise.
- **System automation protection.** Three-layer defense: AutomationManager.update() rejects, AutomationManager.disable() rejects, HTTP routes return 403. Consistent.
- **Timeline API filter.** The `automationId` parameter added to both `db.getTimelineJobs()` and the `/api/timeline` route enables the automation detail job history cleanly.
- **Migration is thorough.** `work-patterns-to-automations.ts` handles: parsing work-patterns frontmatter, converting cadence strings to cron, creating both user and system manifests, falling back to templates when no work-patterns exist.
- **Calendar event source swap.** The `fetchTimelineEvents` function correctly maps past jobs and future projected runs to FullCalendar event format with proper status colors.

### Issues by Severity

#### Important (should fix)

1. **`db: null as any` in debrief adapter.** In `debrief-automation-adapter.ts:64`, the `handleDebriefPrep` method passes `db: null as any` to the handler. While the debrief-prep handler does not currently use `db`, this is a type-safety hole. If any future handler change accesses `db`, this will throw at runtime with no compile-time warning. The `BuiltInHandler` type signature requires `db: ConversationDatabase`, so the cast silently defeats the type contract.

   **Recommendation:** Either make `db` optional in the `BuiltInHandler` type (`db?: ConversationDatabase | null`), or pass a real DB reference through the adapter factory.

2. **No new tests added.** The sprint deleted 1,587 lines of tests (6 test files) and added zero new test files. Key untested areas:
   - Handler registry dispatch (registering, calling, unknown handler error)
   - System automation protection (403 on PATCH/DELETE)
   - Work-patterns migration logic (cadence parsing, idempotency, edge cases)
   - Debrief automation adapter
   - Calendar `fetchTimelineEvents` function

   The plan Task 3 Step 4 explicitly says "write unit test for handler dispatch" and Task 12 Step 5 says "Add tests for protection" -- neither was done.

   **Recommendation:** These should be added in S7 or before merge. The handler registry and migration are particularly important to test.

3. **Handler registry still imports deleted-in-concept files.** The plan Note on Task 7 says handlers should be "refactored to be standalone (no dependency on WorkLoopScheduler or query-model imports)." However, `handler-registry.ts` still imports from:
   - `../query-model.js` (which was NOT deleted, despite the plan listing it for deletion)
   - `./debrief-prep.js`, `./daily-summary.js`, `./weekly-review.js`, `./weekly-summary.js`, `./monthly-summary.js` (all retained)

   The plan said to delete these 6 files in Task 7. Instead, only `work-loop-scheduler.ts` and `work-patterns.ts` were deleted; the job files and `query-model.ts` were kept as dependencies of `handler-registry.ts`.

   **Assessment:** This is a pragmatic deviation. Inlining all job logic into handler-registry.ts would create a 500+ line monolith. Keeping the existing job modules as imported helpers is cleaner. However, it means the scheduler directory still contains files (`query-model.ts`, `haiku-query.ts`, 5 job files) that semantically belong to the old work-loop system. They work correctly but the organizational debt should be noted.

4. **`create_automation` MCP tool does not explicitly reject `system: true`.** The plan Task 2 Step 3 says to reject `system: true` in the create_automation input. The protection is implicit (the Zod schema does not include `system` or `handler` as parameters, so the brain cannot pass them). This is sufficient for schema-validated callers, but direct API callers could potentially write system automation files to disk that get synced. The MCP tool is the only creation path that matters for brain-level protection, so this is acceptable.

#### Suggestions (nice to have)

5. **Memory lifecycle test still creates `work_loop_runs` table.** In `tests/e2e/memory-lifecycle.test.ts:73`, the test setup still creates a `work_loop_runs` table (used by other test assertions in that file). This is cosmetic -- the test still passes because the DB `DROP TABLE IF EXISTS` runs on real startup, not in the test's manual schema setup. But it is stale scaffolding.

6. **Migration runs before AutomationSyncService.** In `app.ts`, the migration at line ~915 runs before the automation system initialization at line ~930+. This is correct ordering (manifests must exist on disk before sync picks them up), but there is no log message if migration finds zero files -- only if it creates some. A debug-level log for "no migration needed" would aid troubleshooting.

7. **`analyzeKnowledge` and `applyPromotions` imported but unused in handler-registry.** These are imported from `weekly-review.js` at line 28-29 but never called in the handler registration. The `weekly-review` handler calls `runWeeklyReview(agentDir)` which internally uses them, so the imports are dead code in this file.

## Concerns

1. **Test debt is significant.** Deleting 1,587 lines of tests with zero replacement leaves core new functionality (handler dispatch, system protection, migration, adapter) untested. The S7 plan covers E2E runtime tests but not unit tests for these mechanisms.

2. **`db: null as any` defeats type safety** at the boundary between the debrief MCP tool and the automation handler system. This is a runtime crash waiting to happen if a handler starts using `db`.

3. **Plan deviation on file deletions** -- 6 files that the plan said to delete were retained. The deviation is justified (they are still used as imports), but the plan was inaccurate about the intended architecture.

## Recommendation

**Merge with tracked follow-ups.** The sprint accomplishes its core goals: WorkLoopScheduler is removed, automations are the new execution model, system automations are protected and hidden, the calendar is rewired, settings UI is updated, and the migration path works. The code compiles clean, all 931 tests pass (226 core + 705 dashboard), and no stale references to deleted modules exist in source.

The test debt (Concern 1) and `db: null as any` (Concern 2) should be tracked as immediate follow-up items, ideally in S7 before the E2E verification sprint closes.
