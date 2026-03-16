# M6.8-S3: Seed Skills — External Review

**Reviewer:** External Reviewer (Claude Opus 4.6)
**Date:** 2026-03-16
**Branch:** `sprint/m6.8-s3-seed-skills`
**Inputs:** Design spec, sprint plan, git diff (7 files, +457 lines), gitignored files, independent test runs

---

## 1. Spec Coverage

| # | Spec Requirement | Status | Evidence |
|---|-----------------|--------|----------|
| 1 | task-triage SKILL.md with exact content from conversation-role.md | **COVERED** | File exists at `.my_agent/.claude/skills/task-triage/SKILL.md`. Content matches spec verbatim: frontmatter (name, description, origin), all sections (Task Delegation, Autonomy, Group Chat Behavior). |
| 2 | knowledge-curation SKILL.md with behavioral guidance | **COVERED** | File exists at `.my_agent/.claude/skills/knowledge-curation/SKILL.md`. Content matches spec verbatim: all 5 sections, MCP tools table, attempt counter logic. |
| 3 | `ALWAYS_ON_SKILLS` loading in `assembleSystemPrompt()` | **COVERED** | `prompt.ts:40` defines `ALWAYS_ON_SKILLS = ['task-triage']`. Lines 502-513 load from `.claude/skills/`, strip frontmatter via regex, push to sections. Code matches spec's implementation exactly. |
| 4 | conversation-role.md shrunk to identity only | **COVERED** | File contains only identity section (22 lines). Task Delegation through Group Chat Behavior removed. Backup at `.bak`. |
| 5 | Level 1: all triage directives in prompt | **COVERED** | `prompt-triage-regression.test.ts` tests 9 directives + 3 identity sentences + no-double-include + no-frontmatter. 14 assertions, all pass. |
| 6 | Level 1: no double inclusion | **COVERED** | Test uses `indexOf` + second `indexOf` to verify marker appears exactly once. Passes. |
| 7 | Level 1: no frontmatter leakage | **COVERED** | Tests assert `name: task-triage` and `origin: system` not in prompt. Passes. |
| 8 | Level 2: both skills in debug API `/brain/skills` | **COVERED** | Verified independently via curl. Both `task-triage` and `knowledge-curation` appear in `user[]` array. |
| 9 | Level 3: 7 triage scenarios produce same routing | **PARTIAL** | 6 of 7 triage scenarios implemented. Scenario 6 ("Do you remember where I'm traveling next?" -> Direct recall) is missing. All 6 skip at runtime (SDK not in deps). |
| 10 | Level 3: 2 knowledge-curation scenarios | **MISSING** | Scenarios 8-9 (debrief trigger with/without staged facts) not implemented. |
| 11 | All existing tests pass (623+) | **COVERED** | 641 passed (exceeds 623 baseline), 8 skipped, 0 failed. |
| 12 | Morning-sequence NOT extracted | **COVERED** | Directory does not exist. Verified via `ls`. |
| 13 | Daily-summary NOT extracted | **COVERED** | Directory does not exist. Verified via `ls`. |
| 14 | `skill-discovery-regression.test.ts` (Level 2 tests) | **MISSING** | Spec lists `packages/dashboard/tests/skill-discovery-regression.test.ts` in Files Affected. Not created. Level 2 was done via curl only. Not logged as a deviation. |

---

## 2. Test Results

Full results in `test-report.md`. Summary:

| Suite | Result |
|-------|--------|
| `npx tsc --noEmit` (core) | PASS, zero errors |
| `npx vitest run` (core) | 165 passed, 6 skipped, 0 failed |
| `npx vitest run` (dashboard) | 476 passed, 2 skipped, 0 failed |
| Debug API: skills | 7/7 skills discovered |
| Debug API: prompt | All directives present, no double inclusion, identity preserved |

---

## 3. Browser Verification (Debug API)

### `/api/debug/brain/skills`

Both `task-triage` and `knowledge-curation` appear in the `user[]` skills array. Total of 7 user skills discovered (identity, personality, operating-rules, auth, scheduling + 2 new).

**Observation:** All user skill descriptions show `"---"` instead of their actual frontmatter descriptions. This is a pre-existing SDK skill parsing issue (not introduced by this sprint) — the SDK appears to read the first content line rather than parsing YAML frontmatter. Not a blocker, but worth noting for the skills dashboard milestone (S6).

### `/api/debug/brain/prompt`

- 8 triage directives: all present
- Double inclusion: count=1 (PASS)
- Identity: present (PASS)

---

## 4. Gaps Found

### Gap 1: Level 3 Scenario 6 missing (Minor)

The spec defines 7 triage scenarios. The implementation has 6. Missing:

> Scenario 6: "Do you remember where I'm traveling next?" -> Direct recall

This is a "direct" routing test (memory recall). The existing 6 scenarios cover 3 delegate and 3 direct cases, so the coverage category is represented, but the exact scenario from the spec is absent.

### Gap 2: Knowledge-curation behavioral scenarios missing (Minor)

Spec defines scenarios 8-9 testing debrief trigger with/without staged facts. These are not implemented in any test file. The spec notes these are tested via "debrief prep endpoint" which is in the dashboard package — the team may have considered these out of scope for core tests, but the omission is not documented.

### Gap 3: `skill-discovery-regression.test.ts` not created (Minor)

The spec's Files Affected table lists `packages/dashboard/tests/skill-discovery-regression.test.ts` as a new file. This was replaced by manual curl verification (Task 6 in the plan). This deviation is not logged in DEVIATIONS.md.

### Gap 4: User skill descriptions show "---" (Pre-existing, informational)

All user skills return `"---"` as their description in the debug API. This means SDK skill discovery cannot use descriptions for filtering or display. Not caused by this sprint, but the sprint creates 2 new skills that are affected.

---

## 5. Code Quality Notes

### Positive

- **Two-phase extraction** (add loading, then shrink) is a sound safety pattern. Well-documented in DECISIONS.md.
- **Frontmatter stripping regex** (`/^---\r?\n[\s\S]*?\r?\n---\r?\n*/`) handles both Unix and Windows line endings.
- **Behavioral tests gracefully skip** when dependencies are unavailable — no suite crashes.
- **Test structure** is clean: temp directories, proper cleanup via `afterEach`, no shared mutable state.
- **DECISIONS.md and DEVIATIONS.md** are thorough and well-structured.

### Minor observations

- `prompt-triage-regression.test.ts` uses individual `it()` blocks generated via `for...of` loop (lines 120-125). This is a valid vitest pattern and produces good test names.
- The `ALWAYS_ON_SKILLS` constant is simple to extend. Adding a new always-on skill only requires adding its name to the array.

---

## 6. Verdict

### **PASS WITH CONCERNS**

**Rationale:**

The core deliverable is solid: task-triage and knowledge-curation SKILL.md files are created with correct content, the always-on loading mechanism works correctly, conversation-role.md is properly shrunk, and the three-level validation framework is in place. All automated tests pass. The debug API confirms live system behavior.

**Concerns (all minor, none blocking):**

1. **3 spec items partially/not implemented:** 1 missing triage scenario, 2 missing knowledge-curation scenarios, 1 missing test file. All are Level 3 / Level 2 tests that supplement the deterministic Level 1 tests already passing. The core extraction and loading logic is fully tested.

2. **Gap 3 not documented as a deviation.** The plan replaced the spec's Level 2 test file with curl commands, which is a reasonable choice, but should be logged in DEVIATIONS.md for traceability.

3. **Level 3 tests cannot run automatically** in the current setup (SDK not in core's deps). This is documented and justified, but means behavioral regression is only verified manually.

**Recommendation:** Log Gap 3 as a deviation. Consider adding the missing scenario 6 to complete spec coverage. The knowledge-curation scenarios (8-9) can be deferred to a future sprint since the skill is on-demand (not always-on) and not tested by the always-on loading path.
