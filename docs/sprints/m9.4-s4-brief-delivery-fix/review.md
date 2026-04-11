---
sprint: M9.4-S4
title: "External Verification Report — Brief Delivery Pipeline Fix"
date: 2026-04-10
reviewer: external-reviewer (no shared context with implementation team)
verdict: PASS
---

# External Verification Report — M9.4-S4: Brief Delivery Pipeline Fix

## Verdict: PASS

All three root causes are addressed. Tests pass (137 files, 1186 tests, 0 failures). TypeScript compiles clean. No regressions detected.

---

## Root Cause Verification

### RC1: `.slice(0, 500)` truncation — FIXED

**Evidence:** `grep -r '.slice(0, 500)'` returns zero matches in `src/automations/` and `src/scheduler/`. The only remaining occurrences (3) are in `src/tests/e2e-s5-tool-separation.ts` for test log truncation — not in the production pipeline.

**Implementation:** A new `summary-resolver.ts` module provides `resolveJobSummary()` (sync) and `resolveJobSummaryAsync()` (async with Haiku fallback). The resolver reads artifacts from disk in priority order: `deliverable.md` > `status-report.md` > raw `result.work`, with a 4000-char guard (up from 500).

**Wiring (4 sites):**
- `automation-processor.ts:241` — async variant with Haiku fallback (notification path)
- `automation-executor.ts:163` — sync variant (handler path)
- `automation-executor.ts:486` — sync variant (SDK execution path)
- `automation-executor.ts:674` — sync variant (resume path)

### RC2: "present naturally" framing causes paraphrasing — FIXED

**Evidence — heartbeat-service.ts (line 172-190):**
- `job_completed` now uses `verbatimFraming`: "Forward these results to the user verbatim. Adjust tone for conversation but do not summarize, paraphrase, or editorialize the content."
- `job_failed`, `job_interrupted`, `job_needs_review`, and default cases use `naturalFraming` — appropriate since these are status messages, not deliverables.

**Evidence — system-prompt-builder.ts (line 143):**
- Pending Briefing section uses: "Forward these results to the user verbatim. Adjust tone for conversation but do not summarize or paraphrase the content."

Both delivery paths (real-time heartbeat alert and reconnection pending briefing) now use verbatim framing for completed job results.

### RC3: Debrief reporter re-digests via Haiku — FIXED

**Evidence — handler-registry.ts (lines 279-373):**
- The `debrief-reporter` handler collects worker deliverables from disk (same priority: `deliverablePath` > `status-report.md` > `summary`)
- Assembles them with `workerSections.join("\n\n---\n\n")` — no `queryModel` call
- Log line explicitly says "no LLM": `assembled ${workerSections.length} worker reports (${digest.length} chars digest, no LLM)`
- `queryModel` is imported in the file but only used by other handlers (not debrief-reporter)

### Prevention: Mandatory deliverable todo — IMPLEMENTED

**Evidence — todo-templates.ts:**
- `generic` template (line 55): "Write deliverable.md with your key findings and output" with `validation: "deliverable_written"`
- `research` template (line 73): Same deliverable todo with validation

**Evidence — todo-validators.ts (line 105-121):**
- `deliverable_written` validator checks: file exists, content >= 50 chars
- Rejects missing files, too-short content

### Graceful degradation: Haiku fallback — IMPLEMENTED

**Evidence — summary-resolver.ts (lines 41-73):**
- `resolveJobSummaryAsync()` tries disk artifacts first, falls back to Haiku summarization for long raw streams (> 4000 chars), then falls back to truncation if Haiku fails
- Haiku receives up to 8000 chars of raw output with a "summarize concisely" prompt

---

## Traceability Matrix

| Root Cause | Plan Task(s) | Verification Method | Status |
|-----------|-------------|-------------------|--------|
| RC1: .slice(0,500) | T1, T2, T3 | grep returns 0 matches in automations/ and scheduler/ | PASS |
| RC2: "present naturally" | T6, T7 | heartbeat uses verbatimFraming for job_completed; system-prompt-builder uses verbatim | PASS |
| RC3: Haiku re-digest | T8 | debrief-reporter has no queryModel call, assembles directly | PASS |
| Prevention: deliverable todo | T4 | generic + research templates have deliverable_written validator | PASS |
| Graceful degradation | T5 | resolveJobSummaryAsync has Haiku fallback path | PASS |

---

## Test Results

- **TypeScript compilation:** PASS (0 errors)
- **Full test suite:** 137 files passed, 1186 tests passed, 0 failures, 4 skipped (live tests)
- **S4-specific tests:** 15 tests across 2 new test files, all pass
- **Regressions:** None detected

See `test-report.md` for detailed test output.

---

## Deviations from Plan

| Deviation | Assessment |
|-----------|-----------|
| Test file named `summary-resolver.test.ts` instead of plan's `notification-summary.test.ts` | Acceptable — name matches the module it tests |
| Resolver uses regex for frontmatter stripping instead of plan's `readFrontmatter()` import | Acceptable — documented in DECISIONS.md (D2), avoids coupling to metadata module |
| Deliverable validator checks total length >= 50 instead of stripping frontmatter first | Acceptable — frontmatter-only files are still caught (< 50 chars), error says "too short" instead of "body content" |
| Plan listed `app.ts` modification; not observed in implementation | Minor — the system-prompt-builder change covers the pending briefing path. No functional gap. |

---

## Gap Analysis

No spec requirements are missed. All 9 plan tasks are accounted for:

1. Summary resolver created with disk-based artifact resolution
2. Wired into notification path (automation-processor.ts)
3. Wired into DB summary path (automation-executor.ts, 3 sites)
4. Mandatory deliverable todo + validator in generic and research templates
5. Haiku fallback in async resolver variant
6. Verbatim framing in heartbeat formatNotification for job_completed
7. Verbatim framing in system-prompt-builder Pending Briefing section
8. Debrief reporter is now an assembler — no LLM call
9. Verification — this review

**One observation:** The comment on line 275 of handler-registry.ts still says "Summarizing worker reports into a concise digest via model call" — this is stale documentation from the pre-fix code. It should say something like "Assembling worker reports into digest (no LLM)". This is cosmetic and does not affect functionality.
