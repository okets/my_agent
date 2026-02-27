# M6-S6 Sprint Review — Embeddings Degraded Mode

**Date:** 2026-02-27
**Status:** Complete
**Sprint:** M6-S6

---

## Summary

Added degraded mode for embeddings — when Ollama goes down, the plugin stays selected but unhealthy, existing embeddings are preserved, and the system recovers automatically when the service comes back. Also added home tab status icons for WhatsApp + Memory.

## What Was Built

### Task 1: Core — Degraded State Types & Registry

- **`PluginDegradedState` interface** — captures plugin ID, name, model, error, resolution guidance, timestamps
- **`deriveResolution()` helper** — maps common error patterns to actionable fix guidance
- **`PluginRegistry` degraded tracking** — `intendedPluginId`, `degradedState`, and methods: `setIntended()`, `setDegraded()`, `clearDegraded()`, `isDegraded()`, `getDegradedState()`
- **`RecallResult.degraded` field** — passes degradation info through to search results
- **`SearchService` wiring** — attaches degraded state via `getDegradedState` callback
- **`formatRecallResults()` preamble** — when degraded, prepends "NOTE: Semantic search unavailable" with error and fix guidance so the agent always tells the user

### Task 2: Dashboard Backend — Startup, Recovery, Liveness

- **Startup degraded mode** — on Ollama failure at boot, enters degraded state instead of dropping the plugin. Vector table preserved.
- **60s liveness timer with two branches:**
  - **Branch 1 (Recovery):** degraded → probe → if healthy, `setActive()` + `fullSync()` + publish state
  - **Branch 2 (Detection):** healthy → `isReady()` probe → if unhealthy, `setDegraded()` + publish state
- **Re-entrancy guard** — `livenessRunning` flag prevents overlapping async callbacks
- **Channel liveness observability** — `checkAllHealth()` runs in parallel via `Promise.allSettled`, logs failures
- **Lazy recovery** — `tryLazyRecovery()` in `/search` and `/rebuild` routes for immediate recovery on user action
- **API responses** — `GET /api/memory/status` includes `degraded` field; search and rebuild include degradation warnings
- **WebSocket protocol** — `MemoryStats` includes `degraded` field
- **State publisher** — includes `pluginRegistry.getDegradedState()` in broadcasts

### Task 3: Dashboard Frontend — UI Indicators

- **Home tab status icons** — WhatsApp + Memory icons in top-right header with notification dots:
  - WhatsApp: green (connected), amber (connecting), red (error), gray (logged out)
  - Memory: green (active), amber+pulse (degraded), gray (no plugin)
  - Click navigates to Settings and scrolls to relevant section
- **Desktop settings degraded badge** — amber panel with pulsing dot, plugin/model info, error, fix guidance, timestamp
- **Mobile settings degraded badge** — compact version in the settings dialog
- **Embedding model row** — shows amber "(degraded)" suffix when applicable
- **Live updates** — all state changes push via WebSocket, no page refresh needed

### Critical Bug Fix: `isReady()` Must Probe

**Root cause:** `OllamaEmbeddingsPlugin.isReady()` returned a cached `this.ready` boolean — it never actually checked if the server was still reachable. This meant Branch 2 (runtime detection) could never detect a failure.

**Fix:** Changed `isReady()` to call `checkHealth()` (GET /api/tags with 5s timeout) when `this.ready` is `true`. If the probe fails, sets `this.ready = false` and returns `false`.

### Infrastructure

- **`.env` file** with `OLLAMA_HOST=http://your-ollama-host:11434`
- **`package.json` dev script** updated to `node --env-file=.env --import tsx/esm src/index.ts`
- **`healthCheck()` interface** on `ChannelPlugin` — optional active liveness probe
- **Implemented** in `BaileysPlugin` and `MockChannelPlugin`
- **`ChannelManager.checkAllHealth()`** — parallel health checks across all channels

## Files Changed

| File | Change |
|------|--------|
| `packages/core/src/memory/embeddings/types.ts` | `PluginDegradedState`, `deriveResolution()` |
| `packages/core/src/memory/embeddings/registry.ts` | `intendedPluginId`, degraded state tracking |
| `packages/core/src/memory/embeddings/ollama.ts` | `isReady()` now probes server |
| `packages/core/src/memory/types.ts` | `degraded` field on `RecallResult` |
| `packages/core/src/memory/search-service.ts` | Pass degraded state through |
| `packages/core/src/memory/tools.ts` | Degradation preamble in `formatRecallResults()` |
| `packages/core/src/channels/types.ts` | `healthCheck()` on `ChannelPlugin` interface |
| `packages/core/src/lib.ts` | Export `PluginDegradedState`, `deriveResolution` |
| `packages/dashboard/src/index.ts` | Degraded restore, 60s liveness timer (2 branches) |
| `packages/dashboard/src/routes/memory.ts` | Lazy recovery, degraded in API responses |
| `packages/dashboard/src/ws/protocol.ts` | `degraded` in `MemoryStats` |
| `packages/dashboard/src/state/state-publisher.ts` | Include degraded in broadcasts |
| `packages/dashboard/src/channels/manager.ts` | `checkHealth()`, `checkAllHealth()` |
| `packages/dashboard/src/channels/mock-plugin.ts` | `healthCheck()` implementation |
| `packages/dashboard/public/index.html` | Home icons, degraded badge (desktop+mobile) |
| `packages/dashboard/public/js/app.js` | Degraded state mapping + helpers |
| `packages/dashboard/package.json` | `--env-file=.env` in dev script |
| `packages/dashboard/.env` | `OLLAMA_HOST` (gitignored) |
| `plugins/channel-whatsapp/src/plugin.ts` | `healthCheck()` implementation |
| `docs/ROADMAP.md` | Add M6-S6 |

## E2E Test Results

Tested with real Ollama on Unraid (your-ollama-host:11434) using iptables to simulate outages.

### Test Sequence (2 full cycles)

| Step | Action | Result |
|------|--------|--------|
| 1 | Start server with Ollama running | Active state, green icons |
| 2 | Block Ollama via iptables REJECT | Liveness timer detects failure within 60s |
| 3 | Verify degraded state | API: `degraded` populated, `active: null`. UI: amber badge, amber dot on memory icon |
| 4 | Verify live updates | Settings badge + home icon updated via WebSocket without page refresh |
| 5 | Unblock Ollama | Liveness timer recovers within 60s |
| 6 | Verify recovery state | API: `active` restored, `degraded: null`. UI: green badge, green dot, sync triggered |
| 7 | Verify live updates on recovery | Badge transitions from amber→green without refresh |
| 8 | Repeat cycle 2 (mobile) | Same results at 390px viewport |

### Verified Views

- Desktop home tab (active, degraded, recovered)
- Desktop settings (active, degraded, recovered)
- Mobile home tab (active, degraded, recovered)
- Mobile settings dialog (active, degraded, recovered)

Screenshots: `.playwright_output/01-10*.png`

## Verification Checklist

- [x] `npx tsc --noEmit` passes (core clean; dashboard has pre-existing WhatsApp plugin type error unrelated to this sprint)
- [x] `npx prettier --write` applied (all files unchanged = already formatted)
- [x] Core package rebuilt (`npm run build` clean)
- [x] All planned tasks complete (Tasks 1-3)
- [x] No console/server errors from our changes
- [x] Works on desktop (1280x900)
- [x] Works on mobile (390x844)
- [x] Server restarted before testing
- [x] Live updates verified (WebSocket pushes for both degraded→active and active→degraded)

## User Stories for CTO Testing

### Story 1: Startup Degraded Mode
1. Stop the Ollama Docker container on Unraid
2. Restart the dashboard (`npm run dev`)
3. Open http://localhost:4321
4. **Expect:** Memory icon in home header has amber pulsing dot. Settings shows amber "Degraded" badge with error and fix guidance.
5. Start the Ollama container
6. **Expect:** Within 60s, memory icon turns green, Settings badge switches to "Active"

### Story 2: Runtime Detection
1. Start with Ollama running and dashboard healthy
2. **Verify:** Memory icon green, Settings shows "Active"
3. Stop the Ollama Docker container
4. **Expect:** Within 60s, memory icon gets amber pulsing dot, Settings shows "Degraded" badge
5. Start Ollama again
6. **Expect:** Within 60s, recovery — green dot, "Active" badge, sync triggered

### Story 3: Search During Degradation
1. With Ollama down (degraded mode):
2. Use the search box in Settings > Memory
3. **Expect:** Results come back (FTS keyword search still works), response includes degradation warning

### Story 4: Mobile Experience
1. Open dashboard on phone (or 390px viewport)
2. Check home tab — status icons visible next to time
3. Tap Settings gear → check degraded/active badge in Memory section
4. **Expect:** Same state transitions as desktop, just compact layout

### Story 5: Icon Click Navigation
1. On home tab, click the WhatsApp icon
2. **Expect:** Settings tab opens, scrolls to Channels section
3. Click the Memory icon
4. **Expect:** Settings tab opens, scrolls to Memory section
