# Trip Mode & Verification Pipeline Design

> **Date:** 2026-03-12
> **Status:** Draft
> **Context:** CTO traveling, needs to run sprints from mobile. Can make architectural decisions via text but cannot do code reviews or read long documents.

---

## 1. Problem

Sprint quality currently depends on manual CTO code review. When the CTO is on mobile, this review cannot happen. Without it, there's no confidence that what was built matches what was designed.

The trust gap has three layers:

1. **Plan completeness** — A plan might miss spec requirements. No systematic check exists today.
2. **Implementation fidelity** — Code might drift from the plan. The reviewer shares context with the implementer, so they can share blind spots.
3. **Runtime correctness** — Unit tests pass but the system might not actually work end-to-end. No automated browser/API verification exists.

## 2. Solution Overview

Two parts:

**Part 1: Verification pipeline upgrades (all sprint modes).** Close the trust gap so that sprint output can be trusted without manual code review. This benefits normal, overnight, and trip sprints equally.

**Part 2: Trip mode (two new skills).** A sprint execution mode optimized for mobile CTO interaction. Autonomous execution with a hard stop on design deviations. Conversational review that replaces reading artifacts.

## 3. Verification Pipeline (All Modes)

### 3.1 Spec-Traceable Plans

Every sprint plan must include a traceability matrix. This is a table that explicitly connects three things: what the design spec requires, which plan task implements it, and how we verify it was done correctly.

#### Format

```markdown
## Traceability

| Spec Requirement | Plan Task(s) | Verification |
|-----------------|-------------|--------------|
| §3.1 "loadNotebookReference must recurse into subdirectories" | Task 1 | Test: prompt-recursive.test.ts — creates nested dirs, asserts all files found |
| §4.3 "Classification prompt produces 7 categories" | Task 6 | Test: knowledge-extractor.test.ts — parses all 7 category types |
| §6.1 "Properties stored in YAML" | Task 5 | Test: properties.test.ts — round-trips YAML read/write |
```

#### Rules

- Every "must" or "should" statement in the design spec maps to at least one plan task. If a spec requirement has no task, the plan is incomplete.
- Every plan task maps back to at least one spec requirement. Orphan tasks that don't trace to a requirement get questioned — they might be scope creep.
- Every row has a concrete verification method: a test file name, a command with expected output, or a Playwright check with expected behavior.
- The plan reviewer (existing spec-document-reviewer step) checks for gaps before execution starts. Incomplete traceability is a rejection reason.

#### Where this is enforced

The `superpowers:writing-plans` skill gets updated to require this table as a mandatory section. Plans without full traceability coverage are rejected during the review loop.

### 3.2 External Reviewer Agent

After all tasks are implemented and automated tests pass, an independent Opus agent is dispatched to verify the output against the design spec.

#### Why independent

Today's code reviewers share conversation context with the implementer. If the implementer misunderstood a spec requirement, the reviewer likely has the same misunderstanding — they were in the same conversation. The external reviewer breaks this shared-context problem by starting fresh.

#### What it receives

The external reviewer gets a precise, curated package:

1. **The design spec** — the full document describing what should be built
2. **The plan** — including the traceability matrix showing what was supposed to happen
3. **The git diff** — `git diff master...HEAD` showing what code was actually written
4. **Test results** — output of the test suite run
5. **File listing** — what new files were created, what existing files were modified

It does NOT receive:
- The implementer's conversation history
- Decision-making context ("we discussed X and decided Y")
- Any narrative about what was done or why

#### What it does

1. **Spec coverage check** — walks through every row in the traceability matrix, confirms the code and tests actually cover what they claim to cover
2. **Runs the test suite** — executes tests independently to verify they pass (doesn't trust reported results alone)
3. **Browser verification** (when applicable) — uses Playwright to navigate to affected pages, hit API endpoints, verify behavior matches the spec. Mandatory when the sprint touches UI or server routes. Skipped for pure library/utility work.
4. **Gap analysis** — looks for spec requirements that were missed, plan tasks that weren't fully implemented, or implementation that diverged from the spec
5. **Produces a structured report** (see below)

#### Report format

```markdown
# External Verification Report

**Sprint:** M{N}-S{N} {name}
**Reviewer:** External Opus (independent)
**Date:** {date}

## Spec Coverage

| Spec Requirement | Status | Evidence |
|-----------------|--------|----------|
| §3.1 Recursive loading | COVERED | globby **/*.md in prompt.ts, test creates nested dirs and passes |
| §4.3 Classification | COVERED | 7 regex patterns in parser, test covers all categories |
| §5.1 Daily summary | COVERED | Writes to summaries/daily/, test verifies via endpoint |

## Test Results

- Core: {N} passed, {N} failed, {N} skipped
- Dashboard: {N} passed, {N} failed, {N} skipped
- TypeScript: compiles clean / {N} errors

## Browser Verification

- [x] Dashboard loads at / without console errors
- [x] POST /api/work-loop/morning-prep returns 200 with non-empty body
- [ ] N/A — no UI changes in this sprint

(or "Skipped — sprint is pure library/utility work with no UI or server changes")

## Gaps Found

- None

(or specific issues: "Spec §6.2 says properties should support 'low' confidence but the test only checks 'high' and 'medium'")

## Verdict

**PASS** | **PASS WITH CONCERNS** | **FAIL**

{1-2 sentence summary of overall assessment}
```

#### Where this is defined

A new procedure document at `docs/procedures/external-reviewer.md` describes the reviewer's full protocol. All sprint skills reference this procedure.

### 3.3 Browser Verification

When a sprint touches UI or server endpoints, the external reviewer uses Playwright to verify runtime behavior.

#### What it checks

- Pages load without console errors
- API endpoints respond with expected status codes and shapes
- UI elements the spec describes are present and functional
- Server restart doesn't break anything

#### When it runs

The external reviewer decides based on the git diff:
- **Mandatory:** sprint modifies files in `public/`, route handlers, server startup, or anything imported by the dashboard
- **Skip:** sprint only modifies internal library code, tests, docs, or scripts with no server/UI impact

#### Evidence

Browser checks produce pass/fail results in the verification report. Screenshots are taken when failures occur for debugging context.

## 4. Trip Mode Sprint (`/start-trip-sprint`)

### 4.1 Overview

Trip mode is for when the CTO is reachable on mobile but cannot do code reviews or read long documents. It runs autonomously like overnight mode, with one key difference: it stops on major design deviations instead of deciding and continuing.

### 4.2 How it differs from other modes

| Aspect | Normal | Overnight | Trip |
|--------|--------|-----------|------|
| CTO available | Live at desk | Absent | Mobile, text only |
| Minor decisions | Make and mention | Make and log | Make and log |
| Medium decisions | Present options | Make, log pros/cons | Make, log pros/cons |
| Major design deviations | Stop and discuss | Make, log extensively | **Stop and wait** |
| External reviewer | Standard step | Standard step | **Mandatory, replaces CTO review** |
| Browser verification | Standard step | Standard step | **Mandatory when applicable** |
| Review delivery | CTO reads artifacts + code | CTO reads artifacts + code | **Conversational walkthrough** |
| Sprint artifacts | Created | Created | **Created and kept current** |

### 4.3 Decision protocol

```
Decision needed?
  |-- Minor (implementation detail)
  |     -> Decide, log briefly, continue
  |
  |-- Medium (multiple valid approaches)
  |     -> Decide, log pros/cons, flag for review, continue
  |
  |-- Major design deviation (spec says X but reality demands Y)
        -> STOP
        -> Present to CTO:
           - What the spec says (1-2 sentences)
           - Why it doesn't work (1-2 sentences)
           - Options labeled A/B/C
        -> Wait for CTO response
        -> Continue with chosen option
```

**What counts as a major design deviation:**
- A spec requirement can't be implemented as written
- Two spec requirements conflict with each other
- A dependency is missing or behaves differently than the spec assumed
- The implementation would require changing the design spec's architecture
- Something affects other sprints or milestones

**What does NOT count:**
- Choosing between two valid ways to implement a spec requirement
- Adding a helper function not mentioned in the spec
- Adjusting test structure
- Import reorganization or code organization choices

### 4.4 Sprint artifacts

All sprint artifacts are created and maintained during execution, not just at the end:

| Artifact | Created when | Updated when |
|----------|-------------|--------------|
| `plan.md` | Before execution, CTO approves conversationally | Not modified during execution |
| `DECISIONS.md` | First decision is made | Each subsequent decision |
| `DEVIATIONS.md` | First deviation occurs | Each subsequent deviation |
| `review.md` | External reviewer completes verification | Not modified after creation |
| `test-report.md` | External reviewer runs tests and browser checks | Not modified after creation |

These artifacts are the source of truth that `/trip-review` reads from. They must be complete and current because the CTO will never read them directly — the conversational review is built from them.

### 4.5 Skill file location

`.claude/skills/start-trip-sprint/SKILL.md`

### 4.6 Execution flow

1. Identify sprint (ask if not specified)
2. Read the design spec and sprint plan
3. Present briefing conversationally:
   - Goal in 1-2 sentences
   - Task count and estimated complexity
   - Any risks or ambiguities to resolve now
   - Ask CTO to confirm
4. On confirmation, create branch and begin execution
5. Run autonomously — minor/medium decisions handled like overnight
6. Stop on major design deviations, present options, wait
7. After all tasks complete, run external reviewer
8. External reviewer runs tests, browser checks, spec gap analysis
9. External reviewer writes `review.md` and `test-report.md`
10. Notify CTO: "Sprint complete. Run /trip-review when ready."

## 5. Trip Review (`/trip-review`)

### 5.1 Overview

A conversational skill that walks the CTO through sprint results. Reads all artifacts, presents findings in short digestible messages, ends with a merge decision.

### 5.2 Skill file location

`.claude/skills/trip-review/SKILL.md`

### 5.3 Flow

1. Read all sprint artifacts: `review.md`, `DECISIONS.md`, `DEVIATIONS.md`, `test-report.md`, `plan.md`
2. Determine verdict from `review.md`
3. Present findings in order:

**If PASS:**
```
"Sprint M6.9-S1 is done. 16 commits, all 17 tasks complete."

"The external reviewer gave it a PASS. All 287 tests pass,
browser checks passed, no spec gaps found."

"5 decisions were made, all minor — implementation details
like adding the yaml package as a direct dependency."

"1 deviation: the staging file regex needed hyphens added
to match subcategory names like 'user-info'. Small fix,
no spec impact."

"Want to merge to master?"
```

**If PASS WITH CONCERNS:**
```
"Sprint done, but the reviewer flagged 2 concerns."

"Concern 1: The spec says properties should support 'low'
confidence but no test covers that case. Code handles it,
just no test."

"Concern 2: The migration script doesn't handle empty
knowledge files gracefully — minor edge case."

"Everything else checks out. 287 tests pass, all spec
requirements covered. These are non-blocking."

"Want to merge, or should I fix the concerns first?"
```

**If FAIL:**
```
"Sprint finished but the reviewer failed it."

"Main issue: the daily summary job writes to the wrong
directory. Spec says summaries/daily/ but it's writing
to daily/ directly. 2 tests rely on the wrong path."

"The rest looks good — 15 of 17 tasks verified, other
spec requirements covered."

"Options:
A. I fix the issue and re-run verification
B. Wait until you're at a desk
C. Roll back the branch"
```

4. CTO responds: merge / fix / wait / elaborate
5. If "merge": execute `git checkout master && git merge sprint/...`
6. If "fix": continue working, re-run reviewer, re-present
7. If "elaborate": give more detail on whatever they ask about
8. If "wait": leave branch as-is

### 5.4 Conversation style

- Short messages, one topic per message
- No jargon, no file paths unless asked
- Numbers over prose ("5 decisions, all minor" not "several decisions were made during the sprint, most of which were minor in nature")
- Lead with the verdict, then details
- Always end with a clear question or action

## 6. Changes to Existing Skills and Procedures

### 6.1 `superpowers:writing-plans` skill

**Add:** Traceability matrix as a mandatory section. Plans without full spec coverage are rejected during the review loop.

**Add:** Every task must specify its verification method (test file, command, or Playwright check).

### 6.2 `start-sprint` skill (normal mode)

**Add:** External reviewer step after execution completes. In normal mode, this is additive — the CTO still does their own review, but the external reviewer provides an independent second opinion.

### 6.3 `start-overnight-sprint` skill

**Add:** External reviewer step as mandatory. Browser verification when applicable. The reviewer's report goes into `review.md`.

### 6.4 `docs/procedures/overnight-sprint.md`

**Update:** Verification Requirements section to include spec coverage check and browser verification. Add external reviewer to the execution flow.

### 6.5 New files

| File | Purpose |
|------|---------|
| `.claude/skills/start-trip-sprint/SKILL.md` | Trip mode sprint execution |
| `.claude/skills/trip-review/SKILL.md` | Conversational sprint review |
| `docs/procedures/external-reviewer.md` | External reviewer protocol — what it receives, what it checks, what it produces |

## 7. Trust Model

The verification pipeline creates a chain of trust:

```
Design Spec (CTO approved)
    |
    v
Plan with Traceability (CTO approved, reviewer verified)
    |
    v
Implementation (automated by agents)
    |
    v
External Reviewer (independent Opus, no shared context)
    |-- Runs tests
    |-- Checks browser
    |-- Verifies spec coverage
    |-- Produces verdict
    |
    v
Trip Review (conversational walkthrough)
    |
    v
CTO Decision (merge / fix / wait / roll back)
```

The CTO's involvement is at the design level (approving specs and plans) and the decision level (merge or not). Everything in between is automated and independently verified.

**Rollback safety:** Everything runs on branches. If the process doesn't work, `git branch -D` and we're back where we started. The worst case is wasted compute, not broken code.

---

*Design by: CTO (Hanan) + Claude Opus*
*Date: 2026-03-12*
