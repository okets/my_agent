# M9.1-S6 Architect Sprint Review

> **Reviewer:** CTO + Claude Code (architects)
> **Date:** 2026-04-06
> **Verdict:** PASS WITH CONCERNS — fix I1 + I2 before merging

---

## Summary

Recovery sequence is solid. Jobs are correctly detected as interrupted on startup, notifications are created with accurate todo progress, once-automations are disabled, capabilities re-scanned, heartbeat started. The AppHarness agentDir reuse pattern is a good infrastructure addition.

Two pre-existing issues surfaced by S6 need fixing before merge — the resume flow is wired but unreachable in production.

---

## What passed

- 5-step recovery sequence in correct order, synchronous before accepting connections
- Interrupted jobs get persistent notifications with `todos_completed`, `todos_total`, `incomplete_items`
- `resume_job` accepts `interrupted` status, `userResponse` optional
- Session ID mismatch detection logic is correct in `executor.resume()`
- Once-automation cleanup uses `disable()` (approved deviation)
- Capability re-scan on startup with try/catch
- 4 acceptance tests pass, AppHarness agentDir reuse works

---

## Issues to fix before merge

### I1: executor not wired to createAutomationServer (Important)

**File:** `packages/dashboard/src/app.ts` (~line 1561)

`createAutomationServer` is called without `executor`. The `resume_job` MCP tool always falls through to `processor.resume()` (full re-execution), never calls `executor.resume()` (session resume with ID detection). The session ID comparison code added by S6 is unreachable in production.

**Fix:** Add `executor: app.automationExecutor` to the `createAutomationServer` call. One line.

### I2: Resume path missing todo MCP server (Important)

**File:** `packages/dashboard/src/automations/automation-executor.ts` — `resume()` method

The resume method provides chart and image MCP servers but not the todo server. The resume prompt tells the worker "Call todo_list to see your assignment" but the tool isn't available.

**Fix:** Add `createTodoServer(todoPath)` in `resume()`, using the existing `todos.json` on disk. Same pattern as `run()`.

---

## Approved deviation

Once-automations disabled instead of deleted. `AutomationManager` only has `disable()`. Equivalent behavior, safer (manifest stays on disk for inspection). Documented in DEVIATIONS.md.

---

## Suggestions (not blocking)

1. **Extract recovery into standalone function** — The acceptance test replicates recovery logic inline instead of calling production code. Extracting `runRecoverySequence()` from `App.create()` would let tests exercise the real path.
2. **`resumable` field accuracy** — Production uses `!!job.sdk_session_id` but test hardcodes `resumable: true`. Low risk since the field is informational.
3. **Update once-automation comment** — Code checks for completed jobs, not `manifest.status === "completed"` as originally specced. Comment should match the actual logic.

---

## Action items for developer

| # | Priority | Fix |
|---|----------|-----|
| 1 | **Important** | Wire `executor` to `createAutomationServer` in app.ts |
| 2 | **Important** | Add todo MCP server to `executor.resume()` path |

Both required before merge. The smoke test and S7 E2E test depend on the resume flow working end-to-end.
