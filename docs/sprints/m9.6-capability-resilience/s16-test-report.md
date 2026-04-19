---
sprint: M9.6-S16
title: Test report
date: 2026-04-19
branch: sprint/m9.6-s16-fix-engine-swap
---

# S16 Test Report

## S16 acceptance tests (Tasks 2/3/4/6/7)

```
cd packages/core && npx vitest run \
  tests/capabilities/fix-mode-invocation \
  tests/capabilities/fix-mode-integration \
  tests/capabilities/fix-mode-escalate \
  tests/capabilities/capability-brainstorming-gate \
  tests/capabilities/resilience-messages-new-reasons
```

Result: **29/29 passed**, duration ~515ms

| Test file | Tests |
|-----------|-------|
| `fix-mode-invocation.test.ts` | 6 |
| `fix-mode-integration.test.ts` | 3 |
| `fix-mode-escalate.test.ts` | 6 |
| `capability-brainstorming-gate.test.ts` | 10 |
| `resilience-messages-new-reasons.test.ts` | 4 |
| **Total** | **29** |

## Full core test suite (Task 11)

```
cd packages/core && npx vitest run
```

Result: **629 passed | 9 skipped** (81 test files, 2 skipped files), duration ~30s

## Full dashboard test suite (Task 11)

```
cd packages/dashboard && npx vitest run
```

Result: **1267 passed | 18 skipped | 7 failed** (161 test files)

The 7 failing tests are pre-existing on master (confirmed by running them on the master branch):
- `tests/browser/automation-ui.test.ts` — SDK auth not configured in test environment
- `tests/browser/capabilities-singleton-visual.test.ts` — visual regression hash mismatch (pre-existing)
- `tests/browser/capability-ack-render.test.ts` — `data.handleWebSocketMessage is not a function` (pre-existing)
- `tests/browser/progress-card.test.ts` — progress card assertion (pre-existing)
- `tests/e2e/whatsapp-before-browser.test.ts` — SDK auth not configured in test environment
- `tests/unit/ui/progress-card.test.ts` — CSS class assertion (pre-existing)
- (1 more from progress-card tests)

None of these failures touch S16 code paths. S16 changes were verified by running the failing files against master — same failures, same counts.

## tsc verification (both packages)

```
cd packages/core && npx tsc --noEmit   # clean
cd packages/dashboard && npx tsc --noEmit  # clean
```

Both packages: **0 errors**.

## Wall-time measurement (Task 12)

**Status: COMPLETE — Branch A (ship as-is).**

Method: synthetic test capability (`s16-walltime-test-cap`) with `smoke.sh exit 1` created
temporarily; MODE:FIX automation written to `.my_agent/automations/` and fired via
`POST /api/automations/:id/fire`; wall-time measured from fire to `completed` status.

Results: **92–100 s (1.5–1.7 min)** — well under the 5-min gate.

| Plug | Break method | Wall-time (s) | Outcome | Gate |
|------|-------------|---------------|---------|------|
| s16-walltime-test-cap (synthetic script) | smoke.sh exit 1 | 100 | completed | A |

Full results: `docs/sprints/m9.6-capability-resilience/s16-walltime-results.md`

**Gate decision: Branch A — ship as-is.** DEV-3 resolved (measurement executed via headless
HTTP API, no CTO presence required).

## Commit log (sprint/m9.6-s16-fix-engine-swap → master)

```
6e96125 types(m9.6-s16): extend surrender/ack types for fix-mode escalate paths
6f1c9bb feat(m9.6-s16): add redesign-needed + insufficient-context surrender copy
61921b5 feat(m9.6-s16): buildFixModeInvocation — MODE:FIX prompt, opus model, 15-min timeout
587ba7e fix(m9.6-s16): update file header + modelUsed=opus after fix-engine swap
d43fc1e feat(m9.6-s16): handle ESCALATE markers — redesign-needed + insufficient-context → immediate surrender
eb35d23 feat(m9.6-s16): wire target_path in app.ts + surrender-redesign-needed/insufficient-context emitAck branches
15ec322 fix(m9.6-s16): isTerminalKind + D4 marker event cover new surrender reasons
754f6ee test(m9.6-s16): fix-mode integration — targetPath, ≤3 spawns, cap path in prompt; file S1 deviation proposal
6d87278 fix(m9.6-s16): integration test — tmpdir cleanup + lower-bound spawn assertion
f40af9a feat(m9.6-s16): add Step 0 fix-mode gate + neutral-identifier convention + R3 regression assertions
86f583a deprecate(m9.6-s16): mark fix-automation.md — replaced by capability-brainstorming fix-mode
782cd5c docs(m9.6-s16): sprint decisions log — write-guard status, targetPath, reflect removal, D6 escape hatch
2d1a459 feat(m9.6-s16): add wall-time measurement script + results template
```
