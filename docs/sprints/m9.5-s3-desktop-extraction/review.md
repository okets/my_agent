# M9.5-S3 Desktop Extraction -- External Review

**Reviewer:** External reviewer (Opus)
**Date:** 2026-04-11
**Verdict:** PASS WITH CONCERNS

## Spec Coverage

| # | Spec Requirement | Implemented? | Evidence |
|---|-----------------|-------------|---------|
| 1 | Desktop MCP servers rewritten as standalone (no `@my-agent/core` imports) | Yes | `.my_agent/capabilities/desktop-x11/src/` -- grep confirms zero `@my-agent/core` imports. Test fixture also standalone. |
| 2 | Coordinate scaling moved into capability | Yes | `.my_agent/capabilities/desktop-x11/src/scaling.ts` exists |
| 3 | package.json + scripts/setup.sh + scripts/detect.sh added | Yes | All present in capability folder |
| 4 | Migration: install capability folder | Yes | `.my_agent/capabilities/desktop-x11/` fully populated with node_modules installed |
| 5 | Migration: add registry wiring alongside hardcoded | Yes | Commit `62573cd` (dual-path) |
| 6 | Migration: verify then remove hardcoded + delete old code | Yes | Commit `2e1c2c2` removes all legacy code |
| 7 | Migrate `.desktop-enabled` to `.enabled` in capability folder | Yes | Old file gone, `.enabled` exists in capability folder, no references to `.desktop-enabled` in codebase |
| 8 | Wire middleware chain -- rate limiter as PreToolUse | Yes | `session-manager.ts` wires rate limiter as PreToolUse with deny response. Plan review correction C1 was addressed. |
| 9 | Wire middleware chain -- audit/screenshot as PostToolUse | Yes | `session-manager.ts` PostToolUse hook with JSONL file writer |
| 10 | Wire spawner crash event to registry health degraded | Partial | Crash listener wired in `app.ts` but spawner instance is never used to spawn -- see Issue I1 |
| 11 | Make audit logger writer async-compatible | Yes | `mcp-middleware.ts` -- writer type accepts `Promise<void>`, `await` added |
| 12 | Add runtime warning when spawner can't access child process | Yes | `mcp-spawner.ts` -- `console.warn` when `_process` is null |
| 13 | Delete `dashboard/src/desktop/` | Yes | Entire directory removed |
| 14 | Delete `desktop-server.ts` | Yes | Removed |
| 15 | Delete `desktop-action-server.ts` | Yes | Removed |
| 16 | Delete `routes/desktop.ts` | Yes | Removed, unregistered from `server.ts` |
| 17 | Delete `hooks/desktop-hooks.ts` | Yes | Removed |
| 18 | Test harness passes on desktop-x11 capability | Yes | `desktop-extraction.test.ts` passes (scan, toggle, test harness) |

## Code Quality

### What was done well

- **Clean migration sequence.** The dual-path commit (`62573cd`) followed by the removal commit (`2e1c2c2`) is the correct migration pattern. Each step is independently revertible.
- **Plan review corrections applied.** The rate limiter was correctly moved to PreToolUse per architect review correction C1. The `git add -A` issue (C2) was avoided.
- **Hatching tool adaptation.** The `get_desktop_status` tool was correctly rewritten to use `scanCapabilities` instead of the deleted `detectDesktopEnvironment` (documented in DECISIONS.md D1).
- **Public API surface updated.** Missing re-exports added to `lib.ts` (documented in DECISIONS.md D2).
- **Standalone constraint enforced.** The test fixture and real capability both have zero framework imports.
- **Test fixture pattern.** Using a committed fixture that mirrors the gitignored real capability is a practical solution for CI.

### Concerns

See Issues section below.

## Test Results

- **38 test files passed**, 1 skipped (triage-behavioral -- pre-existing skip)
- **321 tests passed**, 7 skipped
- **Duration:** 30.17s
- **New tests added:** 3 files (desktop-extraction, mcp-spawner-crash, middleware-wiring)
- **TypeScript compilation:** Clean (both `packages/core` and `packages/dashboard`)

## Issues

### I1: Crash monitoring spawner is dead code (Important)

**File:** `packages/dashboard/src/app.ts` lines 1655-1666

A `McpCapabilitySpawner` is instantiated and a `crash` event listener is attached, but `spawner.spawn()` is never called. The comment says "we use a standalone spawner instance solely for crash monitoring" but the spawner has no child processes to monitor -- the SDK manages the process lifecycle via `addMcpServerFactory`. The crash listener will never fire.

This was identified as risk R2 in the plan review. The developer correctly avoided double-spawning but did not implement an alternative crash monitoring mechanism.

**Impact:** If the desktop MCP server process crashes, the registry will not be notified and health will not degrade to "degraded". The spec requirement "crash event -> degraded health" is not effectively met at runtime.

**Recommendation:** Either:
(a) Use the spawner to spawn the process AND return the transport/client to the SDK (if the SDK supports externally-managed transports), or
(b) Remove the dead spawner code and defer crash monitoring to S4 with a note that the SDK's process lifecycle needs to be hooked into, or
(c) After `addMcpServerFactory` spawns the process, obtain the child process reference and attach an exit listener directly.

### I2: MCP server factory registered even when capability is disabled (Minor)

**File:** `packages/dashboard/src/app.ts` line 1650

The code checks `desktopCap.status === 'available'` but does not check `desktopCap.enabled`. The `registry.list()` returns all capabilities regardless of enabled state. This means if the capability exists but is toggled off in settings, the MCP server factory is still registered and the SDK could spawn the process.

The `registry.get()` method correctly gates on both `status` and `enabled`, but the code uses `registry.list().find()` instead.

**Recommendation:** Add `&& desktopCap.enabled` to the condition, or use `registry.get('desktop-control')` instead of `registry.list().find(...)`.

### I3: Middleware tests partially duplicate S1 tests (Minor)

**File:** `packages/core/tests/capabilities/middleware-wiring.test.ts`

The rate limiter, audit logger, and screenshot interceptor tests in `middleware-wiring.test.ts` overlap significantly with `mcp-middleware.test.ts` from S1. The crash test and desktop-extraction integration test are genuinely new and valuable. This was noted as O1 in the plan review.

**Impact:** No functional impact. Minor maintenance overhead.

## Deferred Items

| Item | Severity | Recommendation |
|------|----------|---------------|
| Crash monitoring (I1) | Important | Carry to S4 -- implement actual process crash detection via SDK hooks or direct child process monitoring |
| Enabled-gate on factory registration (I2) | Minor | Fix in S4 or as a quick follow-up |
| Middleware test deduplication (I3) | Minor | Optional cleanup |
