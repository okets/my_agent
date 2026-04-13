/**
 * Conversation Initiator — Bridge between Working Agent and Conversation Agent
 *
 * "Working agent does the work, Conversation agent presents it."
 *
 * Two primitives:
 * - alert(): Inject a system prompt into the current conversation
 * - initiate(): Start a new conversation on a specific channel
 *
 * Routing follows the M10-S0 presence rule: last user turn's channel if
 * within threshold, else preferred outbound channel. Delivery failures are
 * surfaced via the AlertResult return type so callers (heartbeat) can retry
 * instead of silently dropping.
 */

import type { ConversationManager } from "../conversations/manager.js";
import type { Conversation } from "../conversations/types.js";
import type { ChatEvent, SystemMessageOptions } from "../chat/types.js";

/**
 * Minimal chat service interface for system-initiated brain invocation.
 */
export interface ChatServiceLike {
  sendSystemMessage(
    conversationId: string,
    prompt: string,
    turnNumber: number,
    options?: SystemMessageOptions,
  ): AsyncGenerator<ChatEvent>;
}

/**
 * Minimal transport manager interface for sending messages.
 */
export interface TransportManagerLike {
  send(
    transportId: string,
    to: string,
    message: { content: string },
  ): Promise<void>;

  /** Get transport config to look up ownerJid */
  getTransportConfig(id: string): { ownerJid?: string } | undefined;

  /** Get transport info to check connection status */
  getTransportInfos(): Array<{
    id: string;
    plugin?: string;
    statusDetail?: { connected: boolean };
  }>;
}

export interface ConversationInitiatorOptions {
  conversationManager: ConversationManager;
  chatService: ChatServiceLike;
  channelManager: TransportManagerLike;
  getOutboundChannel: () => string;
  activityThresholdMinutes?: number;
}

/**
 * Outcome of `alert()`. Three distinguishable states so callers can decide
 * whether to retry (`transport_failed`), fall back to `initiate()`
 * (`no_conversation`), or treat the notification as handled (`delivered`).
 */
export type AlertResult =
  | { status: "delivered" }
  | { status: "no_conversation" }
  | { status: "transport_failed"; reason: string };

const DEFAULT_THRESHOLD_MINUTES = 15;

export class ConversationInitiator {
  private conversationManager: ConversationManager;
  private chatService: ChatServiceLike;
  private channelManager: TransportManagerLike;
  private getOutboundChannel: () => string;
  private thresholdMinutes: number;

  constructor(options: ConversationInitiatorOptions) {
    this.conversationManager = options.conversationManager;
    this.chatService = options.chatService;
    this.channelManager = options.channelManager;
    this.getOutboundChannel = options.getOutboundChannel;
    this.thresholdMinutes =
      options.activityThresholdMinutes ?? DEFAULT_THRESHOLD_MINUTES;
  }

  /**
   * Deliver a system notification (Working Nina escalation) to the current
   * conversation, applying the M10-S0 routing presence rule:
   *
   *   targetChannel =
   *     last user turn within threshold  → that turn's channel
   *     otherwise                        → preferred outbound channel
   *
   * Channel is transport, not identity. There is no source-channel input:
   * the rule depends only on conversation history and operator preference.
   */
  async alert(
    prompt: string,
    options?: { triggerJobId?: string },
  ): Promise<AlertResult> {
    const current = await this.conversationManager.getCurrent();
    if (!current) {
      console.warn(
        "[ConversationInitiator] alert() — no current conversation exists",
      );
      return { status: "no_conversation" };
    }

    const last = await this.conversationManager.getLastUserTurn(current.id);
    const within =
      last !== null &&
      Date.now() - new Date(last.timestamp).getTime() <
        this.thresholdMinutes * 60 * 1000;
    const preferred = this.getOutboundChannel();
    const targetChannel = within
      ? (last!.channel ?? "web")
      : preferred || "web";

    // Web delivery: no external transport involved, no forward.
    if (!targetChannel || targetChannel === "web") {
      for await (const _event of this.chatService.sendSystemMessage(
        current.id,
        prompt,
        (current.turnCount ?? 0) + 1,
        { triggerJobId: options?.triggerJobId },
      )) {
        // consume events (turn saving + broadcasting handled by sendSystemMessage)
      }
      return { status: "delivered" };
    }

    // External channel target. Resolve transport + ownerJid upfront so that a
    // disconnected transport bubbles up as transport_failed BEFORE we either
    // write an assistant turn or demote the current conversation.
    const { ownerJid, resolvedChannelId } =
      this.resolveOutboundInfo(targetChannel);
    if (!ownerJid || !resolvedChannelId) {
      console.warn(
        `[ConversationInitiator] target channel "${targetChannel}" not available — deferring delivery`,
      );
      return {
        status: "transport_failed",
        reason: `${targetChannel} not connected`,
      };
    }

    const isSameChannel =
      !!current.externalParty && current.externalParty === ownerJid;

    if (!isSameChannel) {
      // Channel switch — new conversation on the presence-rule target, NOT
      // on the preferred channel. Pass the channel explicitly so initiate()
      // doesn't silently fall back to `getOutboundChannel()`.
      await this.initiate({
        firstTurnPrompt: `[SYSTEM: ${prompt}]`,
        channel: targetChannel,
      });
      return { status: "delivered" };
    }

    let response = "";
    for await (const event of this.chatService.sendSystemMessage(
      current.id,
      prompt,
      (current.turnCount ?? 0) + 1,
      { channel: targetChannel, triggerJobId: options?.triggerJobId },
    )) {
      if (event.type === "text_delta" && event.text) {
        response += event.text;
      }
    }
    const forward = await this.forwardToChannel(response, targetChannel);
    if (!forward.delivered) {
      return {
        status: "transport_failed",
        reason: forward.reason ?? "forward failed",
      };
    }
    return { status: "delivered" };
  }

  /**
   * Start a new conversation on the given channel (or the preferred outbound
   * channel if no override is supplied). The conversation agent speaks first.
   *
   * Callers invoking this as the channel-switch branch of `alert()` should
   * pass the presence-rule target explicitly — otherwise the new conversation
   * lands on the preferred channel, which may differ from the target.
   */
  async initiate(options?: {
    firstTurnPrompt?: string;
    channel?: string;
  }): Promise<Conversation> {
    const { ownerJid, resolvedChannelId } = this.resolveOutboundInfo(
      options?.channel,
    );

    // Harden: if the caller explicitly asked for a non-web channel and it's
    // unavailable, fail loud rather than silently creating a web-only
    // conversation on the "wrong" channel. alert()'s upfront connectivity
    // check means this path is unreachable today; this guards future callers.
    if (
      options?.channel &&
      options.channel !== "web" &&
      !resolvedChannelId
    ) {
      throw new Error(
        `initiate(): requested channel "${options.channel}" is not connected`,
      );
    }

    const conv = await this.conversationManager.create({
      externalParty: ownerJid ?? undefined,
    });

    const prompt =
      options?.firstTurnPrompt ||
      "[SYSTEM: You are reaching out to the user proactively. You are the conversation layer — explain briefly why you're messaging them. If you don't have a specific reason, let them know you're available.]";

    let response = "";
    for await (const event of this.chatService.sendSystemMessage(
      conv.id,
      prompt,
      1,
      { channel: resolvedChannelId ?? undefined },
    )) {
      if (event.type === "text_delta" && event.text) {
        response += event.text;
      }
    }

    if (response && resolvedChannelId) {
      await this.forwardToChannel(response, resolvedChannelId);
    }

    return conv;
  }

  // === Private helpers ===

  /**
   * Resolve a transport ID and owner JID for the given channel name.
   * Defaults to the preferred outbound channel when no override is supplied.
   * Returns nulls if the channel is "web", unknown, or disconnected.
   */
  private resolveOutboundInfo(channelOverride?: string): {
    ownerJid: string | null;
    resolvedChannelId: string | null;
  } {
    const channelId = channelOverride ?? this.getOutboundChannel();
    if (channelId === "web" || !channelId) {
      return { ownerJid: null, resolvedChannelId: null };
    }

    const channels = this.channelManager.getTransportInfos();
    const PLUGIN_MAP: Record<string, string> = { whatsapp: "baileys" };
    const pluginName = PLUGIN_MAP[channelId] || channelId;
    const channel = channels.find(
      (c) => c.id === channelId || c.plugin === pluginName,
    );
    if (!channel?.statusDetail?.connected) {
      return { ownerJid: null, resolvedChannelId: null };
    }

    const config = this.channelManager.getTransportConfig(channel.id);
    return {
      ownerJid: config?.ownerJid ?? null,
      resolvedChannelId: channel.id,
    };
  }

  /**
   * Send a message via the given channel (or preferred outbound channel).
   * Returns `delivered: false` with a reason when the transport is
   * disconnected, has no ownerJid, or `send()` throws — so callers can
   * retry rather than silently report success.
   */
  async forwardToChannel(
    content: string,
    channelOverride?: string,
  ): Promise<{ delivered: boolean; reason?: string }> {
    const channelId = channelOverride ?? this.getOutboundChannel();
    if (channelId === "web" || !channelId) {
      // Web "forward" is a no-op — chat.sendSystemMessage already broadcast.
      return { delivered: true };
    }

    try {
      const channels = this.channelManager.getTransportInfos();
      const PLUGIN_MAP: Record<string, string> = { whatsapp: "baileys" };
      const pluginName = PLUGIN_MAP[channelId] || channelId;
      const channel = channels.find(
        (c) => c.id === channelId || c.plugin === pluginName,
      );
      if (!channel?.statusDetail?.connected) {
        const reason = `${channelId} not connected`;
        console.warn(`[ConversationInitiator] ${reason}`);
        return { delivered: false, reason };
      }

      const resolvedId = channel.id;
      const config = this.channelManager.getTransportConfig(resolvedId);
      const ownerJid = config?.ownerJid;
      if (!ownerJid) {
        const reason = `no ownerJid for ${channelId}`;
        console.warn(`[ConversationInitiator] ${reason}`);
        return { delivered: false, reason };
      }

      await this.channelManager.send(resolvedId, ownerJid, { content });
      return { delivered: true };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[ConversationInitiator] send via ${channelId} threw: ${reason}`,
      );
      return { delivered: false, reason };
    }
  }
}
