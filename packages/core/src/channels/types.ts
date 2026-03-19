/**
 * Channel Binding — Type Definitions
 *
 * A channel binding connects a transport to a consumer (owner).
 * Created by authorization — a deliberate act that says
 * "messages from this identity on this transport should reach the brain."
 */

/** Channel binding: maps a transport to an authorized owner */
export interface ChannelBinding {
  /** Binding ID (e.g., "whatsapp_main_binding") */
  id: string
  /** Transport ID this binding is attached to */
  transport: string
  /** Normalized owner identity for matching incoming messages */
  ownerIdentity: string
  /** Full JID for outbound messaging */
  ownerJid: string
  /** Set during re-authorization — channel is suspended, previous owner preserved */
  previousOwner?: string
}
