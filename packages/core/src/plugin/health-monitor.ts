/**
 * HealthMonitor — polls all registered plugins at configurable intervals
 * and emits 'health_changed' events on state transitions.
 *
 * Observation-only: does NOT perform recovery. Consumers wire recovery logic
 * in their event handlers.
 *
 * @module plugin/health-monitor
 */

import { EventEmitter } from 'node:events'
import type { Plugin, HealthResult, PluginType } from './types.js'
import type { HealthConfig } from '../types.js'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

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

export interface HealthMonitorOptions {
  defaultIntervalMs?: number
  healthConfig?: HealthConfig
}

const DEFAULT_INTERVAL_MS = 60_000

// ─────────────────────────────────────────────────────────────────
// HealthMonitor
// ─────────────────────────────────────────────────────────────────

interface PluginEntry {
  plugin: Plugin
  timer: ReturnType<typeof setInterval> | null
  snapshot: HealthSnapshot | null
  checking: boolean
}

export class HealthMonitor extends EventEmitter {
  private plugins = new Map<string, PluginEntry>()
  private defaultIntervalMs: number
  private healthConfig: HealthConfig | undefined
  private running = false

  constructor(options?: HealthMonitorOptions) {
    super()
    this.defaultIntervalMs = options?.defaultIntervalMs ?? DEFAULT_INTERVAL_MS
    this.healthConfig = options?.healthConfig
  }

  /** Register a plugin for health monitoring. Auto-starts polling if already running. */
  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.id)) return

    const entry: PluginEntry = {
      plugin,
      timer: null,
      snapshot: null,
      checking: false,
    }
    this.plugins.set(plugin.id, entry)

    if (this.running) {
      // Establish baseline first (no event emitted), then start polling
      entry.plugin
        .healthCheck()
        .then((health) => {
          entry.snapshot = { health, checkedAt: new Date() }
        })
        .catch(() => {
          entry.snapshot = {
            health: { healthy: false, message: 'Initial health check failed' },
            checkedAt: new Date(),
          }
        })
        .finally(() => {
          this.startPolling(entry)
        })
    }
  }

  /** Unregister a plugin and stop its timer. */
  unregister(pluginId: string): void {
    const entry = this.plugins.get(pluginId)
    if (!entry) return
    if (entry.timer) clearInterval(entry.timer)
    this.plugins.delete(pluginId)
  }

  /** Start monitoring — establishes baseline then begins periodic polling. */
  async start(): Promise<void> {
    this.running = true

    // Establish baselines (no events emitted)
    await Promise.allSettled(
      Array.from(this.plugins.values()).map(async (entry) => {
        try {
          const health = await entry.plugin.healthCheck()
          entry.snapshot = { health, checkedAt: new Date() }
        } catch {
          entry.snapshot = {
            health: { healthy: false, message: 'Initial health check failed' },
            checkedAt: new Date(),
          }
        }
      }),
    )

    // Start per-plugin timers
    for (const entry of this.plugins.values()) {
      this.startPolling(entry)
    }
  }

  /** Stop all timers. */
  stop(): void {
    this.running = false
    for (const entry of this.plugins.values()) {
      if (entry.timer) {
        clearInterval(entry.timer)
        entry.timer = null
      }
    }
  }

  /** Get current health snapshot for a plugin. */
  getHealth(pluginId: string): HealthSnapshot | null {
    return this.plugins.get(pluginId)?.snapshot ?? null
  }

  /** Get all current health snapshots. */
  getAllHealth(): Map<string, HealthSnapshot> {
    const result = new Map<string, HealthSnapshot>()
    for (const [id, entry] of this.plugins) {
      if (entry.snapshot) result.set(id, entry.snapshot)
    }
    return result
  }

  // ─────────────────────────────────────────────────────────────

  private startPolling(entry: PluginEntry): void {
    const intervalMs = this.resolveInterval(entry.plugin)

    entry.timer = setInterval(() => {
      this.pollPlugin(entry).catch(() => {})
    }, intervalMs)
  }

  private async pollPlugin(entry: PluginEntry): Promise<void> {
    if (entry.checking) return // Reentrancy guard
    entry.checking = true
    try {
      const health = await entry.plugin.healthCheck()
      const now = new Date()
      const previous = entry.snapshot?.health ?? null

      entry.snapshot = { health, checkedAt: now }

      // Emit if health state changed
      if (this.hasChanged(previous, health)) {
        const event: HealthChangedEvent = {
          pluginId: entry.plugin.id,
          pluginType: entry.plugin.type,
          pluginName: entry.plugin.name,
          previous,
          current: health,
          checkedAt: now,
        }
        this.emit('health_changed', event)
      }
    } catch {
      // healthCheck threw — treat as unhealthy
      const now = new Date()
      const previous = entry.snapshot?.health ?? null
      const health: HealthResult = { healthy: false, message: 'Health check threw an exception' }
      entry.snapshot = { health, checkedAt: now }

      if (this.hasChanged(previous, health)) {
        this.emit('health_changed', {
          pluginId: entry.plugin.id,
          pluginType: entry.plugin.type,
          pluginName: entry.plugin.name,
          previous,
          current: health,
          checkedAt: now,
        } satisfies HealthChangedEvent)
      }
    } finally {
      entry.checking = false
    }
  }

  /** Resolve polling interval for a plugin (config > plugin > defaults > hardcoded). */
  private resolveInterval(plugin: Plugin): number {
    // 1. Config override per-plugin
    const configOverride = this.healthConfig?.plugins?.[plugin.id]?.intervalMs
    if (configOverride !== undefined) return configOverride

    // 2. Plugin property
    if (plugin.healthCheckIntervalMs !== undefined) return plugin.healthCheckIntervalMs

    // 3. Config default
    const configDefault = this.healthConfig?.defaults?.intervalMs
    if (configDefault !== undefined) return configDefault

    // 4. Constructor default
    return this.defaultIntervalMs
  }

  /** Check if health result has meaningfully changed. */
  private hasChanged(previous: HealthResult | null, current: HealthResult): boolean {
    if (previous === null) return true
    if (previous.healthy !== current.healthy) return true
    if (previous.message !== current.message) return true
    if (previous.resolution !== current.resolution) return true
    return false
  }
}
