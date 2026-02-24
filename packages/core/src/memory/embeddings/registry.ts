/**
 * Embeddings Plugin Registry
 * Manages embedding providers and active plugin selection.
 *
 * @module memory/embeddings/registry
 */

import type { EmbeddingsPlugin, EmbeddingsConfig } from './types.js'

export class PluginRegistry {
  private plugins = new Map<string, EmbeddingsPlugin>()
  private activePluginId: string | null = null
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
