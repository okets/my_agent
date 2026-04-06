# External Verification Report

**Sprint:** M9.1-S5 Status Communication + System Prompt
**Reviewer:** External Opus (independent)
**Date:** 2026-04-06

## Spec Coverage

| Spec Requirement | Status | Evidence |
|-----------------|--------|----------|
| Enhanced `check_job_status` with todo progress (completed/in_progress/pending items) | COVERED | `formatJobTodoProgress()` in `automation-server.ts` reads `todos.json`, filters by status, appends progress text to each job line. Covers active + needs_review jobs. Also includes `blocked` items (not in spec but harmless addition). |
| `[Active Working Agents]` enhanced with todo progress: `N/M items done, currently: "Step X"` | COVERED | `app.ts` running tasks checker reads `todos.json` per job, computes done/total, finds `in_progress` item for "currently:" label. Format matches spec: `"Name" (job-id): status, N/M items done, currently: "text"`. |
| `[Pending Briefing]` from persistent notification queue | COVERED | `system-prompt-builder.ts` renders `[Pending Briefing]` section with header text, bullet list, and "resume or discard" instruction. Only appears when `pendingBriefing` array is non-empty. Format matches spec. |
| `[Your Pending Tasks]` for Conversation Nina's own todos | COVERED | `system-prompt-builder.ts` renders checkbox format with `\u2713`/`\u2610` and status labels. Matches spec exactly. Only appears when items exist. |
| Three delivery channels (pull/push/briefing) | COVERED | Pull: `check_job_status` tool enhanced. Push: heartbeat + `ci.alert()` (pre-existing from S3, not modified here). Briefing: system prompt sections wired via `buildQuery()`. |
| After briefing shown, notifications marked delivered | COVERED | `session-manager.ts` calls `briefingResult.markDelivered()` after `build()` returns. Provider in `app.ts` captures filenames and moves them from `pending/` to `delivered/` via `PersistentNotificationQueue`. Test at line 195 verifies lifecycle. |
| Section ordering: active agents -> briefing -> todos -> session | COVERED | Code in `system-prompt-builder.ts` adds sections in correct order. Test "all status sections simultaneously" verifies `agentsIdx < briefingIdx < todosIdx < sessionIdx`. |

## Test Results

- **Sprint acceptance tests:** 8 passed, 0 failed, 0 skipped
- **Core TypeScript:** compiles clean (0 errors)
- **Dashboard TypeScript:** compiles clean (0 errors)

Test file: `packages/dashboard/tests/integration/status-prompt-acceptance.test.ts`

Tests cover:
1. Todo file read/filter for `check_job_status` (pull channel)
2. `[Active Working Agents]` with progress in system prompt
3. `[Pending Briefing]` appears with notification content
4. `[Pending Briefing]` absent when queue is empty
5. `[Your Pending Tasks]` with checkbox format
6. `[Your Pending Tasks]` absent when empty
7. Notification lifecycle: pending -> briefing -> delivered
8. All three sections present simultaneously with correct ordering

## Browser Verification

Skipped -- sprint is pure backend/prompt wiring with no UI changes. No files in `public/` were modified.

## Gaps Found

**Minor concern (not a gap):** The design spec shows `check_job_status` returning structured JSON with a `todos` object containing `completed`, `in_progress`, `pending` arrays. The implementation instead appends a text-formatted progress string to the existing text-based tool output. This is a reasonable deviation: the tool already returned text (not JSON), and the text format is equally consumable by the brain. The structured data (completed/in_progress/pending breakdowns) is fully present in the text output. No deviation was logged in `DEVIATIONS.md`, but since the spec example appears illustrative rather than prescriptive, this is acceptable.

No other gaps found. All six spec requirements from System 5 are implemented and tested.

## Verdict

**PASS**

All five validation criteria are met: acceptance tests pass (8/8), `check_job_status` returns todo progress, conversation todos appear in `[Your Pending Tasks]`, notifications move from pending to delivered after briefing, and TypeScript compiles clean in both packages. The implementation is a faithful translation of the System 5 design spec.
