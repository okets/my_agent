# M9.1-S6: Restart Recovery

> **Date:** 2026-04-06
> **Type:** Trip sprint (autonomous, CTO on mobile)
> **Branch:** `sprint/m9.1-s6-restart-recovery`
> **Design spec:** `docs/design/agentic-flow-overhaul.md` § System 6
> **Implementation plan:** `docs/plans/2026-04-05-agentic-flow-overhaul.md` § Sprint 6

---

## Goal

When the dashboard restarts, no work is silently lost. Running jobs are detected, users are notified, and work can resume with todo context.

## Prior Sprint Context

- **S1-S4:** Todo system, templates, heartbeat, enforcement hooks
- **S5:** Status communication — `[Pending Briefing]` in system prompt (the delivery mechanism for restart notifications)

The heartbeat already detects stale jobs during runtime (5min inactivity). S6 adds the startup recovery sequence that runs once on boot, plus the resume flow for interrupted jobs.

---

## Tasks

### Task 1: Startup recovery sequence in app.ts

**Files:** `packages/dashboard/src/app.ts` (insert before heartbeat start)

**What:** On dashboard startup, before accepting connections:
1. Mark all `running`/`pending` jobs as `interrupted` with todo progress
2. Create persistent notifications for each interrupted job
3. Disable stale `once:true` completed automations (no `delete()` method exists — `disable()` is sufficient)
4. Re-scan capabilities
5. Then start heartbeat (already exists)

**Deviation from spec:** Spec says "delete" once-automations, but AutomationManager only has `disable()`. Using disable is safer and equivalent — disabled automations don't fire.

---

### Task 2: Extend `resume_job` to handle `interrupted` status

**Files:** `packages/dashboard/src/mcp/automation-server.ts`

**What:** Currently resume_job only accepts `needs_review` jobs. Extend to also accept `interrupted` jobs. Build a context-aware resume prompt from todo state.

**Steps:**
1. Accept both `needs_review` and `interrupted` statuses
2. For interrupted jobs, construct resume prompt from todo state: show completed items, list remaining
3. Pass enhanced prompt to executor.resume()

---

### Task 3: Enhance executor resume with session ID detection

**Files:** `packages/dashboard/src/automations/automation-executor.ts`

**What:** After SDK session resume, detect whether the session was actually restored or a fresh one was silently created. Log the distinction. If fresh session, the todo context in the prompt is even more important (worker needs to verify completed work on disk).

**Steps:**
1. Compare `newSessionId` to `effectiveSessionId` after iteration
2. If different, log the mismatch — fresh session was created
3. No behavior change needed — the todo-aware resume prompt already handles both cases

---

### Task 4: Extend AppHarness to accept existing agentDir

**Files:** `packages/dashboard/tests/integration/app-harness.ts`

**What:** Add optional `agentDir` parameter to AppHarnessOptions. When provided, reuse the existing directory instead of creating a new temp dir. This enables restart simulation tests.

---

### Task 5: Acceptance tests

**Files:** Create `packages/dashboard/tests/integration/restart-recovery-acceptance.test.ts`

**Tests:**
1. Running job survives restart — detected as interrupted with correct todo progress
2. Notification created in pending/ with correct metadata
3. Stale once:true completed automations disabled on startup
4. resume_job accepts interrupted jobs (not just needs_review)

---

## Validation Criteria

1. **Acceptance tests pass** — restart recovery detects interrupted jobs, creates notifications
2. **resume_job accepts interrupted jobs** — with todo-aware resume prompt
3. **Session ID mismatch detection** — logged when SDK creates fresh session
4. **Stale once:true automations disabled** on startup
5. **TypeScript compiles clean** — 0 errors in both packages

## Spec-to-Task Traceability

| Spec Requirement | Task |
|-----------------|------|
| Step 1: Mark interrupted jobs | Task 1 |
| Step 2: Create notifications | Task 1 |
| Step 3: Clean stale once-automations | Task 1 |
| Step 4: Re-scan capabilities | Task 1 |
| Step 5: Start heartbeat | Already exists |
| Job resumption with session detection | Tasks 2 + 3 |
| Resume with todo context | Task 2 |
| Fresh session fallback | Task 3 |

## Risks

- **AppHarness restart simulation** — reusing agentDir requires careful DB handling (the ConversationManager opens a new DB connection). May need to close first harness cleanly before creating second.
- **SDK session resume detection** — relies on `msg.type === "system"` with `subtype === "init"` which is already captured in executor.resume(). Low risk.
