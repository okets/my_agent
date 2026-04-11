# M9.5-S3 Desktop Extraction -- Test Report

**Date:** 2026-04-11

## Test Suite Results

```
 PASS  tests/capabilities/desktop-extraction.test.ts (3 tests)
   - scanner discovers desktop-x11-fixture as mcp capability with entrypoint
   - registry toggle writes/removes .enabled file in capability folder
   - test harness validates desktop-x11-fixture MCP server (30s timeout)

 PASS  tests/capabilities/mcp-spawner-crash.test.ts (2 tests)
   - emits crash event when child process is killed (1631ms)
   - lists tools from the MCP server (6532ms)

 PASS  tests/capabilities/middleware-wiring.test.ts (7 tests)
   - rate limiter: allows requests under limit
   - rate limiter: blocks requests over limit
   - rate limiter: tracks types independently
   - audit logger: calls writer with enriched entry
   - audit logger: supports async writer
   - screenshot interceptor: detects PNG image in tool result
   - screenshot interceptor: returns false for text-only result

 38 test files passed | 1 skipped
 321 tests passed | 7 skipped
 Duration: 30.17s
```

All 3 new test files pass. Pre-existing tests unaffected.

## TypeScript Compilation

```
packages/core:      npx tsc --noEmit  -> Clean (no errors)
packages/dashboard: npx tsc --noEmit  -> Clean (no errors)
```

## Standalone Constraint

```
grep -rn '@my-agent/core' .my_agent/capabilities/desktop-x11/src/  -> No matches
grep -rn '@my-agent/core' packages/core/tests/fixtures/desktop-x11-fixture/src/  -> No matches
```

Both the real capability and the test fixture are fully standalone.

## Stale References

```
grep -rn 'desktop-server\|desktop-action-server\|desktop-capability-detector\|computer-use-service\|desktop-hooks' packages/dashboard/src/ --include='*.ts'  -> No matches
```

No stale imports or references to deleted modules.

## Deleted Files Verification

| File | Status |
|------|--------|
| `packages/dashboard/src/desktop/` (entire directory) | Deleted |
| `packages/dashboard/src/mcp/desktop-server.ts` | Deleted |
| `packages/dashboard/src/mcp/desktop-action-server.ts` | Deleted |
| `packages/dashboard/src/routes/desktop.ts` | Deleted |
| `packages/dashboard/src/hooks/desktop-hooks.ts` | Deleted |
| `packages/dashboard/src/desktop/computer-use-service.ts` | Deleted |
| `packages/dashboard/src/desktop/x11-backend.ts` | Deleted |
| `packages/dashboard/src/desktop/desktop-capability-detector.ts` | Deleted |

All 7+ legacy desktop files confirmed removed.

## Capability Folder Verification

`.my_agent/capabilities/desktop-x11/` contents:

| File | Present |
|------|---------|
| `CAPABILITY.md` | Yes |
| `config.yaml` | Yes |
| `package.json` | Yes |
| `package-lock.json` | Yes (deps installed) |
| `.enabled` | Yes |
| `src/server.ts` | Yes |
| `src/types.ts` | Yes |
| `src/x11-backend.ts` | Yes |
| `src/scaling.ts` | Yes |
| `scripts/detect.sh` | Yes |
| `scripts/setup.sh` | Yes |

## Runtime Verification

The following could NOT be verified without a running instance:

- Desktop control actually works through the registry (requires X11 display + running dashboard)
- Crash event propagates through the live system (spawner is dead code -- see review I1)
- Rate limiter blocks tool calls in a live agent session
- Audit logger writes to JSONL file during real usage

What WAS verified via tests:
- Registry discovers and toggles the capability correctly
- Test harness spawns the fixture MCP server and validates tools
- Spawner crash events emit when child process is killed
- Middleware functions (rate limiter, audit logger, screenshot interceptor) work in isolation
- MCP server factory config is correctly constructed from entrypoint
