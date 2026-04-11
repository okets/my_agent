# M9.5-S3: Desktop Extraction — Plan Review

**Reviewer:** CTO architect session
**Date:** 2026-04-11

---

## Verdict: APPROVED

10-task plan with 58 steps covers the full extraction scope. All S1 deferred items addressed. Migration sequence follows the spec (dual-path → verify → remove). Standalone constraint enforced. Two corrections required, one risk to note.

---

## Spec Coverage

### Design Spec Requirements

| Requirement | Plan Task | Status |
|---|---|---|
| Rewrite desktop MCP servers as standalone (no framework imports) | Task 3 (types), Task 4 (server) | Covered — local types.ts, no `@my-agent/core` |
| Move coordinate scaling into capability | Task 4 Step 1 (scaling.ts) | Covered |
| Add `package.json` + `scripts/setup.sh` + `scripts/detect.sh` | Task 4 Steps 5-7 | Covered |
| Migration: (1) install capability folder | Tasks 3-4 | Covered |
| Migration: (2) add registry-based wiring alongside hardcoded | Task 6 | Covered — dual-path in app.ts |
| Migration: (3) verify registry path works | Task 6 Step 4 | Covered — manual verification |
| Migration: (4) remove hardcoded + delete old code | Task 8 | Covered — 7 files deleted |
| Migrate `.desktop-enabled` → `.enabled` | Task 5 | Covered |
| Delete `computer-use-service.ts` | Task 8 Step 5 | Covered |
| Delete `routes/desktop.ts` | Task 8 Steps 5-6 | Covered |
| Delete `dashboard/src/desktop/` entirely | Task 8 Step 5 | Covered |
| Delete `dashboard/src/hooks/desktop-hooks.ts` | Task 8 Step 5 | Covered |
| Desktop works as before through registry | Task 10 Steps 5-7 | Covered — runtime + API verification |
| Test harness passes | Task 9 Step 7 (desktop-extraction.test.ts) | Covered |

### S1 Deferred Items

| Item | Plan Task | Status |
|---|---|---|
| Wire middleware to PostToolUse hooks in `app.ts` | Task 7 | Covered |
| Wire spawner `crash` event → registry health `degraded` | Task 6 Step 1 (crash listener in app.ts) | Covered |
| Make audit logger writer async-compatible | Task 1 | Covered |
| Add `_process` access warning in spawner | Task 2 | Covered |

### S2 Deferred Items

| Item | Plan Task | Status |
|---|---|---|
| Remove `routes/desktop.ts` | Task 8 Steps 5-6 | Covered |

All deferred items accounted for.

---

## Corrections Required

### C1: Middleware wired as PostToolUse but rate limiter needs PreToolUse

The design spec's middleware chain (§Framework Middleware) shows:

```
Brain calls tool → [Rate Limiter] → [Audit Logger] → MCP Server → [Screenshot Interceptor] → Brain receives result
```

Rate limiting happens **before** the tool call reaches the server. The plan wires everything as PostToolUse (Task 7, line 1071-1101), which means the rate limiter fires **after** the tool already executed. A blocked call still executes — the rate limiter just logs a warning.

**Fix:** The rate limiter check should be a PreToolUse hook that returns an error response when the limit is exceeded, preventing the tool call from reaching the MCP server. The audit logger and screenshot interceptor correctly belong in PostToolUse.

If the Agent SDK's PreToolUse hook can block tool execution (check the hook return type), use PreToolUse for rate limiting. If not, document this as a known limitation — PostToolUse rate limiting is advisory only.

### C2: `git add -A` in Task 8 Step 9

Task 8 Step 9 uses `git add -A` which stages everything. This is a public repo with `.my_agent/` gitignored, and the pre-commit hook should catch private data, but explicit file staging is always safer — especially in a sprint that creates files in both public and private directories.

**Fix:** Replace `git add -A` with explicit file list:

```bash
git add packages/dashboard/src/app.ts packages/dashboard/src/server.ts
git add -u packages/dashboard/src/desktop/ packages/dashboard/src/mcp/desktop-server.ts packages/dashboard/src/mcp/desktop-action-server.ts packages/dashboard/src/routes/desktop.ts packages/dashboard/src/hooks/desktop-hooks.ts
```

---

## Risks

### R1: `.my_agent/` is gitignored — capability code not in version control

The desktop-x11 capability folder lives in `.my_agent/capabilities/` which is gitignored. This means:
- The actual runtime code is not version-controlled
- The test fixture (Task 9) is a minimal mock, not the real server
- If `.my_agent/` is deleted, the desktop capability must be rebuilt

This is by design (private instance data), but worth noting: S4's verification ("agent builds from scratch") is the real safety net. The test fixture validates the framework wiring, not the capability implementation.

### R2: Task 6 spawner wiring may double-spawn

Task 6 creates a spawner and calls `addMcpServerFactory` with a closure that returns a stdio config. The spawner's `spawn()` is called inside the factory but the factory also returns a raw stdio config — this means the SDK may try to spawn a second process using the returned config. The spawner and the SDK factory would conflict.

The developer should verify: does `addMcpServerFactory` use the returned config to spawn its own process, or does it use the config as metadata? If the former, the spawner should not also spawn — the factory should return the config without calling `spawner.spawn()`.

---

## Observations (non-blocking)

### O1: Middleware tests in Task 9 duplicate S1 tests

Task 9 `middleware-wiring.test.ts` re-tests rate limiter, audit logger, and screenshot interceptor with nearly identical tests to S1's `mcp-middleware.test.ts`. These aren't regression tests (they don't test anything new). The crash test and desktop extraction integration test are genuinely new.

Not blocking — extra coverage doesn't hurt, just noting the duplication.

### O2: detect.sh only checks xdotool and maim, not wmctrl

Task 4 Step 6 — `detect.sh` requires only `xdotool` and `maim` (exit 1 if missing), while `wmctrl` is optional (warning only). This matches `CAPABILITY.md` which lists `requires.system: [xdotool, maim]` (not wmctrl). Consistent and correct — wmctrl absence degrades window management but doesn't break core functionality.

### O3: The standalone server computes scale factor once at startup

Task 4 Step 2 — `server.ts` line 518-519 calls `backend.displayInfo()` and `computeScaleFactor()` at startup. If display resolution changes at runtime, the scale factor is stale. This matches the existing behavior (same pattern in `desktop-action-server.ts`). Not a regression, but worth noting for a future improvement.

---

## Deferred Items

No new deferrals needed. All spec requirements and deferred items from S1/S2 are covered by this plan.

---

## S4 Deferred Items Verification

Confirmed S4 still tracks its items (from design spec):
- Tool schema validation against template contract in test harness
- Functional screenshot test (call `desktop_screenshot`, validate PNG response)
- Write `desktop-control.md` template
- Update brainstorming skill with MCP-specific guidance

No changes needed to S4 scope.

---

## Summary

Comprehensive plan for the largest sprint in M9.5. Two corrections: rate limiter should be PreToolUse (not PostToolUse), and Task 8 should use explicit git staging. One risk to investigate (spawner + factory double-spawn). All deferred items from S1 and S2 covered. No new deferrals.
