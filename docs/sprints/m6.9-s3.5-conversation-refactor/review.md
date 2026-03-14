# M6.9-S3.5 External Review: Conversation Refactor

**Reviewer:** External review agent (Opus 4.6)
**Date:** 2026-03-14
**Branch:** `sprint/m6.9-s3.5-conversation-refactor`
**Spec:** `docs/superpowers/specs/2026-03-13-s3.5-conversation-refactor-design.md`
**Diff:** 60 files changed, +1361 / -347

---

## Spec Coverage

| Spec Section | Status | Evidence |
|---|---|---|
| **2.1 alert() Channel Routing** | PASS | `conversation-initiator.ts:120-134` — looks up last user turn's channel via `getRecentTurns()`, passes as `channelOverride` to `trySendViaChannel()`. Two new tests verify: web channel skips send, whatsapp channel sends via whatsapp even when global pref is web. |
| **2.2 firstTurnPrompt Wiring** | PASS | `conversation-initiator.ts:145-162` — `initiate()` accepts `options.firstTurnPrompt`, passes to `streamNewConversation()`. Already functional. |
| **3.1 notifyOnCompletion Field** | PASS | `core/src/tasks/types.ts:11,88,135` — `NotifyOnCompletion` type (`"immediate" | "debrief" | "none"`) added to both `Task` and `CreateTaskInput`. |
| **3.1 DB Migration** | PASS | `conversations/db.ts:252-257` — `ALTER TABLE tasks ADD COLUMN notify_on_completion TEXT DEFAULT NULL` with column existence check. |
| **3.2 TaskProcessor CI Integration** | PASS | `task-processor.ts:238-258` — resolves effective notify via `task.notifyOnCompletion ?? (task.type === "immediate" ? "immediate" : "debrief")`. Calls `CI.alert()`, falls back to `CI.initiate()` with `firstTurnPrompt`. 4 unit tests cover: immediate with active conv, immediate without active conv, debrief skip, type-based default. |
| **3.3 CI Dependency Injection** | PASS | `task-processor.ts:28-31` — `conversationInitiator` is optional in `TaskProcessorConfig`. `index.ts:309-311` uses a getter for lazy resolution. |
| **4.1 Config Rename** | PASS | `core/src/config.ts:87-89` — `debrief` key (no `channel` sub-field). `DebriefPreferences` interface at line 338. `loadPreferences()` returns `debrief` not `morningBrief`. |
| **4.2 Code Rename** | PASS | Zero occurrences of `morningBrief`, `morning-prep`, `MorningBriefPreferences`, `handleMorningPrep`, `runMorningPrep` in `packages/`. File renamed: `morning-prep.ts` -> `debrief-prep.ts`. Method: `handleDebriefPrep()`. Job name: `debrief-prep`. |
| **4.3 Debrief: Task Completion Section** | PASS | `work-loop-scheduler.ts:748-763` — queries `taskManager.getCompletedForDebrief(lastRun)` and appends "Tasks Completed Since Last Debrief" section. `task-manager.ts:380-394` implements the SQL query with correct WHERE clause: `notify_on_completion = 'debrief' OR (notify_on_completion IS NULL AND type = 'scheduled')`. |
| **4.4 Settings UI** | PASS | `index.html` — "Debrief" section header (not "Morning Brief"). "Preferred Channel" in its own `glass-strong` panel, separate from debrief. Both desktop and mobile variants. |
| **4.5 Manual Migration** | N/A | Documentation-only step for VPS deployment. Not code-verifiable. |
| **5.1 request_debrief MCP Tool** | PASS | `mcp/debrief-server.ts` — `tool("request_debrief", ...)` with no parameters. Returns `{ debrief: result }` as JSON text. |
| **5.2 Debrief Behavior (cache vs fresh)** | PASS | `debrief-server.ts:19-23` — checks `scheduler.hasRunToday("debrief-prep")`, returns cached output if available, otherwise calls `handleDebriefPrep()`. `work-loop-scheduler.ts:304-312` implements `hasRunToday()`. `getDebriefOutput()` reads `current-state.md`. 2 unit tests cover both paths. |
| **5.3 MCP Integration** | PASS | `session-manager.ts:22,94-97` — `createDebriefMcpServer(debriefScheduler)` registered alongside existing MCP servers. `WorkLoopScheduler` passed via `index.ts:466-467`. |
| **6.1 Typing Indicator Refresh** | PASS | `response-timer.ts:12,35-37` — `setInterval` at 10,000ms calling `sendTyping()`. Unit test verifies 2 calls after 20s. |
| **6.2 Interim Messages** | PASS | `response-timer.ts:13-14,39-49` — two `setTimeout`s at 30s and 90s. Messages: "Working on it..." and "Still on it, bear with me...". Max 2 (no further timeouts). 4 unit tests verify timing and max count. |
| **6.3 Channel Behavior: WhatsApp** | PASS | `message-handler.ts:527-541` — `ResponseTimer` instantiated per message with `sendTyping` callback to channel and `sendInterim` callback via `channelManager.send()`. Interim messages are NOT appended to transcript (ephemeral). |
| **6.3 Channel Behavior: Web** | PASS | `protocol.ts:113` — `interim_status` message type added to `ServerMessage`. `app.js:16,775-780` — handles `interim_status`, sets `interimMessage`. `app.js:785` — clears on first `text_delta`. `index.html:4713-4721,7828-7836` — renders ephemeral italic message in both desktop and mobile. |
| **6.4 ResponseTimer Class** | PASS | `response-timer.ts` — clean encapsulation with `start()` and `cancel()`. Cancel clears interval + all timeouts. `message-handler.ts:556,571,578` — `cancel()` called on first token, on error, and in finally block. |
| **8. Edge Cases** | PASS | Task completes with active conv -> `CI.alert()` (line 249). No active conv + immediate -> `CI.initiate()` (line 251). Debrief with no schedule -> waits for `request_debrief` or next run. `request_debrief` twice -> second call reads cache (line 19-21). WhatsApp disconnect during interim -> catch in `trySendViaChannel` (line 224-229). |

## Gaps Found

1. **Sidebar label still says "Morning Prep"** — The left sidebar button at `e14` in the dashboard reads "Morning Prep". The spec (S4) says rename throughout. This is a cosmetic label in `index.html` that was not updated. **Severity: Low** — functional code is correct, this is a UI label in a navigation button.

2. **`available-models` API returns 404** — Console shows `Failed to load resource: 404` for `/api/settings/available-models`. This is pre-existing (requires API key) and not related to this sprint.

## Unspecified Additions

None found. All changes trace directly to spec sections.

## Test Summary

- **TypeScript:** 0 errors
- **Unit tests:** 389 passed, 5 failed (all 5 are pre-existing live-API integration tests requiring `ANTHROPIC_API_KEY`)
- **New sprint tests:** 13 tests across 4 files, all passing
- **Browser:** Dashboard loads, Settings UI shows "Debrief" section and separate "Preferred Channel" section

---

## Verdict: PASS

The implementation matches the spec across all 16+ requirements. Tests are comprehensive with 13 new tests covering all major features. TypeScript compiles cleanly. The code is well-structured with proper dependency injection and clean separation.

**Post-merge fixes applied:**
- CI lazy getter bug: `TaskProcessor` eagerly evaluated `conversationInitiator` to null at construction time (before CI was initialized). Fixed to use a getter function for lazy resolution.
- Sidebar "Morning Prep" label concern from initial review: confirmed as false positive (grep finds zero matches in codebase).
- DB migration: renamed 345 `morning-prep` → `debrief-prep` entries in `work_loop_runs` to prevent spurious debrief fire on restart.
- Trigger endpoint: `skipOutreach` flag + `localhostOnly` middleware added after 270-trigger incident.

**CTO verified:** Task completion notification via WhatsApp confirmed working end-to-end on 2026-03-14.
