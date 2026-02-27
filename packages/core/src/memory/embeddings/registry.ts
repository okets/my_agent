/**
 * Embeddings Plugin Registry
 * Manages embedding providers and active plugin selection.
 *
 * @module memory/embeddings/registry
 */

import type { HealthResult } from '../../plugin/types.js'
import type { EmbeddingsPlugin, EmbeddingsConfig } from './types.js'

export class PluginRegistry {
  private plugins = new Map<string, EmbeddingsPlugin>()
  private activePluginId: string | null = null
  private intendedPluginId: string | null = null
  private degradedHealth: HealthResult | null = null
  private config: EmbeddingsConfig

  constructor(config?: EmbeddingsConfig) {
    this.config = config ?? { activePlugin: null, plugins: {} }
    this.activePluginId = this.config.activePlugin
  }

  /**
   * Register a plugin with the registry.
   */
  register(plugin: EmbeddingsPlugin): void {
    this.plugins.set(plugin.id, plugin)
  }

  /**
   * Unregister a plugin.
   */
  unregister(pluginId: string): void {
    this.plugins.delete(pluginId)
    if (this.activePluginId === pluginId) {
      this.activePluginId = null
    }
  }

  /**
   * Get a plugin by ID.
   */
  get(pluginId: string): EmbeddingsPlugin | null {
    return this.plugins.get(pluginId) ?? null
  }

  /**
   * List all registered plugins.
   */
  list(): EmbeddingsPlugin[] {
    return Array.from(this.plugins.values())
  }

  /**
   * Get the currently active plugin.
   * Returns null if no plugin is active or the active plugin isn't registered.
   */
  getActive(): EmbeddingsPlugin | null {
    if (!this.activePluginId) return null
    return this.plugins.get(this.activePluginId) ?? null
  }

  /**
   * Get the active plugin ID.
   */
  getActivePluginId(): string | null {
    return this.activePluginId
  }

  /**
   * Set the active plugin.
   * Does NOT initialize the plugin — call plugin.initialize() separately.
   * On success also records as intended and clears any degraded state.
   * On setActive(null) (user disables), clears intended and degraded state.
   */
  async setActive(pluginId: string | null): Promise<void> {
    if (pluginId !== null && !this.plugins.has(pluginId)) {
      throw new Error(`Plugin not registered: ${pluginId}`)
    }

    // Cleanup previous plugin
    const previousPlugin = this.getActive()
    if (previousPlugin && previousPlugin.id !== pluginId) {
      await previousPlugin.cleanup()
    }

    this.activePluginId = pluginId
    this.config.activePlugin = pluginId

    if (pluginId !== null) {
      this.intendedPluginId = pluginId
      this.degradedHealth = null
    } else {
      this.intendedPluginId = null
      this.degradedHealth = null
    }
  }

  // ─── Degraded Mode ──────────────────────────────────────────────────────

  /**
   * Record the user's intended plugin choice.
   * Persists through degradation so we know what to recover.
   */
  setIntended(pluginId: string | null): void {
    this.intendedPluginId = pluginId
  }

  /**
   * Get the intended plugin ID (what the user chose, even if currently degraded).
   */
  getIntendedPluginId(): string | null {
    return this.intendedPluginId
  }

  /**
   * Mark the registry as degraded.
   * Keeps activePluginId = null so no embed calls happen,
   * but preserves intendedPluginId for recovery.
   */
  setDegraded(health: HealthResult): void {
    this.degradedHealth = health
    this.activePluginId = null
    this.config.activePlugin = null
  }

  /**
   * Clear degraded state (called on recovery).
   */
  clearDegraded(): void {
    this.degradedHealth = null
  }

  /**
   * Get the degraded health result, or null if not degraded.
   */
  getDegradedHealth(): HealthResult | null {
    return this.degradedHealth
  }

  /**
   * Check if the registry is in degraded mode.
   */
  isDegraded(): boolean {
    return this.degradedHealth !== null
  }

  /**
   * Get plugin-specific settings from config.
   */
  getPluginSettings(pluginId: string): Record<string, unknown> {
    return this.config.plugins[pluginId] ?? {}
  }

  /**
   * Set plugin-specific settings.
   */
  setPluginSettings(pluginId: string, settings: Record<string, unknown>): void {
    this.config.plugins[pluginId] = settings
  }

  /**
   * Get the full config for persistence.
   */
  getConfig(): EmbeddingsConfig {
    return {
      activePlugin: this.activePluginId,
      plugins: this.config.plugins,
    }
  }

  /**
   * Load config (e.g., from config.yaml).
   */
  loadConfig(config: EmbeddingsConfig): void {
    this.config = config
    this.activePluginId = config.activePlugin
  }
}

// Singleton instance for global access
let globalRegistry: PluginRegistry | null = null

export function getPluginRegistry(): PluginRegistry {
  if (!globalRegistry) {
    globalRegistry = new PluginRegistry()
  }
  return globalRegistry
}

export function initPluginRegistry(config?: EmbeddingsConfig): PluginRegistry {
  globalRegistry = new PluginRegistry(config)
  return globalRegistry
}
