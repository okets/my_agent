# M9.5-S3 Decisions

Sprint: Desktop Extraction
Branch: `sprint/m9.5-s3-desktop-extraction`
Started: 2026-04-11

## D1: hatching-tools.ts `get_desktop_status` rewritten (minor)

**Context:** Task 8 discovered that `packages/dashboard/src/hatching/hatching-tools.ts` imported `detectDesktopEnvironment` from the deleted `desktop-capability-detector.ts`.

**Decision:** Rewrote the `get_desktop_status` tool to use `scanCapabilities` from `@my-agent/core` instead, checking the capability registry. This is the correct approach — the hatching wizard should discover desktop status via the same registry that everything else uses.

**Pros/cons:** Wasn't in the plan but clearly correct. The alternative (removing the tool entirely) would break the hatching flow.

## D2: Task 7 agent also exported middleware from lib.ts

**Context:** The Task 7 implementer found that `createCapabilityRateLimiter`, `createCapabilityAuditLogger`, `createScreenshotInterceptor`, and `McpCapabilitySpawner` weren't exported from `packages/core/src/lib.ts` (only from `capabilities/index.ts`). Dashboard imports from `@my-agent/core` which resolves to `lib.ts`.

**Decision:** Added the missing re-exports to `lib.ts`. Correct — any symbol used by dashboard needs to be in the public API surface.
