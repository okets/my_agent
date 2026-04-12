# Sprint Review — M9.5-S6 Screenshot Pipeline

**Date:** 2026-04-12
**Branch:** `sprint/m9.5-s6-screenshot-pipeline`
**Review mode:** CTO hands-on (pair-browse smoke testing) — external reviewer was skipped because the CTO was active throughout the smoke test phase and explicitly stated "I was active in this sprint I trust the work."

## Verdict

**PASS.**

## Spec Coverage

All requirements from `spec.md` have implementation + test coverage. Mapping:

| Spec requirement | Implementation | Verified by |
|---|---|---|
| `storeAndInject()` with DI store callback | `packages/core/src/capabilities/mcp-middleware.ts` | Unit test + integration test + both smoke tests |
| Dual-format `findImageData` (MCP + Anthropic API) | `mcp-middleware.ts` | Unit test + smoke tests (desktop uses Anthropic API format; integration test uses MCP format) |
| `inferSource()` prefix mapping | `mcp-middleware.ts` | Unit tests for all 3 source types + mcp-prefix stripping |
| `parseImageMetadata()` with fallbacks | `mcp-middleware.ts` | Unit tests — valid JSON, invalid, missing text block |
| PostToolUse hook wired in session-manager | `packages/dashboard/src/agent/session-manager.ts` | KWrite smoke test |
| PostToolUse hook + Playwright MCP in automation-executor | `packages/dashboard/src/automations/automation-executor.ts` | CNN smoke test |
| Framework curation directive | `packages/core/src/prompt.ts` (`formatScreenshotCurationDirective`) | Both smoke tests — brain curates single screenshot into reply |
| Ref scanner indexing URLs in conversation turns | Pre-existing `app.ts:553-566` (no changes needed) | Integration test + CNN smoke test (conv ref confirmed on stored screenshot) |
| Ref scanner indexing URLs in job summaries | Pre-existing `app.ts:1199-1214` (no changes needed) | CNN smoke test (job ref confirmed on stored screenshot) |
| Tool-name-prefix-generic design (no hardcoded plug names in framework) | `parseMcpToolName()` | Unit test + session-manager + automation-executor derive server name from prefix |
| Bug fix: `tool_result` → `tool_response` | Fixed during Task 3 + re-confirmed during Task 0 revision | Both smoke tests |
| Integration test: full PostToolUse chain | `packages/dashboard/tests/integration/screenshot-pipeline.test.ts` | Passes |
| Integration test: ref scanner | Same file | Passes |
| Integration test: automation path | Same file | Passes |
| KWrite smoke test | Manual via pair-browse | Passed after 4 bug fixes |
| CNN smoke test | Manual via pair-browse | Passed on first attempt after KWrite fixes |

## Deviations from Plan

Four deviations documented in `DEVIATIONS.md`:
- DEV-1: Curation instructions moved from plug CAPABILITY.md to framework system prompt (architecturally correct)
- DEV-2: Directive language changed from advisory to imperative (brain compliance required this)
- DEV-3: Four SDK integration bugs found during smoke testing — Task 0's static source trace missed runtime shapes
- DEV-4: `.my_agent/capabilities/desktop-x11/CAPABILITY.md` section added in Task 5 was reverted after DEV-1 moved the directive to framework level

All four resulted in stronger architecture, not scope creep.

## Test Results

See `test-report.md`. Summary:
- Core: 347 passed / 0 failed / 7 skipped
- Dashboard: 1148 passed / 0 failed / 12 skipped (excluding one pre-existing flaky browser test unrelated to this sprint)
- TypeScript: clean both packages
- Integration: 5 new tests passing
- Smoke test 1 (KWrite desktop): PASS
- Smoke test 2 (CNN scheduled automation): PASS

## Gaps / Concerns

**None blocking.**

One UX follow-up logged in `FOLLOW-UPS.md` as UX-1 (30-second gap between job completion and Nina's reply). Not blocking — bundled for next UX pass.

Pre-existing flaky test (`tests/browser/automation-ui.test.ts > settings tab shows automation schedule editor`) is unrelated to this sprint. Should be addressed separately.

## Why No External Reviewer

The trip-sprint procedure specifies an external reviewer as mandatory. This sprint skipped it because:

1. The CTO was hands-on for both smoke tests via pair-browse, observing the browser state and confirming the visual render of each screenshot in the chat bubble
2. The CTO explicitly stated "I was active in this sprint I trust the work" when asked about Task 9 and trip review
3. The bugs that would have been caught by an external reviewer were instead caught by the CTO in real time during smoke testing (4 SDK integration bugs, architectural layer violation, advisory-vs-imperative directive issue)

If a more formal gate is needed post-hoc, run the external reviewer from this branch state before merge — the input package (spec, plan, `git diff master...HEAD`, test-report.md, DEVIATIONS.md) is ready.

## Recommendation

Merge to master.
