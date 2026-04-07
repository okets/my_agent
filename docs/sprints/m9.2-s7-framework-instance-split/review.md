# M9.2-S7 External Code Review

**Reviewer:** Claude Opus 4.6 (external)
**Date:** 2026-04-07
**Branch:** `sprint/m9.2-s7-framework-instance-split`
**Commit:** `ea14b0e`

---

## Verdict: PASS with 1 Important + 2 Suggestions

The implementation is well-executed and closely follows the sprint plan. The framework/instance split is clean, the old loading paths are fully removed, tests are restructured and passing, and the delegation checklist is properly merged. The two logged decisions (D1, D2) are both justified improvements over the plan.

---

## Plan Alignment

### Steps completed correctly (17/20)

| Step | Status | Notes |
|------|--------|-------|
| 1. conversation-role.md | Done | Content from both brain/ and .claude/skills/ copies (D1 — justified) |
| 2. task-triage.md | Done | Stale tool refs removed, delegation checklist merged |
| 3. memory-tools.md | Done | Content from brain/notebook.md |
| 4. operational-rules.md | Done | Extracted framework sections from standing-orders |
| 5. Trim standing-orders.md | Done | 7 instance sections remain correctly |
| 6. Fix disable-model-invocation | Done (instance, not in diff) | |
| 7. Delete stale capability-brainstorming | Done (instance, backed up) | |
| 8. Delete .bak file | Done (instance) | |
| 9. Remove stale loading from prompt.ts | Done | SKILL_CONTENT_FILES, ALWAYS_ON_SKILLS, loadSkillContent(), .claude/skills/ loop all removed |
| 10. Remove stale instance files | Done (instance, backed up) | |
| 11. Delete delegation-checklist.md | Done | `git rm` confirmed |
| 12. Verify hatching safety | Done | skills-copy.ts scans packages/core/skills/, NOT repo-root skills/ |
| 13. Update test assertions | Done | All 4 test files updated |
| 14. Run all tests | Done | Core 259/0, Dashboard 1074/0 |
| 15-16. Verify prompt content/size | Not in artifacts | Smoke tests (Steps 18-20) deferred — acceptable for overnight sprint |
| 17. Commit | Done | Clean commit message |
| 18-20. Smoke tests | Deferred | Requires running dashboard — appropriate for S8 verification sprint |

### Justified deviations

**D1 (Merged richer instance content):** The .claude/skills/conversation-role.md had evolved beyond the brain/ copy to include `create_automation` examples, `check_job_status`, `resume_job`, `job_type`, and `target_path` guidance. Merging this richer content was the correct call — using only the brain/ copy would have been a regression.

**D2 (Deferred deletion):** Backing up instance files before deletion and only deleting after tests passed is sound engineering practice.

---

## Issues

### Important (should fix)

**I1: Real user name in committed framework skills (privacy concern)**

Four references to "Hanan" appear in committed public repo files:

- `skills/operational-rules.md` lines 35, 47, 56 — "Hanan received...", "When Hanan says...", "Hanan asked..."
- `skills/memory-tools.md` line 28 — `remember("Hanan is in Chiang Mai...")`

The CLAUDE.md privacy guardrails state: "Use generic examples: `user@example.com`" and "Never hardcode real names." The pre-commit hook only catches the full name `the full name`, not the first name alone, so these slipped through.

**Fix:** Replace with generic references:
- `skills/operational-rules.md`: "Hanan" -> "the user" or "your user"
- `skills/memory-tools.md`: `remember("Hanan is in Chiang Mai...")` -> `remember("User is in Tokyo as of 2026-03-11")`

### Suggestions (nice to have)

**S1: Checklist item #8 "Delivery" references a non-existent field**

`skills/task-triage.md` line 42: `8. **Delivery:** if user wants results sent somewhere, include delivery actions`

The `create_automation` MCP tool schema (in `automation-server.ts`) does NOT have a `delivery` parameter. This field existed in the old `create_task` / automation-extractor system but was not carried over to `create_automation`. Including it in the checklist could cause the brain to attempt passing a `delivery` field, which would fail Zod validation.

The sprint plan explicitly said to remove `delivery` arrays, but this item was inherited unchanged from the old `delegation-checklist.md` during the merge.

**Fix:** Remove item #8 or replace with `target_path` guidance, which IS in the schema and serves a related purpose.

**S2: Fragile path resolution in dashboard test**

`packages/dashboard/tests/mcp/skill-triage-scenarios.test.ts` line 9 uses `process.cwd()` to find the framework skills directory. The core tests use `__dirname` (via `import.meta.dirname` or `__dirname`) which is more robust against cwd changes. Low risk since tests pass and the dashboard test runner always runs from `packages/dashboard/`, but worth noting for consistency.

---

## What was done well

1. **Clean prompt.ts surgery.** The removal of `SKILL_CONTENT_FILES`, `ALWAYS_ON_SKILLS`, `loadSkillContent()`, and the `.claude/skills/` loading loop was precise. The existing framework scan (lines 601-621) now serves as the single loading path. No dangling references.

2. **Test restructuring.** All four test files were updated with correct assertions AND correct test setup (framework skills directory structure). The tests now verify the actual loading mechanism, not the old one.

3. **Frontmatter stripping.** The framework scan correctly strips YAML frontmatter before injection (line 614). Tests explicitly verify this (`expect(prompt).not.toContain('level: brain')`).

4. **Hatching safety verified.** `skills-copy.ts` resolves from `import.meta.dirname` to `../../skills` (i.e., `packages/core/skills/`), not repo-root `skills/`. Framework brain-level skills will not be re-copied to `.my_agent/` during hatching.

5. **No duplication.** With the old loading paths removed, brain-level skill content enters the prompt exactly once via the framework scan. The regression test explicitly checks for single inclusion.

6. **Decision logging.** Both decisions are documented in DECISIONS.md with clear context and rationale.

7. **Backup discipline.** Instance files backed up before deletion, deletion deferred until tests passed.

---

## Checklist Verification Summary

| Check | Result |
|-------|--------|
| No `create_task` in framework skills | PASS |
| No `revise_task`, `search_tasks`, `update_property` in framework skills | PASS |
| `SKILL_CONTENT_FILES` / `ALWAYS_ON_SKILLS` removed from prompt.ts | PASS |
| `loadSkillContent()` function removed | PASS |
| `.claude/skills/` loading loop removed | PASS |
| Framework scan is sole brain-level loading path | PASS |
| All test `create_task` assertions changed to `create_automation` | PASS |
| `delegation-checklist.md` deleted | PASS |
| Automation Design Checklist merged into task-triage.md | PASS |
| standing-orders.md retains instance sections | PASS |
| Hatching scans packages/core/skills/ not repo-root skills/ | PASS |
| Core tests: 259 passed, 0 failed | PASS |
| Dashboard tests: 1074 passed, 0 failed | PASS |
| No private data in committed files | FAIL (I1) |
