/**
 * Conversation Initiator — Bridge between Working Agent and Conversation Agent
 *
 * "Working agent does the work, Conversation agent presents it."
 *
 * Two primitives:
 * - alert(): Inject a system prompt into the active conversation
 * - initiate(): Start a new conversation on the preferred outbound channel
 */

import type { ConversationManager } from "../conversations/manager.js";
import type { Conversation } from "../conversations/types.js";

/**
 * Adapts per-conversation SessionManager instances to a factory interface.
 * ConversationInitiator doesn't own sessions — it asks the factory for them.
 */
export interface SessionFactory {
  /** Inject a synthetic system turn into an existing conversation's brain session */
  injectSystemTurn(
    conversationId: string,
    prompt: string,
  ): AsyncGenerator<{ type: string; text?: string }>;

  /** Start a brain session for a new conversation (agent speaks first) */
  streamNewConversation(
    conversationId: string,
    prompt?: string,
  ): AsyncGenerator<{ type: string; text?: string }>;

  /** Check if a conversation's session is currently streaming a response */
  isStreaming(conversationId: string): boolean;
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
  sessionFactory: SessionFactory;
  channelManager: TransportManagerLike;
  getOutboundChannel: () => string;
  activityThresholdMinutes?: number;
}

const DEFAULT_THRESHOLD_MINUTES = 15;

export class ConversationInitiator {
  private conversationManager: ConversationManager;
  private sessionFactory: SessionFactory;
  private channelManager: TransportManagerLike;
  private getOutboundChannel: () => string;
  private thresholdMinutes: number;

  constructor(options: ConversationInitiatorOptions) {
    this.conversationManager = options.conversationManager;
    this.sessionFactory = options.sessionFactory;
    this.channelManager = options.channelManager;
    this.getOutboundChannel = options.getOutboundChannel;
    this.thresholdMinutes =
      options.activityThresholdMinutes ?? DEFAULT_THRESHOLD_MINUTES;
  }

  /**
   * Inject a system prompt into the active conversation.
   * Returns true if an active conversation was found and alerted.
   * Returns false (no-op) if no active conversation exists.
   *
   * The synthetic turn is NOT appended to the transcript —
   * only the brain's response is appended as an assistant turn.
   */
  async alert(prompt: string): Promise<boolean> {
    const active = await this.conversationManager.getActiveConversation(
      this.thresholdMinutes,
    );

    if (!active) {
      console.warn(
        "[ConversationInitiator] alert() called but no active conversation found",
      );
      return false;
    }

    // Skip if the session is already streaming (prevents race with user messages or other alerts)
    if (this.sessionFactory.isStreaming(active.id)) {
      console.warn(
        "[ConversationInitiator] Session busy for conversation, falling back to initiate()",
      );
      return false;
    }

    // Collect brain response from synthetic turn
    let response = "";
    for await (const event of this.sessionFactory.injectSystemTurn(
      active.id,
      prompt,
    )) {
      if (event.type === "text" || event.type === "text_delta") {
        if (event.text) response += event.text;
      }
    }

    if (response) {
      // Send via the active conversation's channel, not the global preference
      // Search enough turns back to find the inbound channel, even if assistant
      // turns have accumulated since the last user message
      const CHANNEL_SEARCH_DEPTH = 20;
      const recentTurns = await this.conversationManager.getRecentTurns(
        active.id,
        CHANNEL_SEARCH_DEPTH,
      );
      const lastChannelTurn = recentTurns
        .filter((t) => t.channel && t.role === "user")
        .at(-1);
      const outboundChannel = lastChannelTurn?.channel ?? undefined;

      // Only append the brain's response — NOT the synthetic system turn
      await this.conversationManager.appendTurn(active.id, {
        type: "turn",
        role: "assistant",
        content: response,
        timestamp: new Date().toISOString(),
        turnNumber: (active.turnCount ?? 0) + 1,
        channel: outboundChannel,
      });

      await this.trySendViaChannel(response, outboundChannel);
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

    // Stream first turn from brain — agent speaks first
    const prompt =
      options?.firstTurnPrompt ||
      "[SYSTEM: You are reaching out to the user proactively. You are the conversation layer — explain briefly why you're messaging them. If you don't have a specific reason, let them know you're available.]";
    let response = "";
    for await (const event of this.sessionFactory.streamNewConversation(
      conv.id,
      prompt,
    )) {
      if (event.type === "text" || event.type === "text_delta") {
        if (event.text) response += event.text;
      }
    }

    if (response) {
      await this.conversationManager.appendTurn(conv.id, {
        type: "turn",
        role: "assistant",
        content: response,
        timestamp: new Date().toISOString(),
        turnNumber: 1,
        channel: resolvedChannelId ?? undefined,
      });

      await this.trySendViaChannel(response);
    }

    return conv;
  }

  /**
   * Resolve the outbound channel's transport ID and owner JID.
   * Used to set externalParty and channel on agent-initiated conversations
   * so that incoming replies can be matched back.
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
   *
   * @param channelOverride - If provided, use this channel instead of the global preference.
   *   Used by alert() to send via the active conversation's channel.
   */
  private async trySendViaChannel(
    content: string,
    channelOverride?: string,
  ): Promise<void> {
    const channelId = channelOverride ?? this.getOutboundChannel();
    if (channelId === "web" || !channelId) return;

    try {
      // Check if channel is connected
      // channelId from preferences is a type like "whatsapp", but actual channel
      // IDs are instance names like "ninas_dedicated_whatsapp". Match by plugin type
      // first, fall back to exact ID match.
      const channels = this.channelManager.getTransportInfos();
      // Map preference names to plugin names (e.g. "whatsapp" → "baileys")
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

      // Get owner JID for outbound messaging
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
