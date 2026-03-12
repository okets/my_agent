# Trip Mode & Verification Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trip mode sprint execution and conversational review skills, plus upgrade the verification pipeline across all sprint modes with spec-traceable plans and an independent external reviewer agent.

**Architecture:** 3 new files (trip sprint skill, trip review skill, external reviewer procedure) + 5 existing file modifications (writing-plans skill, start-sprint skill, start-overnight-sprint skill, overnight procedure, whats-next skill). All changes are markdown/skill files — no TypeScript.

**Tech Stack:** Markdown, Claude Code skills, Claude Code procedures

**Design spec:** `docs/superpowers/specs/2026-03-12-trip-mode-verification-pipeline-design.md`

---

## File Structure

### New files to create

| File | Responsibility |
|------|---------------|
| `docs/procedures/external-reviewer.md` | External reviewer protocol — what it receives, what it checks, report format, dispatch mechanism |
| `.claude/skills/start-trip-sprint/SKILL.md` | Trip mode sprint execution skill — autonomous with hard stop on design deviations |
| `.claude/skills/trip-review/SKILL.md` | Conversational sprint review — walks CTO through results, ends with merge decision |

### Existing files to modify

| File | Change |
|------|--------|
| `.claude/skills/whats-next/SKILL.md` | Add "Trip" to sprint mode recommendation (§6.5) |
| `.claude/skills/start-sprint/SKILL.md` | Add external reviewer step after execution (§6.2) |
| `.claude/skills/start-overnight-sprint/SKILL.md` | Add mandatory external reviewer step (§6.3) |
| `docs/procedures/overnight-sprint.md` | Update verification requirements with spec coverage + browser verification (§6.4) |

**Note:** The `superpowers:writing-plans` skill lives in the superpowers plugin cache (`~/.claude/plugins/cache/claude-plugins-official/superpowers/`). Per spec §6.1, this skill needs a traceability matrix requirement added. However, since this is a plugin-managed file (not in the project repo), the traceability matrix section will be added as a **project-level override** in the project's own writing-plans configuration, or documented in the external reviewer procedure as a plan requirement that the reviewer enforces. The external reviewer procedure (Task 1) will specify that plans must include traceability matrices, and the reviewer checks for them.

---

## Traceability

| Spec Requirement | Plan Task(s) | Verification |
|-----------------|-------------|--------------|
| §3.1 "Every sprint plan must include a traceability matrix" | Task 1 (external reviewer checks for it), Task 4 (overnight procedure references it) | Read external-reviewer.md — confirms traceability check is in spec coverage step |
| §3.2 "Independent Opus agent dispatched after implementation" | Task 1 | Read external-reviewer.md — confirms dispatch mechanism, input package, isolation |
| §3.2 "Produces structured report" | Task 1 | Read external-reviewer.md — report format matches spec §3.2 |
| §3.3 "Browser verification via Playwright when applicable" | Task 1 | Read external-reviewer.md — browser verification section with mandatory/skip criteria |
| §4.1 "Trip mode autonomous execution with hard stop on design deviations" | Task 2 | Read start-trip-sprint/SKILL.md — decision protocol matches spec §4.3 |
| §4.3 "Decision protocol: minor/medium/major" | Task 2 | Read start-trip-sprint/SKILL.md — three-tier protocol with STOP on major |
| §4.3 "Timeout policy: log as BLOCKED, skip, continue" | Task 2 | Read start-trip-sprint/SKILL.md — timeout section present |
| §4.4 "Plan must exist before invocation" | Task 2 | Read start-trip-sprint/SKILL.md — plan prerequisite in pre-flight |
| §4.5 "Sprint artifacts created and maintained during execution" | Task 2 | Read start-trip-sprint/SKILL.md — artifacts table with creation/update timing |
| §4.6 "Skill at .claude/skills/start-trip-sprint/SKILL.md" | Task 2 | File exists at correct path |
| §4.7 "Execution flow 1-10" | Task 2 | Read start-trip-sprint/SKILL.md — flow matches spec |
| §4.7 "Two reviewer roles: in-team + external" | Task 2 | Read start-trip-sprint/SKILL.md — both roles documented |
| §5.1 "Conversational walkthrough of sprint results" | Task 3 | Read trip-review/SKILL.md — reads artifacts, presents findings |
| §5.2 "Skill at .claude/skills/trip-review/SKILL.md" | Task 3 | File exists at correct path |
| §5.3 "Flow: read artifacts, present by verdict, CTO decides" | Task 3 | Read trip-review/SKILL.md — PASS/CONCERNS/FAIL flows |
| §5.4 "Short messages, numbers over prose, lead with verdict" | Task 3 | Read trip-review/SKILL.md — conversation style section |
| §6.2 "start-sprint gets external reviewer step" | Task 5 | Read start-sprint/SKILL.md — external reviewer in flow |
| §6.3 "start-overnight-sprint gets mandatory external reviewer" | Task 6 | Read start-overnight-sprint/SKILL.md — external reviewer mandatory |
| §6.4 "overnight procedure updated" | Task 4 | Read overnight-sprint.md — spec coverage + browser verification in requirements |
| §6.5 "whats-next adds Trip recommendation" | Task 7 | Read whats-next/SKILL.md — Trip option with criteria |

---

## Chunk 1: Foundation + New Files

### Task 1: Create External Reviewer Procedure

**Files:**
- Create: `docs/procedures/external-reviewer.md`

This is the foundation document. All sprint skills reference it. Write it first.

- [ ] **Step 1: Create the procedure file**

Write `docs/procedures/external-reviewer.md` with these sections:

```markdown
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
```

- [ ] **Step 2: Verify the file was created correctly**

Read `docs/procedures/external-reviewer.md` and confirm:
- Dispatch mechanism section exists with Agent tool parameters
- Input package lists 5 items
- Plan requirements section describes traceability matrix
- 4 verification steps (spec coverage, tests, browser, gap analysis)
- Report format matches spec §3.2
- Browser verification has mandatory/skip/blocked criteria

- [ ] **Step 3: Commit**

```bash
git add docs/procedures/external-reviewer.md
git commit -m "docs: add external reviewer procedure (spec §3.2)"
```

---

### Task 2: Create Trip Sprint Skill

**Files:**
- Create: `.claude/skills/start-trip-sprint/SKILL.md`

- [ ] **Step 1: Create the skill directory and file**

```bash
mkdir -p .claude/skills/start-trip-sprint
```

Write `.claude/skills/start-trip-sprint/SKILL.md`:

```markdown
---
name: start-trip-sprint
description: Start an autonomous trip sprint. Stops on major design deviations and waits for CTO input. External reviewer replaces manual code review.
---

# Start Trip Sprint (Mobile CTO Mode)

You are starting a **trip sprint** — autonomous execution while CTO is on mobile. CTO can text but cannot do code reviews or read documents.

**External reviewer procedure:** `docs/procedures/external-reviewer.md`

## Pre-Flight Checklist

Before starting, verify:

- [ ] Sprint plan exists and is complete (created beforehand via normal brainstorming + writing-plans flow)
- [ ] Plan has been reviewed by spec-document-reviewer
- [ ] Plan includes a complete traceability matrix (spec requirement → task → verification)
- [ ] Scope is clear and unambiguous
- [ ] No heavy visual design work requiring CTO visual feedback
- [ ] Branch will be created

If any pre-flight item fails, **stop and tell the CTO** — trip sprints cannot proceed without a reviewed plan.

## How Trip Mode Differs

| Aspect | Normal | Overnight | Trip |
|--------|--------|-----------|------|
| CTO available | Live at desk | Absent | Mobile, text only |
| Minor decisions | Make and mention | Make and log | Make and log |
| Medium decisions | Present options | Make, log pros/cons | Make, log pros/cons |
| Major design deviations | Stop and discuss | Make, log extensively | **Stop and wait** |
| External reviewer | Standard step | Standard step | **Mandatory, replaces CTO review** |
| Browser verification | Standard step | Standard step | **Mandatory when applicable** |
| Review delivery | CTO reads artifacts + code | CTO reads artifacts + code | **Conversational walkthrough via /trip-review** |

## Branch Setup

```bash
git checkout -b sprint/m{N}-s{N}-{name}
```

All work happens on this branch. Never touch master.

## Team Composition

| Role | Model | Responsibility |
|------|-------|----------------|
| Tech Lead | Opus | Orchestrate, decide, integrate, write decision log |
| Frontend Dev | Sonnet | UI implementation |
| Backend Dev | Sonnet | Server implementation |
| Reviewer | Opus | Independent code review during execution (can fail sprint) |
| QA | Sonnet | Manual testing, write test report |

Add **custom roles** when the sprint benefits. The in-team Reviewer handles code quality (bugs, security, style). The External Reviewer (dispatched after execution) handles spec verification.

## Agent Team Setup

**Use Claude Code's native Teams feature** — same setup as overnight sprints.

1. **Create team** with `TeamCreate`: `sprint-m{N}-s{N}-{name}`
2. **Create shared tasks** with `TaskCreate` — one per sprint task
3. **Spawn teammates** with `Agent` tool using `team_name` and `name`
4. **Agents communicate via `SendMessage`** — DMs for handoffs, `broadcast` for blockers
5. **Task coordination via shared task list** — claim with `TaskUpdate`, mark complete
6. **Shutdown when sprint completes** — `shutdown_request` to all, then `TeamDelete`

### When NOT to use teams

Single-agent execution when: <3 tasks, strictly sequential, or pure research.

## Decision Protocol (Trip Mode)

```
Decision needed?
  ├─ Minor (implementation detail)
  │     → Decide, log briefly in DECISIONS.md, continue
  │
  ├─ Medium (multiple valid approaches)
  │     → Decide, log pros/cons in DECISIONS.md, flag for review, continue
  │
  └─ Major design deviation (spec says X but reality demands Y)
        → STOP
        → Present to CTO:
           - What the spec says (1-2 sentences)
           - Why it doesn't work (1-2 sentences)
           - Options labeled A/B/C
        → Wait for CTO response
        → Continue with chosen option
```

### What Counts as a Major Design Deviation

- A spec requirement can't be implemented as written
- Two spec requirements conflict with each other
- A dependency is missing or behaves differently than the spec assumed
- The implementation would require changing the design spec's architecture
- Something affects other sprints or milestones

### What Does NOT Count

- Choosing between two valid ways to implement a spec requirement
- Adding a helper function not mentioned in the spec
- Adjusting test structure
- Import reorganization or code organization choices

### Timeout Policy

If no CTO response within the current session (CTO closes terminal or session expires):
1. Log the deviation as **BLOCKED** in `DEVIATIONS.md`
2. Skip the affected task
3. Continue with remaining unblocked tasks
4. All blocked items are presented during `/trip-review`

## Sprint Artifacts

All artifacts are created and maintained during execution, not just at the end.

| Artifact | Location | Created when | Updated when |
|----------|----------|-------------|--------------|
| `plan.md` | `docs/sprints/m{N}-s{N}-{name}/` | Before execution (pre-existing) | Not modified (unless critical fix, logged in DEVIATIONS.md) |
| `DECISIONS.md` | `docs/sprints/m{N}-s{N}-{name}/` | First decision is made | Each subsequent decision |
| `DEVIATIONS.md` | `docs/sprints/m{N}-s{N}-{name}/` | First deviation occurs | Each subsequent deviation |
| `review.md` | `docs/sprints/m{N}-s{N}-{name}/` | External reviewer completes verification | Not modified after creation |
| `test-report.md` | `docs/sprints/m{N}-s{N}-{name}/` | External reviewer runs tests + browser checks | Not modified after creation |

These artifacts are the source of truth for `/trip-review`. They must be complete because the CTO will never read them directly.

## Execution Flow

1. **Identify sprint** — ask if not specified
2. **Read the design spec and sprint plan**
3. **Present briefing conversationally:**
   - Goal in 1-2 sentences
   - Task count and estimated complexity
   - Any risks or ambiguities to resolve now
   - Ask CTO to confirm
4. **On confirmation** — create branch and begin execution
5. **Run autonomously** — minor/medium decisions handled like overnight
6. **Stop on major design deviations** — present options, wait for response
7. **After all tasks complete** — shut down implementation team
8. **Dispatch external reviewer** (see `docs/procedures/external-reviewer.md`):
   - Gather input package: spec, plan, `git diff master...HEAD`, test results, file list
   - Spawn external reviewer agent with `Agent` tool
   - External reviewer runs tests, browser checks, spec gap analysis
   - External reviewer writes `review.md` and `test-report.md`
9. **Notify CTO:** "Sprint complete. Run `/trip-review` when ready."

## Start

1. Confirm which sprint (ask if not specified)
2. Read the sprint plan thoroughly
3. Present briefing and wait for confirmation:
   - Goal, task count, complexity
   - Team composition
   - Any pre-flight concerns
   - **Ask CTO to confirm before proceeding**
4. On confirmation → create branch, set up team, begin execution
```

- [ ] **Step 2: Verify the file**

Read `.claude/skills/start-trip-sprint/SKILL.md` and confirm:
- Frontmatter has name and description
- Pre-flight includes plan prerequisite and traceability check
- Comparison table matches spec §4.2
- Decision protocol has 3 tiers with STOP on major
- Timeout policy present
- Artifacts table matches spec §4.5
- Execution flow has 9 steps matching spec §4.7
- External reviewer dispatch references the procedure doc

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/start-trip-sprint/SKILL.md
git commit -m "feat: add start-trip-sprint skill (spec §4)"
```

---

### Task 3: Create Trip Review Skill

**Files:**
- Create: `.claude/skills/trip-review/SKILL.md`

- [ ] **Step 1: Create the skill directory and file**

```bash
mkdir -p .claude/skills/trip-review
```

Write `.claude/skills/trip-review/SKILL.md`:

```markdown
---
name: trip-review
description: Conversational sprint review for mobile CTO. Reads all artifacts, presents findings in short messages, ends with merge decision.
---

# Trip Review (Conversational Sprint Review)

Walk the CTO through sprint results. Read all artifacts, present findings in short digestible messages, end with a clear action.

**When to use:** After a trip sprint completes, or when CTO runs `/trip-review`.

## Flow

### 1. Read All Artifacts

Read these files from `docs/sprints/m{N}-s{N}-{name}/`:
- `review.md` — external reviewer's verdict and findings
- `DECISIONS.md` — all decisions made during execution
- `DEVIATIONS.md` — all departures from plan
- `test-report.md` — test results and browser verification
- `plan.md` — original plan for context

If any artifact is missing, note it explicitly: "No deviations logged" or "test-report.md is missing — this needs investigation."

### 2. Determine Verdict

Read the verdict from `review.md`: PASS, PASS WITH CONCERNS, or FAIL.

### 3. Present Findings

Present in order, one topic per message. Keep messages short — the CTO is on a phone.

**If PASS:**

```
"Sprint M{N}-S{N} is done. {N} commits, all {N} tasks complete."

"The external reviewer gave it a PASS. All {N} tests pass,
browser checks passed, no spec gaps found."

"{N} decisions were made, all minor — {brief summary}."

"{N} deviations: {brief summary of each}."

"Want to merge to master?"
```

**If PASS WITH CONCERNS:**

```
"Sprint done, but the reviewer flagged {N} concerns."

"Concern 1: {1-2 sentence description}"

"Concern 2: {1-2 sentence description}"

"Everything else checks out. {N} tests pass, all spec
requirements covered. These are non-blocking."

"Want to merge, or should I fix the concerns first?"
```

**If FAIL:**

```
"Sprint finished but the reviewer failed it."

"Main issue: {1-2 sentence description of primary failure}"

"The rest looks good — {N} of {N} tasks verified."

"Options:
A. I fix the issue and re-run verification
B. Wait until you're at a desk
C. Roll back the branch"
```

### 4. Handle CTO Response

| Response | Action |
|----------|--------|
| "merge" | Execute `git checkout master && git merge sprint/m{N}-s{N}-{name}` |
| "fix" | Continue working on the branch, fix issues, re-run external reviewer, re-present results |
| "wait" | Leave branch as-is, no action |
| "elaborate" / question | Give more detail on whatever they ask about |
| Blocked items from timeout | Present each blocked item with the deviation details, ask for decision on each |

### 5. After Merge

If CTO approves merge:
1. Execute the merge
2. Confirm: "Merged to master. {N} commits."
3. Check if roadmap needs updating

## Conversation Style

- **Short messages** — one topic per message
- **No jargon** — no file paths unless CTO asks for specifics
- **Numbers over prose** — "5 decisions, all minor" not "several decisions were made"
- **Lead with verdict** — then details
- **Always end with a clear question or action**

## Identifying the Sprint

If the CTO doesn't specify which sprint:
1. Check for branches matching `sprint/m*`
2. If exactly one exists, use it
3. If multiple exist, list them and ask which one
4. If none exist, say "No sprint branches found"
```

- [ ] **Step 2: Verify the file**

Read `.claude/skills/trip-review/SKILL.md` and confirm:
- Frontmatter has name and description
- Reads all 5 artifact files
- 3 verdict flows: PASS, PASS WITH CONCERNS, FAIL
- CTO response handling table
- Conversation style rules match spec §5.4
- Sprint identification logic

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/trip-review/SKILL.md
git commit -m "feat: add trip-review skill (spec §5)"
```

---

## Chunk 2: Existing File Modifications

### Task 4: Update Overnight Sprint Procedure

**Files:**
- Modify: `docs/procedures/overnight-sprint.md`

- [ ] **Step 1: Add external reviewer to execution flow**

In the Execution Flow section (the numbered list in the code block), add after step 6 (Documentation):

```markdown
7. External Reviewer (independent verification)
   ├─ Gather: spec, plan, git diff, test results, file list
   ├─ Dispatch: standalone Opus agent (see docs/procedures/external-reviewer.md)
   ├─ Reviewer runs tests independently
   ├─ Reviewer runs browser checks (if sprint touches UI/server)
   ├─ Reviewer checks spec coverage against traceability matrix
   └─ Reviewer writes review.md and test-report.md
```

Renumber existing step 7 (Final Commit) to step 8. Preserve its existing sub-items (squash/structured commits + DO NOT merge to master).

- [ ] **Step 2: Update Verification Requirements section**

Add to the "Must Pass" list:

```markdown
- [ ] External reviewer spec coverage — all traceability matrix rows verified
- [ ] External reviewer verdict — PASS or PASS WITH CONCERNS (not FAIL)
```

Add to the "Should Pass" list:

```markdown
- [ ] Browser verification passes (when sprint touches UI/server routes)
```

- [ ] **Step 3: Add traceability matrix reference**

In the Pre-Flight Checklist table, add a row:

```markdown
| Traceability matrix | Yes | Plan must map spec requirements → tasks → verification |
```

- [ ] **Step 4: Verify changes**

Read `docs/procedures/overnight-sprint.md` and confirm:
- External reviewer step is in execution flow
- Spec coverage and verdict are in verification requirements
- Traceability matrix is in pre-flight
- Existing content is not broken

- [ ] **Step 5: Commit**

```bash
git add docs/procedures/overnight-sprint.md
git commit -m "docs: add external reviewer to overnight sprint procedure (spec §6.4)"
```

---

### Task 5: Update Start Sprint Skill (Normal Mode)

**Files:**
- Modify: `.claude/skills/start-sprint/SKILL.md`

- [ ] **Step 1: Add external reviewer step to Sprint Flow**

In the Sprint Flow section (numbered list), add after step 7 (gap analysis) and before step 8 (shut down):

```markdown
8. **External reviewer** — dispatch independent Opus agent to verify spec coverage (see `docs/procedures/external-reviewer.md`). In normal mode, this is additive — CTO still does their own review, but the external reviewer provides an independent second opinion.
```

Renumber existing step 8 to step 9.

- [ ] **Step 2: Add external reviewer to Verification Checklist**

Add to the checklist:

```markdown
- [ ] External reviewer dispatched and report saved to `review.md`
- [ ] External reviewer verdict is PASS or PASS WITH CONCERNS
- [ ] Browser verification passed (when sprint touches UI/server)
```

- [ ] **Step 3: Verify changes**

Read `.claude/skills/start-sprint/SKILL.md` and confirm:
- External reviewer step is in sprint flow
- Existing steps are preserved and correctly numbered
- Verification checklist includes external reviewer verdict and browser verification

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/start-sprint/SKILL.md
git commit -m "feat: add external reviewer step to normal sprint skill (spec §6.2)"
```

---

### Task 6: Update Start Overnight Sprint Skill

**Files:**
- Modify: `.claude/skills/start-overnight-sprint/SKILL.md`

- [ ] **Step 1: Add external reviewer as mandatory step**

In the execution steps at the bottom (numbered list starting at "1. Confirm which sprint"), add after step 11 (gap analysis) and before step 12 (shut down):

```markdown
12. **External reviewer (mandatory)** — dispatch independent Opus agent to verify spec coverage and run browser checks (see `docs/procedures/external-reviewer.md`). The reviewer's report goes into `review.md` and `test-report.md`.
```

Renumber existing step 12 to step 13.

- [ ] **Step 2: Add to Verification Before Completion**

In the "Must pass" checklist, add:

```markdown
- [ ] External reviewer spec coverage verified
- [ ] External reviewer verdict is PASS or PASS WITH CONCERNS
- [ ] Browser verification passed (when sprint touches UI/server)
```

- [ ] **Step 3: Add traceability requirement to Pre-Flight**

In the Pre-Flight Checklist, add:

```markdown
- [ ] Plan includes traceability matrix (spec requirement → task → verification)
```

- [ ] **Step 4: Verify changes**

Read `.claude/skills/start-overnight-sprint/SKILL.md` and confirm:
- External reviewer is step 12, mandatory
- Verification checklist includes reviewer verdict and browser checks
- Pre-flight includes traceability requirement
- Existing content preserved

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/start-overnight-sprint/SKILL.md
git commit -m "feat: add mandatory external reviewer to overnight sprint skill (spec §6.3)"
```

---

### Task 7: Update What's Next Skill

**Files:**
- Modify: `.claude/skills/whats-next/SKILL.md`

- [ ] **Step 1: Update Sprint Mode Recommendation section**

Replace the current section 7 content. The output format should change from `Normal | Overnight | Either` to `Normal | Overnight | Trip | Either`.

Replace the content of section 7 (lines 93-108 in the current file) with the following. The section starts with `### 7. Sprint Mode Recommendation` and ends before `## When to Run`:

````markdown
### 7. Sprint Mode Recommendation

```
Assess the next action for sprint mode suitability:

  Trip mode if ALL:
    └─ CTO is traveling/mobile-only
    └─ Sprint plan exists and is reviewed
    └─ Plan includes traceability matrix
    └─ Scope is unambiguous (no open design questions)
    └─ No heavy visual design work requiring CTO visual feedback

  Overnight mode if ALL:
    └─ Sprint plan exists and is complete
    └─ Scope is unambiguous (no open design questions)
    └─ No UI-heavy work requiring visual review cycles
    └─ No dependencies on external services being configured

  NOT suitable for autonomous (overnight or trip) if ANY:
    └─ Plan has open questions or ambiguous requirements
    └─ Heavy UI/UX work needing CTO visual feedback
    └─ Requires access or credentials not yet set up
    └─ First sprint in a new milestone (architectural decisions likely)

  Report: "Normal" | "Overnight" | "Trip" | "Either" with brief reason
```
````

- [ ] **Step 2: Update Output Format**

In the Output Format section, change the Recommended Sprint Mode line:

```markdown
### Recommended Sprint Mode
[Normal | Overnight | Trip | Either] — [reason]
```

- [ ] **Step 3: Verify changes**

Read `.claude/skills/whats-next/SKILL.md` and confirm:
- Trip mode criteria present
- Output format includes Trip option
- Existing Normal and Overnight criteria preserved

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/whats-next/SKILL.md
git commit -m "feat: add Trip mode to whats-next sprint recommendation (spec §6.5)"
```

---

## Final Verification

After all tasks are complete:

- [ ] **Verify all new files exist:**
  - `docs/procedures/external-reviewer.md`
  - `.claude/skills/start-trip-sprint/SKILL.md`
  - `.claude/skills/trip-review/SKILL.md`

- [ ] **Verify all modified files have the expected changes:**
  - `docs/procedures/overnight-sprint.md` — external reviewer in flow + verification
  - `.claude/skills/start-sprint/SKILL.md` — external reviewer step
  - `.claude/skills/start-overnight-sprint/SKILL.md` — mandatory external reviewer
  - `.claude/skills/whats-next/SKILL.md` — Trip mode recommendation

- [ ] **Cross-reference with spec §6.6 new files table** — confirm all listed files are created

- [ ] **Final commit (if any cleanup needed)**
