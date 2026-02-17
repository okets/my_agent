import type { ChannelInstanceConfig } from './channels/types.js'

export interface BrainConfig {
  model: string
  brainDir: string
  channels: Record<string, ChannelInstanceConfig>
}
