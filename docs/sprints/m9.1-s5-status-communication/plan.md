# M9.1-S5: Status Communication + System Prompt

> **Date:** 2026-04-06
> **Type:** Trip sprint (autonomous, CTO on mobile)
> **Branch:** `sprint/m9.1-s5-status-communication`
> **Design spec:** `docs/design/agentic-flow-overhaul.md` § System 5
> **Implementation plan:** `docs/plans/2026-04-05-agentic-flow-overhaul.md` § Sprint 5

---

## Goal

Nina always knows the status of every job and can communicate it accurately. Three delivery channels (pull/push/briefing) ensure nothing falls through.

## Prior Sprint Context

- **S1:** Todo system + MCP server (todos.json per session, 4 tools)
- **S2:** Todo templates + validation (capability_build/modify templates, 3-layer assembly, completion gating)
- **S3:** Heartbeat service (30s tick, stale detection, persistent notification queue, delivery via ci.alert())
- **S4:** Enforcement hooks (source code protection, capability routing, Stop reminder, trust model)

All prerequisites are in place. S5 wires the existing infrastructure into the user-facing communication channels.

---

## Tasks

### Task 1: Enhanced `check_job_status` with todo progress

**Files:** `packages/dashboard/src/mcp/automation-server.ts` (lines 364-481)

**What:** For each active job, read `todos.json` from `job.run_dir` and include structured progress in the response — completed items, in-progress items, pending items.

**Steps:**
1. Import `readTodoFile` from `automations/todo-file.js`
2. For each active job that has a `run_dir`, read todos and format progress
3. Include todo breakdown in the text output for each job line
4. Write unit tests for the enhanced output

**Spec reference:** Design spec § "Enhanced check_job_status"

---

### Task 2: Enhance `[Active Working Agents]` with todo progress

**Files:**
- `packages/dashboard/src/app.ts` (lines 1355-1378) — `setRunningTasksChecker`

**What:** The running tasks checker currently returns `"name (job id, status: running)"`. Enhance to include todo progress: `"name (job-id): running, 3/6 items done, currently: 'Step 3'"`.

**Steps:**
1. Import `readTodoFile` in app.ts
2. For each job with a `run_dir`, read todos and compute done/total + current item
3. Format as spec requires: `"Name" (job-id): status, N/M items done, currently: "text"`
4. No changes needed to system-prompt-builder.ts — it already renders the string array

---

### Task 3: Add `[Pending Briefing]` section to system prompt

**Files:**
- `packages/dashboard/src/agent/system-prompt-builder.ts` — add section + extend `BuildContext`
- `packages/dashboard/src/agent/session-manager.ts` — wire pending briefing into build context
- `packages/dashboard/src/app.ts` — provide pending briefing data

**What:** New system prompt section populated from the persistent notification queue. Shows events that occurred since last interaction (interrupted jobs, capability health changes). After briefing is shown, mark notifications as delivered.

**Steps:**
1. Add `pendingBriefing?: string[]` to `BuildContext` interface
2. Add `[Pending Briefing]` section rendering in `build()` — after active agents, before session context
3. Wire: expose a `setPendingBriefingProvider` function (or extend the existing checker pattern) so app.ts can provide pending briefing data from the notification queue
4. In app.ts, wire the provider to read from `PersistentNotificationQueue.listPending()` and format each notification into a human-readable line
5. After building the prompt, mark the returned notifications as delivered (they'll be in Nina's context)

**Spec reference:** Design spec § "Pending Briefing (after restart or idle)"

---

### Task 4: Add `[Your Pending Tasks]` section to system prompt

**Files:**
- `packages/dashboard/src/agent/system-prompt-builder.ts` — add section + extend `BuildContext`
- `packages/dashboard/src/agent/session-manager.ts` — wire conversation todos

**What:** Show Conversation Nina's own todo list in the system prompt, so she knows what she needs to do.

**Steps:**
1. Add `conversationTodos?: Array<{ text: string; status: string }>` to `BuildContext`
2. Add `[Your Pending Tasks]` section rendering — checkbox format (`☐`/`✓`)
3. Wire: session manager reads conversation's `todos.json` and passes items into context

**Spec reference:** Design spec § "Conversation Nina's Own Pending Tasks"

---

### Task 5: Acceptance tests

**Files:**
- Create: `packages/dashboard/tests/integration/status-prompt-acceptance.test.ts`

**What:** Prove all three delivery channels work: check_job_status returns todo progress, system prompt contains [Active Working Agents] with progress, [Pending Briefing] from queue, [Your Pending Tasks] from conversation todos.

**Tests:**
1. `check_job_status` returns todo breakdown for running jobs
2. System prompt `[Active Working Agents]` includes "N/M items done"
3. System prompt `[Pending Briefing]` appears when notifications are pending
4. System prompt `[Your Pending Tasks]` shows conversation todos
5. After briefing is built, notifications move from pending to delivered

---

## Validation Criteria

1. **Acceptance tests pass** — system prompt includes todo progress + pending briefing + conversation todos
2. **`check_job_status` returns todo progress** for running jobs
3. **Conversation Nina's own todos appear** in `[Your Pending Tasks]`
4. **After briefing is shown, notifications move** from `pending/` to `delivered/`
5. **TypeScript compiles clean** — 0 errors in both core and dashboard

## Spec-to-Task Traceability

| Spec Requirement | Task |
|-----------------|------|
| Enhanced check_job_status with todo progress | Task 1 |
| [Active Working Agents] with todo progress | Task 2 |
| [Pending Briefing] from persistent queue | Task 3 |
| [Your Pending Tasks] for Conversation Nina | Task 4 |
| Three delivery channels working | Tasks 1-4 + Task 5 acceptance |
| Mark delivered after briefing shown | Task 3 Step 5 |

## Risks

- **AppHarness may need extending** for `buildSystemPrompt()` — mitigate by checking harness API before writing tests
- **Session manager wiring** for pending briefing requires understanding the query flow — mitigate by reading how `activeWorkingAgents` is currently wired (well understood from exploration)
