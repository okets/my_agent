# M9.5-S2 Decisions

## D1: Desktop routes stay (pre-approved)

**Decision:** `routes/desktop.ts` is NOT removed in S2. The desktop capability folder doesn't exist yet (S3 creates it), so the generic toggle has nothing to toggle for desktop.

**Alternatives considered:**
- A) Remove desktop.ts, rely on generic toggle — breaks desktop control (no folder to target)
- B) Add compatibility shim — unnecessary complexity
- C) Keep desktop.ts alongside new generic routes — cleanest, S3 does the swap

**Chosen:** C — CTO approved before execution.

## D2: Refetch after toggle instead of optimistic update

**Decision:** After toggling a capability, the UI refetches the full capability list from `GET /api/settings/capabilities` rather than optimistically updating local state.

**Why:** Architect review C1 flagged that optimistically setting `state = 'healthy'` after enabling would incorrectly snap degraded capabilities to healthy. The refetch is one extra request per toggle but always correct.

## D3: `enabled !== false` backward compatibility in store

**Decision:** The `$store.capabilities.has()` check uses `c.enabled !== false` instead of `c.enabled === true`.

**Why:** If a WebSocket broadcast from a pre-S2 code path omits the `enabled` field, `undefined !== false` is `true`, preserving the existing behavior. Once S2 is deployed and both publish methods include `enabled`, this is equivalent to `=== true`.

## D4: Per-socket publish fix (found during verification)

**Decision:** Added `enabled` to both `publishCapabilities()` (broadcast) AND `publishAllTo()` (per-socket initial state). The plan only specified the broadcast method, but browser verification revealed the per-socket initial publish also omitted `enabled`.

**Impact:** Without this fix, newly connected clients would see all capabilities as enabled regardless of actual state, causing the mic button to appear when STT is disabled.
