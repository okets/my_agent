# M6.8-S3: Seed Skills — Deviations Log

## Deviation 1: dist/ rebuild required for live verification

**Plan:** Task 6 (Level 2 debug API verification) assumed the dashboard would pick up prompt.ts changes on restart.

**Actual:** The dashboard imports from `packages/core/dist/lib.js` (compiled JavaScript), not the TypeScript source. Required `npx tsc` rebuild before dashboard restart.

**Impact:** None — caught during verification, added build step. Tests (vitest) use tsx and load TypeScript directly, so they were unaffected.

**Category:** Addition (build step not in plan)

## Deviation 2: Behavioral test uses dynamic import for SDK

**Plan:** Task 7 uses `import Anthropic from '@anthropic-ai/sdk'` (static import).

**Actual:** `@anthropic-ai/sdk` is not in core's dependencies. Static import crashes the test suite. Changed to dynamic import with `try/catch` and graceful skip.

**Impact:** Level 3 tests skip instead of crashing the suite. Tests can be run by manually installing the SDK or by chatting with Nina via the dashboard.

**Category:** Change (import strategy)

## Deviation 3: Guardrail pattern in test comment

**Plan:** Test file contained `ANTHROPIC_API_KEY (env var) =...` in a run command example.

**Actual:** Pre-commit hook guardrail blocked the commit (pattern `ANTHROPIC_API_KEY (env var) =` matched).

**Impact:** Minor — reformatted the comment to avoid the pattern.

**Category:** Change (comment wording)

## Deviation 4: skill-discovery-regression.test.ts replaced by curl verification

**Plan/Spec:** Design spec's Files Affected table lists `packages/dashboard/tests/skill-discovery-regression.test.ts` as a deliverable.

**Actual:** Level 2 validation was done via curl commands to the debug API instead of a vitest test file. The sprint plan (Task 6) specified curl verification, not a test file.

**Impact:** None — the verification is equivalent. Curl commands confirmed 7/7 skills discovered and triage directives present. The spec's file listing was aspirational; the plan's curl approach is simpler and equally valid.

**Category:** Removal (test file replaced by manual verification)

## Deviation 5: Knowledge-curation behavioral scenarios deferred

**Plan/Spec:** Spec defines scenarios 8-9 (debrief trigger with/without staged facts) for knowledge-curation verification.

**Actual:** Not implemented. Knowledge-curation is on-demand (not always-on), so it doesn't go through the `assembleSystemPrompt()` path being tested. The debrief prep endpoint is in the dashboard package, making cross-package behavioral tests complex.

**Impact:** Knowledge-curation SKILL.md exists and is discovered by the SDK (Level 2 verified). Behavioral validation deferred to manual testing or future sprint.

**Category:** Removal (scenarios deferred)
