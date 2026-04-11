# M9.5-S4: Template & Agent Verification — Architect Review

**Reviewer:** CTO architect session
**Date:** 2026-04-11

---

## Verdict: PASS — 1 correction required before M9.5 closes

S4 achieved its core purpose: the agent built a working desktop-control capability from scratch on the first attempt, then used it in conversation to read text from a KWrite document. The template, test harness, and tool contracts are well-implemented. One correction blocks milestone closure: 31 failing dashboard tests from the S3 extraction must be fixed.

---

## Deliverables

| # | Deliverable | Status | Notes |
|---|---|---|---|
| 1 | Remove dead crash monitoring + enabled-gate | Done | `app.ts` — spawner removed, `c.enabled` check added |
| 2 | Expand test fixture to 7 tools | Done | All 7 required tools with correct schemas |
| 3 | Tool schema validation in harness | Done | `tool-contracts.ts` — 7 required, 5 optional. Wired into `testMcpCapability()` |
| 4 | Functional screenshot test | Done | `testMcpScreenshot()` + inline PNG validation. Fixture returns minimal valid PNG. |
| 5 | desktop-control.md template | Done | 342 lines, comprehensive 3-tier contract |
| 6 | Reset script | Done | `scripts/reset-capability.sh` |
| 6.5 | Brainstorming skill MCP guidance | Done | SKILL.md + references updated |
| 7 | Build-from-scratch loop | Done | Single-shot success. Documented in D1. |
| 8 | Acceptance test — Nina reads KWrite | Done | Nina found minimized KWrite, foregrounded it, read all text correctly |
| 8.5 | User feedback | Partial | Template adequacy confirmed. Structured tool UX questions not asked — see below. |
| 9 | Sprint artifacts | Done | |
| 10 | External review | Done | |

---

## Plan Review Corrections

| Correction | Status |
|---|---|
| C1: Task 7 — real agent build (not backup/restore) | Resolved — agent built from scratch, documented in D1 |
| C2: Task 8 — dashboard conversation (not programmatic) | Resolved — chat conversation, Nina used tools autonomously |
| C3: Task 6.5 — brainstorming skill MCP guidance | Resolved — SKILL.md and references updated |
| C4: Task 8.5 — structured user feedback | Partial — template adequacy captured, but structured questions not asked |
| O1: Region param string → object | Resolved — consistent object form across template, fixture, contract |

---

## Correction Required

### C1: Fix 31 failing dashboard tests before M9.5 closes

**Two categories:**

**Category A — Deleted module imports (4 test files, ~20 tests):**
Tests that import modules deleted in S3:
- `tests/unit/desktop/computer-use-service.test.ts` — tests deleted `computer-use-service.ts`
- `tests/unit/desktop/desktop-capability-detector.test.ts` — tests deleted `desktop-capability-detector.ts`
- `tests/unit/desktop/x11-backend.test.ts` — tests deleted `x11-backend.ts` (if failing)
- `tests/unit/hooks/desktop-hooks.test.ts` — tests deleted `desktop-hooks.ts`
- `tests/unit/mcp/desktop-server.test.ts` — tests deleted `desktop-server.ts`

**Action:** Delete these test files. The modules they test no longer exist in the framework — they were extracted to the capability folder. The capability's own tests (in `packages/core/tests/capabilities/`) cover the framework-side behavior.

**Category B — Stale test expectations (2 test files, ~11 tests):**
- `tests/unit/capabilities/capability-system.test.ts` — tests `has()` and `get()` without setting `enabled: true`. S1 changed `get()` to require both `available` AND `enabled`. These tests create capabilities without `.enabled` files, so `enabled` defaults to `false`, and `get()` returns `undefined`.
- `tests/session-manager-skills.test.ts` — mock for `@my-agent/core` doesn't include `createCapabilityRateLimiter` (added in S1). Session manager now imports it, mock is stale.

**Action:** Update `capability-system.test.ts` to set `enabled: true` on test capabilities. Update `session-manager-skills.test.ts` mock to include the new exports.

**This is tech debt from S3 that was not caught because the S3 external review didn't run the dashboard test suite.** It must be fixed before M9.5 can close — we don't ship milestones with known test failures.

---

## Acceptance Test Evidence

The test harness deliverable card (screenshot) confirms:
- Environment check: PASS (DISPLAY=:10, tools present)
- Schema validation: PASS (7/7 tools, correct schemas)
- Functional screenshot: PASS (434,757 bytes, 1800x1130)
- Status: Ready for Deployment

Nina's KWrite acceptance test (from test-report.md):
1. Took screenshot — KWrite not visible (minimized)
2. Found KWrite in taskbar, clicked to foreground
3. Took second screenshot, read all text correctly
4. Presented content with accurate summary

This proves the full chain: framework discovery → registry → factory → MCP spawn → brain tool use → coordinate scaling → screenshot capture → vision interpretation → response.

---

## Decisions — Reviewed

| Decision | Verdict |
|---|---|
| D1: Single-shot build success + validator path bug | Agree. Template works. `.enabled` auto-creation should be added to builder flow. |
| D2: Memory confusion on capability state | Agree. Low priority — only affects rebuild testing. |
| D3: Factory wiring bug (relative paths) | Agree. Good fix. SDK limitation well-documented. |
| D4: Screenshot inline rendering (CTO PRIORITY) | Agree. This is the natural next step — VAS integration for in-conversation MCP tool images. Track for next sprint. |

---

## Deviations — Reviewed

All three deviations reasonable:
- DEV1: Factory path fix — necessary bugfix, small and correct
- DEV2: "New" button required — dashboard behavior documented
- DEV3: Inline screenshots deferred — CTO priority flagged

---

## Items for Next Sprint

| Item | Priority | Description |
|---|---|---|
| Desktop screenshots render inline in conversation | CTO Priority | D4 — VAS integration for MCP tool images in chat |
| `.enabled` auto-creation on first build | Low | Builder should write `.enabled` so user doesn't have to manually enable |
| Structured tool UX feedback from Nina | Low | C4 incomplete — ask the specific questions about tool usability |

---

## Summary

M9.5's final sprint delivers on the milestone's promise: the framework is self-building. One blocking correction (fix 31 failing tests) before the milestone can close. The acceptance test proves end-to-end capability from framework discovery through agent tool use to vision interpretation. The CTO-flagged inline screenshot rendering is the natural follow-on work.
