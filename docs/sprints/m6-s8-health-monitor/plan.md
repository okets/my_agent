# M6-S8 Sprint Plan — Configurable Health Monitor

**Date:** 2026-02-27
**Status:** Planned
**Milestone:** M6 (Memory)
**Estimated size:** S (mechanical, ~1 day)
**Design doc:** `docs/plans/2026-02-27-health-monitor-design.md`

---

## Motivation

M6-S7 unified plugin types but health monitoring remains fragmented:
- Embeddings: hardcoded 60s `setInterval` in `index.ts` (detection + recovery)
- Channels: watchdog in `ChannelManager` (inactivity timeout + reconnect)
- No configurable intervals, no unified event system

Adding a new plugin type means writing another bespoke health loop. This sprint introduces a `HealthMonitor` service that polls all plugins at configurable intervals and emits events on health state changes.

### Design decisions

1. **Observation-only.** HealthMonitor polls and emits — it does NOT perform recovery. Recovery stays per-plugin/consumer (channels reconnect via ChannelManager, embeddings recover via dashboard).
2. **Per-plugin intervals.** Each plugin can declare a preferred interval. `config.yaml` can override per-plugin or set defaults.
3. **EventEmitter pattern.** Consistent with SyncService and NotificationService — `health_changed` event with typed payload.
4. **Channels included.** ChannelManager exposes `getPlugins()` so channels participate in unified monitoring from day one.

---

## Config Schema

```yaml
# .my_agent/config.yaml
health:
  defaults:
    intervalMs: 60000          # Default for all plugins (ms)
  plugins:
    embeddings-ollama:
      intervalMs: 30000        # Ollama: faster recovery
    embeddings-local:
      intervalMs: 120000       # Local: less volatile
```

Resolution order (highest wins):
1. `config.yaml` → `health.plugins[pluginId].intervalMs`
2. Plugin property → `plugin.healthCheckIntervalMs`
3. `config.yaml` → `health.defaults.intervalMs`
4. HealthMonitor constructor default (60_000)

---

## Tasks

### Task 1: Add `healthCheckIntervalMs` to Plugin interface

**Size:** XS
**Files:** `packages/core/src/plugin/types.ts`

Add optional `healthCheckIntervalMs?: number` to the `Plugin` interface. No existing code breaks (optional field).

### Task 2: Add `health` config section

**Size:** S
**Files:**
- `packages/core/src/config.ts` — `HealthConfig` type, `YamlConfig.health`, `loadConfig()` returns it
- `packages/core/src/types.ts` — `BrainConfig.health?`
- `packages/core/src/lib.ts` — export `HealthConfig`

Add `HealthConfig` type and wire it through config loading. Follows existing pattern (channels have `defaults` + per-entry overrides).

### Task 3: Implement HealthMonitor class

**Size:** M
**Files:**
- Create: `packages/core/src/plugin/health-monitor.ts`
- `packages/core/src/plugin/index.ts` — barrel export
- `packages/core/src/lib.ts` — public export

~100 lines. Extends `EventEmitter`. Per-plugin timers, reentrancy guards, baseline establishment on `start()`. Emits `health_changed` on any health state change (healthy toggle OR message/resolution change).

Key types:
```typescript
interface HealthSnapshot { health: HealthResult; checkedAt: Date }
interface HealthChangedEvent {
  pluginId: string; pluginType: PluginType; pluginName: string
  previous: HealthResult | null; current: HealthResult; checkedAt: Date
}
```

### Task 4: Make `OllamaEmbeddingsPlugin.initialize()` idempotent

**Size:** XS
**Files:** `packages/core/src/memory/embeddings/ollama.ts`

Add `if (this.ready) return` guard at top of `initialize()`. Prevents race between HealthMonitor recovery and `tryLazyRecovery`.

### Task 5: Add `ChannelManager.getPlugins()`

**Size:** XS
**Files:** `packages/dashboard/src/channels/manager.ts`

3-line method returning all channel plugin instances for HealthMonitor registration.

### Task 6: Replace liveness loop with HealthMonitor

**Size:** M
**Files:** `packages/dashboard/src/index.ts`

Delete the inline `setInterval` liveness loop (lines 482-553). Replace with:
1. Create `HealthMonitor` with `config.health`
2. Register embeddings + channel plugins
3. Wire `health_changed` event handler:
   - Embeddings: detection (active→degraded) and recovery (degraded→active) — same logic as current loop
   - Channels: observation-only logging
   - All: `statePublisher.publishMemory()`
4. Update shutdown handler: `healthMonitor.stop()` replaces `clearInterval(livenessCheckTimer)`

### Task 7: E2E verification — degraded mode cycle

**Size:** S

Restart dashboard. Verify baseline (Ollama active). Block Ollama via iptables. Wait for HealthMonitor detection. Verify degraded state. Unblock Ollama. Wait for recovery. Verify active state restored. Verify search works.

Use QA agent with `/unraid` skill (or iptables fallback) to toggle Ollama.

---

## Team

| Role | Model | Responsibility |
|------|-------|----------------|
| Tech Lead | Opus | Orchestration, decisions, review |
| Backend Dev | Sonnet | Tasks 1-6 implementation |
| QA / Reviewer | Opus | Task 7 E2E, code review |

---

## Dependencies

- M6-S7 (Unified Plugin Interface) — **must be complete** (provides Plugin base, HealthResult, PluginStatus)

## What stays unchanged

- Channel watchdog + reconnect logic in ChannelManager
- PluginRegistry degraded state (used by SearchService for FTS fallback)
- `tryLazyRecovery` in memory routes (complements periodic monitoring)
- Frontend (same wire format)
- StatePublisher (reads from PluginRegistry as before)
