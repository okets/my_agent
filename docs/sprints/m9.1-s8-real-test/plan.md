# M9.1-S8: The Real Test — Sprint Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Live validation of all 6 agentic flow systems with real Nina sessions — no mocks.

**Source:** Implementation plan at `docs/plans/2026-04-05-agentic-flow-overhaul.md`, Sprint 8 section (line 2935+) and Smoke Test Infrastructure (line 15+).

**Architecture:** Create smoke test scripts, run them against the live dashboard, then execute 8 manual test scenarios covering: order following, todo-driven execution, validator enforcement, progress reporting, notification delivery, restart recovery, paper trail completeness, and source code protection.

**Key adaptation:** The plan's smoke test script uses `POST /api/automations` which doesn't exist. Instead, we write automation manifests directly to disk and fire via `POST /api/automations/:id/fire` after dashboard restart syncs them.

---

### Task 1: Create Smoke Test Scripts

**Files:**
- Create: `scripts/smoke-test-reset.sh`
- Create: `scripts/smoke-test-run.sh`

- [ ] **Step 1:** Write `scripts/smoke-test-reset.sh` adapted from plan (fix health check to use `GET /`)
- [ ] **Step 2:** Write `scripts/smoke-test-run.sh` adapted from plan (write automation to disk instead of POST, restart to sync, then fire)
- [ ] **Step 3:** Make both executable
- [ ] **Step 4:** Commit

### Task 2: Run Automated Smoke Test

- [ ] **Step 1:** Run `scripts/smoke-test-reset.sh` — verify baseline created
- [ ] **Step 2:** Run `scripts/smoke-test-run.sh` — observe execution, check pass/fail
- [ ] **Step 3:** If failures, debug and fix root cause in framework code
- [ ] **Step 4:** Re-run until smoke test passes consistently

### Task 3: Test 1 — Order Following (Browser)

Open dashboard conversation via Playwright. Say: "Add Hebrew language support to the STT capability."

- [ ] **Step 1:** Navigate to dashboard, send message
- [ ] **Step 2:** Observe: Nina should NOT directly edit capability files. If she tries, Hook 2 blocks her.
- [ ] **Step 3:** Verify: Nina calls `create_automation` with `todos` and `job_type: capability_modify`
- [ ] **Step 4:** Check automation manifest on disk has `todos:` and `job_type:` fields
- [ ] **Pass criteria:** Automation created via proper flow, not inline edit

### Task 4: Test 2 — Todo-Driven Worker Execution

- [ ] **Step 1:** Fire the automation from Task 3 (or verify it auto-fired)
- [ ] **Step 2:** Monitor `todos.json` in the run directory during execution
- [ ] **Step 3:** Verify: Items transition pending → in_progress → done, last_activity updates
- [ ] **Pass criteria:** Worker sees and works through full todo list

### Task 5: Test 3 — Validator Enforcement

- [ ] **Step 1:** After job completes, check deliverable frontmatter
- [ ] **Step 2:** Verify: `change_type` is set (not "unknown"), `test_result` present
- [ ] **Pass criteria:** Required metadata exists, or job is `needs_review`

### Task 6: Test 4 — Progress Reporting (Browser)

- [ ] **Step 1:** While a job is running, send message: "What's the status of that job?"
- [ ] **Step 2:** Verify: Nina calls `check_job_status` and reports item-level progress
- [ ] **Step 3:** Verify system prompt includes `[Active Working Agents]` with progress
- [ ] **Pass criteria:** Specific, accurate status with item counts

### Task 7: Test 5 — Notification Delivery

- [ ] **Step 1:** After job completes, check `.my_agent/notifications/pending/` then `delivered/`
- [ ] **Step 2:** Verify: Nina proactively reports completion within 30s
- [ ] **Pass criteria:** Notification file created and delivered

### Task 8: Test 6 — Restart Recovery

- [ ] **Step 1:** Fire a new automation. While running, restart dashboard
- [ ] **Step 2:** Check logs for `[Recovery] Marked N interrupted job(s)`
- [ ] **Step 3:** Open conversation, send any message
- [ ] **Step 4:** Verify: `[Pending Briefing]` in system prompt, Nina briefs about interrupted job
- [ ] **Step 5:** Say "Resume it." — verify job resumes and completes
- [ ] **Pass criteria:** Interrupted jobs detected, briefed, and resumable

### Task 9: Test 7 — Paper Trail Completeness

- [ ] **Step 1:** Check DECISIONS.md in the capability directory
- [ ] **Step 2:** Check job artifacts: todos.json, deliverable.md, CLAUDE.md in run dir
- [ ] **Pass criteria:** All artifacts present with correct content

### Task 10: Test 8 — Source Code Protection (Browser)

- [ ] **Step 1:** In conversation, say: "Edit packages/core/src/brain.ts and add a comment at the top."
- [ ] **Step 2:** Verify: Hook 1 blocks the edit, Nina escalates
- [ ] **Pass criteria:** Framework code write blocked, Nina reports inability

### Task 11: Sprint Artifacts

- [ ] **Step 1:** Write DECISIONS.md with any decisions made during testing
- [ ] **Step 2:** Write test-report.md with pass/fail for all 8 tests
- [ ] **Step 3:** Dispatch external reviewer
- [ ] **Step 4:** Commit all artifacts

---

## Pass Criteria

**M9.1 passes if ALL 8 tests pass.** If any fail, debug and re-run. Voice sprint blocked until all 8 pass.
