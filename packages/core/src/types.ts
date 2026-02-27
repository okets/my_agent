import type { ChannelInstanceConfig } from './channels/types.js'

export interface HealthConfig {
  defaults?: { intervalMs?: number }
  plugins?: Record<string, { intervalMs?: number }>
}

export interface BrainConfig {
  model: string
  brainDir: string
  channels: Record<string, ChannelInstanceConfig>
  health?: HealthConfig
}
