# M6-S6: Embeddings Degraded Mode

**Status:** In Progress
**Started:** 2026-02-27
**Team:** Tech Lead + Backend Dev + Frontend Dev + Reviewer

## Problem

When Ollama goes down, the dashboard drops the embeddings plugin entirely (`activePluginId = null`). If someone then activates the `local` plugin, `resetVectorIndex()` sees a model change and **wipes all Ollama embeddings**. As memory grows, we can't afford to lose the vector index due to a transient outage.

**Current flow (broken):**
```
Startup → try initialize() → fails → activePluginId = null
                                    └→ no record of intended plugin
                                    └→ resetVectorIndex() may wipe on next switch
```

Additionally, the home tab's channel status section takes too much space. Replace it with compact status icons in the header.

## Solution

Add a "degraded mode" — the plugin stays selected (as `intendedPluginId`) but unhealthy, existing embeddings are preserved, and the system recovers automatically when the service comes back.

**Target flow:**
```
Startup → try initialize() → fails → intendedPluginId = savedPlugin
                                    └→ degradedState = { error, resolution, since }
                                    └→ activePluginId = null (no embed calls)
                                    └→ vector table preserved (no reset)
                                    └→ 60s health check timer → auto-recover
```

---

## Task 1: Core — Degraded State Types and Registry

### 1a. Add types (`packages/core/src/memory/embeddings/types.ts`)

Add `PluginDegradedState` interface:
```typescript
export interface PluginDegradedState {
  pluginId: string
  pluginName: string
  model: string
  error: string
  resolution: string  // actionable fix guidance
  since: string       // ISO 8601
  lastAttempt: string | null
}
```

Add `deriveResolution(pluginId, error)` helper that maps common errors to fix guidance:
- "Cannot connect to Ollama" → "Start the Ollama Docker container or check that the host is reachable."
- "does not support embeddings" → "Use an embeddings model like 'nomic-embed-text'."
- Fallback → "Check the embeddings plugin configuration and server status."

### 1b. Add degraded tracking to `PluginRegistry` (`packages/core/src/memory/embeddings/registry.ts`)

New fields:
- `intendedPluginId: string | null` — what the user chose (persists through degradation)
- `degradedState: PluginDegradedState | null`

New methods:
- `setIntended(pluginId)` — record user's choice
- `getIntendedPluginId()` — return intended plugin
- `setDegraded(state)` — mark as degraded (keeps `activePluginId = null` so no embed calls happen, but preserves `intendedPluginId`)
- `clearDegraded()` — clear on recovery
- `getDegradedState()` / `isDegraded()` — getters

Modify `setActive(pluginId)`:
- On success: also set `intendedPluginId = pluginId`, call `clearDegraded()`
- On `setActive(null)` (user disables): also clear `intendedPluginId` and `degradedState`

### 1c. Extend `RecallResult` (`packages/core/src/memory/types.ts`)

Add optional `degraded` field:
```typescript
export interface RecallResult {
  notebook: SearchResult[]
  daily: SearchResult[]
  degraded?: {
    pluginName: string
    error: string
    resolution: string
  }
}
```

### 1d. Wire into `SearchService` (`packages/core/src/memory/search-service.ts`)

Add `getDegradedState` callback to `SearchServiceOptions`. In `recall()`, if degraded, attach `degraded` field to the returned `RecallResult`.

No change to `hybridSearch()` — it already skips vector when plugin is null.

### 1e. Update `formatRecallResults()` (`packages/core/src/memory/tools.ts`)

When `results.degraded` is present, prepend:
```
NOTE: Semantic search unavailable — {pluginName} is down.
Reason: {error}
Fix: {resolution}
Results below are keyword-only and may miss semantically relevant content.
```

This ensures the agent always tells the user about the degradation.

---

## Task 2: Dashboard Backend — Startup, Recovery, API

### 2a. Startup enters degraded mode on failure (`packages/dashboard/src/index.ts`)

Current behavior: catch block logs warning, continues with `activePluginId = null`.

New behavior: catch block calls `pluginRegistry.setIntended(savedPluginId)` + `pluginRegistry.setDegraded(...)` with error details. The vector table stays intact (no `resetVectorIndex` call).

Also init vector table from saved dimensions if available — `memoryDb.initVectorTable(savedDims)` — so FTS + existing vectors still work for cached results.

### 2b. Periodic liveness check (`packages/dashboard/src/index.ts`)

After memory init, add 60s `setInterval` with two branches:

**Branch 1 — Recovery (degraded → healthy):**
- If degraded, try `plugin.initialize()` + `plugin.isReady()`
- On success: `pluginRegistry.setActive(pluginId)`, init vector table, trigger `syncService.fullSync()` for new files, publish state update
- On failure: update `lastAttempt` timestamp

**Branch 2 — Detection (healthy → degraded):**
- If an active plugin exists (not degraded), probe it with `plugin.isReady()`
- On failure: enter degraded mode — `pluginRegistry.setDegraded(...)`, publish state update
- This detects runtime failures (e.g., Ollama container stopped mid-session)
- One failed check = immediate degraded entry (no retry buffer — recovery already retries every 60s)

Clear interval on shutdown.

### 2b-channels. Channel `healthCheck()` interface (`packages/core/src/channels/types.ts`)

Add optional `healthCheck?(): Promise<boolean>` to `ChannelPlugin` interface. This provides an active probe for channel liveness, complementing the existing passive event-based status tracking.

Implement in:
- `MockChannelPlugin` — returns `status().connected`
- `BaileysPlugin` — returns `status().connected` (Baileys already emits disconnect events, so this is a synchronous check for now; deeper probing can come later)

Wire into `ChannelManager`:
- Add `checkHealth(channelId)` method that calls `plugin.healthCheck()` if available, falls back to `status().connected`
- Add `checkAllHealth()` method that runs `checkHealth` on all channels, returns map of `channelId → boolean`

Wire into the periodic timer in `index.ts`:
- After the embeddings check, call `channelManager.checkAllHealth()` if available
- For each channel that fails: log a warning (channels already handle reconnection via events, so no state transition needed — this is observability)

### 2c. Lazy recovery helper (`packages/dashboard/src/routes/memory.ts`)

Add `tryLazyRecovery(fastify)` helper. Call at top of `/search` and `/rebuild` handlers. Same logic as health check but synchronous with the request.

### 2d. API responses include degradation

**`GET /api/memory/status`** — add `embeddings.degraded` field:
```json
{
  "embeddings": {
    "active": null,
    "degraded": {
      "pluginId": "embeddings-ollama",
      "pluginName": "Ollama Embeddings",
      "model": "nomic-embed-text",
      "error": "Cannot connect to Ollama...",
      "resolution": "Start the Ollama Docker container...",
      "since": "2026-02-27T04:00:00Z"
    }
  }
}
```

**`GET /api/memory/search`** — include `degraded` in response when applicable.

**`POST /api/memory/rebuild`** — include warning when embeddings skipped.

### 2e. WebSocket protocol (`packages/dashboard/src/ws/protocol.ts`)

Add `degraded` field to `MemoryStats` interface.

### 2f. State publisher (`packages/dashboard/src/state/state-publisher.ts`)

Include `pluginRegistry.getDegradedState()` in `_getMemoryStats()`.

---

## Task 3: Dashboard Frontend — UI Indicators

### 3a. Home tab — replace channel section with top-right status icons

**Remove** the full "Channels:" inline section (lines 554-584 in `index.html`) — it takes too much space.

**Replace** the header's green dot + time (lines 323-326) with clickable status icons:

```
Dashboard                    [WhatsApp-icon][Memory-icon] 06:25 AM
```

Each icon uses a neutral `text-tokyo-muted` SVG with a **notification dot** overlay at the lower-right corner (not coloring the icon itself, since not all SVGs support settable fill):

- **Channel icons**: reuse `channel.icon` SVG (already available per channel). Dot color by `channel.status`:
  - green (`bg-green-400`) = connected
  - amber (`bg-amber-400`) = connecting
  - red (`bg-red-400`) = error/disconnected
  - gray (`bg-gray-500`) = logged_out
- **Click**: switches to Settings tab and scrolls to the Channels section

- **Memory icon**: generic brain/chip SVG. Dot color by state:
  - green = active plugin
  - amber + pulse = degraded
  - gray = no plugin
- **Click**: switches to Settings tab and scrolls to the Memory section

Dot implementation: `position: relative` container with `absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[#1a1b26]`

Add `id="settings-channels"` and `id="settings-memory"` to the corresponding settings section headings for scroll targets.

Add `openSettingsSection(sectionId)` method to `app.js`:
```javascript
openSettingsSection(sectionId) {
  this.activeTab = 'home';  // settings is rendered in the home tab
  this.$nextTick(() => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
```

### 3b. Settings — desktop degraded badge (`packages/dashboard/public/index.html`)

After the existing `<template x-if="memoryStatus?.embeddings?.active">` block (~line 1359), add degraded panel:

Amber panel with pulsing dot, "Degraded" label, plugin/model info, error message, resolution hint, since timestamp.

Update the Embedding Model stat row (~line 1284) to show amber text + "(degraded)" when applicable.

### 3c. Settings — mobile degraded badge (`packages/dashboard/public/index.html`)

Same pattern as 3b in the mobile settings section (~line 4913). Smaller text/dots per mobile design language.

### 3d. App.js state mapping (`packages/dashboard/public/js/app.js`)

- Map `store.stats.degraded` into `memoryStatus.embeddings.degraded`
- Add `isMemoryDegraded()` and `memoryDegradedInfo()` helper methods

---

## Testing

### Manual Test: Degraded Mode Entry
1. Start dashboard with `OLLAMA_HOST=http://dead-host:11434`
2. Verify Settings → Memory shows amber "Degraded" badge with error details
3. Verify home tab shows amber pulsing memory icon
4. Search memory → verify FTS results returned with degradation note

### Manual Test: Runtime Detection (Healthy → Degraded)
1. Start dashboard with Ollama running (should show green/active)
2. Stop the Ollama container
3. Wait up to 60 seconds
4. Verify Settings → Memory shows amber "Degraded" badge
5. Verify home tab memory icon gets amber notification dot

### Manual Test: Auto-Recovery (Degraded → Healthy)
1. Start in degraded mode (dead Ollama host)
2. Start Ollama on the correct host
3. Wait up to 60 seconds
4. Verify degraded badge disappears, green "Active" badge appears
5. Verify memory icon turns green

### Manual Test: Data Preservation
1. With Ollama active, index some files (rebuild)
2. Stop Ollama, restart dashboard
3. Verify vectors are NOT wiped (check `index_meta` table)
4. Start Ollama, verify recovery without rebuild

### Manual Test: Search During Degradation
1. Enter degraded mode
2. Perform search via API: `GET /api/memory/search?q=test`
3. Verify response includes `degraded` field alongside FTS results

---

## Acceptance Criteria

- [ ] Ollama goes down at startup → dashboard enters degraded mode (not null)
- [ ] Ollama goes down at runtime → liveness check detects and enters degraded mode
- [ ] Existing vector embeddings preserved (no `resetVectorIndex` call)
- [ ] 60s liveness check auto-recovers when service returns
- [ ] Lazy recovery on search/rebuild requests
- [ ] `recall()` returns `degraded` field → agent informs user
- [ ] `formatRecallResults()` includes degradation preamble
- [ ] API `/status`, `/search`, `/rebuild` include degraded info
- [ ] WebSocket `state:memory` broadcasts include degraded state
- [ ] Home tab: channel + memory status icons with notification dots
- [ ] Settings desktop: amber degraded badge with error + resolution
- [ ] Settings mobile: amber degraded badge (compact)
- [ ] Icons click → scroll to relevant Settings section
- [ ] `ChannelPlugin.healthCheck()` optional method exists
- [ ] `ChannelManager.checkHealth()` / `checkAllHealth()` wired

## Files Changed

| File | Change |
|------|--------|
| `packages/core/src/memory/embeddings/types.ts` | `PluginDegradedState`, `deriveResolution()` |
| `packages/core/src/memory/embeddings/registry.ts` | `intendedPluginId`, degraded state tracking |
| `packages/core/src/memory/types.ts` | `degraded` field on `RecallResult` |
| `packages/core/src/memory/search-service.ts` | Pass degraded state through to `RecallResult` |
| `packages/core/src/memory/tools.ts` | Degradation preamble in `formatRecallResults()` |
| `packages/core/src/channels/types.ts` | Optional `healthCheck()` on `ChannelPlugin` |
| `packages/dashboard/src/index.ts` | Degraded restore, 60s liveness timer (detect + recover) |
| `packages/dashboard/src/routes/memory.ts` | Lazy recovery, degraded in API responses |
| `packages/dashboard/src/ws/protocol.ts` | `degraded` in `MemoryStats` |
| `packages/dashboard/src/state/state-publisher.ts` | Include degraded in broadcasts |
| `packages/dashboard/src/channels/manager.ts` | `checkHealth()`, `checkAllHealth()` methods |
| `packages/dashboard/src/channels/mock-plugin.ts` | `healthCheck()` implementation |
| `plugins/channel-whatsapp/src/plugin.ts` | `healthCheck()` implementation |
| `packages/dashboard/public/index.html` | Home icons (notification dots), degraded badge (desktop+mobile) |
| `packages/dashboard/public/js/app.js` | Degraded state mapping + helpers |
| `docs/ROADMAP.md` | Add M6-S6 row |

## Build & Test Sequence

1. Core: edit types → registry → search-service → tools → `npm run build`
2. Dashboard backend: index.ts → routes → protocol → state-publisher
3. Dashboard frontend: app.js → index.html
4. Restart server with `OLLAMA_HOST` pointing to dead endpoint → verify degraded mode
5. Start Ollama → verify periodic recovery within 60s
6. Search during degraded → verify FTS results + degradation message
7. UI: verify amber badge on desktop + mobile, home tab icons
