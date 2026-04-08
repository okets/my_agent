# M9.3-S1 Prompt Corrections -- Test Report

**Date:** 2026-04-08
**Branch:** `sprint/m9.3-s1-prompt-corrections`
**Runner:** Opus (external reviewer)

---

## Test Results

### Core (`packages/core`)

| Metric | Count |
|--------|-------|
| Test files | 28 (27 passed, 1 skipped) |
| Tests | 273 (266 passed, 7 skipped) |
| Failed | 0 |
| Duration | 3.03s |

Skipped: `tests/triage-behavioral.test.ts` (7 tests) -- behavioral tests requiring live LLM, not applicable for unit-level verification.

### Dashboard (`packages/dashboard`)

| Metric | Count |
|--------|-------|
| Test files | 126 (123 passed, 3 skipped) |
| Tests | 1089 (1081 passed, 8 skipped) |
| Failed | 0 |
| Duration | 25.17s |

Skipped: `tests/live/handler-execution.test.ts` (4), `tests/live/hitl-live.test.ts` (1), `tests/live/user-automation.test.ts` (1) -- live integration tests.

---

## Sprint-Specific Tests

### `prompt-delegation-compliance.test.ts` (new -- 2 tests)

| Test | Result |
|------|--------|
| should not contain advisory delegation language | PASS |
| should contain explicit WebSearch scope and delegation motivation | PASS |

Verified banned phrases ("your call", "consider delegating") are absent from assembled system prompt. Verified 7 required phrases are present: paper trail, debrief integration, ONLY/MUST rules, self-check, identity sentences.

### `prompt-triage-regression.test.ts` (modified -- 14 tests)

| Test | Result |
|------|--------|
| contains triage directive: "For anything beyond a single-question..." | PASS |
| contains triage directive: "You may use WebSearch ONLY for" | PASS |
| contains triage directive: "You MUST delegate via create_automation f..." | PASS |
| contains triage directive: "Include ALL relevant context in the instr..." | PASS |
| contains triage directive: "Internal actions (safe to do freely)" | PASS |
| contains triage directive: "External actions (ask first)" | PASS |
| contains triage directive: "Respond when directly mentioned or when y..." | PASS |
| contains triage directive: "Automation Design Checklist" | PASS |
| contains identity sentence: "You are the conversation layer" | PASS |
| contains identity sentence: "What you do directly" | PASS |
| contains identity sentence: "What you delegate" | PASS |
| does not double-include triage content (no duplication) | PASS (vacuous -- see note) |
| does not include YAML frontmatter from framework skills | PASS |
| does not contain stale tool references | PASS |

**Note:** The duplication test at line 81 passes vacuously because the marker string was not updated to match the new wording. The test no longer validates what it claims to validate. See review.md for details and fix.

---

## Regression Verification

No existing tests were broken by the changes. The three updated directive strings in `TRIAGE_DIRECTIVES` correctly match the new skill file content. All 1347 total tests (266 + 1081) pass.

---

## Recommendations

1. Fix the stale duplication marker before merge (Important -- see review.md).
2. After merge, S2 (WebSearch Budget Hook) provides code enforcement as a second layer. S3 (E2E Verification) will be the true validation of whether prompt corrections alone achieve the target compliance rate.
