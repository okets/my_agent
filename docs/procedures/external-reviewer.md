# External Reviewer Procedure

> **Purpose:** Independent post-implementation verification of sprint output against design spec
> **Created:** 2026-03-12
> **Referenced by:** start-sprint, start-overnight-sprint, start-trip-sprint skills

---

## Overview

After all sprint tasks are implemented and automated tests pass, an independent Opus agent verifies the output against the design spec. This agent has NO shared context with the implementation team — it starts fresh, reads the spec, reads the code, and produces a verdict.

**Why independent:** Today's in-team reviewers share conversation context with implementers. If the implementer misunderstood a spec requirement, the reviewer likely shares that blind spot. The external reviewer breaks this by starting with zero implementation context.

**Note:** The external reviewer does NOT replace the in-team Reviewer role. The in-team Reviewer checks code quality (bugs, security, style) during execution. The external reviewer checks spec fidelity (was the right thing built?) after execution. Both are needed.

---

## Dispatch Mechanism

The external reviewer is spawned as a **standalone subagent** via the `Agent` tool — NOT as a team member. This ensures full context isolation.

```
Agent tool parameters:
  name: "external-reviewer"
  subagent_type: "general-purpose"
  model: "opus"
  mode: "bypassPermissions"  (needs to run tests, start servers, use Playwright)
```

**Timing:** Dispatched AFTER the implementation team has finished and been shut down. Runs in the same worktree so it has access to the built code and can start the server.

---

## Input Package

The external reviewer receives a precise, curated prompt containing:

1. **The design spec** — full document describing what should be built
2. **The plan** — including the traceability matrix showing spec requirement → task → verification
3. **The git diff** — `git diff master...HEAD` showing what code was actually written
4. **Test results** — output of the test suite run
5. **File listing** — new files created, existing files modified

It does NOT receive:
- The implementer's conversation history
- Decision-making context ("we discussed X and decided Y")
- Any narrative about what was done or why

---

## Plan Requirements

The external reviewer checks that the sprint plan includes a **traceability matrix**:

| Spec Requirement | Plan Task(s) | Verification |
|-----------------|-------------|--------------|
| §N.N "requirement text" | Task N | Test: file.test.ts — description |

**Rules enforced:**
- Every "must" or "should" in the design spec maps to at least one plan task
- Every plan task maps back to at least one spec requirement (orphan tasks get questioned)
- Every row has a concrete verification method: test file, command with expected output, or Playwright check
- Incomplete traceability is flagged in the report

---

## What It Does

### 1. Spec Coverage Check

Walk through every row in the traceability matrix:
- Confirm the code actually implements what the task claims
- Confirm the test actually verifies the behavior described
- Flag any spec requirements with no corresponding code or test

### 2. Run Test Suite

Execute tests independently — do not trust reported results alone:
- `npx vitest run` (or project-specific test command)
- `npx tsc --noEmit`
- Record pass/fail counts

### 3. Browser Verification (when applicable)

**Mandatory when:** Sprint modifies files in `public/`, route handlers, server startup, or anything imported by the dashboard.

**Skip when:** Sprint only modifies internal library code, tests, docs, or scripts with no server/UI impact.

**Process:**
1. Start the server with the new code (e.g., `npx tsx src/index.ts` or the appropriate start command)
2. Use Playwright to navigate to affected pages, hit API endpoints, verify behavior matches spec
3. Check: pages load without console errors, API endpoints respond with expected status/shapes, UI elements spec describes are present

**If server fails to start:** Mark browser verification as **BLOCKED** (not skipped). A BLOCKED browser verification means the verdict cannot be PASS. Include the error in the report.

**On failure:** Take screenshots via Playwright when browser checks fail, for debugging context.

### 4. Gap Analysis

Look for:
- Spec requirements that were missed entirely
- Plan tasks that weren't fully implemented
- Implementation that diverged from the spec
- Edge cases the spec mentions that tests don't cover

---

## Report Format

```markdown
# External Verification Report

**Sprint:** M{N}-S{N} {name}
**Reviewer:** External Opus (independent)
**Date:** {date}

## Spec Coverage

| Spec Requirement | Status | Evidence |
|-----------------|--------|----------|
| §N.N requirement | COVERED / MISSING / PARTIAL | code location, test name, or gap description |

## Test Results

- Core: {N} passed, {N} failed, {N} skipped
- Dashboard: {N} passed, {N} failed, {N} skipped
- TypeScript: compiles clean / {N} errors

## Browser Verification

- [x] Dashboard loads at / without console errors
- [x] POST /api/endpoint returns 200 with expected body
- [ ] N/A — no UI changes in this sprint

(or "Skipped — sprint is pure library/utility work with no UI or server changes")
(or "BLOCKED — server failed to start: {error}")

## Gaps Found

- None

(or specific issues with spec section references)

## Verdict

**PASS** | **PASS WITH CONCERNS** | **FAIL**

{1-2 sentence summary}
```

The report is saved to `docs/sprints/m{N}-s{N}-{name}/review.md`.

---

## How Sprint Skills Use This

Each sprint skill (normal, overnight, trip) includes a step that:
1. Gathers the input package (spec, plan, diff, test results, file list)
2. Constructs the reviewer prompt with all inputs inline
3. Dispatches via `Agent` tool with the parameters above
4. Waits for the report
5. Saves the report to `review.md` in the sprint folder

The sprint skill references this procedure: "See `docs/procedures/external-reviewer.md` for full protocol."

---

*Created: 2026-03-12*
