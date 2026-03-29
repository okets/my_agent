# M8-S2: Desktop Control -- Linux X11 -- Deep External Review

**Reviewer:** External Opus reviewer (deep adversarial audit)
**Date:** 2026-03-29
**Branch:** `sprint/m8-s2-desktop-control-linux` (18 commits)
**Verdict:** PASS WITH CONCERNS

---

## Context

The CTO flagged that the first review found a cosmetic toggle that did not work. A fix commit (`574178d`) was applied after that review. This deep review verifies every claim from scratch, assumes nothing works, and traces every code path.

---

## 1. Verdict: PASS WITH CONCERNS

The architecture is sound. The fix commit properly wired the enable/disable toggle, rate limiter, and audit logger into the MCP tool handlers. The core safety model now functions. However, the action-level audit log (`desktop-actions.jsonl`) is effectively dead, the MCP server tests are still fake, and several paths are under-tested. These are not blockers but represent deferred risk.

---

## 2. Spec Compliance Matrix

Each requirement from the design spec's S2 scope is evaluated below.

### 2.1 DesktopBackend Interface

| Requirement | Status | Evidence |
|---|---|---|
| Interface in `packages/core` | PASS | `packages/core/src/desktop/types.ts` -- all methods match spec |
| DesktopCapabilities | PASS | Lines 1-7, exact match |
| WindowInfo | PASS | Lines 9-14, exact match |
| MonitorInfo | PASS | Lines 16-22, exact match |
| DisplayInfo | PASS | Lines 24-30, exact match |
| ScreenshotOptions | PASS | Lines 32-38, exact match |
| DesktopEnvironment | PASS | Lines 59-74, exact match |
| Exported via lib.ts | PASS | `packages/core/src/lib.ts` lines 224-232 |
| `platform` field: `"x11" \| "wayland" \| "macos"` | PASS | Line 42 |

### 2.2 X11Backend

| Requirement | Status | Evidence |
|---|---|---|
| Implements DesktopBackend | PASS | `packages/dashboard/src/desktop/x11-backend.ts` line 25 |
| xdotool for mouse/keyboard | PASS | Lines 64-105 |
| maim for screenshots | PASS | Lines 49-62 |
| wmctrl for window management | PASS | Lines 107-131 |
| xdpyinfo + xrandr for display info | PASS | Lines 166-211 |
| Capability gating (throws on missing tool) | PASS | `requireCapability()` lines 43-46 |
| focusWindow settle delay (50-150ms per spec risk table) | PASS | 100ms delay, line 155 |
| doubleClick with proper repeat | PASS | `--repeat 2 --delay 50`, line 73 |
| scroll via button 4/5/6/7 | PASS | SCROLL_MAP lines 18-23, scroll method lines 99-105 |
| mouseDrag via mousedown/mousemove/mouseup | PASS | Lines 91-96 |

**Issue: syncFileSync blocks event loop.** All methods are `async` but call `execFileSync` synchronously. Acceptable for <50ms operations but could cause UI lag during long text typing or rapid scroll sequences. Flagged as Suggestion in first review, still present.

### 2.3 DesktopCapabilityDetector

| Requirement | Status | Evidence |
|---|---|---|
| Checks XDG_SESSION_TYPE | PASS | `desktop-capability-detector.ts` line 15 |
| Checks DISPLAY | PASS | Line 16 |
| Checks WAYLAND_DISPLAY | PASS | Line 17 |
| Checks platform for macOS | PASS | Line 33 |
| Probes CLI tools via `which` | PASS | `hasCommand()` lines 4-10 |
| Builds setupNeeded list | PASS | `buildSetupNeeded()` lines 112-138 |
| Reports `none` for headless | PASS | Lines 31, 41 |

### 2.4 ComputerUseService

| Requirement | Status | Evidence |
|---|---|---|
| Uses `client.beta.messages.create()` | PASS | `computer-use-service.ts` line 151 |
| Uses `computer_20251124` tool type | PASS | Line 158 |
| Uses `betas: ["computer-use-2025-11-24"]` | PASS | Line 164 |
| Screenshot-action-screenshot loop | PASS | Lines 150-266 |
| Scale factor computation (1568px + 1.15MP) | PASS | `computeScaleFactor()` lines 62-68 |
| Coordinate scaling back to screen space | PASS | `toScreenCoord()` line 73, used in `executeAction()` lines 300-370 |
| Concurrent mutex (max 1 task) | PASS | `this.running` flag, lines 80-88 |
| Default model: Sonnet | PASS | Line 37, `DEFAULT_MODEL = "claude-sonnet-4-6"` |
| maxActions default: 50 | PASS | Line 38 |
| timeout default: 120000 | PASS | Line 39 |
| Handles all action types (click, type, key, drag, scroll, wait, screenshot) | PASS | `executeAction()` lines 293-386 |
| Agent tagging via `screenshot_tag` field | PARTIALLY WORKS | Lines 211-213 extract from `input` -- but see note below |
| Pixel diff fallback | PASS | Lines 215-217 use `computeDiffRatio` from S1 |
| Final screenshot on completion | PASS | Lines 179-191 |
| Action log (desktop-actions.jsonl) | **EFFECTIVELY DEAD** | Lines 230-239 only write when `task.logDir` is provided; MCP handler never passes it |

**Agent tagging concern (carried from first review):** The `screenshot_tag` field is extracted from `input` (the tool_use input dict) at line 211. The `computer_20251124` tool has a fixed schema -- custom fields in tool_use responses may be silently dropped by the API. The pixel diff fallback handles this gracefully, but agent tagging may be inert. This cannot be verified without a real API call.

### 2.5 MCP Tools

| Requirement | Status | Evidence |
|---|---|---|
| `desktop_task` tool | PASS | `desktop-server.ts` lines 22-111 |
| `desktop_screenshot` tool | PASS | Lines 113-199 |
| `desktop_info` tool | PASS | Lines 202-296 |
| Registered via `createSdkMcpServer` | PASS | Lines 298-301 |
| Error handling for null backend | PASS | Lines 63-73 (task), 142-152 (screenshot), 214-239 (info) |
| Error handling for null computerUse | PASS | Lines 63-73 |

### 2.6 Safety

| Requirement | Status | Evidence |
|---|---|---|
| Rate limiter created | PASS | `desktop-hooks.ts` lines 15-43 |
| Rate limiter wired into MCP tools | **PASS (FIXED)** | `desktop-server.ts` lines 49-56 check `deps.rateLimiter` |
| Audit logger created | PASS | `desktop-hooks.ts` lines 58-72 |
| Audit logger wired into MCP tools | **PASS (FIXED)** | `desktop-server.ts` lines 59-61 call `deps.auditLogger.log()` |
| Enable/disable toggle gates tools | **PASS (FIXED)** | `desktop-server.ts` lines 42-47 (task), 136-140 (screenshot) |
| Rate limit: 30/minute (D3) | PASS | `app.ts` line 1141 |
| Action-level audit (desktop-actions.jsonl) | **FAIL** | `logDir` never passed from MCP handler; see section 3 |

### 2.7 Hatching Integration

| Requirement | Status | Evidence |
|---|---|---|
| `get_desktop_status` tool | PASS | `hatching-tools.ts` lines 218-239 |
| Prompt references desktop step (step 7) | PASS | `hatching-prompt.ts` lines 11-12 |
| Silent check, conditional surfacing | PASS | Prompt says "Call get_desktop_status silently" |
| Non-blocking / skippable | PASS | Prompt says "always skippable -- never block on it" |

### 2.8 Settings UI

| Requirement | Status | Evidence |
|---|---|---|
| Status display (Enabled/Disabled/Not Available) | PASS | `index.html` lines 2926-2960 |
| Detected backend display | PASS | Line 2948 |
| Capabilities grid | PASS | Lines 2963-2972 |
| Computer Use API indicator | PASS | Lines 2975-2980 |
| Missing tools + install button | PASS | Lines 2983-3008 |
| Enable/disable toggle | **PASS (FIXED)** | Lines 2926-2939 |
| Accessibility hidden (per D1 in code review) | PASS | Line 2965 filters out `accessibility` |
| Action limits config (max actions, timeout, screenshot rate) | NOT IMPLEMENTED | Spec says settings should show these; deferred |
| App allowlist/blocklist | NOT IMPLEMENTED | Spec says settings should show these; deferred |

### 2.9 Desktop Skill

| Requirement | Status | Evidence |
|---|---|---|
| Brain-level skill | PASS | `skills/desktop-control.md` frontmatter: `level: brain` |
| Tool references | PASS | `tools: [desktop_task, desktop_screenshot, desktop_info]` |
| When to use / when NOT to use | PASS | Lines 13-21 |
| Permission rules | PASS | Lines 33-37 |
| Credential safety | PASS | Lines 39-41 |

### 2.10 Environment Detection & Setup

| Requirement | Status | Evidence |
|---|---|---|
| `detectDesktopEnvironment()` at startup | PASS | `app.ts` line 1113 |
| X11Backend created when appropriate | PASS | `app.ts` lines 1117-1123 |
| ComputerUseService created when backend + API key present | PASS | `app.ts` lines 1126-1131 |
| Graceful degradation (no display = no tools) | PASS | MCP server returns helpful errors |
| Setup script (apt/dnf/pacman) | PASS | `scripts/setup-desktop.sh` lines 24-31 |
| Install endpoint | PASS | `routes/desktop.ts` lines 75-93 |

---

## 3. Dead Code / Cosmetic Features

### CRITICAL: Action-level audit log (desktop-actions.jsonl) is never written

The spec requires: "Every desktop task produces: Action log (action type, coordinates, timestamp) in `{run_dir}/desktop-actions.jsonl`"

The code at `computer-use-service.ts` lines 230-239 correctly writes the log -- but ONLY when `task.logDir` is provided:

```typescript
if (task.logDir) {
  const actionEntry = { ... };
  await appendFile(join(task.logDir, "desktop-actions.jsonl"), ...);
}
```

The MCP tool handler at `desktop-server.ts` line 76-82 never passes `logDir`:

```typescript
const result = await deps.computerUse.run({
  instruction: args.instruction,
  context: args.context,
  model: args.model,
  maxActions: args.maxActions,
  timeoutMs: args.timeoutMs,
  // logDir is NOT passed
});
```

This means the action-level audit trail -- which the spec calls a safety requirement for auditability -- is dead code. It exists and would work if `logDir` were passed, but it is never invoked.

**Fix:** Derive `logDir` from the `context` argument (same directory structure VisualActionService uses) and pass it to `computerUse.run()`. Something like:

```typescript
const logDir = deps.visualService?.screenshotDir(args.context);
const result = await deps.computerUse.run({
  ...args,
  logDir,
});
```

### MINOR: `desktop_info` does not check isEnabled

`desktop_task` and `desktop_screenshot` both check `deps.isEnabled()` and return an error when desktop is disabled. `desktop_info` does not check this flag. Since `desktop_info` is read-only (returns capabilities, windows, display info), this is arguably correct -- but it means a disabled desktop still exposes information about the desktop environment. This is an inconsistency, not a security issue.

---

## 4. Security Issues

### 4.1 Route path prefix mismatch (Low severity)

The desktop routes at `routes/desktop.ts` use paths starting with `/api/debug/` but are registered directly on the main fastify instance (`server.ts` line 263), NOT inside the debug route scope (`server.ts` lines 200-205) which applies `localhostOnly` middleware.

The comment in `desktop.ts` line 6 explicitly notes this is intentional ("No localhostOnly middleware: users access the dashboard via Tailscale"), and the rest of the dashboard has no auth middleware at all (Tailscale is the only access control). So this is consistent but confusing:

- **The `/api/debug/desktop-install` endpoint runs `sudo apt install` and is accessible to anyone on Tailscale.** For a single-user setup this is acceptable, but the route path implies it's debug-only/localhost-only when it is not.

**Recommendation:** Rename the routes to `/api/desktop/status`, `/api/desktop/toggle`, `/api/desktop/install` to avoid confusion with the actual debug routes.

### 4.2 No command injection risk (Verified safe)

All `execFileSync` calls in X11Backend pass arguments as arrays, not shell strings. User input (text to type, key combos) cannot escape to shell commands. The `setup-desktop.sh` script only uses hardcoded tool names. Verified safe.

### 4.3 Install endpoint runs sudo (Acceptable)

`POST /api/debug/desktop-install` executes `bash scripts/setup-desktop.sh` which runs `sudo apt install`. This requires passwordless sudo to succeed. If sudo requires a password, the endpoint will hang for 120 seconds (the timeout) and then fail. This is acceptable for the intended environment.

### 4.4 Rate limiter cannot be bypassed (Verified)

The rate limiter is checked before the `computerUse.run()` call at line 49 of `desktop-server.ts`. There is no alternative code path to `computerUse.run()` that skips the rate limiter. The MCP server is the only entry point. Verified safe.

### 4.5 Enable flag cannot be bypassed (Verified)

The `isEnabled` check is at lines 42-47 and 136-140 of `desktop-server.ts`. It is checked before any action is taken. The flag is a filesystem check (`existsSync`), not a cached value, so toggling takes effect immediately. Verified working via curl:

```
GET  /api/debug/desktop-status  => {"enabled": false}
POST /api/debug/desktop-toggle  => {"enabled": true}
GET  /api/debug/desktop-status  => {"enabled": true}
POST /api/debug/desktop-toggle  => {"enabled": false}
```

---

## 5. Test Gaps

### Tests that exist and work

| Component | File | Tests | Verdict |
|---|---|---|---|
| Capability detector | `desktop-capability-detector.test.ts` | 6 | Solid coverage of X11/Wayland/headless/missing tools |
| X11Backend | `x11-backend.test.ts` | 10 | All CLI arg construction verified, wmctrl parsing, display info |
| ComputerUseService statics | `computer-use-service.test.ts` | 7 | Scale factor, coord translation, mutex, maxActions validation |
| Rate limiter | `desktop-hooks.test.ts` | 3 | Including sliding window with fake timers |
| Audit logger | `desktop-hooks.test.ts` | 3 | Sink invocation, timestamp enrichment |
| Desktop MCP server | `desktop-server.test.ts` | 11 | **FAKE TESTS -- see below** |

### MCP server tests are still fake (Critical test gap)

The `desktop-server.test.ts` file does NOT test the actual MCP server handlers. Instead, it defines `simulateDesktopTaskHandler()`, `simulateDesktopScreenshotHandler()`, and `simulateDesktopInfoHandler()` functions (lines 61-126) that DUPLICATE the handler logic from the server. The tests verify these duplicated functions, not the real code.

This means:
- If the real handler logic diverges from the simulated functions, tests still pass
- The `isEnabled` gate is not tested at all (the simulate functions do not check it)
- The `auditLogger.log()` call is not tested
- The `visualService.store()` integration in `desktop_screenshot` is not tested
- The actual MCP tool serialization (schema, content types) is not tested

The "all passing" MCP server tests provide false confidence. They test a copy of the code, not the code itself.

### What is NOT tested

| Missing test | Risk |
|---|---|
| `desktop_task` handler with `isEnabled = false` | High -- this was the original bug |
| `desktop_screenshot` handler with `isEnabled = false` | High |
| `desktop_task` handler calling `auditLogger.log()` | Medium |
| `desktop_task` handler calling `rateLimiter.check()` | Medium (tested via simulate, not real handler) |
| `desktop_screenshot` storing via VisualActionService | Medium |
| ComputerUseService full loop (API call -> action -> screenshot) | Low (requires real API) |
| Action log (desktop-actions.jsonl) writing | Medium |
| Desktop routes (GET/POST) | Low (verified via curl) |
| Settings UI interaction | Low (visual only) |
| Hatching `get_desktop_status` tool | Low (simple wrapper) |
| Install endpoint error paths | Low |

---

## 6. Code Quality Issues

### 6.1 `execFileSync` in async methods (Suggestion, carried forward)

All X11Backend methods are `async` but call `execFileSync` synchronously. This blocks the Node.js event loop. For typical single-action latency (<50ms) this is acceptable, but `type()` with long text strings or `scroll()` with high amounts could block for hundreds of milliseconds.

### 6.2 Rate limiter has side effects in `check()` (Minor design concern)

The `check()` method both checks AND records the timestamp (line 39 of `desktop-hooks.ts`). This means checking the rate limit counts as an invocation. If something calls `check()` speculatively (e.g., a UI preview), it would consume quota. The current codebase only calls it once per tool invocation, so this is not a problem today, but the naming is misleading.

### 6.3 Hardcoded typing delay (Minor)

`xdotool type --delay 12` at `x11-backend.ts` line 79. The 12ms delay is hardcoded. For long text strings, this could be slow (1200ms for 100 chars). Should be configurable or use `--clearmodifiers` for reliability.

### 6.4 `displayInfo()` returns zeros on failure (Acceptable)

If `xdpyinfo` is not available, `displayInfo()` returns `{ width: 0, height: 0, ... }`. The `computeScaleFactor(0, 0)` would return `1` (all checks pass for zero), which means no scaling. This is reasonable degradation -- the API will receive full-resolution screenshots and handle them.

### 6.5 No retry logic in ComputerUseService (Acceptable for S2)

If the Claude beta API returns a transient error (429, 503), the service immediately fails the entire task. No retry logic. This is acceptable for S2 but should be added before production use.

### 6.6 `DesktopBackend` property `appName` always empty in X11Backend

`listWindows()` and `activeWindow()` return `appName: ""` in all cases (lines 121, 139, 227). The spec includes `appName` in WindowInfo. wmctrl does not provide app name directly. This is a known limitation of the X11 CLI approach.

---

## 7. What Works Well

1. **The fix commit (`574178d`) properly addressed the original issue.** The enable/disable toggle now gates `desktop_task` and `desktop_screenshot` via `deps.isEnabled()`. The rate limiter and audit logger are passed as deps and called from the handlers. This was the CTO's primary concern and it is resolved.

2. **Clean architecture.** Types in core, implementation in dashboard, MCP server pattern matches existing servers. The `DesktopBackend` interface is well-designed for future backends (Wayland, macOS).

3. **ComputerUseService is well-structured.** The computer use loop correctly handles the full lifecycle: initial screenshot, API calls, action execution, coordinate scaling, screenshot storage, tagging, timeout/limit enforcement, and the concurrent mutex.

4. **Coordinate scaling is mathematically correct.** The dual constraint (1568px edge + 1.15MP) with min selection matches the Claude API documentation. The inverse scaling (`toScreenCoord = apiCoord / scaleFactor`) is correct.

5. **Environment detection is thorough.** Handles X11, Wayland, macOS, and headless. Probes CLI tools individually. Provides actionable setupNeeded hints.

6. **Hatching integration is tasteful.** Silent check + conditional prompt surfacing is the right pattern. Does not block setup if user declines.

7. **No command injection vulnerabilities.** All child_process calls use array arguments. Verified safe.

8. **The toggle endpoint actually works.** Verified via live curl that POST toggle creates/removes the flag file and GET status reflects the change immediately.

---

## 8. Summary Table

| Category | Status | Notes |
|---|---|---|
| Spec compliance | **Good with gaps** | Action log dead, settings config missing |
| Enable/disable toggle | **PASS (fixed)** | Gates desktop_task + desktop_screenshot |
| Rate limiter wiring | **PASS (fixed)** | Called from MCP handler, blocks when exceeded |
| Audit logger wiring | **PASS (fixed)** | Called from MCP handler, logs to console |
| Action-level audit (JSONL) | **FAIL** | logDir never passed; dead code path |
| Concurrent mutex | **PASS** | `this.running` flag prevents parallel tasks |
| Coordinate scaling | **PASS** | Dual constraint, correct inverse |
| Agent tagging | **UNCERTAIN** | May be silently dropped by API; fallback works |
| Code quality | **Good** | Clean, follows patterns, minor issues |
| Test coverage | **Weak on MCP server** | Fake tests, no isEnabled gate coverage |
| Security | **Acceptable** | Route naming confusing; no injection risks |
| TypeScript compilation | **PASS** | Both packages clean |
| Test suite | **PASS** | 1057 passed, 2 pre-existing failures |
| Live endpoints | **PASS** | All three endpoints working correctly |

---

## 9. Recommendations

### Must fix before merge

None -- the original critical issue (cosmetic toggle) is fixed. The remaining issues are deferred risk, not blockers.

### Should fix soon (before S3)

1. **Wire `logDir` into desktop_task handler** so action-level audit trail actually works
2. **Rewrite MCP server tests** to test real handlers, not simulated copies
3. **Add isEnabled gate test** -- this was the bug that prompted this review

### Nice to have

4. Rename desktop routes from `/api/debug/desktop-*` to `/api/desktop/*`
5. Add `desktop_info` isEnabled check for consistency
6. Migrate `execFileSync` to async `execFile` in X11Backend
7. Make typing delay configurable

---

*Review written: 2026-03-29*
*Reviewer: External Opus 4.6 (adversarial deep audit)*
