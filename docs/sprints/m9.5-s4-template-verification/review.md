# External Verification Report

**Sprint:** M9.5-S4 Template & Agent Verification
**Reviewer:** External Opus (independent)
**Date:** 2026-04-11

## Spec Coverage

### S1 Deferred Items

| Spec Requirement | Status | Evidence |
|-----------------|--------|----------|
| Tool schema validation against template contract | COVERED | `packages/core/src/capabilities/tool-contracts.ts` — `validateToolContract()` checks required tools + params. Wired into `testMcpCapability()` in test-harness.ts lines 110-115. 5 unit tests in `schema-validation.test.ts`. |
| Functional screenshot test (PNG validation) | COVERED | `testMcpScreenshot()` exported from test-harness.ts. Also wired inline into `testMcpCapability()` for desktop-control type (lines 118-141). 1 test in `functional-screenshot.test.ts`. Fixture returns minimal valid PNG. |

### S3 Deferred Items

| Spec Requirement | Status | Evidence |
|-----------------|--------|----------|
| Fix dead crash monitoring code | COVERED | `app.ts` diff removes `McpCapabilitySpawner` instantiation, crash listener, and unused import. |
| Add enabled-gate to factory registration | COVERED | `app.ts` diff adds `c.enabled` to the `.find()` predicate. |
| Expand test fixture to all 7 required tools | COVERED | `desktop-x11-fixture/src/server.ts` now has all 7 tools with correct schemas. |

### S4 Own Scope

| Spec Requirement | Status | Evidence |
|-----------------|--------|----------|
| Write `desktop-control.md` template | COVERED | `skills/capability-templates/desktop-control.md` — 341 lines, comprehensive. |
| Update brainstorming skill with MCP guidance (CTO C3) | COVERED | `SKILL.md` diff adds MCP vs Script guidance, builder instructions. `capability-template.md` adds MCP interface template. `well-known-types.md` adds desktop-control row. |
| Build cleanup/reset script | COVERED | `scripts/reset-capability.sh` — 26 lines, deletes capability folder. |
| Build-from-scratch loop (CTO C1 correction applied) | COVERED | DECISIONS.md D1 documents the real agent-driven loop: delete capability, ask Nina via dashboard chat, brainstorming skill found template, builder completed, harness passed. 1 iteration needed. |
| Acceptance test — agent-driven via dashboard (CTO C2 correction applied) | COVERED | DECISIONS.md D3 + test-report.md Test 2: asked Nina via chat "What text is in the Kwrite window?", Nina used desktop tools autonomously, read text correctly. |
| Factory-to-session wiring bug fix (discovered during acceptance) | COVERED | `app.ts` diff resolves entrypoint args to absolute paths. Documented as DEV1 in DEVIATIONS.md and D3 in DECISIONS.md. |
| User feedback (CTO C4) | PARTIAL | D1 captures Nina's template adequacy assessment ("No real design decisions to make — the template is prescriptive"). Missing the structured feedback questions the CTO requested (which tools were confusing? what was missing? was coordinate scaling intuitive? would optional tools help?). |

## Test Results

- Core capabilities: **54 passed**, 0 failed, 0 skipped (12 test files)
- TypeScript (packages/core): compiles clean (`tsc --noEmit`)
- TypeScript (packages/dashboard): compiles clean (`tsc --noEmit`)

All tests verified independently by this reviewer.

## Browser Verification

N/A — sprint modifies backend capability code, not frontend HTML/JS. Browser verification was performed by the implementation team during Task 7 (build-from-scratch) and Task 8 (acceptance test) and is documented in test-report.md.

## Gaps Found

### G1: User feedback not fully structured (minor)

CTO correction C4 asked for specific reflection questions: which tools were confusing, what was missing, was coordinate scaling intuitive, would optional tools have helped. DECISIONS.md D1 only captures one quote from Nina about template adequacy. The structured feedback loop was not performed as specified.

**Impact:** Low. The template was validated by a successful single-shot build. The missing feedback is about future template improvements, not current correctness.

### G2: CTO observation O1 (region param type mismatch) not addressed

The plan review noted that `desktop_screenshot`'s `region` parameter is defined as `object { x, y, width, height }` in the template and fixture, but the CTO flagged that the real S3 capability server might use a different shape. The team appears to have chosen the object form consistently across template, fixture, and contracts — which is the correct choice. However, no explicit decision was logged acknowledging this observation.

**Impact:** None if the real capability already uses the object form. Could surface as a mismatch if the real server uses string form.

### G3: Reset script does not warn about running processes

CTO observation O3 noted that `reset-capability.sh` does not kill orphaned MCP server processes. The script includes a note to restart the dashboard but does not actively check for or kill running server processes.

**Impact:** Low. The note in the script output ("restart the dashboard if it was running") is sufficient for developer use. Not a correctness issue.

## Template-Contract Alignment Check

The `desktop-control.md` template and `tool-contracts.ts` are well-aligned:

| Tool | Template Required Params | Contract Required Params | Match |
|------|------------------------|-------------------------|-------|
| desktop_screenshot | region (optional object) | (none required) | YES |
| desktop_click | x, y (required); button, double (optional) | x, y | YES |
| desktop_type | text (required) | text | YES |
| desktop_key | key (required) | key | YES |
| desktop_scroll | x, y, direction (required); amount (optional) | x, y, direction | YES |
| desktop_info | query (required) | query | YES |
| desktop_wait | seconds (required) | seconds | YES |

Optional tools (5) also match between template and contract. The fixture implements all 7 required tools with matching schemas.

## Code Quality Notes

1. **tool-contracts.ts** is clean, well-typed, and correctly handles the three-tier validation (required tools present, required params present, required params marked required in schema).
2. **test-harness.ts** additions are well-integrated — schema validation and functional screenshot test are wired into the existing `testMcpCapability` flow, and also available as standalone exports.
3. **app.ts** fix for absolute path resolution is correct — it handles relative paths containing `/` (like `src/server.ts`) and dot-relative paths. The `cwd` is still passed as a fallback.
4. **Brainstorming skill** updates are concise and actionable — the MCP vs Script distinction and builder instructions give the agent enough context to choose the right interface.

## Verdict

**PASS WITH CONCERNS**

All core deliverables are implemented and working: tool contracts, schema validation, functional screenshot test, desktop-control template, reset script, brainstorming skill MCP guidance, S3 deferred fixes, and the factory wiring bug fix. The build-from-scratch loop and acceptance test were performed correctly per CTO corrections C1 and C2. The only gap is the incomplete user feedback (C4) — Nina's structured reflection was not fully captured. This is minor and can be addressed in the next sprint.
