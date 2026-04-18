---
sprint: m9.6-s12
---

# S12 Test Report

Ran every command from `s12-plan.md` §Verification commands. Summary: all pass except the pre-existing `integration.test.ts` MCP-spawn flake (present on master too; not introduced by this sprint).

---

## 1. Core typecheck

```bash
cd packages/core && npx tsc --noEmit
```

Output: (empty stdout, exit 0). No type errors.

## 2. Core unit tests (S12 entrypoints)

```bash
cd packages/core && npx vitest run \
  tests/capabilities/mcp-cfr-detector \
  tests/capabilities/registry-find-by-name \
  tests/capabilities/ack-delivery-origin \
  tests/capabilities/orchestrator/mutex-origin-coalescing
```

Output (tail):

```
 ✓ tests/capabilities/orchestrator/mutex-origin-coalescing.test.ts (4 tests) 45ms
 ✓ tests/capabilities/registry-find-by-name.test.ts (5 tests) 6ms
 ✓ tests/capabilities/ack-delivery-origin.test.ts (13 tests) ~78ms
 ✓ tests/capabilities/mcp-cfr-detector.test.ts (22 tests) 19ms

 Test Files  4 passed (4)
      Tests  44 passed (44)
   Duration  774ms
```

## 3. Dashboard typecheck

```bash
cd packages/dashboard && npx tsc --noEmit
```

Output: (empty stdout, exit 0). No type errors.

## 4. Dashboard integration tests (S12)

```bash
cd packages/dashboard && npx vitest run \
  tests/integration/cfr-conversation-mcp \
  tests/integration/cfr-automation-mcp \
  tests/integration/debrief-prep-cfr-recovery
```

Output (tail):

```
 ✓ tests/integration/debrief-prep-cfr-recovery.test.ts (10 tests) ...
 ✓ tests/integration/cfr-conversation-mcp.test.ts (3 tests) 48ms
 ✓ tests/integration/cfr-automation-mcp.test.ts (4 tests) 79ms

 Test Files  3 passed (3)
      Tests  17 passed (17)
   Duration  1.69s
```

## 5. Acceptance check — zero live `unreachable in S9` throws (Task 8)

```bash
rg "unreachable in S9" packages/
```

Exit code: `1` (no matches). Zero hits. All five S9 placeholder throws have been replaced by the Task 4/5/6 landings.

Note: one leading-comment reference existed in `ack-delivery.ts` after Task 5; it was rewritten during Task 9 verification to avoid ambiguity with the acceptance grep (see `s12-DEVIATIONS.md`). No live code paths contain the phrase.

## 6. Core phase regression (capabilities + conversations)

```bash
cd packages/core && npx vitest run tests/capabilities tests/conversations
```

Output (tail):

```
 Test Files  1 failed | 37 passed | 1 skipped (39)
      Tests  1 failed | 245 passed | 2 skipped (248)
   Duration  29.61s
```

**The one failure** is `tests/capabilities/integration.test.ts > MCP capability integration > full flow: scan → registry → spawn → rate limit → toggle → shutdown` with error `McpError: MCP error -32000: Connection closed`. This is the pre-existing MCP-spawn flake called out in the plan's verification section; the test file is untouched by this sprint (`git log packages/core/tests/capabilities/integration.test.ts` → last touched at `33303bc`, well before S12). Fails on master the same way.

**Expected baseline** per plan: "185+ passed / 2 skipped". Actual: **245 passed / 2 skipped** — well above the baseline. New tests added this sprint account for the increase.

## 7. Dashboard phase regression (cfr)

```bash
cd packages/dashboard && npx vitest run tests/cfr
```

Output (tail):

```
 ✓ tests/cfr/cfr-emit-deps-missing.test.ts (3 tests) 402ms

 Test Files  4 passed (4)
      Tests  35 passed (35)
   Duration  3.82s
```

**Expected baseline** per plan: "35+ passed". Actual: **35 passed** — matches baseline exactly.

---

## Summary

| Check | Result |
|---|---|
| Core typecheck | PASS |
| Core S12 unit tests (4 files, 44 tests) | PASS |
| Dashboard typecheck | PASS |
| Dashboard S12 integration tests (3 files, 17 tests) | PASS |
| `rg "unreachable in S9"` acceptance grep | ZERO HITS (exit 1) |
| Core phase regression (245/2 skipped / 1 pre-existing flake) | PASS (flake noted) |
| Dashboard CFR regression (35 tests) | PASS |

All S12 tasks verified. Zero live `unreachable in S9` throws. Phase 1 + Phase 2 regression holds.

---

## External reviewer run (2026-04-18)

Reproduced every verification command from `s12-plan.md` §Verification commands on branch `sprint/m9.6-s12-mcp-cfr-detector` at commit `a092c6c`.

### External reviewer: typecheck

```bash
cd packages/core && npx tsc --noEmit    # exit 0, no output
cd packages/dashboard && npx tsc --noEmit  # exit 0, no output
```

### External reviewer: S12 core unit tests

```bash
cd packages/core && npx vitest run \
  tests/capabilities/mcp-cfr-detector \
  tests/capabilities/registry-find-by-name \
  tests/capabilities/ack-delivery-origin \
  tests/capabilities/orchestrator/mutex-origin-coalescing
```

Result:
```
 ✓ tests/capabilities/orchestrator/mutex-origin-coalescing.test.ts (4 tests) 31ms
 ✓ tests/capabilities/ack-delivery-origin.test.ts (13 tests) 107ms
 ✓ tests/capabilities/registry-find-by-name.test.ts (5 tests) 7ms
 ✓ tests/capabilities/mcp-cfr-detector.test.ts (22 tests) 16ms

 Test Files  4 passed (4)
      Tests  44 passed (44)
   Duration  843ms
```

Matches the dev's run exactly — 44/44 PASS.

### External reviewer: S12 dashboard integration tests

```bash
cd packages/dashboard && npx vitest run \
  tests/integration/cfr-conversation-mcp \
  tests/integration/cfr-automation-mcp \
  tests/integration/debrief-prep-cfr-recovery
```

Result:
```
 ✓ tests/integration/debrief-prep-cfr-recovery.test.ts (10 tests) 67ms
 ✓ tests/integration/cfr-conversation-mcp.test.ts (3 tests) 55ms
 ✓ tests/integration/cfr-automation-mcp.test.ts (4 tests) 79ms

 Test Files  3 passed (3)
      Tests  17 passed (17)
   Duration  1.93s
```

Matches the dev's run exactly — 17/17 PASS.

### External reviewer: acceptance grep (Task 8)

```bash
rg "unreachable in S9" packages/
```

Exit code: 1 (no matches). **Zero live throws in `packages/`.** Confirmed: all five S9 placeholder throws have been replaced.

### External reviewer: core phase regression

```bash
cd packages/core && npx vitest run tests/capabilities tests/conversations
```

Result:
```
 Test Files  1 failed | 37 passed | 1 skipped (39)
      Tests  1 failed | 245 passed | 2 skipped (248)
   Duration  29.78s
```

Single failure: `tests/capabilities/integration.test.ts > MCP capability integration > full flow: scan → registry → spawn → rate limit → toggle → shutdown` → `MCP error -32000: Connection closed`. Verified not touched by this sprint:

```bash
git log master..HEAD -- packages/core/tests/capabilities/integration.test.ts
# (empty — no commits touch the file on this branch)
```

Pre-existing flake — outside S12 scope. Baseline from plan was "185+ passed / 2 skipped"; actual 245 passed / 2 skipped is well above.

### External reviewer: dashboard CFR regression

```bash
cd packages/dashboard && npx vitest run tests/cfr
```

Result:
```
 ✓ tests/cfr/cfr-emit-deps-missing.test.ts (3 tests) 388ms
 Test Files  4 passed (4)
      Tests  35 passed (35)
   Duration  3.67s
```

Matches baseline — 35/35 PASS.

### External reviewer summary

| Check | Result |
|---|---|
| Core typecheck | PASS (exit 0) |
| Dashboard typecheck | PASS (exit 0) |
| Core S12 unit tests (4 files, 44 tests) | PASS (44/44) |
| Dashboard S12 integration tests (3 files, 17 tests) | PASS (17/17) |
| `rg "unreachable in S9"` acceptance grep | ZERO HITS (exit 1) |
| Core phase regression | 245/248 PASS (1 pre-existing flake, 2 skipped) |
| Dashboard CFR regression | 35/35 PASS |

**External reviewer verdict on test evidence:** all S12 acceptance criteria verified. The single regression failure is a pre-existing MCP-spawn flake unrelated to this sprint (file untouched since commit `33303bc`, well before S12).

See `s12-review.md` for the full external review.
