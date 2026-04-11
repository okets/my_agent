# M9.5-S3: Desktop Extraction — Architect Review

**Reviewer:** CTO architect session
**Date:** 2026-04-11

---

## Verdict: PASS

All deliverables implemented. Clean migration sequence (dual-path → verify → remove). All 7 legacy files deleted. Standalone constraint enforced. Both plan review corrections addressed. 321 tests passing, TypeScript clean. Two issues deferred to S4 with clear documentation.

---

## Spec Compliance

| Design Spec Requirement | Status | Notes |
|---|---|---|
| Standalone MCP server (no framework imports) | Done | Zero `@my-agent/core` imports in capability folder — verified |
| Coordinate scaling moved to capability | Done | `scaling.ts` in capability `src/` |
| `package.json` + `scripts/setup.sh` + `scripts/detect.sh` | Done | All present, scripts executable |
| Migration: (1) install capability folder | Done | Tasks 3-4 |
| Migration: (2) dual-path wiring | Done | Commit `62573cd` |
| Migration: (3) verify registry path | Done | Manual + automated |
| Migration: (4) remove legacy + delete old code | Done | Commit `2e1c2c2`, all 7 files confirmed deleted |
| `.desktop-enabled` → `.enabled` | Done | Old file removed, `.enabled` in capability folder |
| `computer-use-service.ts` deleted | Done | |
| `routes/desktop.ts` deleted | Done | Registration removed from `server.ts` |
| `dashboard/src/desktop/` deleted entirely | Done | |
| `dashboard/src/hooks/desktop-hooks.ts` deleted | Done | |
| Desktop works through registry | Done | Runtime verified |
| Test harness passes | Done | Integration test confirms |

### S1 Deferred Items

| Item | Status | Evidence |
|---|---|---|
| Wire middleware to PostToolUse hooks | Done | `session-manager.ts` — PreToolUse for rate limiter, PostToolUse for audit + screenshot |
| Wire spawner crash → health degraded | Partial | Wiring present but dead code — spawner never spawns (SDK manages process). Documented in D3, deferred to S4. |
| Audit logger writer async-compatible | Done | `mcp-middleware.ts` — writer accepts `Promise<void>`, `await` added |
| `_process` access warning in spawner | Done | `mcp-spawner.ts` — `console.warn` when null |

### S2 Deferred Items

| Item | Status |
|---|---|
| Remove `routes/desktop.ts` | Done |

---

## Plan Review Corrections

| Correction | Status | Notes |
|---|---|---|
| C1: Rate limiter needs PreToolUse | Resolved | Rate limiter wired as PreToolUse with `permissionDecision: 'deny'`. Audit + screenshot remain PostToolUse. Matches spec middleware chain. |
| C2: No `git add -A` | Resolved | Explicit file staging throughout |
| R2: Spawner + factory double-spawn | Resolved | Developer correctly avoided double-spawn by not calling `spawner.spawn()`. SDK manages the process. Tradeoff: crash monitoring is dead code. Documented in D3. |

---

## Decisions — Reviewed

| Decision | Verdict |
|---|---|
| D1: Hatching tools adapted to use `scanCapabilities` instead of deleted `detectDesktopEnvironment` | Agree — necessary adaptation, not in plan but clearly correct |
| D2: Middleware/spawner symbols exported from core public API | Agree — dashboard needs them |
| D3: Crash monitoring dead code deferred to S4 | Agree — double-spawning would be worse. S4 should resolve by using SDK lifecycle hooks or removing the dead code. |

---

## Corrections Required

None blocking. Two issues carry into S4.

---

## Items for S4

| Item | Priority | Description |
|---|---|---|
| Remove dead crash monitoring code or implement via SDK lifecycle | Important | Spawner instance in app.ts is never used — either wire real crash detection or remove the dead code |
| Add enabled-gate to factory registration | Important | `app.ts` uses `registry.list().find()` which ignores enabled state — should use `registry.get()` or add `&& desktopCap.enabled` |
| Expand test fixture to all 7 required tools | Required | S4 contract validation needs all required tools in the fixture |
| Tool schema validation in test harness | Required | Already tracked in S4 scope |
| Functional screenshot test | Required | Already tracked in S4 scope |

The first two items are new from this review. The last three were already in S4's scope.

---

## Summary

The largest sprint in M9.5, cleanly executed. Desktop control is now a standalone capability driven through the registry. Zero platform code remains in the framework. Migration followed the spec sequence. Both plan corrections addressed. Two new items added to S4 (dead crash code, enabled-gate). 321 tests passing.
