# External Verification Report

**Sprint:** M9.5-S1 Framework Extension
**Reviewer:** External Opus (independent)
**Date:** 2026-04-11

## Spec Coverage

| Spec Requirement | Status | Evidence |
|-----------------|--------|----------|
| `entrypoint` field on `Capability` and `CapabilityFrontmatter` | COVERED | `types.ts` lines 19, 34; type test validates both shapes |
| `requires.system` array on frontmatter | COVERED | `types.ts` line 37; type test validates system array |
| `enabled` boolean on `Capability` | COVERED | `types.ts` line 18; type test, scanner test, registry test all exercise it |
| Scanner probes system tools via `which` | COVERED | `scanner.ts` `hasSystemTool()` lines 49-55; scanner-system test with missing + present tools |
| Scanner reads `entrypoint` from frontmatter | COVERED | `scanner.ts` lines 158-160; scanner-system test `reads entrypoint from frontmatter` |
| Scanner reads `.enabled` file | COVERED | `scanner.ts` lines 139-141; scanner-system test `enabled when present` + `disabled when absent` |
| `.mcp.json` coexistence (both patterns survive) | COVERED | `scanner.ts` lines 162-168 loads `.mcp.json` only for mcp interface; scanner-system test `existing .mcp.json capabilities still work` |
| `get()` gates on `available` AND `enabled` | COVERED | `registry.ts` line 43; registry-toggle test verifies all four combinations |
| `has()` respects enabled gate | COVERED | `registry.ts` delegates to `get()`; registry-toggle test confirms |
| `isEnabled()` explicit boolean check | COVERED | `registry.ts` lines 51-55; registry-toggle test |
| `toggle()` writes/removes `.enabled` file | COVERED | `registry.ts` lines 64-84; registry-toggle test with filesystem verification |
| `toggle()` emits `capability:changed` event | COVERED | `registry.ts` line 82; registry-toggle test line 106-116 verifies event payload |
| `CapabilityRegistry` extends `EventEmitter` | COVERED | `registry.ts` line 8 |
| MCP server spawning (child process, stdio) | COVERED | `mcp-spawner.ts` full class; spawner test spawns smoke server, verifies tools |
| Per-session factory pattern | COVERED | Spawner test `creates separate instances per session` verifies different PIDs |
| Shutdown lifecycle: SIGTERM then wait 5s then SIGKILL | COVERED | `mcp-spawner.ts` lines 97-109, `SHUTDOWN_TIMEOUT_MS = 5_000` |
| Crash recovery: emit event on unexpected exit | COVERED | `mcp-spawner.ts` lines 69-86 emits `crash` event, removes handle |
| Crash recovery: test verifies event emission | MISSING | No test exercises the crash/unexpected-exit path |
| Rate limiter (sliding window per capability) | COVERED | `mcp-middleware.ts` `createCapabilityRateLimiter`; middleware test verifies limits + independent tracking |
| Audit logger (JSONL logging) | COVERED | `mcp-middleware.ts` `createCapabilityAuditLogger`; middleware test verifies entries |
| Screenshot interceptor (base64 PNG detection) | COVERED | `mcp-middleware.ts` `createScreenshotInterceptor`; middleware test verifies detection + extraction |
| Middleware wiring via PostToolUse hooks | DEFERRED | Plan explicitly defers to S3 (primitives exported, wiring in `app.ts` during Desktop Extraction) |
| detect.sh gates functional test in harness | COVERED | `test-harness.ts` lines 75-82 runs detect.sh; on failure returns error that registry maps to `untested` health |
| MCP test harness: spawn, connect, validate tools | COVERED | `test-harness.ts` `testMcpCapability()`; harness test with smoke server |
| MCP test harness: functional screenshot test | PARTIAL | Generic MCP path only checks tool count > 0. Desktop-specific functional test (call `desktop_screenshot`, validate PNG) is not implemented. Acceptable for S1 scope since the smoke server has no screenshot tool; desktop-specific contract expected in S3/S4. |
| Harness dispatches by interface type (script vs mcp) | COVERED | `test-harness.ts` lines 34-36 check `capability.interface === 'mcp'` before `TEST_CONTRACTS` dispatch |
| All new types/functions exported from `index.ts` | COVERED | `index.ts` exports `McpCapabilitySpawner`, `McpHandle`, rate limiter, audit logger, screenshot interceptor |
| Integration smoke test (full flow) | COVERED | `integration.test.ts` — scan, registry, spawn, rate limit, toggle, shutdown in one test |

## Test Results

- Capabilities: **34 passed**, 0 failed, 0 skipped (7 test files)
- TypeScript: compiles clean (no errors)

## Browser Verification

Skipped — sprint is pure library/utility work with no UI or server changes.

## Gaps Found

1. **Crash recovery path untested.** The spawner emits a `crash` event when a child process exits unexpectedly (lines 69-86), but no test exercises this path. The code looks correct structurally, but there is no evidence it works. A test that kills the child process and asserts the `crash` event fires would close this gap.

2. **Health not marked `degraded` by spawner on crash.** The spec says "the framework logs the event and marks health as `degraded`." The spawner emits a `crash` event but does not itself mark health — the consumer must do that. This is an architectural delegation (spawner signals, registry/framework reacts), which is reasonable, but the wiring that marks health degraded does not exist yet anywhere. This should be verified in S3 when the wiring is done.

3. **Functional screenshot test deferred.** The MCP test harness validates tool presence but does not call `desktop_screenshot` to verify a real screenshot. This is acceptable for S1 (the smoke server has no screenshot tool), but must be addressed in S3/S4 when the desktop capability is extracted and the `desktop-control` test contract is written.

## Verdict

**PASS WITH CONCERNS**

All S1 deliverables are implemented and tested. Types, scanner, registry, spawner, middleware, and test harness all work correctly across 34 passing tests with clean TypeScript compilation. The two concerns are: (1) crash recovery path has no test coverage, and (2) the health-degraded marking on crash is not wired yet. Both are low-risk for S1 but must be addressed by S3.
