# M6-S8 Sprint Review — Configurable Health Monitor

**Date:** 2026-02-27
**Verdict:** PASS
**Duration:** ~2 hours

---

## Summary

Replaced the hardcoded 60s liveness `setInterval` in `index.ts` with a `HealthMonitor` service that polls all registered plugins at configurable per-plugin intervals and emits `health_changed` events. Observation-only — recovery stays per-consumer.

## Tasks Completed

| # | Task | Status |
|---|------|--------|
| 1 | Add `healthCheckIntervalMs?` to Plugin interface | Done |
| 2 | Add `HealthConfig` type + config loading | Done |
| 3 | Implement `HealthMonitor` class (~185 lines) | Done |
| 4 | Make `OllamaEmbeddingsPlugin.initialize()` idempotent | Done |
| 5 | Add `ChannelManager.getPlugins()` | Done |
| 6 | Replace liveness loop with HealthMonitor in `index.ts` | Done |
| 7 | E2E verification — degraded mode cycle | Done |

## E2E Test Results

| Step | Result |
|------|--------|
| Dashboard starts, "HealthMonitor started" logged | PASS |
| Baseline: Ollama active, embeddings ready | PASS |
| Block Ollama via iptables | PASS |
| Degraded mode detected within 60s | PASS |
| Unblock Ollama | PASS |
| Recovery detected within 60s | PASS |
| Memory search works after recovery | PASS |
| TypeScript compiles clean (core + dashboard) | PASS |

## Code Review Findings (Opus)

Three important issues identified and fixed:

1. **Recovery handler fired for wrong plugin** — didn't filter by `event.pluginId`. Fixed: added `intendedId === event.pluginId` guard.
2. **Detection handler fired for wrong plugin** — didn't check `active.id === event.pluginId`. Fixed.
3. **Late-registered plugins skipped baseline** — caused spurious initial `health_changed` events. Fixed: async baseline before starting timer.

## Bonus Fix

**Ollama host not synced to settings UI** — The settings screen always showed `http://localhost:11434` regardless of the actual `OLLAMA_HOST` env var. Fixed by:
- Adding `settings` to the `/api/memory/status` available plugins response
- Frontend `loadMemoryStatus()` now syncs `ollamaHost` from backend plugin settings

## Files Changed

| File | Change |
|------|--------|
| `packages/core/src/plugin/health-monitor.ts` | NEW — HealthMonitor class |
| `packages/core/src/plugin/types.ts` | Added `healthCheckIntervalMs?` to Plugin |
| `packages/core/src/plugin/index.ts` | Barrel exports for HealthMonitor |
| `packages/core/src/types.ts` | `HealthConfig` type, `health?` on BrainConfig |
| `packages/core/src/config.ts` | `health` section in YamlConfig + loadConfig() |
| `packages/core/src/lib.ts` | Public exports for HealthMonitor, HealthConfig |
| `packages/core/src/memory/embeddings/ollama.ts` | Idempotent `initialize()` guard |
| `packages/dashboard/src/channels/manager.ts` | `getPlugins(): Plugin[]` method |
| `packages/dashboard/src/index.ts` | Replaced liveness loop with HealthMonitor |
| `packages/dashboard/src/routes/memory.ts` | Added plugin settings to status response |
| `packages/dashboard/public/js/app.js` | Sync ollamaHost from backend |

## Architecture

```
config.yaml (optional)
  └─ health.defaults.intervalMs / health.plugins[id].intervalMs

HealthMonitor (packages/core/src/plugin/health-monitor.ts)
  ├─ register(plugin) — stores plugin, starts polling if running
  ├─ start() — baseline check (no events), then per-plugin setInterval
  ├─ stop() — clears all timers
  └─ emits: 'health_changed' → { pluginId, pluginType, previous, current }

Dashboard index.ts wiring:
  ├─ Registers embeddings plugins (from PluginRegistry)
  ├─ Registers channel plugins (from ChannelManager.getPlugins())
  └─ health_changed handler:
       ├─ embeddings: detection (active→degraded) + recovery (degraded→active)
       └─ channels: observation-only logging
```

Interval resolution order: config per-plugin > plugin property > config defaults > 60s hardcoded.

## What's Next

M6-S8 completes M6 (Memory). Next: **M6.5 Agent SDK Alignment** (3 sprints planned).
