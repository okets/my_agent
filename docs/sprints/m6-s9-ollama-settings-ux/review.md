# Sprint Review — M6-S9: Memory Settings UX Redesign

> **Reviewer:** Opus (Tech Lead)
> **Date:** 2026-02-28
> **Build:** e308e59
> **Mode:** Normal sprint
> **Status:** COMPLETE

---

## Summary

Redesigned the Memory settings panel with inline action buttons and fixed a critical bug where files indexed during Ollama downtime never received embeddings.

---

## Deliverables

### 1. Inline Action Buttons UX

**Problem:** The original 3-zone layout (STATUS → CONFIGURATION → MAINTENANCE) was confusing:
- "Fix" call-to-action was too small
- Clicking it caused layout jumps (stats row moved)
- Transition UX between zones was unpredictable

**Solution:** Removed zone-switching entirely. Each state shows its own action buttons directly:

| State | Display | Actions |
|-------|---------|---------|
| Active | Green dot, plugin/model/dims | "Change Plugin" |
| Not Configured | Gray "Not configured" | "Set up" opens plugin selector |
| Connecting | Orange pulsing dot | - |
| Error | Red dot, error message | "Retry Connection", "Reconfigure", "Use Local" |

**Files changed:**
- `packages/dashboard/public/index.html` — complete Memory section rewrite
- `packages/dashboard/public/js/app.js` — simplified state variables, added `resetMemoryUI()`

### 2. Button Styling (Design Language)

Applied Tokyo Night design language to error recovery buttons:

```html
<!-- Retry: Red theme -->
bg-red-500/15 text-red-400 border border-red-500/30

<!-- Reconfigure: Neutral -->
bg-white/5 text-tokyo-text border border-white/10

<!-- Use Local: Green theme -->
bg-green-500/10 text-green-400 border border-green-500/20
```

### 3. Tab Bar Breakpoint Fix

**Problem:** Tab bar showed at `lg` (1024px+) but mobile detection cut off at 768px, leaving a 768-1024px gap where neither desktop tabs nor mobile popover worked.

**Fix:** Changed `hidden lg:flex` to `hidden md:flex` in tab bar and chat panel.

### 4. Settings Tab Opening Fix

**Problem:** Health status icons called `openSettingsSection()` which set `activeTab` but didn't add to `openTabs` array, so the tab wasn't visible.

**Fix:** Updated `openSettingsSection()` to call `this.openTab({...})` properly:

```javascript
openSettingsSection(sectionId) {
  if (mobile.isMobile) {
    mobile.openPopoverWithFocus("settings");
  } else {
    this.openTab({
      id: "settings",
      type: "settings",
      title: "Settings",
      icon: "⚙️",
      closeable: true,
    });
  }
  // ... scroll to section
}
```

### 5. Incremental Sync Endpoint

Added `POST /api/memory/sync` for incremental sync (vs rebuild which wipes everything):

```typescript
// packages/dashboard/src/routes/memory.ts
fastify.post("/sync", async (request, reply) => {
  const result = await syncService.fullSync();
  return {
    success: true,
    added: result.added,
    updated: result.updated,
    removed: result.removed,
    errors: result.errors.length,
    durationMs: result.duration,
  };
});
```

### 6. Degraded Mode Embeddings Recovery Fix

**Bug:** Files indexed while Ollama was unavailable never received embeddings, even after recovery.

**Root cause:** Sync logic used hash-only skip:
```typescript
if (existingFile && existingFile.hash === hash) {
  continue; // BUG: doesn't check if embeddings exist!
}
```

**Fix:** Added `indexed_with_embeddings` column to `files` table:

```typescript
// Skip only if hash matches AND embeddings were generated
if (existingFile && existingFile.hash === hash) {
  if (existingFile.indexedWithEmbeddings || !embeddingsAvailable) {
    continue;
  }
  // Hash matches but missing embeddings — reprocess
}
```

**Files changed:**
- `packages/core/src/memory/types.ts` — added `indexedWithEmbeddings: boolean`
- `packages/core/src/memory/memory-db.ts` — schema, migration, CRUD methods
- `packages/core/src/memory/sync-service.ts` — updated skip logic in `syncFile()` and `fullSync()`

---

## E2E Verification

### Memory Error/Recovery Flow (Unraid API)

Used real Unraid GraphQL API to control Ollama Docker container:

| Step | Action | Result |
|------|--------|--------|
| 1 | Stop Ollama via `mutation { docker { stop } }` | EXITED |
| 2 | Create test file in notebook | File created |
| 3 | Wait for file watcher | `indexed_with_embeddings: 0`, no embeddings |
| 4 | UI shows error state | Red dot, "Connection Error", 3 recovery buttons |
| 5 | Start Ollama via `mutation { docker { start } }` | RUNNING |
| 6 | HealthMonitor detects recovery | Triggers `fullSync()` |
| 7 | Check file state | `indexed_with_embeddings: 1`, embeddings exist |

**Screenshots captured:**
- `.playwright_output/memory-error-state-full.png` — Error state with styled buttons
- `.playwright_output/memory-recovered.png` — Active state after recovery

---

## Edge Cases Handled

| Scenario | Before | After |
|----------|--------|-------|
| File indexed while degraded | No embeddings forever | Reprocessed on recovery |
| File updated while healthy | Reprocess (hash change) | Same |
| File updated while degraded | FTS only, stuck | Reprocessed when healthy |
| Model/plugin change | `resetVectorIndex()` clears cache | Same (existing mechanism) |

---

## Files Changed

| File | Changes |
|------|---------|
| `packages/dashboard/public/index.html` | Memory section rewrite, breakpoint fix |
| `packages/dashboard/public/js/app.js` | Simplified state, `resetMemoryUI()`, `openSettingsSection()` fix |
| `packages/dashboard/src/routes/memory.ts` | Added `/api/memory/sync` endpoint |
| `packages/core/src/memory/types.ts` | Added `indexedWithEmbeddings` to `FileRecord` |
| `packages/core/src/memory/memory-db.ts` | Schema, migration, getFile/upsertFile/listFiles |
| `packages/core/src/memory/sync-service.ts` | Updated skip logic in `syncFile()` and `fullSync()` |
| `docs/design/database-schema.md` | Added `indexed_with_embeddings` column |

---

## Verification Checklist

- [x] Memory panel shows 4 states correctly (active, error, connecting, not configured)
- [x] Error state shows styled recovery buttons
- [x] "Retry Connection" button works
- [x] "Use Local" button switches to local embeddings
- [x] Tab bar visible at md breakpoint (768px+)
- [x] Health status icons open Settings tab properly
- [x] Files indexed during degraded mode get embeddings on recovery
- [x] `/api/memory/sync` does incremental sync (not full rebuild)
- [x] `npx tsc --noEmit` passes
- [x] Server tested with real Ollama shutdown/restart

---

## Next Steps

Resume M6.5-S4 live validation tests (paused for this UX fix).
