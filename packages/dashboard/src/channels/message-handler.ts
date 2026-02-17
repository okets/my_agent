/**
 * Channel Message Handler
 *
 * Routes incoming channel messages to conversations via the brain.
 * Dedup and debounce are handled by ChannelManager before messages reach here.
 */

import type { IncomingMessage, OutgoingMessage } from "@my-agent/core";
import type { ConversationManager } from "../conversations/index.js";
import type { SessionManager } from "../agent/session-manager.js";
import { SessionRegistry } from "../agent/session-registry.js";
import type { ConnectionRegistry } from "../ws/connection-registry.js";
import type { TranscriptTurn } from "../conversations/types.js";

interface MessageHandlerDeps {
  conversationManager: ConversationManager;
  sessionRegistry: SessionRegistry;
  connectionRegistry: ConnectionRegistry;
  sendViaChannel: (
    channelId: string,
    to: string,
    message: OutgoingMessage,
  ) => Promise<void>;
}

export class ChannelMessageHandler {
  private deps: MessageHandlerDeps;

  constructor(deps: MessageHandlerDeps) {
    this.deps = deps;
  }

  /**
   * Handle incoming messages from a channel (already deduped + debounced).
   * Messages array may have 1+ messages if debounced together.
   */
  async handleMessages(
    channelId: string,
    messages: IncomingMessage[],
  ): Promise<void> {
    if (messages.length === 0) return;

    // Use first message to determine conversation party
    const first = messages[0];
    const externalParty = first.groupId ?? first.from;

    // Look up or create conversation
    let conversation = await this.deps.conversationManager.getByExternalParty(
      channelId,
      externalParty,
    );

    if (!conversation) {
      // Create new conversation for this channel + party
      const title = first.senderName ?? first.groupName ?? undefined;
      conversation = await this.deps.conversationManager.create(channelId, {
        externalParty,
        title,
      });

      // Broadcast new conversation to WS clients
      this.deps.connectionRegistry.broadcastToAll({
        type: "conversation_created",
        conversation: {
          id: conversation.id,
          channel: conversation.channel,
          title: conversation.title,
          topics: conversation.topics,
          created: conversation.created.toISOString(),
          updated: conversation.updated.toISOString(),
          turnCount: conversation.turnCount,
          model: conversation.model,
          externalParty: conversation.externalParty,
        },
      });
    }

    // Combine message contents (if debounced, join with newlines)
    const combinedContent = messages.map((m) => m.content).join("\n");

    // Build context with replyTo if present
    let contextPrefix = "";
    if (first.replyTo?.text) {
      contextPrefix = `[Replying to: "${first.replyTo.text}"]\n`;
    }

    const userContent = contextPrefix + combinedContent;
    const turnNumber = conversation.turnCount + 1;
    const userTimestamp = new Date().toISOString();

    // Save user turn
    const userTurn: TranscriptTurn = {
      type: "turn",
      role: "user",
      content: userContent,
      timestamp: userTimestamp,
      turnNumber,
      channel: channelId,
      sender: first.from,
    };

    await this.deps.conversationManager.appendTurn(conversation.id, userTurn);

    // Broadcast user turn to WS clients viewing this conversation
    this.deps.connectionRegistry.broadcastToConversation(conversation.id, {
      type: "conversation_updated",
      conversationId: conversation.id,
      turn: {
        role: "user",
        content: userContent,
        timestamp: userTimestamp,
        turnNumber,
      },
    });

    // Get or create session for this conversation
    const sessionManager = await this.deps.sessionRegistry.getOrCreate(
      conversation.id,
      this.deps.conversationManager,
    );

    // Stream brain response
    let assistantContent = "";
    try {
      for await (const event of sessionManager.streamMessage(userContent)) {
        if (event.type === "text_delta") {
          assistantContent += event.text;
          // Broadcast streaming to WS clients
          this.deps.connectionRegistry.broadcastToConversation(
            conversation.id,
            {
              type: "text_delta",
              content: event.text,
            },
          );
        }
      }
    } catch (err) {
      console.error(
        `Brain error for channel message in ${conversation.id}:`,
        err,
      );
      assistantContent = "I encountered an error processing your message.";
    }

    if (assistantContent) {
      // Save assistant turn
      const assistantTurn: TranscriptTurn = {
        type: "turn",
        role: "assistant",
        content: assistantContent,
        timestamp: new Date().toISOString(),
        turnNumber,
      };

      await this.deps.conversationManager.appendTurn(
        conversation.id,
        assistantTurn,
      );

      // Send response back via channel
      await this.deps.sendViaChannel(channelId, first.from, {
        content: assistantContent,
      });

      // Broadcast assistant turn to WS clients
      this.deps.connectionRegistry.broadcastToConversation(conversation.id, {
        type: "conversation_updated",
        conversationId: conversation.id,
        turn: {
          role: "assistant",
          content: assistantContent,
          timestamp: assistantTurn.timestamp,
          turnNumber,
        },
      });
    }
  }
}
