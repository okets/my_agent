/**
 * Channel Message Handler
 *
 * Routes incoming channel messages based on sender identity:
 * - Token messages → authorize sender as owner
 * - Owner messages → conversation flow (brain routing)
 * - External messages → stored for S3 trust tier system
 *
 * Dedup and debounce are handled by ChannelManager before messages reach here.
 */

import type {
  IncomingMessage,
  OutgoingMessage,
  ChannelInstanceConfig,
} from "@my-agent/core";
import { saveChannelToConfig } from "@my-agent/core";
import type { ConversationManager } from "../conversations/index.js";
import { SessionRegistry } from "../agent/session-registry.js";
import type { ConnectionRegistry } from "../ws/connection-registry.js";
import type { TranscriptTurn } from "../conversations/types.js";
import { ExternalMessageStore } from "./external-store.js";
import {
  AttachmentService,
  type AttachmentMeta,
} from "../conversations/attachments.js";

/** Content block types for Agent SDK (images + text) */
type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    };

interface MessageHandlerDeps {
  conversationManager: ConversationManager;
  sessionRegistry: SessionRegistry;
  connectionRegistry: ConnectionRegistry;
  sendViaChannel: (
    channelId: string,
    to: string,
    message: OutgoingMessage,
  ) => Promise<void>;
  getChannelConfig: (channelId: string) => ChannelInstanceConfig | undefined;
  updateChannelConfig: (
    channelId: string,
    update: Partial<ChannelInstanceConfig>,
  ) => void;
  agentDir: string;
}

/**
 * Strip platform-specific suffixes and normalise to digits + optional leading +.
 * Handles WhatsApp JIDs: @s.whatsapp.net, @lid, @g.us
 */
function normalizeIdentity(identity: string): string {
  let normalized = identity.replace(/@(s\.whatsapp\.net|lid|g\.us)$/, "");
  normalized = normalized.replace(/[^\d+]/g, "");
  return normalized;
}

function isOwnerMessage(
  config: ChannelInstanceConfig | undefined,
  senderIdentity: string,
): boolean {
  if (!config?.ownerIdentities?.length) {
    // WARNING: LID JIDs (e.g., 169969@lid) cannot be matched to phone numbers
    // without a contact store lookup. Owner detection will fail for LID senders.
    // TODO: Implement LID resolution via Baileys store in S3.
    return false;
  }
  const normalizedSender = normalizeIdentity(senderIdentity);
  return config.ownerIdentities.some(
    (owner) => normalizeIdentity(owner) === normalizedSender,
  );
}

/** Pending authorization token for a channel */
interface PendingToken {
  token: string;
  channelId: string;
  expiresAt: Date;
}

export class ChannelMessageHandler {
  private deps: MessageHandlerDeps;
  private externalStore: ExternalMessageStore;
  private attachmentService: AttachmentService;
  private warnedMissingOwner = new Set<string>();
  private pendingTokens = new Map<string, PendingToken>();

  constructor(deps: MessageHandlerDeps) {
    this.deps = deps;
    this.externalStore = new ExternalMessageStore(
      deps.conversationManager.getDb(),
    );
    this.attachmentService = new AttachmentService(deps.agentDir);
  }

  /**
   * Generate an authorization token for a channel.
   * User sends this token via WhatsApp to prove ownership.
   */
  generateToken(channelId: string): string {
    // 6-char alphanumeric token (easy to type on phone)
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 to avoid confusion
    let token = "";
    for (let i = 0; i < 6; i++) {
      token += chars[Math.floor(Math.random() * chars.length)];
    }

    this.pendingTokens.set(channelId, {
      token,
      channelId,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    });

    return token;
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

    const first = messages[0];

    // Check for authorization token BEFORE owner check
    const pending = this.pendingTokens.get(channelId);
    if (pending) {
      const content = first.content.trim().toUpperCase();
      if (content === pending.token && new Date() < pending.expiresAt) {
        await this.handleTokenAuthorization(channelId, first);
        return;
      }
    }

    const channelConfig = this.deps.getChannelConfig(channelId);

    // Warn once per channel if ownerIdentities is missing (all messages treated as external)
    if (
      !channelConfig?.ownerIdentities?.length &&
      !this.warnedMissingOwner.has(channelId)
    ) {
      this.warnedMissingOwner.add(channelId);
      console.warn(
        `[ChannelMessageHandler] Channel "${channelId}" has no ownerIdentities configured — all messages will be treated as external.`,
      );
    }

    if (isOwnerMessage(channelConfig, first.from)) {
      // Owner message → conversation flow
      await this.handleOwnerMessage(channelId, messages);
    } else {
      // External party → store for S3 trust tier system
      await this.handleExternalMessage(channelId, messages);
    }
  }

  /**
   * Handle a valid authorization token — register sender as channel owner.
   */
  private async handleTokenAuthorization(
    channelId: string,
    msg: IncomingMessage,
  ): Promise<void> {
    const senderJid = msg.from;
    const normalizedJid = normalizeIdentity(senderJid);

    console.log(
      `[ChannelMessageHandler] Token authorization successful for channel "${channelId}" — owner JID: ${senderJid}`,
    );

    // Update runtime config
    this.deps.updateChannelConfig(channelId, {
      ownerIdentities: [normalizedJid],
    });

    // Persist to config.yaml
    try {
      saveChannelToConfig(
        channelId,
        { owner_identities: [normalizedJid] },
        this.deps.agentDir,
      );
    } catch (err) {
      console.error(
        `[ChannelMessageHandler] Failed to persist owner identity:`,
        err,
      );
    }

    // Clear the pending token
    this.pendingTokens.delete(channelId);
    this.warnedMissingOwner.delete(channelId);

    // Send confirmation via WhatsApp
    const name = msg.senderName ?? "there";
    await this.deps.sendViaChannel(channelId, senderJid, {
      content: `Hi ${name}! You're now authorized as my owner on this channel. Send me anything and I'll respond!`,
    });

    // Broadcast to dashboard
    this.deps.connectionRegistry.broadcastToAll({
      type: "channel_authorized",
      channelId,
      ownerJid: normalizedJid,
      ownerName: msg.senderName ?? null,
    });
  }

  /**
   * Handle messages from the channel owner — route through brain as a conversation.
   */
  private async handleOwnerMessage(
    channelId: string,
    messages: IncomingMessage[],
  ): Promise<void> {
    const first = messages[0];
    const externalParty = first.groupId ?? first.from;
    const replyTo = first.groupId ?? first.from;
    const commandText = first.content.trim().toLowerCase();

    // Look up existing conversation for slash command context
    const existingConversation =
      await this.deps.conversationManager.getByExternalParty(
        channelId,
        externalParty,
      );

    // ── Slash command: /new ───────────────────────────────────────────
    if (commandText === "/new") {
      const currentModel = existingConversation?.model ?? null;

      // Unpin current conversation if it exists
      if (existingConversation) {
        await this.deps.conversationManager.unpin(existingConversation.id);

        // Broadcast unpin to dashboard
        this.deps.connectionRegistry.broadcastToAll({
          type: "conversation_unpinned",
          conversationId: existingConversation.id,
        });
      }

      // Create new pinned conversation (inherits model)
      const title = first.senderName ?? first.groupName ?? undefined;
      const newConversation = await this.deps.conversationManager.create(
        channelId,
        {
          externalParty,
          title,
          model: currentModel,
        },
      );

      // Send confirmation via channel
      await this.deps.sendViaChannel(channelId, replyTo, {
        content: "Starting fresh! How can I help?",
      });

      // Broadcast new conversation to dashboard
      this.deps.connectionRegistry.broadcastToAll({
        type: "conversation_created",
        conversation: {
          id: newConversation.id,
          channel: newConversation.channel,
          title: newConversation.title,
          topics: newConversation.topics,
          created: newConversation.created.toISOString(),
          updated: newConversation.updated.toISOString(),
          turnCount: newConversation.turnCount,
          model: newConversation.model,
          externalParty: newConversation.externalParty,
          isPinned: newConversation.isPinned,
        },
      });

      return; // Don't process as normal message
    }

    // ── Slash command: /model ─────────────────────────────────────────
    const modelMatch = commandText.match(/^\/model(?:\s+(\w+))?$/);
    if (modelMatch) {
      const modelArg = modelMatch[1]; // undefined, "opus", "sonnet", or "haiku"

      if (!modelArg) {
        // Show current model and options
        const currentModel =
          existingConversation?.model || "claude-sonnet-4-5-20250929";
        const modelName = currentModel.includes("opus")
          ? "Opus"
          : currentModel.includes("haiku")
            ? "Haiku"
            : "Sonnet";

        await this.deps.sendViaChannel(channelId, replyTo, {
          content: `Current model: ${modelName}\n\nAvailable: /model opus, /model sonnet, /model haiku`,
        });
        return;
      }

      // Map shorthand to full model ID
      const modelMap: Record<string, string> = {
        opus: "claude-opus-4-6",
        sonnet: "claude-sonnet-4-5-20250929",
        haiku: "claude-haiku-4-5-20251001",
      };

      const newModelId = modelMap[modelArg];
      if (!newModelId) {
        await this.deps.sendViaChannel(channelId, replyTo, {
          content: `Unknown model "${modelArg}". Available: opus, sonnet, haiku`,
        });
        return;
      }

      if (!existingConversation) {
        await this.deps.sendViaChannel(channelId, replyTo, {
          content: `No active conversation. Send a message first to start one.`,
        });
        return;
      }

      // Update conversation model
      await this.deps.conversationManager.setModel(
        existingConversation.id,
        newModelId,
      );

      const modelName = modelArg.charAt(0).toUpperCase() + modelArg.slice(1);
      await this.deps.sendViaChannel(channelId, replyTo, {
        content: `Switched to ${modelName}.`,
      });

      // Broadcast model change to dashboard
      this.deps.connectionRegistry.broadcastToConversation(
        existingConversation.id,
        {
          type: "conversation_model_changed",
          conversationId: existingConversation.id,
          model: newModelId,
        },
      );

      return;
    }

    // ── Normal message processing ─────────────────────────────────────
    let conversation = existingConversation;

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
          isPinned: conversation.isPinned,
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

    const textContent = contextPrefix + combinedContent;
    const turnNumber = conversation.turnCount + 1;
    const userTimestamp = new Date().toISOString();

    // Process attachments and build ContentBlocks
    const savedAttachments: AttachmentMeta[] = [];
    const contentBlocks: ContentBlock[] = [];

    if (first.attachments?.length) {
      for (const att of first.attachments) {
        try {
          const base64 = att.data.toString("base64");
          const saved = await this.attachmentService.save(
            conversation.id,
            att.filename,
            att.mimeType,
            base64,
          );
          savedAttachments.push(saved.meta);

          // Build ContentBlock directly from buffer (no re-read)
          if (this.attachmentService.isImage(att.mimeType)) {
            contentBlocks.push({
              type: "image",
              source: {
                type: "base64",
                media_type: att.mimeType,
                data: base64,
              },
            });
          }
        } catch (err) {
          console.error(
            `[ChannelMessageHandler] Failed to save attachment ${att.filename}:`,
            err,
          );
        }
      }
    }

    // Add text content if present
    if (textContent) {
      contentBlocks.push({ type: "text", text: textContent });
    }

    // Use ContentBlocks if we have attachments, otherwise plain string
    const messageContent: string | ContentBlock[] =
      contentBlocks.length > 0 && savedAttachments.length > 0
        ? contentBlocks
        : textContent;

    // Save user turn (with attachment metadata)
    const userTurn: TranscriptTurn = {
      type: "turn",
      role: "user",
      content: textContent,
      timestamp: userTimestamp,
      turnNumber,
      channel: channelId,
      sender: first.from,
      ...(savedAttachments.length > 0 && { attachments: savedAttachments }),
    };

    await this.deps.conversationManager.appendTurn(conversation.id, userTurn);

    // Broadcast user turn to WS clients viewing this conversation
    this.deps.connectionRegistry.broadcastToConversation(conversation.id, {
      type: "conversation_updated",
      conversationId: conversation.id,
      turn: {
        role: "user",
        content: textContent,
        timestamp: userTimestamp,
        turnNumber,
        ...(savedAttachments.length > 0 && { attachments: savedAttachments }),
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
      for await (const event of sessionManager.streamMessage(messageContent)) {
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

      // Send response back via channel (use group JID for groups, sender JID for DMs)
      const replyTo = first.groupId ?? first.from;
      await this.deps.sendViaChannel(channelId, replyTo, {
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

  /**
   * Handle messages from an external party — store without brain routing.
   * S3 trust tier system will handle these via escalation rules.
   */
  private async handleExternalMessage(
    channelId: string,
    messages: IncomingMessage[],
  ): Promise<void> {
    const first = messages[0];
    console.log(
      `[ChannelMessageHandler] External message from ${first.from} on ${channelId} — stored (pending S3 trust tier)`,
    );

    for (const msg of messages) {
      this.externalStore.storeMessage({
        id: msg.id,
        channelId,
        from: msg.from,
        displayName: msg.senderName ?? msg.groupName,
        content: msg.content,
        timestamp: msg.timestamp.toISOString(),
      });
    }
  }
}
