# M9.1-S8 Test Report

**Date:** 2026-04-06
**Tester:** Sprint developer (Claude Code)
**Branch:** `sprint/m9.1-s8-real-test`
**Method:** Real LLM sessions against live dashboard — no mocks

---

## Test Results Summary

| # | Test | Status | Notes |
|---|------|--------|-------|
| 1 | Order Following | PASS | Hook 2 blocked inline edit, Nina redirected to `create_automation` with `job_type: capability_modify` |
| 2 | Todo-Driven Execution | PASS | 9/9 items done, sequential progression, notes added, `last_activity` updated |
| 3 | Validator Enforcement | PASS | Deliverable has `change_type: configure`, `test_result: pass` in YAML frontmatter |
| 4 | Progress Reporting | PASS | `check_job_status` returns todo progress, system prompt includes `[Active Working Agents]` + `[Pending Briefing]` |
| 5 | Notification Delivery | PASS | Notification created in persistent queue, delivery attempted. Push is best-effort per design; briefing section is the guarantee. |
| 6 | Restart Recovery | PASS | `[Recovery] Marked 1 interrupted job(s)`, Nina briefed: "Got 1 of 5 steps done... Want me to resume?" |
| 7 | Paper Trail | PASS | DECISIONS.md entry with date/change_type/test/job-link. Run dir has CLAUDE.md, deliverable.md, status-report.md, todos.json |
| 8 | Source Code Protection | PASS | Hook 1 blocked edit to brain.ts: "protected as developer-maintained source code" |

**Verdict: ALL 8 TESTS PASS. M9.1 is complete.**

---

## Smoke Test Execution Log

| Run | Todos Done | Status | Key Finding |
|-----|-----------|--------|-------------|
| Run 1 | 0/9 | needs_review | Worker ignored todo system — prompt had zero mention of todos |
| Run 2 | 8/9 (1 blocked) | needs_review | Worker engaged with todos. 1 item blocked by validator (change_type_set tried before deliverable written). Executor overwriting worker's deliverable.md. |
| Run 3 | 8/9 (0 blocked, 1 in_progress) | needs_review | Deliverable preservation fix worked. Worker forgot to retry failed validation on t8. |
| Run 4 | 9/9 | completed | Full pass. All mandatory items done, validators passed, notification created, paper trail complete. |

## Bugs Found and Fixed

### Bug 1: Working Nina prompt missing todo instructions (D1)
**Severity:** Critical
**Root cause:** `working-nina-prompt.ts` had zero mention of the todo system. Tools were wired in but worker had no instructions to use them.
**Fix:** Added "Todo System (MANDATORY)" section to working nina persona prompt.
**Commit:** `d0bd6ba`

### Bug 2: Executor overwrites worker deliverable (D4)
**Severity:** High
**Root cause:** After SDK session ends, executor extracts response text and writes it to `deliverable.md`, overwriting the worker's properly-formatted frontmatter.
**Fix:** Check if `deliverable.md` exists and starts with `---` (YAML frontmatter). If so, preserve the worker's version.
**Commit:** `697ab41`

### Bug 3: Todo template text too vague for validated items (D5)
**Severity:** Medium
**Root cause:** Template items like "Identify change type" didn't mention that the validator checks `deliverable.md` frontmatter. Worker didn't know where to write the data.
**Fix:** Updated template text to include target file and field name (e.g., "write to deliverable.md frontmatter as change_type").
**Commit:** `697ab41`

### Bug 4: Worker forgets to retry failed validation (D6)
**Severity:** Low
**Root cause:** Worker got validation error, fixed the underlying issue, but didn't retry `todo_update`. Prompt said "fix and retry" but wasn't explicit enough.
**Fix:** Strengthened prompt: "read the error, fix the issue, then call todo_update AGAIN. Do not move on until validated items pass."
**Commit:** `f0793c0`

## Findings (Non-Blocking)

### F1: Conversation Nina doesn't provide delegator todos
When creating automations via `create_automation`, conversation Nina provides `job_type: capability_modify` but omits the `todos` field (delegator items). The framework Layer 2 template still provides mandatory items, so the system works — but the delegator layer is empty.

**Impact:** Low. The framework template covers all process requirements. Delegator items are an optimization for task-specific breakdowns.

### F2: Notification push delivery depends on active conversation
Push delivery via `ci.alert()` fails when no conversation session is active (expected per design). The persistent queue + `[Pending Briefing]` system prompt section is the reliability guarantee. This worked correctly in Test 6 — Nina briefed about the interrupted job on the next conversation turn.

## System Verification Matrix

| System | Verified By | Evidence |
|--------|------------|---------|
| 1. Universal Todo System | Smoke test runs 2-4 | todos.json created, 4 MCP tools used, atomic writes, last_activity tracked |
| 2. Todo Templates | Smoke test run 4 | 9 items (4 delegator + 5 template), validators checked, completion gating worked |
| 3. Heartbeat Service | Smoke test + Test 6 | Stale detection, notification delivery, capability health checks |
| 4. Enforcement Hooks | Test 1, Test 8 | Source code protection (Hook 1), capability routing (Hook 2), Stop reminder |
| 5. Status Communication | Test 4, Test 6 | `[Active Working Agents]`, `[Pending Briefing]`, `check_job_status` with todos |
| 6. Restart Recovery | Test 6 | `[Recovery] Marked 1 interrupted`, notification created, Nina briefed on next turn |
