# M6-S4 Memory Events - Sprint Review

**Sprint:** M6-S4 Memory File Watcher Events
**Duration:** ~1 hour
**Status:** Complete

## Objective

Implement EventEmitter pattern in SyncService so file changes trigger dashboard live updates.

## Implementation Summary

### Files Modified

1. **packages/core/src/memory/sync-service.ts**
   - Extended `EventEmitter` for event publishing
   - Fixed ignored pattern bug (see Root Cause below)
   - Added `usePolling: true` for WSL2 compatibility
   - Emits `sync` events: `{ type: 'file' | 'delete' | 'full' | 'rebuild', ... }`

2. **packages/dashboard/src/index.ts**
   - Added sync event subscription: `syncService.on('sync', () => publishMemory())`

### Root Cause Analysis

The file watcher was not detecting changes due to two bugs:

#### Bug 1: Ignored Pattern Matched Parent Directory
```javascript
// BROKEN - matches .my_agent in the path
ignored: /(^|[\/\\])\../

// FIXED - only checks the file/folder basename
ignored: (path) => basename(path).startsWith('.')
```

The regex pattern matched `.my_agent` in the parent path (e.g., `{project}/.my_agent/notebook`), causing **all notebook files to be ignored**.

#### Bug 2: awaitWriteFinish Timeout
The `awaitWriteFinish` option caused timeouts on WSL2's filesystem. Removed since `scheduleSync()` already debounces changes.

### Testing

Verified all three operations work:
```
[SyncService] File added: .../notebook/operations/test.md
[SyncService] File changed: .../notebook/operations/test.md
[SyncService] File deleted: .../notebook/operations/test.md
```

The full flow is now operational:
1. File created/modified/deleted in notebook/
2. Chokidar detects change (via polling)
3. SyncService indexes file and emits 'sync' event
4. Dashboard receives event, calls `publishMemory()`
5. StatePublisher broadcasts via WebSocket
6. Alpine.js store updates reactively

## Lessons Learned

1. **Test patterns against actual paths** - The ignored pattern looked correct but failed when the watched directory was inside a dotfile directory.

2. **WSL2 requires polling** - Native inotify doesn't work reliably for WSL2 filesystems.

3. **Test with full configuration** - The watcher worked in isolation but failed with the full config. Always test with production settings.

## Commits

- `36fbe5b` fix(memory): file watcher now detects changes on WSL2
