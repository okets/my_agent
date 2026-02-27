/**
 * Channel System — Type Definitions
 *
 * Core types for the channel plugin interface, message routing,
 * and resilience configuration.
 */

// ─────────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────────

/** Simple display status for UI rendering */
export type ChannelDisplayStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'logged_out'

/** Rich status object emitted by plugins and tracked by manager */
export interface ChannelStatus {
  running: boolean
  connected: boolean
  reconnectAttempts: number
  lastConnectedAt: Date | null
  lastDisconnect: {
    at: Date
    status: ChannelDisplayStatus
    error?: string
    loggedOut?: boolean
  } | null
  lastMessageAt: Date | null
  lastEventAt: Date | null
  lastError: string | null
}

/** Convert rich status to display status for UI */
export function toDisplayStatus(status: ChannelStatus): ChannelDisplayStatus {
  if (status.lastDisconnect?.loggedOut) return 'logged_out'
  if (status.lastError && !status.connected) return 'error'
  if (status.connected) return 'connected'
  if (status.running && !status.connected) return 'connecting'
  return 'disconnected'
}

/** Create a fresh initial status */
export function initialStatus(): ChannelStatus {
  return {
    running: false,
    connected: false,
    reconnectAttempts: 0,
    lastConnectedAt: null,
    lastDisconnect: null,
    lastMessageAt: null,
    lastEventAt: null,
    lastError: null,
  }
}

// ─────────────────────────────────────────────────────────────────
// Resilience Configuration
// ─────────────────────────────────────────────────────────────────

/** Exponential backoff reconnect policy */
export interface ReconnectPolicy {
  initialMs: number
  maxMs: number
  factor: number
  jitter: number
  maxAttempts: number
}

/** Watchdog timer configuration */
export interface WatchdogConfig {
  enabled: boolean
  checkIntervalMs: number
  timeoutMs: number
}

// ─────────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────────

/** Incoming message from an external channel */
export interface IncomingMessage {
  /** Unique message ID (from the platform) */
  id: string
  /** Sender identity (phone number, email, etc.) */
  from: string
  /** Message text content */
  content: string
  /** When the message was sent */
  timestamp: Date
  /** Channel instance ID */
  channelId: string
  /** Thread ID for email threading */
  threadId?: string
  /** Group ID for group chats */
  groupId?: string
  /** File attachments */
  attachments?: ChannelAttachment[]
  /** Display name of the sender */
  senderName?: string
  /** Display name of the group */
  groupName?: string
  /** Reply context */
  replyTo?: {
    messageId: string
    sender?: string
    text?: string
  }
}

/** Outgoing message to an external channel */
export interface OutgoingMessage {
  /** Message text content */
  content: string
  /** Message ID to reply to */
  replyTo?: string
  /** File attachments */
  attachments?: ChannelAttachment[]
}

/** File attachment in channel messages */
export interface ChannelAttachment {
  filename: string
  mimeType: string
  data: Buffer
}

// ─────────────────────────────────────────────────────────────────
// Plugin Interface
// ─────────────────────────────────────────────────────────────────

/** Configuration for a channel instance */
export interface ChannelInstanceConfig {
  /** Instance ID (e.g., "baileys_agent_main") */
  id: string
  /** Plugin name (e.g., "baileys", "mock") */
  plugin: string
  /** Channel role */
  role: 'dedicated' | 'personal'
  /** Display identity (phone, email, etc.) */
  identity: string
  /** Message processing mode */
  processing: 'immediate' | 'on_demand'
  /** Owner for personal channels */
  owner?: string
  /** Escalation policy name (S3) */
  escalation?: string
  /** Permissions for personal channels (S3) */
  permissions?: string[]
  /** Plugin-specific auth directory */
  authDir?: string
  /** Reconnect policy overrides */
  reconnect?: Partial<ReconnectPolicy>
  /** Watchdog config overrides */
  watchdog?: Partial<WatchdogConfig>
  /** Message debounce window in ms (0 = disabled) */
  debounceMs?: number
  /** Owner identities — normalized IDs for matching incoming messages */
  ownerIdentities?: string[]
  /** Owner JID — full JID for outbound messaging (e.g., "phone@s.whatsapp.net") */
  ownerJid?: string
  /** Plugin-specific config */
  [key: string]: unknown
}

/** Channel plugin interface — implemented by each channel type */
export interface ChannelPlugin {
  /** Plugin name (e.g., "mock", "baileys") */
  name: string
  /** SVG icon string (viewBox="0 0 24 24") */
  icon: string
  /** Initialize plugin with instance config */
  init(config: ChannelInstanceConfig): Promise<void>
  /** Connect to the external service */
  connect(): Promise<void>
  /** Disconnect from the external service */
  disconnect(): Promise<void>
  /** Send a message to a recipient */
  send(to: string, message: OutgoingMessage): Promise<void>
  /** Register event handlers */
  on(event: 'message', handler: (msg: IncomingMessage) => void): void
  on(event: 'error', handler: (err: Error) => void): void
  on(event: 'status', handler: (status: ChannelStatus) => void): void
  on(event: 'qr', handler: (qrDataUrl: string) => void): void
  /** Get current status */
  status(): ChannelStatus
  /** Optional active liveness probe — returns true if the channel is healthy */
  healthCheck?(): Promise<boolean>
}

/** Factory function to create a plugin instance */
export type PluginFactory = (config: ChannelInstanceConfig) => ChannelPlugin

// ─────────────────────────────────────────────────────────────────
// Channel Info (exposed to frontend)
// ─────────────────────────────────────────────────────────────────

/** Channel info for REST API and WebSocket broadcasts */
export interface ChannelInfo {
  /** Instance ID */
  id: string
  /** Plugin name */
  plugin: string
  /** Channel role */
  role: 'dedicated' | 'personal'
  /** Display identity */
  identity: string
  /** Simple display status */
  status: ChannelDisplayStatus
  /** Rich status detail */
  statusDetail: ChannelStatus
  /** SVG icon string */
  icon: string
}
