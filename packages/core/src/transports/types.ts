/**
 * Transport System — Type Definitions
 *
 * Core types for the transport plugin interface, message routing,
 * and resilience configuration.
 */

import type { Plugin, HealthResult, PluginStatus } from '../plugin/types.js'

// ─────────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────────

/** Simple display status for UI rendering */
export type TransportDisplayStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'logged_out'

/** Rich status object emitted by plugins and tracked by manager */
export interface TransportStatus {
  running: boolean
  connected: boolean
  reconnectAttempts: number
  lastConnectedAt: Date | null
  lastDisconnect: {
    at: Date
    status: TransportDisplayStatus
    error?: string
    loggedOut?: boolean
  } | null
  lastMessageAt: Date | null
  lastEventAt: Date | null
  lastError: string | null
}

/** Convert rich status to display status for UI */
export function toDisplayStatus(status: TransportStatus): TransportDisplayStatus {
  if (status.lastDisconnect?.loggedOut) return 'logged_out'
  if (status.lastError && !status.connected) return 'error'
  if (status.connected) return 'connected'
  if (status.running && !status.connected) return 'connecting'
  return 'disconnected'
}

/** Create a fresh initial status */
export function initialStatus(): TransportStatus {
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

// ─────────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────────

/** Incoming message from an external transport */
export interface IncomingMessage {
  /** Unique message ID (from the platform) */
  id: string
  /** Sender identity (phone number, email, etc.) */
  from: string
  /** Message text content */
  content: string
  /** When the message was sent */
  timestamp: Date
  /** Transport instance ID */
  channelId: string
  /** Thread ID for email threading */
  threadId?: string
  /** Group ID for group chats */
  groupId?: string
  /** File attachments */
  attachments?: TransportAttachment[]
  /** Display name of the sender */
  senderName?: string
  /** Display name of the group */
  groupName?: string
  /** Whether this message is a voice note (audio message with ptt flag) */
  isVoiceNote?: boolean
  /** Language detected by STT (e.g. "he", "en") — only set for transcribed voice notes */
  detectedLanguage?: string
  /** Raw audio attachment for voice notes — transports pass raw audio, app layer transcribes */
  audioAttachment?: { buffer: Buffer; mimeType: string }
  /** Reply context */
  replyTo?: {
    messageId: string
    sender?: string
    text?: string
  }
}

/** Outgoing message to an external transport */
export interface OutgoingMessage {
  /** Message text content */
  content: string
  /** Message ID to reply to */
  replyTo?: string
  /** File attachments */
  attachments?: TransportAttachment[]
}

/** File attachment in transport messages */
export interface TransportAttachment {
  filename: string
  mimeType: string
  data: Buffer
}

// ─────────────────────────────────────────────────────────────────
// Plugin Interface
// ─────────────────────────────────────────────────────────────────

/** Configuration for a transport instance */
export interface TransportConfig {
  /** Instance ID (e.g., "baileys_agent_main") */
  id: string
  /** Plugin name (e.g., "baileys", "mock") */
  plugin: string
  /** Transport role */
  role: 'dedicated' | 'personal'
  /** Display identity (phone, email, etc.) */
  identity: string
  /** Message processing mode */
  processing: 'immediate' | 'on_demand'
  /** Owner for personal transports */
  owner?: string
  /** Escalation policy name (S3) */
  escalation?: string
  /** Permissions for personal transports (S3) */
  permissions?: string[]
  /** Plugin-specific auth directory */
  authDir?: string
  /** Reconnect policy overrides */
  reconnect?: Partial<ReconnectPolicy>
  /** Message debounce window in ms (0 = disabled) */
  debounceMs?: number
  /** Owner identities — normalized IDs for matching incoming messages */
  ownerIdentities?: string[]
  /** Owner JID — full JID for outbound messaging (e.g., "phone@s.whatsapp.net") */
  ownerJid?: string
  /** Plugin-specific config */
  [key: string]: unknown
}

/** Transport plugin interface — implemented by each transport type */
export interface TransportPlugin extends Plugin {
  readonly type: 'transport'
  /** Initialize plugin with instance config */
  init(config: TransportConfig): Promise<void>
  /** Connect to the external service */
  connect(): Promise<void>
  /** Disconnect from the external service */
  disconnect(): Promise<void>
  /** Send a message to a recipient */
  send(to: string, message: OutgoingMessage): Promise<void>
  /** Register event handlers */
  on(event: 'message', handler: (msg: IncomingMessage) => void): void
  on(event: 'error', handler: (err: Error) => void): void
  on(event: 'status', handler: (status: TransportStatus) => void): void
  on(event: 'qr', handler: (qrDataUrl: string) => void): void
  /** Get transport-specific rich status (internal detail) */
  transportStatus(): TransportStatus
}

/** Factory function to create a plugin instance */
export type TransportPluginFactory = (config: TransportConfig) => TransportPlugin

// ─────────────────────────────────────────────────────────────────
// Transport Info (exposed to frontend)
// ─────────────────────────────────────────────────────────────────

/** Transport info for REST API and WebSocket broadcasts */
export interface TransportInfo {
  /** Instance ID */
  id: string
  /** Plugin name */
  plugin: string
  /** Transport role */
  role: 'dedicated' | 'personal'
  /** Display identity */
  identity: string
  /** Simple display status */
  status: TransportDisplayStatus
  /** Rich status detail */
  statusDetail: TransportStatus
  /** SVG icon string */
  icon: string
  /** Whether transport has authorized owner(s) */
  hasOwner: boolean
  /** Owner's phone number (if available from JID) */
  ownerNumber?: string
}
