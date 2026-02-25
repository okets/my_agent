# M6-S4: Memory File Watcher Events

**Status:** In Progress
**Started:** 2026-02-25
**Team:** Tech Lead + Backend Dev + QA Tester

## Problem

File changes in `.my_agent/notebook/` don't trigger dashboard live updates.

**Current flow (broken):**
```
File written → chokidar → syncFile() → updates SQLite ✓
                                      └→ publishMemory() ✗ (missing)
```

**Root cause:** `SyncService` (core package) has no way to notify `StatePublisher` (dashboard package).

## Solution

Add EventEmitter to SyncService. Dashboard subscribes to events.

**Target flow:**
```
File written → chokidar → syncFile() → updates SQLite
                                      └→ emit('sync') → dashboard subscribes
                                                       └→ publishMemory()
```

## Implementation

### 1. Core Package: SyncService EventEmitter

**File:** `packages/core/src/memory/sync-service.ts`

- Extend `EventEmitter`
- Emit `'sync'` event after:
  - `syncFile()` completes
  - `handleDelete()` completes
  - `fullSync()` / `rebuild()` completes

```typescript
import { EventEmitter } from 'node:events'

export class SyncService extends EventEmitter {
  // After successful sync:
  this.emit('sync', { type: 'file', path: relativePath })

  // After delete:
  this.emit('sync', { type: 'delete', path: relativePath })

  // After full sync:
  this.emit('sync', { type: 'full', added, removed, errors })
}
```

### 2. Dashboard: Subscribe to Events

**File:** `packages/dashboard/src/index.ts`

After creating syncService:
```typescript
syncService.on('sync', () => {
  statePublisher?.publishMemory()
})
```

### 3. Rebuild Core Package

```bash
cd packages/core && npm run build
```

## Testing

### Manual Test
1. Open dashboard in browser (http://localhost:4321)
2. Note current "Files indexed" count in Settings → Memory
3. In terminal: `echo "# Test" > .my_agent/notebook/operations/test-file.md`
4. Dashboard should update within 1 second (no refresh)
5. Delete: `rm .my_agent/notebook/operations/test-file.md`
6. Dashboard should update again

### Debug API Test
```bash
# Create file
echo "# Test file" > .my_agent/notebook/operations/test-event.md

# Wait 1 second, check stats
curl -s http://localhost:4321/api/debug/memory/status | jq '.filesIndexed'

# Delete file
rm .my_agent/notebook/operations/test-event.md
```

## Acceptance Criteria

- [ ] File create in notebook/ triggers dashboard update
- [ ] File modify in notebook/ triggers dashboard update
- [ ] File delete in notebook/ triggers dashboard update
- [ ] No manual refresh required
- [ ] Works on mobile dashboard too

## Files Changed

| File | Change |
|------|--------|
| `packages/core/src/memory/sync-service.ts` | Extend EventEmitter, emit 'sync' |
| `packages/core/src/memory/index.ts` | Re-export types if needed |
| `packages/dashboard/src/index.ts` | Subscribe to sync events |
