# Memory System: Live Updates Gap Report

**Date:** 2026-02-25
**Author:** QA Agent (Claude Code)
**For:** Architect Review

## Summary

During live dashboard testing, we discovered that the Memory system (M6) does not have WebSocket-based live updates. All other dashboard entities (tasks, calendar events, conversations) support real-time updates via the `StatePublisher` pattern.

## Current State

### What Works (Live Updates)
| Entity | CREATE | UPDATE | DELETE | Mechanism |
|--------|--------|--------|--------|-----------|
| Tasks | ✅ | ✅ | ✅ | `statePublisher.publishTasks()` |
| Calendar Events | ✅ | ✅ | ✅ | `statePublisher.publishCalendar()` |
| Conversations | ✅ | ✅ | ✅ | `statePublisher.publishConversations()` |
| **Memory** | ❌ | ❌ | ❌ | None |

### Memory System Components
- **Settings Panel** (`packages/dashboard/public/index.html`): Displays static memory stats
  - Files indexed
  - Total chunks
  - Last sync timestamp
  - Embedding model
- **API Endpoints** (`packages/dashboard/src/routes/memory.ts`): REST-only
- **State Publisher** (`packages/dashboard/src/state/state-publisher.ts`): No `publishMemory()` method

## Impact

1. **User Experience**: Memory stats (files indexed, chunks, sync status) don't update in real-time
2. **Rebuild Index**: When user clicks "Rebuild Memory Index", stats don't refresh automatically
3. **Background Sync**: When `SyncService` runs, dashboard shows stale data

## Recommendation

### Option A: Add Memory to StatePublisher (Recommended)

Add `publishMemory()` following the existing pattern:

```typescript
// state-publisher.ts
publishMemory(): void {
  if (this.memoryTimer) clearTimeout(this.memoryTimer);
  this.memoryTimer = setTimeout(() => {
    this.memoryTimer = null;
    this._broadcastMemory();
  }, DEBOUNCE_MS);
}

private async _broadcastMemory(): Promise<void> {
  // Get memory stats from MemoryDb/SyncService
  const stats = await this.getMemoryStats();
  this.registry.broadcastToAll({
    type: "state:memory",
    stats,
    timestamp: Date.now(),
  });
}
```

Call `publishMemory()` after:
- Memory index rebuild completes
- SyncService finishes a sync cycle
- Embedding plugin changes

### Option B: Polling (Not Recommended)

Client-side polling every N seconds. Adds unnecessary load and latency.

## Files to Modify

1. `packages/dashboard/src/state/state-publisher.ts` - Add `publishMemory()`
2. `packages/dashboard/src/routes/memory.ts` - Call publisher after mutations
3. `packages/dashboard/src/memory/sync-service.ts` - Call publisher after sync
4. `packages/dashboard/public/js/ws-client.js` - Handle `state:memory` message
5. `packages/dashboard/public/js/stores.js` - Add memory store
6. `packages/dashboard/public/js/app.js` - Add Alpine.effect() for memory store

## Priority

**Medium** - Memory operations are less frequent than tasks/calendar, but live updates would improve UX during index rebuilds and sync operations.

## Resolution

**RESOLVED** (2026-02-25)

Implemented Option A. Changes:
- Added `publishMemory()` to `StatePublisher` with debouncing
- Added `setMemoryServices()` to inject memory dependencies after init
- Updated `memory.ts` routes to call `publishMemory()` after mutations
- Added `state:memory` message type to WebSocket protocol
- Added `memory` store to Alpine.js stores
- Added Alpine effect to sync store → local state
- Added `/api/debug/memory/publish` for testing

Test: `curl -X POST http://localhost:4321/api/debug/memory/publish`

## Related

- M6-S2: Memory Index (current milestone)
- Self-evolving infrastructure: `docs/design/self-evolving-infrastructure.md`
