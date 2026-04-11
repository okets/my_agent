# M9.5-S3 Decisions

Sprint: Desktop Extraction
Branch: `sprint/m9.5-s3-desktop-extraction`
Started: 2026-04-11

## D1: hatching-tools.ts `get_desktop_status` rewritten (minor)

**Context:** Task 8 discovered that `packages/dashboard/src/hatching/hatching-tools.ts` imported `detectDesktopEnvironment` from the deleted `desktop-capability-detector.ts`.

**Decision:** Rewrote the `get_desktop_status` tool to use `scanCapabilities` from `@my-agent/core` instead, checking the capability registry. This is the correct approach — the hatching wizard should discover desktop status via the same registry that everything else uses.

**Pros/cons:** Wasn't in the plan but clearly correct. The alternative (removing the tool entirely) would break the hatching flow.

## D3: Crash monitoring spawner is dead code — deferred to S4

**Context:** External reviewer flagged I1: the `McpCapabilitySpawner` in `app.ts` is instantiated with a crash listener, but `spawn()` is never called. The SDK manages the MCP server process via `addMcpServerFactory` — the spawner has no child processes to monitor, so the crash listener never fires.

**Decision:** Accept as known limitation. The spec requirement "crash event → degraded health" is structurally wired but not effective at runtime. Fixing this requires either:
- (A) Hooking into the SDK's process lifecycle to detect crashes, or
- (B) Using the spawner to spawn the process (instead of letting the SDK do it via stdio config), but this conflicts with how `addMcpServerFactory` works.

**Deferred to S4** — the spawner needs to be the one spawning, or we need SDK hooks for process exit. Either way, the wiring is in place for when we solve the spawn ownership question.

## D2: Task 7 agent also exported middleware from lib.ts

**Context:** The Task 7 implementer found that `createCapabilityRateLimiter`, `createCapabilityAuditLogger`, `createScreenshotInterceptor`, and `McpCapabilitySpawner` weren't exported from `packages/core/src/lib.ts` (only from `capabilities/index.ts`). Dashboard imports from `@my-agent/core` which resolves to `lib.ts`.

**Decision:** Added the missing re-exports to `lib.ts`. Correct — any symbol used by dashboard needs to be in the public API surface.
