import type { TransportConfig } from './transports/types.js'
import type { ChannelBinding } from './channels/types.js'

export interface HealthConfig {
  defaults?: { intervalMs?: number }
  plugins?: Record<string, { intervalMs?: number }>
}

export interface BrainConfig {
  model: string
  brainDir: string
  transports: Record<string, TransportConfig>
  channels: ChannelBinding[]
  health?: HealthConfig
}
