# M8-S2: Desktop Control — Linux X11 — Code Review

**Reviewer:** External Opus reviewer
**Date:** 2026-03-29
**Branch:** `sprint/m8-s2-desktop-control-linux` (12 commits)
**Verdict:** PASS with Important issues

---

## What Was Built

12 commits delivering the full S2 scope:

1. **Desktop types** (`packages/core/src/desktop/types.ts`) -- DesktopBackend interface, DesktopEnvironment, DesktopCapabilities, WindowInfo, MonitorInfo, DisplayInfo, ScreenshotOptions. Exported via `lib.ts`.
2. **Capability detector** (`packages/dashboard/src/desktop/desktop-capability-detector.ts`) -- Probes env vars and CLI tools at startup. Builds DesktopEnvironment profile.
3. **X11Backend** (`packages/dashboard/src/desktop/x11-backend.ts`) -- Full DesktopBackend implementation: xdotool for mouse/keyboard, maim for screenshots, wmctrl for window management, xdpyinfo+xrandr for display info.
4. **ComputerUseService** (`packages/dashboard/src/desktop/computer-use-service.ts`) -- Claude beta computer use API bridge. Runs screenshot-action-screenshot loop. Agent tagging + pixel diff fallback. Concurrent mutex. Coordinate scaling.
5. **Desktop MCP server** (`packages/dashboard/src/mcp/desktop-server.ts`) -- Three tools: desktop_task, desktop_screenshot, desktop_info. Registered via createSdkMcpServer.
6. **Safety hooks** (`packages/dashboard/src/hooks/desktop-hooks.ts`) -- Sliding-window rate limiter + audit logger.
7. **Desktop route** (`packages/dashboard/src/routes/desktop.ts`) -- GET /api/debug/desktop-status endpoint.
8. **App wiring** (`packages/dashboard/src/app.ts`) -- Detect desktop env, create X11Backend, create ComputerUseService, register MCP server, attach safety utilities to app.
9. **Hatching integration** (`packages/dashboard/src/hatching/`) -- get_desktop_status tool + prompt step 7.
10. **Settings UI** (`packages/dashboard/public/index.html`) -- Desktop Control panel in Settings with status, capabilities grid, computer use indicator, setup-needed list.
11. **Skill** (`skills/desktop-control.md`) -- Brain-level skill with tool guidance, permission rules, credential safety.
12. **Setup script** (`scripts/setup-desktop.sh`) -- apt/dnf/pacman installer for xdotool, maim, wmctrl.

---

## What Went Well

- **Clean architecture.** The DesktopBackend interface in core, implementation in dashboard pattern is the correct split. Matches the existing codebase conventions (core = types + interfaces, dashboard = runtime).
- **Types match the spec exactly.** The DesktopBackend, DesktopCapabilities, WindowInfo, DisplayInfo, MonitorInfo, ScreenshotOptions, and DesktopEnvironment interfaces are faithful reproductions of the design spec.
- **ComputerUseService is well-structured.** The computer use loop correctly handles: initial screenshot, action-screenshot cycling, tool_result assembly, scale factor computation, coordinate translation, timeout + action limit enforcement, and the concurrent mutex.
- **Agent tagging + pixel diff fallback implemented.** Lines 207-214 of computer-use-service.ts correctly check for agent-provided `screenshot_tag` first, then fall back to `computeDiffRatio` from the S1 screenshot tagger. This matches the spec's "Primary: agent tagging, Fallback: pixel diff" requirement.
- **Coordinate scaling is correct.** `computeScaleFactor` applies both the 1568px long-edge limit and the 1.15MP limit, taking the minimum. `toScreenCoord` divides by scale factor and rounds. This matches Claude computer use API constraints.
- **Capability detector is thorough.** Checks XDG_SESSION_TYPE, DISPLAY, WAYLAND_DISPLAY, probes CLI tools, builds setupNeeded hints. Good fallback logic for ambiguous environments.
- **Hatching integration is tasteful.** Decision D1 (tool+prompt, not step class) is the right call. The silent check + conditional surfacing in the prompt is clean.
- **MCP server follows established pattern.** Uses `tool()` + `createSdkMcpServer()` consistent with other servers in the codebase.
- **Good test coverage on core components.** X11Backend tests verify all xdotool/maim argument construction. Capability detector tests cover X11, Wayland, headless, and missing-tools scenarios. Rate limiter tests include sliding window with fake timers.

---

## Issues Found

### Important (should fix)

**I1: Rate limiter and audit logger are created but never called.**

The rate limiter (`app.desktopRateLimiter`) and audit logger (`app.desktopAuditLogger`) are instantiated in `app.ts` lines 1141-1144 but are never invoked anywhere. The MCP tool handlers in `desktop-server.ts` do not reference them. The ComputerUseService does not reference them.

This means the safety hooks described in the spec (rate limiting per minute, audit trail logging) are effectively dead code. The rate limiter will never block a runaway loop, and the audit logger will never record tool invocations.

**Fix:** Pass the rate limiter and audit logger into `createDesktopServer` deps, and call them from the `desktop_task` and `desktop_screenshot` handlers before executing. Something like:

```typescript
// In desktop_task handler, before calling computerUse.run():
if (deps.rateLimiter) {
  const check = deps.rateLimiter.check();
  if (!check.allowed) {
    return { content: [{ type: "text", text: check.reason }], isError: true };
  }
}
if (deps.auditLogger) {
  deps.auditLogger.log({ tool: "desktop_task", instruction: args.instruction, timestamp: new Date().toISOString() });
}
```

**I2: No action-level audit log (desktop-actions.jsonl).**

The spec says: "Every desktop task produces: Action log (action type, coordinates, timestamp) in `{run_dir}/desktop-actions.jsonl`". The ComputerUseService `executeAction` method does not log individual actions. Only the high-level audit logger (which itself is never called -- see I1) exists.

This is acceptable for S2 as a deferred item, but should be tracked. The action-level log would need the run directory context, which ComputerUseService does not currently have.

**I3: MCP server tests are shallow.**

The `desktop-server.test.ts` tests do not actually invoke the MCP tool handlers. They create the server and verify mock objects directly, testing conditions like `const computerUse = null; expect(computerUse).toBeNull()` -- which tests nothing about the server's behavior. The tests for `desktop_info` call `backend.listWindows()` directly instead of going through the MCP tool handler.

This means there is no test coverage for: error paths when backend is null, the JSON serialization of tool results, the image content type for screenshots, or the integration between tool handlers and deps.

**Fix:** Either use the MCP server's handler directly (extract the handler function and call it with mock args) or restructure the tests to verify tool handler behavior, not just object existence.

### Suggestions (nice to have)

**S1: The `core/src/index.ts` barrel was not updated (plan says to modify it).**

The plan's Task 1 Step 3 says to add desktop exports to `packages/core/src/index.ts`. The implementation correctly added them to `packages/core/src/lib.ts` instead, which is the actual barrel export (`"main": "dist/lib.js"` in package.json). This is a deviation from the plan but the implementation is correct. The plan had the wrong file.

**S2: Settings UI missing some spec'd features.**

The spec describes: "Action limits: max actions, timeout, screenshot rate" and "App allowlist / blocklist (for cautious autonomy)." The implementation shows status and capabilities but not configurable limits or allowlists. This is fine for S2 -- configurability can come later -- but worth noting.

**S3: X11Backend uses synchronous execFileSync in async methods.**

All X11Backend methods are `async` but call `execFileSync` synchronously, blocking the event loop during tool execution. For typical single-action latency (<50ms) this is acceptable, but for longer operations (typing large text, multi-step drag) it could introduce UI lag. Consider migrating to `execFile` (async) in a future pass.

**S4: The `screenshot_tag` field is extracted from `input` (tool_use input) but the computer use API may not support custom fields in tool_use responses.**

The SYSTEM_PROMPT instructs Claude to include `screenshot_tag` in tool_use responses, and line 209 extracts it from `input`. The Claude computer use API's `computer_20251124` tool has a fixed schema -- custom fields in tool_use input may be silently dropped. The pixel diff fallback will handle this correctly if the agent tag is never present, but the agent tagging feature may be effectively inert. This should be validated with a real API call.

---

## Decisions Review

All three decisions are reasonable:

- **D1 (Hatching as tool+prompt):** Correct. The hatching system is prompt-driven, not class-driven.
- **D2 (Safety hooks as standalone utilities):** Correct in principle, but they need to actually be wired into the tool handlers (see I1).
- **D3 (Rate limit 30/minute instead of 10):** Reasonable. 10/minute is too restrictive for a computer use loop that takes screenshots after every action. 30/minute gives ~2 seconds per action average, which matches interactive usage.

---

## Summary

| Category | Status |
|----------|--------|
| Spec compliance | Good -- all major components built, minor gaps in audit logging |
| Code quality | Good -- clean, follows patterns, well-organized |
| Security | **Incomplete** -- rate limiter + audit logger created but never called |
| Integration | Good -- App wiring, MCP server, hatching, settings UI all connected |
| Agent tagging + pixel diff | Implemented correctly with appropriate fallback |
| Coordinate scaling | Correct -- dual constraint (edge + megapixel), proper inverse |
| Concurrent mutex | Implemented via `this.running` flag in ComputerUseService |
| Tests | Adequate for unit logic, shallow for MCP server integration |

**Verdict: PASS** -- The architecture is sound and the implementation is clean. The rate limiter/audit logger wiring (I1) should be fixed before merge to ensure the safety model actually functions. The other issues can be addressed in follow-up work.
