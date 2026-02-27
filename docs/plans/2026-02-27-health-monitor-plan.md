# Health Monitor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a unified HealthMonitor service that polls all plugins at configurable intervals and emits health state change events, replacing the hardcoded liveness loop.

**Architecture:** HealthMonitor in `packages/core/src/plugin/` extends EventEmitter. It registers plugins, polls `healthCheck()` per-plugin on configurable intervals, and emits `health_changed` events. Dashboard wires recovery logic as event handlers. Config from `config.yaml` can override intervals per-plugin.

**Tech Stack:** TypeScript, Node.js EventEmitter, Fastify (dashboard)

**Design doc:** `docs/plans/2026-02-27-health-monitor-design.md`

---

### Task 1: Plugin Interface — Add `healthCheckIntervalMs`

**Files:**
- Modify: `packages/core/src/plugin/types.ts:45-52`

**Step 1: Add the optional property to Plugin interface**

In `packages/core/src/plugin/types.ts`, add `healthCheckIntervalMs` to the `Plugin` interface:

```typescript
export interface Plugin {
  readonly id: string
  readonly name: string
  readonly type: PluginType
  readonly icon: string // SVG string (viewBox="0 0 24 24")
  healthCheck(): Promise<HealthResult>
  status(): PluginStatus
  healthCheckIntervalMs?: number // Preferred poll interval (ms). Default: 60_000
}
```

**Step 2: Verify types compile**

Run: `cd packages/core && npx tsc --noEmit`
Expected: PASS (optional field, no existing code breaks)

**Step 3: Commit**

```bash
git add packages/core/src/plugin/types.ts
git commit -m "feat(plugin): add healthCheckIntervalMs to Plugin interface"
```

---

### Task 2: Config — Add `health` section to config.yaml loading

**Files:**
- Modify: `packages/core/src/config.ts:47-65` (YamlConfig interface)
- Modify: `packages/core/src/config.ts:200-211` (loadConfig function)
- Modify: `packages/core/src/types.ts:3-7` (BrainConfig interface)

**Step 1: Add HealthConfig types and extend YamlConfig**

In `packages/core/src/config.ts`, add above the `YamlConfig` interface (before line 47):

```typescript
export interface HealthPluginConfig {
  intervalMs?: number
}

export interface HealthConfig {
  defaults?: {
    intervalMs?: number
  }
  plugins?: Record<string, HealthPluginConfig>
}
```

Then add `health` to the `YamlConfig` interface (inside, after the `channels` field):

```typescript
interface YamlConfig {
  agent?: {
    name?: string
    nickname?: string
    fullName?: string
  }
  brain?: {
    model?: string
    dir?: string
  }
  channels?: {
    defaults?: {
      reconnect?: Partial<ReconnectPolicy>
      watchdog?: Partial<WatchdogConfig>
      debounceMs?: number
    }
    [key: string]: unknown
  }
  health?: HealthConfig
}
```

**Step 2: Add `health` to BrainConfig**

In `packages/core/src/types.ts`:

```typescript
import type { ChannelInstanceConfig } from './channels/types.js'
import type { HealthConfig } from './config.js'

export interface BrainConfig {
  model: string
  brainDir: string
  channels: Record<string, ChannelInstanceConfig>
  health?: HealthConfig
}
```

**Step 3: Load health config in `loadConfig()`**

In `packages/core/src/config.ts`, update `loadConfig()` (line 200):

```typescript
export function loadConfig(): BrainConfig {
  const agentDir = process.env.MY_AGENT_DIR ?? DEFAULT_AGENT_DIR
  const yaml = loadYamlConfig(agentDir)

  return {
    model: process.env.MY_AGENT_MODEL ?? yaml?.brain?.model ?? DEFAULT_MODEL,
    brainDir:
      process.env.MY_AGENT_BRAIN_DIR ??
      (yaml?.brain?.dir ? path.resolve(agentDir, yaml.brain.dir) : path.join(agentDir, 'brain')),
    channels: loadChannelConfigs(yaml),
    health: yaml?.health,
  }
}
```

**Step 4: Export HealthConfig from lib.ts**

In `packages/core/src/lib.ts`, add to the config exports (around line 17):

```typescript
export {
  loadConfig,
  findAgentDir,
  loadAgentName,
  loadAgentNickname,
  loadAgentFullName,
  saveChannelToConfig,
} from './config.js'
export type { HealthConfig, HealthPluginConfig } from './config.js'
export type { BrainConfig } from './types.js'
```

**Step 5: Verify types compile**

Run: `cd packages/core && npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/core/src/config.ts packages/core/src/types.ts packages/core/src/lib.ts
git commit -m "feat(config): add health section to config.yaml schema"
```

---

### Task 3: HealthMonitor — Core Implementation

**Files:**
- Create: `packages/core/src/plugin/health-monitor.ts`
- Modify: `packages/core/src/plugin/index.ts:1`
- Modify: `packages/core/src/lib.ts:4`

**Step 1: Create HealthMonitor class**

Create `packages/core/src/plugin/health-monitor.ts`:

```typescript
/**
 * Health Monitor
 *
 * Polls healthCheck() on registered plugins at configurable intervals.
 * Emits 'health_changed' when a plugin's health state transitions.
 * Observation-only — does NOT perform recovery.
 *
 * @module plugin/health-monitor
 */

import { EventEmitter } from 'node:events'
import type { Plugin, PluginType, HealthResult } from './types.js'
import type { HealthConfig } from '../config.js'

const DEFAULT_INTERVAL_MS = 60_000

export interface HealthSnapshot {
  health: HealthResult
  checkedAt: Date
}

export interface HealthChangedEvent {
  pluginId: string
  pluginType: PluginType
  pluginName: string
  previous: HealthResult | null
  current: HealthResult
  checkedAt: Date
}

interface PluginEntry {
  plugin: Plugin
  timer: ReturnType<typeof setInterval> | null
  lastHealth: HealthResult | null
  checking: boolean
}

export interface HealthMonitorOptions {
  defaultIntervalMs?: number
  healthConfig?: HealthConfig
}

export class HealthMonitor extends EventEmitter {
  private plugins = new Map<string, PluginEntry>()
  private defaultIntervalMs: number
  private healthConfig: HealthConfig | undefined
  private started = false

  constructor(options?: HealthMonitorOptions) {
    super()
    this.defaultIntervalMs = options?.defaultIntervalMs ?? DEFAULT_INTERVAL_MS
    this.healthConfig = options?.healthConfig
  }

  /**
   * Register a plugin to be monitored.
   * If already started, immediately begins polling this plugin.
   */
  register(plugin: Plugin): void {
    // Stop existing timer if re-registering
    const existing = this.plugins.get(plugin.id)
    if (existing?.timer) {
      clearInterval(existing.timer)
    }

    const entry: PluginEntry = {
      plugin,
      timer: null,
      lastHealth: null,
      checking: false,
    }
    this.plugins.set(plugin.id, entry)

    if (this.started) {
      this.startPlugin(entry)
    }
  }

  /**
   * Unregister a plugin — stops its timer and removes it.
   */
  unregister(pluginId: string): void {
    const entry = this.plugins.get(pluginId)
    if (entry?.timer) {
      clearInterval(entry.timer)
    }
    this.plugins.delete(pluginId)
  }

  /**
   * Start monitoring all registered plugins.
   * Runs an initial health check to establish baselines (no events emitted),
   * then begins periodic polling.
   */
  async start(): Promise<void> {
    this.started = true

    // Establish baseline for each plugin (parallel, no events)
    const entries = Array.from(this.plugins.values())
    await Promise.allSettled(
      entries.map(async (entry) => {
        try {
          entry.lastHealth = await entry.plugin.healthCheck()
        } catch {
          entry.lastHealth = { healthy: false, message: 'Health check failed during startup' }
        }
      }),
    )

    // Start per-plugin timers
    for (const entry of entries) {
      this.startPlugin(entry)
    }
  }

  /**
   * Stop all health check timers.
   */
  stop(): void {
    this.started = false
    for (const entry of this.plugins.values()) {
      if (entry.timer) {
        clearInterval(entry.timer)
        entry.timer = null
      }
    }
  }

  /**
   * Get the last known health for a plugin.
   */
  getHealth(pluginId: string): HealthSnapshot | null {
    const entry = this.plugins.get(pluginId)
    if (!entry?.lastHealth) return null
    return { health: entry.lastHealth, checkedAt: new Date() }
  }

  /**
   * Get health snapshots for all monitored plugins.
   */
  getAllHealth(): Map<string, HealthSnapshot> {
    const result = new Map<string, HealthSnapshot>()
    for (const [id, entry] of this.plugins) {
      if (entry.lastHealth) {
        result.set(id, { health: entry.lastHealth, checkedAt: new Date() })
      }
    }
    return result
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private resolveInterval(plugin: Plugin): number {
    // 1. config.yaml per-plugin override
    const perPlugin = this.healthConfig?.plugins?.[plugin.id]?.intervalMs
    if (perPlugin !== undefined) return perPlugin

    // 2. Plugin's own property
    if (plugin.healthCheckIntervalMs !== undefined) return plugin.healthCheckIntervalMs

    // 3. config.yaml defaults
    const configDefault = this.healthConfig?.defaults?.intervalMs
    if (configDefault !== undefined) return configDefault

    // 4. Constructor default
    return this.defaultIntervalMs
  }

  private startPlugin(entry: PluginEntry): void {
    if (entry.timer) {
      clearInterval(entry.timer)
    }

    const intervalMs = this.resolveInterval(entry.plugin)
    entry.timer = setInterval(() => this.pollPlugin(entry), intervalMs)
  }

  private async pollPlugin(entry: PluginEntry): Promise<void> {
    if (entry.checking) return // Reentrancy guard
    entry.checking = true

    try {
      const current = await entry.plugin.healthCheck()
      const previous = entry.lastHealth
      const changed =
        previous === null ||
        previous.healthy !== current.healthy ||
        previous.message !== current.message ||
        previous.resolution !== current.resolution

      entry.lastHealth = current

      if (changed) {
        const event: HealthChangedEvent = {
          pluginId: entry.plugin.id,
          pluginType: entry.plugin.type,
          pluginName: entry.plugin.name,
          previous,
          current,
          checkedAt: new Date(),
        }
        this.emit('health_changed', event)
      }
    } catch (err) {
      // Health check itself threw — treat as unhealthy
      const errMsg = err instanceof Error ? err.message : String(err)
      const current: HealthResult = {
        healthy: false,
        message: errMsg,
        since: new Date(),
      }
      const previous = entry.lastHealth
      entry.lastHealth = current

      if (previous === null || previous.healthy || previous.message !== errMsg) {
        this.emit('health_changed', {
          pluginId: entry.plugin.id,
          pluginType: entry.plugin.type,
          pluginName: entry.plugin.name,
          previous,
          current,
          checkedAt: new Date(),
        } satisfies HealthChangedEvent)
      }
    } finally {
      entry.checking = false
    }
  }
}
```

**Step 2: Update barrel export**

In `packages/core/src/plugin/index.ts`:

```typescript
export * from './types.js'
export { HealthMonitor } from './health-monitor.js'
export type { HealthSnapshot, HealthChangedEvent, HealthMonitorOptions } from './health-monitor.js'
```

**Step 3: Export from lib.ts**

In `packages/core/src/lib.ts`, update line 4:

```typescript
// Plugin base types
export type { Plugin, PluginType, PluginState, HealthResult, PluginStatus } from './plugin/index.js'
export { HealthMonitor } from './plugin/index.js'
export type { HealthSnapshot, HealthChangedEvent, HealthMonitorOptions } from './plugin/index.js'
```

**Step 4: Build core**

Run: `cd packages/core && npm run build`
Expected: Clean build, no errors

**Step 5: Commit**

```bash
git add packages/core/src/plugin/health-monitor.ts packages/core/src/plugin/index.ts packages/core/src/lib.ts
git commit -m "feat(plugin): add HealthMonitor service"
```

---

### Task 4: Idempotency Fix — OllamaEmbeddingsPlugin.initialize()

**Files:**
- Modify: `packages/core/src/memory/embeddings/ollama.ts:67`

**Step 1: Add early return guard**

In `packages/core/src/memory/embeddings/ollama.ts`, at the top of `initialize()` (line 67):

```typescript
async initialize(_options?: InitializeOptions): Promise<void> {
  if (this.ready) return // Already initialized — idempotent guard

  // Check server is reachable
  const healthResult = await this.healthCheck()
  // ... rest unchanged
```

**Step 2: Build and verify**

Run: `cd packages/core && npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/core/src/memory/embeddings/ollama.ts
git commit -m "fix(ollama): make initialize() idempotent to prevent race conditions"
```

---

### Task 5: ChannelManager — Add `getPlugins()`

**Files:**
- Modify: `packages/dashboard/src/channels/manager.ts` (add method after `checkAllHealth()`, around line 379)

**Step 1: Add getPlugins method**

Add to `ChannelManager` class, after the `checkAllHealth()` method:

```typescript
  /**
   * Get all channel plugin instances (for unified health monitoring).
   */
  getPlugins(): ChannelPlugin[] {
    return Array.from(this.channels.values()).map((entry) => entry.plugin);
  }
```

Note: The import for `ChannelPlugin` is already present at line 10. The return type uses `ChannelPlugin` which extends `Plugin`, so it satisfies `Plugin[]` consumers.

**Step 2: Type check**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/dashboard/src/channels/manager.ts
git commit -m "feat(channels): expose getPlugins() for unified health monitoring"
```

---

### Task 6: Dashboard Wiring — Replace Liveness Loop with HealthMonitor

**Files:**
- Modify: `packages/dashboard/src/index.ts:1-22` (imports)
- Modify: `packages/dashboard/src/index.ts:482-554` (replace liveness loop)
- Modify: `packages/dashboard/src/index.ts:591-595` (shutdown handler)

This is the most complex task. It replaces the inline `setInterval` liveness loop with HealthMonitor.

**Step 1: Add HealthMonitor import**

In `packages/dashboard/src/index.ts`, add `HealthMonitor` to the core imports (line 1):

```typescript
import {
  findAgentDir,
  resolveAuth,
  isHatched,
  loadConfig,
  toDisplayStatus,
  CalendarScheduler,
  createCalDAVClient,
  loadCalendarConfig,
  loadCalendarCredentials,
  NotificationService,
  // Memory system (M6-S2)
  MemoryDb,
  SyncService,
  SearchService,
  PluginRegistry,
  LocalEmbeddingsPlugin,
  OllamaEmbeddingsPlugin,
  initNotebook,
  migrateToNotebook,
  needsMigration,
  // Health monitoring
  HealthMonitor,
} from "@my-agent/core";
```

**Step 2: Replace liveness loop (lines 482-554)**

Delete the entire block from `// Periodic liveness check` (line 482) through `}, 60_000);` (line 553) and `livenessCheckTimer` / `livenessRunning` variable declarations.

Replace with:

```typescript
  // Unified health monitoring — polls all plugins at configurable intervals
  let healthMonitor: HealthMonitor | null = null;
  if (pluginRegistry && memoryDb && syncService) {
    healthMonitor = new HealthMonitor({
      defaultIntervalMs: 60_000,
      healthConfig: config.health,
    });

    // Register embeddings plugins
    for (const plugin of pluginRegistry.list()) {
      healthMonitor.register(plugin);
    }

    // Register channel plugins
    if (channelManager) {
      for (const plugin of channelManager.getPlugins()) {
        healthMonitor.register(plugin);
      }
    }

    // Wire health change events
    healthMonitor.on("health_changed", (event) => {
      if (event.pluginType === "embeddings") {
        if (!event.current.healthy && event.previous?.healthy !== false) {
          // ── Detection: active → degraded ──
          const active = pluginRegistry!.getActive();
          if (active?.id === event.pluginId) {
            pluginRegistry!.setIntended(active.id);
            pluginRegistry!.setDegraded({
              ...event.current,
              since: event.current.since ?? new Date(),
            });
            console.warn(
              `[HealthMonitor] Embeddings plugin ${event.pluginId} failed health check — entering degraded mode`,
            );
          }
        } else if (event.current.healthy && pluginRegistry!.isDegraded()) {
          // ── Recovery: degraded → active ──
          const intendedId = pluginRegistry!.getIntendedPluginId();
          if (intendedId) {
            const plugin = pluginRegistry!.get(intendedId);
            if (plugin) {
              plugin
                .initialize()
                .then(async () => {
                  const isReady = await plugin.isReady();
                  if (isReady) {
                    await pluginRegistry!.setActive(intendedId);
                    const dims = plugin.getDimensions();
                    if (dims && memoryDb) {
                      memoryDb.initVectorTable(dims);
                    }
                    console.log(
                      `[HealthMonitor] Embeddings recovered: ${intendedId} (${plugin.modelName})`,
                    );
                    syncService!.fullSync().catch(() => {});
                  }
                })
                .catch(() => {
                  // Recovery failed — leave degraded, will retry next poll
                });
            }
          }
        }
      }

      if (event.pluginType === "channel") {
        if (!event.current.healthy) {
          console.warn(
            `[HealthMonitor] Channel ${event.pluginId} health check failed`,
          );
        }
      }

      // Broadcast updated health to dashboard
      server.statePublisher?.publishMemory();
    });

    await healthMonitor.start();
    console.log("HealthMonitor started");
  }
```

**Step 3: Update shutdown handler (lines 591-595)**

Replace:

```typescript
      // Stop liveness check
      if (livenessCheckTimer) {
        clearInterval(livenessCheckTimer);
        console.log("Liveness check stopped.");
      }
```

With:

```typescript
      // Stop health monitor
      if (healthMonitor) {
        healthMonitor.stop();
        console.log("HealthMonitor stopped.");
      }
```

**Step 4: Build core first (for HealthMonitor export)**

Run: `cd packages/core && npm run build`
Expected: PASS

**Step 5: Type check dashboard**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: PASS

**Step 6: Run prettier**

Run: `cd /home/nina/my_agent && npx prettier --write packages/dashboard/src/index.ts packages/core/src/plugin/health-monitor.ts packages/core/src/config.ts packages/core/src/types.ts`

**Step 7: Rebuild core after prettier**

Run: `cd packages/core && npm run build`
Expected: PASS

**Step 8: Commit**

```bash
git add packages/dashboard/src/index.ts
git commit -m "feat(dashboard): replace liveness loop with HealthMonitor"
```

---

### Task 7: E2E Verification — Degraded Mode Cycle

**Files:** None (testing only)

**Step 1: Restart dashboard**

```bash
pkill -f "tsx.*dashboard" 2>/dev/null
sleep 1
cd /home/nina/my_agent/packages/dashboard && npm run dev &
sleep 5
```

**Step 2: Verify baseline**

```bash
curl -s http://localhost:4321/api/memory/status | python3 -m json.tool
```

Expected: `embeddings.active.id` = "embeddings-ollama", `embeddings.degraded` = null

**Step 3: Block Ollama**

```bash
sudo iptables -A OUTPUT -d <OLLAMA_HOST> -p tcp --dport 11434 -j REJECT
```

**Step 4: Wait for HealthMonitor detection (up to 60s)**

```bash
sleep 65
curl -s http://localhost:4321/api/memory/status | python3 -m json.tool
```

Expected: `embeddings.active` = null, `embeddings.degraded` is NOT null with `pluginId` = "embeddings-ollama"

**Step 5: Unblock Ollama**

```bash
sudo iptables -D OUTPUT -d <OLLAMA_HOST> -p tcp --dport 11434 -j REJECT
```

**Step 6: Wait for HealthMonitor recovery (up to 60s)**

```bash
sleep 65
curl -s http://localhost:4321/api/memory/status | python3 -m json.tool
```

Expected: `embeddings.active.id` = "embeddings-ollama", `embeddings.degraded` = null

**Step 7: Verify search works**

```bash
curl -s 'http://localhost:4321/api/memory/search?q=test' | python3 -m json.tool
```

Expected: Results returned, no `degraded` field

---
