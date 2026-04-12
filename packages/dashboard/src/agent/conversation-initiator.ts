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
   * Deliver a system notification to the current conversation.
   *
   * Always finds the current conversation (there's always one, unless fresh install).
   * Uses web recency to decide delivery channel:
   * - Last web message < threshold: deliver via web (app.chat broadcasts to WS clients)
   * - Last web message > threshold: deliver via preferred channel (WhatsApp)
   *
   * Channel switches (web→WhatsApp) trigger a new conversation per the asymmetric rule.
   *
   * Returns true if delivered, false only if no current conversation exists.
   */
  async alert(
    prompt: string,
    options?: { sourceChannel?: string; triggerJobId?: string },
  ): Promise<boolean> {
    const current = await this.conversationManager.getCurrent();
    if (!current) {
      console.warn(
        "[ConversationInitiator] alert() — no current conversation exists",
      );
      return false;
    }

    // Channel decision: is the user on the web?
    const webAge = await this.getLastWebMessageAge(current.id);
    const useWeb = webAge !== null && webAge < this.thresholdMinutes;

    // Dashboard-sourced actions always stay on web — never route to WhatsApp
    const isDashboardSourced = options?.sourceChannel === "dashboard";

    if (useWeb || isDashboardSourced) {
      // Deliver via app.chat — broadcasts to all WS clients automatically
      for await (const event of this.chatService.sendSystemMessage(
        current.id,
        prompt,
        (current.turnCount ?? 0) + 1,
        { triggerJobId: options?.triggerJobId },
      )) {
        // consume events (turn saving + broadcasting handled by sendSystemMessage)
      }
      return true;
    }

    // User not on web — deliver via preferred channel
    const outboundChannel = this.getOutboundChannel();
    if (!outboundChannel || outboundChannel === "web") {
      // Web-only user, but they haven't messaged recently. Still deliver via web.
      for await (const event of this.chatService.sendSystemMessage(
        current.id,
        prompt,
        (current.turnCount ?? 0) + 1,
        { triggerJobId: options?.triggerJobId },
      )) {
        // consume events
      }
      return true;
    }

    // Check if this is a channel switch (web→WhatsApp).
    // Conversations without externalParty are web-only; those with externalParty
    // are already bound to an external channel. Compare with resolved ownerJid
    // (not channel name) since externalParty is a JID like "123@s.whatsapp.net".
    const { ownerJid } = this.resolveOutboundInfo();
    const isCurrentOnWeb = !current.externalParty;
    const isSameChannel = !isCurrentOnWeb && current.externalParty === ownerJid;
    const needsNewConversation = !isSameChannel;

    if (needsNewConversation) {
      // Channel switch: create new conversation on preferred channel
      await this.initiate({ firstTurnPrompt: `[SYSTEM: ${prompt}]` });
    } else {
      // Same channel: continue current conversation via app.chat
      let response = "";
      for await (const event of this.chatService.sendSystemMessage(
        current.id,
        prompt,
        (current.turnCount ?? 0) + 1,
        { channel: outboundChannel, triggerJobId: options?.triggerJobId },
      )) {
        if (event.type === "text_delta" && event.text) {
          response += event.text;
        }
      }
      // Forward to external channel
      await this.forwardToChannel(response, outboundChannel);
    }

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
   * Resolve the outbound channel's transport ID and owner JID.
   */
  private resolveOutboundInfo(): {
    ownerJid: string | null;
    resolvedChannelId: string | null;
  } {
    const channelId = this.getOutboundChannel();
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

  /**
   * Get the age (in minutes) of the most recent user message on the web channel.
   * Returns null if no web user messages exist in the conversation.
   *
   * Web messages are identified by having no `channel` field or `channel === 'web'`.
   */
  private async getLastWebMessageAge(
    conversationId: string,
  ): Promise<number | null> {
    const SEARCH_DEPTH = 50;
    const recentTurns = await this.conversationManager.getRecentTurns(
      conversationId,
      SEARCH_DEPTH,
    );

    // Find the most recent user turn from web (no channel = web, or channel === 'web')
    const lastWebUserTurn = recentTurns
      .filter(
        (t) =>
          t.role === "user" && (!t.channel || t.channel === "web"),
      )
      .at(-1); // getRecentTurns returns oldest-first, so last = most recent

    if (!lastWebUserTurn) return null;

    const ageMs = Date.now() - new Date(lastWebUserTurn.timestamp).getTime();
    return ageMs / (60 * 1000);
  }
}
