/**
 * Plugin Base Types
 *
 * Unified interface that all plugin types (channels, embeddings, etc.) extend.
 * Standardizes identity, health checking, and status reporting across the system.
 *
 * @module plugin/types
 */

// ─────────────────────────────────────────────────────────────────
// Plugin Type & State
// ─────────────────────────────────────────────────────────────────

export type PluginType = 'channel' | 'embeddings' | string

export type PluginState =
  | 'active' // Healthy and operational
  | 'degraded' // Was active, now unhealthy
  | 'connecting' // Starting up
  | 'disconnected' // Cleanly stopped
  | 'error' // Failed, not recovering

// ─────────────────────────────────────────────────────────────────
// Health & Status
// ─────────────────────────────────────────────────────────────────

export interface HealthResult {
  healthy: boolean
  message?: string // "Ollama unreachable"
  resolution?: string // "Start the Docker container"
  since?: Date // When this state started
}

export interface PluginStatus {
  state: PluginState
  lastHealthCheck?: Date
  error?: string
  detail?: Record<string, unknown> // Plugin-specific extras
}

// ─────────────────────────────────────────────────────────────────
// Plugin Base Interface
// ─────────────────────────────────────────────────────────────────

export interface Plugin {
  readonly id: string
  readonly name: string
  readonly type: PluginType
  readonly icon: string // SVG string (viewBox="0 0 24 24")
  healthCheck(): Promise<HealthResult>
  status(): PluginStatus
}
