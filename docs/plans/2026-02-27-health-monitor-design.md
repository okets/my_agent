# Health Monitor Design

**Date:** 2026-02-27
**Status:** Approved
**Context:** M6-S7 introduced a unified Plugin interface. Health check intervals are hardcoded. This design adds configurable, per-plugin health monitoring.

## Problem

Health monitoring is fragmented:
- Embeddings: hardcoded 60s `setInterval` in `index.ts` (detection + recovery)
- Channels: watchdog in `ChannelManager` (inactivity timeout + reconnect)
- No unified way to monitor all plugins at configurable intervals

Adding a new plugin type means writing another bespoke health loop.

## Design

### Core Concept

A `HealthMonitor` service that polls `healthCheck()` on all registered plugins at configurable intervals and emits events on health state changes. It is **observation-only** — recovery stays per-plugin/consumer.

### Architecture

```
Plugin (base interface)
├── healthCheck(): Promise<HealthResult>     (exists)
├── status(): PluginStatus                   (exists)
└── healthCheckIntervalMs?: number           (NEW, optional, default 60s)

HealthMonitor (new, packages/core/src/plugin/health-monitor.ts)
├── register(plugin: Plugin)
├── unregister(pluginId: string)
├── start()
├── stop()
├── getHealth(pluginId): HealthSnapshot | null
├── getAllHealth(): Map<string, HealthSnapshot>
└── emits: 'health_changed' (HealthChangedEvent)

Dashboard index.ts
├── Creates HealthMonitor with config from config.yaml
├── Registers all plugins (embeddings + channels)
├── Listens for 'health_changed' → triggers recovery + StatePublisher
└── Replaces the inline liveness setInterval
```

### Plugin Interface Change

```typescript
export interface Plugin {
  // ... existing fields ...
  healthCheckIntervalMs?: number  // Default: 60_000
}
```

Optional. HealthMonitor uses this as one input in the interval resolution chain.

### HealthMonitor

~80-100 lines. Extends `EventEmitter` (consistent with SyncService, NotificationService).

**Per-plugin state:**
```typescript
interface HealthSnapshot {
  health: HealthResult
  checkedAt: Date
}
```

**Behavior:**
- `register()` stores plugin reference. If already started, immediately begins polling.
- `start()` runs an initial health check on each plugin (establishes baseline without emitting), then starts per-plugin `setInterval` timers.
- Each poll: call `healthCheck()`, compare to previous result. Emit `health_changed` if `healthy` boolean changed OR if `message`/`resolution` changed.
- Per-plugin reentrancy guard prevents overlapping checks.
- `stop()` clears all timers.

**Event payload:**
```typescript
interface HealthChangedEvent {
  pluginId: string
  pluginType: PluginType
  pluginName: string
  previous: HealthResult | null
  current: HealthResult
  checkedAt: Date
}
```

### Interval Resolution

Priority order (highest wins):

1. `config.yaml` → `health.plugins[pluginId].intervalMs`
2. Plugin property → `plugin.healthCheckIntervalMs`
3. `config.yaml` → `health.defaults.intervalMs`
4. HealthMonitor constructor → `defaultIntervalMs` (hardcoded 60_000)

### Config Schema

```yaml
# .my_agent/config.yaml
health:
  defaults:
    intervalMs: 60000
  plugins:
    embeddings-ollama:
      intervalMs: 30000
    embeddings-local:
      intervalMs: 120000
```

TypeScript:
```typescript
interface HealthConfig {
  defaults?: { intervalMs?: number }
  plugins?: Record<string, { intervalMs?: number }>
}
```

Added to `BrainConfig` and `YamlConfig`. Loaded in `loadConfig()`.

### Dashboard Wiring (index.ts)

Replaces the inline liveness `setInterval` (lines 482-553).

```typescript
const healthMonitor = new HealthMonitor({
  defaultIntervalMs: 60_000,
  healthConfig: config.health,
})

// Register all plugins
for (const plugin of pluginRegistry.list()) {
  healthMonitor.register(plugin)
}
for (const plugin of channelManager.getPlugins()) {
  healthMonitor.register(plugin)
}

// Wire events
healthMonitor.on('health_changed', (event) => {
  if (event.pluginType === 'embeddings') {
    // Embeddings degradation/recovery logic (same as current liveness loop)
  }
  if (event.pluginType === 'channel') {
    // Observation-only logging
  }
  server.statePublisher?.publishMemory()
})

healthMonitor.start()
```

Shutdown: `healthMonitor.stop()` replaces `clearInterval(livenessCheckTimer)`.

### ChannelManager Change

Add `getPlugins(): Plugin[]` — iterates `this.channels` entries, returns plugin instances. ~3 lines.

### What Stays Unchanged

- **Channel watchdog + reconnect** — ChannelManager retains exclusive reconnection authority
- **PluginRegistry degraded state** — still used by SearchService for FTS fallback
- **`tryLazyRecovery`** — on-demand recovery in memory routes (complements periodic monitoring)
- **Frontend** — same wire format, no changes
- **StatePublisher** — reads from PluginRegistry as before

### Idempotency Fix

`OllamaEmbeddingsPlugin.initialize()` gets a guard: `if (this.ready) return`. Prevents race between HealthMonitor recovery and `tryLazyRecovery`.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Race between HealthMonitor + tryLazyRecovery on recovery | Medium | Make `initialize()` idempotent |
| Timer leak on shutdown | Low | `stop()` clears all timers, wired in shutdown handler |
| Late registration after `start()` | Low | `register()` auto-starts timer if already running |
| First poll baseline | Low | Initial check in `start()` establishes baseline without emitting |

## Files Changed

| File | Change |
|------|--------|
| `packages/core/src/plugin/types.ts` | Add `healthCheckIntervalMs?` to Plugin |
| `packages/core/src/plugin/health-monitor.ts` | NEW — HealthMonitor class |
| `packages/core/src/plugin/index.ts` | Export HealthMonitor |
| `packages/core/src/lib.ts` | Export HealthMonitor |
| `packages/core/src/config.ts` | Add `health` to YamlConfig, HealthConfig type, load in loadConfig() |
| `packages/core/src/types.ts` | Add `health?` to BrainConfig |
| `packages/core/src/memory/embeddings/ollama.ts` | Idempotent `initialize()` guard |
| `packages/dashboard/src/channels/manager.ts` | Add `getPlugins(): Plugin[]` |
| `packages/dashboard/src/index.ts` | Replace liveness loop with HealthMonitor |
| `packages/dashboard/src/index.ts` | Update shutdown handler |
