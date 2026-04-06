# M9.1-S8 External Review

**Reviewer:** External reviewer (Claude Opus 4.6)
**Date:** 2026-04-06
**Branch:** `sprint/m9.1-s8-real-test` (6 commits, `9cd9f53..50e607d`)
**Method:** Read spec + plan + test report + decisions, reviewed all code diffs, ran E2E tests, ran TypeScript compilation

---

## Verdict: PASS

All 6 agentic flow systems were validated against the live dashboard with real LLM sessions. The 4 bugs found during testing were correctly identified, fixed, and documented. No regressions were introduced. The sprint is complete.

---

## 1. Spec Coverage Analysis

The design spec (`docs/design/agentic-flow-overhaul.md`) defines 6 systems plus 4 infrastructure fixes. The 8 test scenarios map as follows:

| Spec System | Test Coverage | Assessment |
|---|---|---|
| System 1: Universal Todo System | Tests 2, 3 (smoke runs 1-4) | Fully covered: creation, tool usage, atomic writes, last_activity |
| System 2: Todo Templates | Tests 2, 3 (smoke runs 2-4) | Fully covered: 3-layer assembly, validators, completion gating |
| System 3: Heartbeat Service | Tests 5, 6 | Covered: stale detection, notification delivery, persistent queue |
| System 4: Enforcement Hooks | Tests 1, 8 | Covered: Hook 1 (source protection), Hook 2 (capability routing). Stop hook exercised implicitly in smoke runs. |
| System 5: Status Communication | Tests 4, 6 | Covered: `check_job_status` with todos, `[Active Working Agents]`, `[Pending Briefing]` |
| System 6: Restart Recovery | Test 6 | Covered: interrupted marking, notification creation, briefing on next turn, resume |

| Infrastructure Fix | Test Coverage | Assessment |
|---|---|---|
| Fix 1: Scanner loudness | Not directly tested | Acceptable -- scanner changes were in prior sprints (S1-S7) |
| Fix 2: findById from disk | Not directly tested | Acceptable -- prior sprint implementation, not changed here |
| Fix 3: Builder prompt simplification | Smoke test (implicit) | Worker engagement improved across runs, validating the prompt works |
| Fix 4: target_path from manifest | Smoke test (implicit) | Automation manifest had `target_path`, worker operated on correct directory |

**No spec requirements are missed by the 8 test scenarios.** The 4 infrastructure fixes are either tested implicitly or were implemented in prior sprints. The test matrix in the test report accurately maps systems to evidence.

---

## 2. Code Review

### 2a. Bug 2 fix: Deliverable preservation (`automation-executor.ts`)

**Change:** Lines 335-351 -- executor now checks if `deliverable.md` exists with YAML frontmatter before deciding whether to overwrite.

**Assessment:** Correct and well-reasoned.

- The guard condition `fs.existsSync(path) && fs.readFileSync(path, "utf-8").startsWith("---")` is a safe heuristic. YAML frontmatter always starts with `---`.
- The file is read twice when the worker wrote a deliverable (once for the check, once for assignment). This is a minor inefficiency but not a problem -- this code runs once per job completion, the file is small, and it is hot in the OS page cache.
- The outer condition changed from `if (finalDeliverable && job.run_dir)` to `if (job.run_dir)`. This is correct: we need to enter the block even when `finalDeliverable` is null/undefined, because the worker may have written the file directly. Without this change, a worker-written deliverable would be ignored when the stream text extraction produced nothing.
- The `else if (finalDeliverable)` guard prevents writing an empty/null deliverable to disk, preserving the original behavior for the no-worker-deliverable path.

**Suggestion (nice to have):** The double read could be collapsed into a single read:

```typescript
const existing = fs.existsSync(deliverablePath)
  ? fs.readFileSync(deliverablePath, "utf-8")
  : undefined;
if (existing?.startsWith("---")) {
  finalDeliverable = existing;
} else if (finalDeliverable) {
  fs.writeFileSync(deliverablePath, finalDeliverable, "utf-8");
}
```

This is not blocking -- the current code is correct and clear.

### 2b. Bug 1 fix: Todo system instructions (`working-nina-prompt.ts`)

**Change:** Added 14-line "Todo System (MANDATORY)" section to the working nina persona prompt. Renamed the existing "Principles:" to "## Principles" for consistent heading level.

**Assessment:** Correct.

- The instructions are specific and actionable: start with `todo_list`, mark `in_progress` before starting, mark `done` after completing, retry on validation failure.
- The warning ("your job will be flagged as needs_review") creates the right incentive without being a bluff -- the completion gate actually does this.
- The retry instruction (item 5) was strengthened in a subsequent commit (`f0793c0`) after run 3 showed the initial wording was insufficient. This iterative approach is appropriate for prompt engineering.
- No competing instructions exist elsewhere in the prompt that could confuse the worker.

### 2c. Bug 3 fix: Template text clarity (`todo-templates.ts`)

**Change:** Updated 5 template item texts across both `capability_build` and `capability_modify` templates:
- "Run test harness -- record pass/fail and latency" became "Run test harness -- record result in deliverable.md frontmatter as test_result"
- "Fill completion report" became "Write deliverable.md with YAML frontmatter (change_type, test_result, summary)"
- "Identify change type (configure/upgrade/fix/replace)" became "Identify change type (configure/upgrade/fix/replace) -- write to deliverable.md frontmatter as change_type"

**Assessment:** Correct and well-targeted.

- The updated text tells the worker exactly what file and field the validator will check, eliminating the guessing game that caused run 2 failures.
- Both templates were updated symmetrically (capability_build and capability_modify share 3 of the 5 items).
- The `assembleJobTodos` function and `getTemplate` helper remain unchanged and correct. The 3-layer assembly (delegator, template, agent) works as designed.

### 2d. Smoke test scripts

**`scripts/smoke-test-reset.sh`:** Creates a clean baseline (test capability with known state), cleans previous test artifacts, restarts dashboard. Uses `find -delete` safely scoped to test prefixes. Health check loop is reasonable (10 attempts x 2s = 20s max).

**`scripts/smoke-test-run.sh`:** Writes automation manifest to disk, restarts to sync, fires via API, polls for completion (5min timeout, 10s interval), verifies artifacts. Uses Python for JSON parsing (acceptable for a test script).

**Assessment:** Both scripts are well-structured, use `set -euo pipefail`, have clear output, and handle errors appropriately. The adaptation from the plan's nonexistent `POST /api/automations` to disk-write-and-sync is correctly documented in D2.

One minor note: the `find` command in reset.sh could match non-test files if other automations have names starting with "smoke-test-". This is not a real risk since these are explicitly test-only prefixes.

---

## 3. Test Verification Results

### E2E Tests (S7)

```
Test Files  1 passed (1)
Tests       6 passed (6)
Duration    3.02s
```

All 6 existing E2E agentic flow tests pass. No regressions.

### TypeScript Compilation

- `packages/core`: Clean (no errors)
- `packages/dashboard`: Clean (no errors)

---

## 4. Bug Fix Verification

| Bug | Claimed Fix | Verified in Code | Correctly Addresses Root Cause |
|---|---|---|---|
| Bug 1: Missing todo instructions | Added prompt section | Yes (`working-nina-prompt.ts` +14 lines) | Yes -- tools were wired but worker had no instructions to use them |
| Bug 2: Executor overwrites deliverable | Check for existing frontmatter | Yes (`automation-executor.ts` +10/-3 lines) | Yes -- unconditional write replaced with conditional preservation |
| Bug 3: Vague template text | Explicit file/field in text | Yes (`todo-templates.ts` 5 items updated) | Yes -- worker now knows what the validator checks |
| Bug 4: Retry instruction weak | Stronger prompt wording | Yes (`working-nina-prompt.ts` item 5 text) | Yes -- explicit "call todo_update AGAIN" instruction |

All 4 bugs are actually fixed in the code. The fixes are minimal, targeted, and do not introduce new behavior beyond what is necessary.

---

## 5. Sprint Artifacts Completeness

| Artifact | Present | Assessment |
|---|---|---|
| `plan.md` | Yes | 11 tasks covering smoke test creation, 8 test scenarios, and artifact generation |
| `DECISIONS.md` | Yes | 7 decisions (D1-D7, D3 is out of sequence). All dated with context, root cause, and trade-offs |
| `test-report.md` | Yes | 8/8 tests PASS, smoke test execution log (4 runs), bug list, findings, system verification matrix |
| Smoke test scripts | Yes | `scripts/smoke-test-reset.sh` and `scripts/smoke-test-run.sh`, both executable |

**Note on DECISIONS.md numbering:** D3 appears last (after D7) because it was written at creation time but is the last section in the file. The numbering gap (no D3 between D2 and D4 in chronological order) is mildly confusing but does not affect content. D3 is a minor finding (health check endpoint), not a code change.

---

## 6. Gaps and Concerns

### Non-blocking findings

**F1: Conversation Nina omits delegator todos (D7).** Documented as a non-blocking finding. The spec's Layer 1 (delegator items) is empty in practice because Conversation Nina does not populate the `todos` field in `create_automation`. The framework template (Layer 2) provides all mandatory items, so the system works. This is a prompt quality issue for future optimization, correctly categorized.

**F2: Double file read in deliverable preservation.** The executor reads `deliverable.md` twice (once for the frontmatter check, once to assign to `finalDeliverable`). A single read would be cleaner. Not blocking -- the file is small and the code is clear.

**F3: The smoke test scripts use `python3` for JSON parsing.** This creates an implicit dependency on Python being installed. Acceptable for test scripts on this platform (Ubuntu 25.10 has Python pre-installed), but worth noting.

### No critical or important issues found

The code changes are minimal, correct, and well-documented. The test methodology (real LLM sessions, iterative bug fixing, 4 smoke test runs) is thorough. The iterative approach -- running, finding bugs, fixing, re-running -- is exactly what a validation sprint should do.

---

## 7. Summary

The sprint successfully validated all 6 agentic flow systems defined in the M9.1 design spec. Four bugs were discovered and fixed during testing, each with clear root cause analysis and targeted fixes. The existing E2E test suite passes with no regressions. TypeScript compiles cleanly in both packages. Sprint artifacts are complete and well-documented.

**Verdict: PASS**
