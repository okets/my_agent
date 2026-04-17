/**
 * cfr-helpers.ts — Convenience factories for TriggeringOrigin.
 * Created in M9.6-S9. Used by emit sites that construct TriggeringInput.
 */

import type { ChannelContext, TriggeringOrigin } from "./cfr-types.js";

/**
 * Build a conversation-kind TriggeringOrigin from its component parts.
 * Every emit site in chat-service and orphan-watchdog uses this helper.
 */
export function conversationOrigin(
  channel: ChannelContext,
  conversationId: string,
  turnNumber: number,
): TriggeringOrigin {
  return { kind: "conversation", channel, conversationId, turnNumber };
}
