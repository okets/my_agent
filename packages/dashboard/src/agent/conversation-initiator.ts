/**
 * Conversation Initiator — Bridge between Working Agent and Conversation Agent
 *
 * "Working agent does the work, Conversation agent presents it."
 *
 * Two primitives:
 * - alert(): Inject a system prompt into the current conversation
 * - initiate(): Start a new conversation on the preferred outbound channel
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
   * Channel is transport, not identity. There is no source-channel carve-out:
   * the rule depends only on conversation history and operator preference.
   *
   * Returns true if delivered, false only if no current conversation exists.
   */
  async alert(
    prompt: string,
    options?: { triggerJobId?: string },
  ): Promise<boolean> {
    const current = await this.conversationManager.getCurrent();
    if (!current) {
      console.warn(
        "[ConversationInitiator] alert() — no current conversation exists",
      );
      return false;
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

    // Web delivery: no channel option, no forward.
    if (!targetChannel || targetChannel === "web") {
      for await (const _event of this.chatService.sendSystemMessage(
        current.id,
        prompt,
        (current.turnCount ?? 0) + 1,
        { triggerJobId: options?.triggerJobId },
      )) {
        // consume events (turn saving + broadcasting handled by sendSystemMessage)
      }
      return true;
    }

    // External channel delivery. If the current conversation isn't bound to
    // this channel's owner JID, start a new conversation on the target
    // channel instead of cross-posting (channel switch rule).
    const { ownerJid } = this.resolveOutboundInfo(targetChannel);
    const isSameChannel =
      !!current.externalParty && current.externalParty === ownerJid;

    if (!isSameChannel) {
      await this.initiate({ firstTurnPrompt: `[SYSTEM: ${prompt}]` });
      return true;
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
    await this.forwardToChannel(response, targetChannel);

    return true;
  }

  /**
   * Start a new conversation on the preferred outbound channel.
   * Falls back silently to web if the channel is unavailable.
   * The conversation agent speaks first — no user turn needed.
   */
  async initiate(options?: {
    firstTurnPrompt?: string;
  }): Promise<Conversation> {
    // Resolve outbound channel info so the conversation is reply-matchable
    const { ownerJid, resolvedChannelId } = this.resolveOutboundInfo();

    const conv = await this.conversationManager.create({
      externalParty: ownerJid ?? undefined,
    });

    // Brain speaks first via app.chat — broadcasts to WS clients
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

    // Forward to external channel if applicable
    if (response && resolvedChannelId) {
      await this.forwardToChannel(response);
    }

    return conv;
  }

  // === Private helpers (unchanged from original) ===

  /**
   * Resolve a transport ID and owner JID for the given channel name.
   * Defaults to the preferred outbound channel when no override is supplied.
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
   * Try to send a message via the preferred outbound channel.
   * Silently falls back to web (no send) if channel is unavailable.
   */
  async forwardToChannel(
    content: string,
    channelOverride?: string,
  ): Promise<void> {
    const channelId = channelOverride ?? this.getOutboundChannel();
    if (channelId === "web" || !channelId) return;

    try {
      const channels = this.channelManager.getTransportInfos();
      const PLUGIN_MAP: Record<string, string> = { whatsapp: "baileys" };
      const pluginName = PLUGIN_MAP[channelId] || channelId;
      const channel = channels.find(
        (c) => c.id === channelId || c.plugin === pluginName,
      );
      if (!channel?.statusDetail?.connected) {
        console.warn(
          `[ConversationInitiator] Channel ${channelId} not connected, falling back to web`,
        );
        return;
      }

      const resolvedId = channel.id;
      const config = this.channelManager.getTransportConfig(resolvedId);
      const ownerJid = config?.ownerJid;
      if (!ownerJid) {
        console.warn(
          `[ConversationInitiator] No owner identity for channel ${channelId}, falling back to web`,
        );
        return;
      }

      await this.channelManager.send(resolvedId, ownerJid, { content });
    } catch (err) {
      console.warn(
        `[ConversationInitiator] Failed to send via ${channelId}, falling back to web:`,
        err,
      );
    }
  }

}
