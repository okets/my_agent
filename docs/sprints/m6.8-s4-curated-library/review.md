# M6.8-S4: Curated Library — External Review

**Reviewer:** External Reviewer (Claude Opus 4.6)
**Date:** 2026-03-17
**Branch:** sprint/m6.8-s4-curated-library
**Inputs:** Design spec, sprint plan, git diff, test runs, debug API

---

## 1. Spec Coverage

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| 1 | Curated skills adapted from Superpowers (brainstorming, debugging, writing-plans) | COVERED | All 3 skill files present in `packages/core/skills/` with full procedure content |
| 2 | BMAD technique libraries (CSV reference data, loaded silently) | COVERED | `brainstorming-techniques/data/brain-methods.csv` (62 lines), `elicitation-techniques/data/methods.csv` (51 lines) |
| 3 | Personas stripped from all adapted skills | COVERED | `grep -ri "Mary\|John\|Barry\|BMAD"` returns zero matches across all skill files |
| 4 | Procedures kept intact | COVERED | Brainstorming retains question flow, design presentation, YAGNI. Debugging retains all 4 phases, iron law, red flags, rationalizations table. Writing-plans retains zero-context assumption, TDD steps, file structure mapping. |
| 5 | `origin: curated` used on all new skills | COVERED | All 5 new SKILL.md files have `origin: curated` in frontmatter |
| 6 | `allowed-tools` on skills that need code tools | COVERED | `systematic-debugging` and `writing-plans` both declare `allowed-tools: [Read, Grep, Glob, Write, Edit, Bash]` |
| 7 | Brainstorming skill does NOT have Visual Companion | COVERED | No mention of visual companion, browser server, or mockup rendering in brainstorming SKILL.md |
| 8 | No references to `superpowers:` or `docs/superpowers/` paths | COVERED | `grep -r "superpowers:"` and `grep -r "docs/superpowers/"` return zero matches in skills/ |
| 9 | No BMAD persona names (Mary, John, Barry) | COVERED | Zero matches for persona names across all skill files |
| 10 | Hatching copies skills with no-overwrite semantics | COVERED | `skills-copy.ts` checks `existsSync(targetSkillMd)` before copying; test `preserves existing skills (does not overwrite)` validates this |
| 11 | All tests pass | COVERED | Core: 15 passed, 1 skipped (171 tests). Dashboard: 50 passed (476 tests). TypeScript: zero errors. |
| 12 | Skills discoverable via debug API (12 total) | COVERED | `curl localhost:4321/api/debug/brain/skills` returns 12 skills including all 5 new ones |

## 2. Test Results

| Suite | Result | Details |
|-------|--------|---------|
| `npx tsc --noEmit` (core) | PASS | Zero errors |
| `npx vitest run` (core) | PASS | 15 files, 171 tests passed, 7 skipped (triage-behavioral, expected) |
| `npx vitest run` (dashboard) | PASS | 50 files, 476 tests passed, 2 skipped |
| `hatching-skills-copy.test.ts` | PASS | 6 tests: copies SKILL.md, copies CSVs, skips non-skill files, no-overwrite, correct origin, copies all 10 framework skills |

## 3. Content Quality

### brainstorming/SKILL.md
- Core value preserved: question flow, approach exploration, design presentation, HARD-GATE on implementation before approval
- No identity-overriding language
- Frontmatter complete: name, description, origin
- Description is keyword-rich ("collaborative design exploration", "creative work", "architecture changes")
- Good addition: "Technique Libraries" section cross-references brainstorming-techniques and elicitation-techniques (Decision D4)
- No `allowed-tools` — correct, this is a conversational skill

### systematic-debugging/SKILL.md
- Core value preserved: all 4 phases, iron law, root cause tracing, defense-in-depth, condition-based waiting, red flags, rationalizations table
- Supporting techniques (root-cause-tracing, defense-in-depth, condition-based-waiting) successfully inlined rather than external references
- No identity-overriding language
- Frontmatter complete: name, description, origin, allowed-tools
- Description keyword-rich ("4-phase debugging", "root cause investigation", "hypothesis testing")

### writing-plans/SKILL.md
- Core value preserved: zero-context assumption, file structure mapping, bite-sized TDD tasks, complete code examples, DRY/YAGNI
- Superpowers-specific paths stripped (no `docs/superpowers/plans/`)
- No identity-overriding language
- Frontmatter complete: name, description, origin, allowed-tools

### brainstorming-techniques/SKILL.md + data/brain-methods.csv
- Silent application rules clearly stated
- CSV has 61 techniques (header + 61 data rows = 62 lines), 10 categories
- Categories match SKILL.md description
- No persona references in CSV data

### elicitation-techniques/SKILL.md + data/methods.csv
- Silent application rules clearly stated
- CSV has 50 methods (header + 50 data rows = 51 lines), 11 categories
- CSV columns documented correctly in SKILL.md
- No persona references in CSV data

## 4. Gaps Found

### Gap 1: Description count mismatch in brainstorming-techniques (Severity: LOW)

The SKILL.md frontmatter description says "56 brainstorming techniques" but the CSV contains 61 techniques. DEVIATIONS.md (DEV1) acknowledges this: "The SKILL.md description says '56' but the actual CSV has 61; this is a minor mismatch in the description only."

The body text also says "A library of 56 brainstorming techniques."

**Recommendation:** Update "56" to "61" in both the frontmatter description and body text. This is a 2-second fix.

### Gap 2: Design spec says `origin: system`, sprint uses `origin: curated` (Severity: LOW)

The design spec's migration plan (line 391-392) labels curated skills as `origin: system`. The sprint introduces `origin: curated` as a new third tier. This is documented as Decision D1 with clear rationale (CTO asked for non-disableable framework capabilities distinct from infrastructure).

**Assessment:** This is a deliberate, well-reasoned deviation from the spec. The spec should be updated to reflect the three-tier model, but this is not a blocker.

### Gap 3: Existing system skills lack YAML frontmatter (Severity: INFO)

Pre-existing skills (auth, identity, personality, operating-rules, calendar) in `packages/core/skills/` do not have YAML frontmatter — they have bare markdown. The new curated skills all have proper frontmatter. This inconsistency is pre-existing and outside S4 scope, but worth noting for a future normalization pass.

### Gap 4: DEV3 — work done on master, branch created at closure (Severity: INFO)

DEVIATIONS.md notes work was committed to master first, sprint branch created retroactively. This is a process concern, not a code quality issue. The deviation document notes the /start-sprint skill has been fixed to include closure steps.

## 5. Code Quality Notes

**Positive:**
- `skills-copy.ts` is clean and minimal — 41 lines, single responsibility, clear comments
- No-overwrite check is at the right granularity (per-skill SKILL.md existence, not per-directory)
- Test coverage is thorough: 6 tests covering happy path, subdirectories, exclusion, no-overwrite, frontmatter validation, and completeness
- `copyFrameworkSkills` is exported from `lib.ts` for external package use — good API hygiene
- Hatching integration is a single line addition (`await copyFrameworkSkills(agentDir)`) at the right place (after directory creation)
- DECISIONS.md and DEVIATIONS.md are well-structured with context, alternatives, and rationale

**Negative:**
- The `import.meta.dirname` path resolution (`../../skills`) is fragile if file structure changes. Acceptable for now given the monorepo structure is stable.

## 6. Verdict

**PASS WITH CONCERNS**

The sprint delivers all 5 curated skills, the hatching integration, and full test coverage. All tests pass. All 12 skills are discoverable via the debug API. Content quality is high — procedures are preserved, personas are stripped, no leaked references.

**Concerns (non-blocking):**
1. The brainstorming-techniques description says "56" but the CSV has 61 techniques. Trivial fix.
2. The design spec still says `origin: system` for curated skills — spec should be updated to reflect the `origin: curated` decision.

Neither concern blocks the merge. Both are cleanup items.
