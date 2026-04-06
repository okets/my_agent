/**
 * Channel Message Handler
 *
 * Routes incoming transport messages through:
 * 1. AuthorizationGate — token validation
 * 2. MessageRouter — channel binding lookup (owner vs external)
 * 3. Owner messages → conversation flow (brain routing)
 * 4. External messages → stored for S3 trust tier system
 *
 * Dedup and debounce are handled by TransportManager before messages reach here.
 */

import type {
  IncomingMessage,
  OutgoingMessage,
  ChannelBinding,
} from "@my-agent/core";
import { loadModels, ConfigWriter } from "@my-agent/core";
import type { ConversationManager } from "../conversations/index.js";
import { SessionRegistry } from "../agent/session-registry.js";
import type { ConnectionRegistry } from "../ws/connection-registry.js";
import type { TranscriptTurn } from "../conversations/types.js";
import { ExternalMessageStore } from "./external-store.js";
import {
  AttachmentService,
  type AttachmentMeta,
} from "../conversations/attachments.js";
import { ResponseTimer } from "./response-timer.js";
import { AuthorizationGate } from "../routing/authorization-gate.js";
import { TokenManager } from "../routing/token-manager.js";
import { MessageRouter, normalizeIdentity } from "../routing/message-router.js";

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
  sendViaTransport: (
    transportId: string,
    to: string,
    message: OutgoingMessage,
  ) => Promise<void>;
  sendTypingIndicator: (transportId: string, to: string) => Promise<void>;
  /** Send a voice reply (audio buffer) via transport. Returns true if sent. */
  sendAudioViaTransport?: (
    transportId: string,
    to: string,
    text: string,
    language?: string,
  ) => Promise<boolean>;
  agentDir: string;
  /** App instance for event-emitting mutations */
  app: import("../app.js").App;
  postResponseHooks?: {
    run(
      conversationId: string,
      userContent: string,
      assistantContent: string,
      options?: {
        turnNumber?: number;
        imagesStoredDuringTurn?: number;
        source?: "dashboard" | "channel";
      },
    ): Promise<void>;
  } | null;
}

export class ChannelMessageHandler {
  private deps: MessageHandlerDeps;
  private externalStore: ExternalMessageStore;
  private attachmentService: AttachmentService;
  private gate: AuthorizationGate;
  private router: MessageRouter;
  private tokenManager: TokenManager;
  private configWriter: ConfigWriter;

  constructor(deps: MessageHandlerDeps, initialBindings: ChannelBinding[]) {
    this.deps = deps;
    this.externalStore = new ExternalMessageStore(
      deps.conversationManager.getDb(),
    );
    this.attachmentService = new AttachmentService(deps.agentDir);
    this.configWriter = new ConfigWriter(deps.agentDir);

    // Initialize routing components with persistent token manager
    console.log(
      `[E2E] ChannelMessageHandler init — ${initialBindings.length} initial bindings: ${JSON.stringify(initialBindings.map((b) => ({ id: b.id, transport: b.transport, owner: b.ownerIdentity })))}`,
    );
    this.tokenManager = new TokenManager(deps.agentDir, {
      onExpired: (transportId) => this.handleTokenExpiry(transportId),
    });
    this.router = new MessageRouter(initialBindings);
    this.gate = new AuthorizationGate(this.tokenManager, {
      onAuthorized: (transportId, msg) =>
        this.handleTokenAuthorization(transportId, msg),
    });
  }

  /**
   * Generate an authorization token for a transport.
   * User sends this token via WhatsApp to prove ownership.
   * Uses crypto.randomInt() (CSPRNG) and persists SHA-256 hash to disk.
   */
  generateToken(transportId: string): string {
    const token = this.tokenManager.generateToken(transportId);
    console.log(
      `[E2E] generateToken("${transportId}") → token generated (6 chars)`,
    );
    console.log(
      `[E2E] Current bindings: ${JSON.stringify(this.router.getBindingForTransport(transportId) ?? "none")}`,
    );
    return token;
  }

  /**
   * Start re-authorization flow for a transport.
   * Suspends the existing channel binding and generates a new token.
   * Returns the plaintext token for dashboard display.
   */
  async startReauthorization(transportId: string): Promise<string> {
    const binding = this.router.getBindingForTransport(transportId);
    if (!binding) {
      throw new Error(
        `No channel binding exists for transport "${transportId}"`,
      );
    }

    // Suspend: set previousOwner on the binding
    const suspendedBinding: ChannelBinding = {
      ...binding,
      previousOwner: binding.ownerIdentity,
    };
    this.router.addBinding(suspendedBinding);

    // Persist suspended state
    await this.configWriter.saveChannelBinding(binding.id, {
      transport: binding.transport,
      ownerIdentity: binding.ownerIdentity,
      ownerJid: binding.ownerJid,
      previousOwner: binding.ownerIdentity,
    });

    // Send warning to previous owner
    try {
      await this.deps.sendViaTransport(transportId, binding.ownerJid, {
        content:
          "I'm in re-authorization mode. Messages won't be processed until verification completes.",
      });
    } catch {
      // Best effort — owner may not be reachable
    }

    // Generate new token
    return this.tokenManager.generateToken(transportId);
  }

  /**
   * Handle token expiry — if this was a re-auth, revert to previous owner.
   */
  private handleTokenExpiry(transportId: string): void {
    const binding = this.router.getBindingForTransport(transportId);
    if (!binding?.previousOwner) return;

    console.log(
      `[ChannelMessageHandler] Re-auth token expired for "${transportId}" — reverting to previous owner`,
    );

    // Revert: clear previousOwner, restore normal routing
    const revertedBinding: ChannelBinding = {
      ...binding,
      previousOwner: undefined,
    };
    this.router.addBinding(revertedBinding);

    // Persist reverted state
    this.configWriter
      .saveChannelBinding(binding.id, {
        transport: binding.transport,
        ownerIdentity: binding.ownerIdentity,
        ownerJid: binding.ownerJid,
      })
      .catch((err) => {
        console.error(
          `[ChannelMessageHandler] Failed to persist re-auth revert:`,
          err,
        );
      });
  }

  /**
   * Handle incoming messages from a transport (already deduped + debounced).
   * Messages array may have 1+ messages if debounced together.
   */
  async handleMessages(
    transportId: string,
    messages: IncomingMessage[],
  ): Promise<void> {
    if (messages.length === 0) return;

    const first = messages[0];

    console.log(
      `[E2E] handleMessages("${transportId}") — from="${first.from}", content="${first.content.substring(0, 30)}..."`,
    );

    // Step 1: Authorization gate — check for pending token
    console.log(`[E2E] Step 1: checking authorization gate...`);
    const handled = await this.gate.checkMessage(transportId, first);
    if (handled) {
      console.log(`[E2E] Step 1: token matched! Authorization handled.`);
      return;
    }
    console.log(`[E2E] Step 1: no token match, continuing to routing.`);

    // Step 2: Message router — check channel bindings
    const decision = this.router.route(transportId, first.from);
    console.log(`[E2E] Step 2: route decision = "${decision.type}"`);

    if (decision.type === "owner") {
      console.log(`[E2E] Routing as OWNER message → brain`);
      await this.handleOwnerMessage(transportId, messages);
    } else if (decision.type === "suspended") {
      // Channel is suspended during re-authorization — drop message silently
      console.log(
        `[ChannelMessageHandler] Message dropped — channel suspended for re-authorization on "${transportId}"`,
      );
    } else {
      await this.handleExternalMessage(transportId, messages);
    }
  }

  /**
   * Handle a valid authorization token — create channel binding.
   */
  private async handleTokenAuthorization(
    transportId: string,
    msg: IncomingMessage,
  ): Promise<void> {
    const senderJid = msg.from;
    const normalizedJid = normalizeIdentity(senderJid);
    const bindingId = `${transportId}_binding`;

    console.log(
      `[E2E][Auth] Token authorization successful for "${transportId}"`,
    );
    console.log(
      `[E2E][Auth] senderJid="${senderJid}", normalizedJid="${normalizedJid}", bindingId="${bindingId}"`,
    );

    // Create channel binding
    const binding: ChannelBinding = {
      id: bindingId,
      transport: transportId,
      ownerIdentity: normalizedJid,
      ownerJid: senderJid,
    };

    // Update router with new binding
    this.router.addBinding(binding);
    console.log(
      `[E2E][Auth] Binding added to router: ${JSON.stringify(binding)}`,
    );

    // Persist binding to config.yaml
    console.log(`[E2E][Auth] Persisting binding to config.yaml...`);
    try {
      await this.configWriter.saveChannelBinding(bindingId, {
        transport: transportId,
        ownerIdentity: normalizedJid,
        ownerJid: senderJid,
      });
    } catch (err) {
      console.error(
        `[ChannelMessageHandler] Failed to persist channel binding:`,
        err,
      );
    }

    // Send confirmation via WhatsApp
    const name = msg.senderName ?? "there";
    await this.deps.sendViaTransport(transportId, senderJid, {
      content: `Hi ${name}! You're now authorized as my owner on this channel. Send me anything and I'll respond!`,
    });

    // Broadcast to dashboard
    this.deps.connectionRegistry.broadcastToAll({
      type: "transport_authorized",
      transportId,
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
      await this.deps.conversationManager.getByExternalParty(externalParty);

    // Check for channel-switch new conversation trigger.
    // Rule: if the most recent turn's channel differs from the incoming
    // message's channel, start a new conversation. Both user and assistant
    // turns carry the channel they were sent on, tracking where the
    // conversation is happening.
    let forceNewConversation = false;
    if (existingConversation) {
      const recentTurns = await this.deps.conversationManager.getRecentTurns(
        existingConversation.id,
        1,
      );
      if (recentTurns.length > 0) {
        const lastTurnChannel = recentTurns[0].channel ?? "web";
        if (lastTurnChannel !== channelId) {
          // Last turn was on a different channel — force new conversation
          await this.deps.conversationManager.unpin(existingConversation.id);
          this.deps.connectionRegistry.broadcastToAll({
            type: "conversation_unpinned",
            conversationId: existingConversation.id,
          });
          forceNewConversation = true;
        }
      }
      // If conversation has no turns yet, continue using it
    }

    // ── Slash command: /new ───────────────────────────────────────────
    if (commandText === "/new") {
      const currentModel = existingConversation?.model ?? null;

      // Unpin current conversation if it exists
      if (existingConversation) {
        await this.deps.app!.conversations.unpin(existingConversation.id);

        // Broadcast unpin to dashboard
        this.deps.connectionRegistry.broadcastToAll({
          type: "conversation_unpinned",
          conversationId: existingConversation.id,
        });
      }

      // Create new pinned conversation (inherits model)
      const title = first.senderName ?? first.groupName ?? undefined;
      const newConversation = await this.deps.app!.conversations.create({
        externalParty,
        title,
        model: currentModel,
      });

      // Send confirmation via channel
      await this.deps.sendViaTransport(channelId, replyTo, {
        content: "Starting fresh! How can I help?",
      });

      // Broadcast new conversation to dashboard
      this.deps.connectionRegistry.broadcastToAll({
        type: "conversation_created",
        conversation: {
          id: newConversation.id,
          title: newConversation.title,
          topics: newConversation.topics,
          created: newConversation.created.toISOString(),
          updated: newConversation.updated.toISOString(),
          turnCount: newConversation.turnCount,
          model: newConversation.model,
          externalParty: newConversation.externalParty,
          isPinned: newConversation.isPinned,
          status: newConversation.status,
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
        const currentModel = existingConversation?.model || loadModels().sonnet;
        const modelName = currentModel.includes("opus")
          ? "Opus"
          : currentModel.includes("haiku")
            ? "Haiku"
            : "Sonnet";

        await this.deps.sendViaTransport(channelId, replyTo, {
          content: `Current model: ${modelName}\n\nAvailable: /model opus, /model sonnet, /model haiku`,
        });
        return;
      }

      // Map shorthand to full model ID
      const m = loadModels();
      const modelMap: Record<string, string> = {
        opus: m.opus,
        sonnet: m.sonnet,
        haiku: m.haiku,
      };

      const newModelId = modelMap[modelArg];
      if (!newModelId) {
        await this.deps.sendViaTransport(channelId, replyTo, {
          content: `Unknown model "${modelArg}". Available: opus, sonnet, haiku`,
        });
        return;
      }

      if (!existingConversation) {
        await this.deps.sendViaTransport(channelId, replyTo, {
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
      await this.deps.sendViaTransport(channelId, replyTo, {
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
    let conversation = forceNewConversation ? null : existingConversation;

    // Existing channel conversation receiving a message becomes current
    if (conversation && conversation.status !== "current") {
      await this.deps.app!.conversations.makeCurrent(conversation.id);
    }

    if (!conversation) {
      // Create new conversation for this channel + party
      const title = first.senderName ?? first.groupName ?? undefined;
      conversation = await this.deps.app!.conversations.create({
        externalParty,
        title,
      });

      // Broadcast new conversation to WS clients
      this.deps.connectionRegistry.broadcastToAll({
        type: "conversation_created",
        conversation: {
          id: conversation.id,
          title: conversation.title,
          topics: conversation.topics,
          created: conversation.created.toISOString(),
          updated: conversation.updated.toISOString(),
          turnCount: conversation.turnCount,
          model: conversation.model,
          externalParty: conversation.externalParty,
          isPinned: conversation.isPinned,
          status: conversation.status,
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
    let turnNumber = conversation.turnCount + 1;
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

    // Inject voice mode hint for voice notes so brain writes for speech
    if (first.isVoiceNote && textContent) {
      const voiceHint = `[VOICE MODE: The user sent a voice message. Your response will be spoken aloud via TTS.

Write for the ear, not the eye:
- Natural conversational sentences — no bullet points, numbered lists, or tables
- No emojis — they don't translate to speech
- No markdown formatting — bold, italic, and headers are invisible in audio
- Keep it concise — spoken responses should be shorter than written ones
- Use punctuation expressively — commas for pauses, em-dashes for emphasis, question marks for rising tone
- No URLs — if you need to share a link, say "I'll send you the link" and follow up in text
- Don't mention that this is a voice message or that you're in voice mode]`;
      if (contentBlocks.length > 0) {
        contentBlocks.unshift({ type: "text", text: voiceHint });
      } else {
        contentBlocks.push({ type: "text", text: voiceHint + "\n\n" + textContent });
      }
    }

    // Use ContentBlocks if we have attachments or voice hint, otherwise plain string
    const messageContent: string | ContentBlock[] =
      contentBlocks.length > 0 && (savedAttachments.length > 0 || first.isVoiceNote)
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

    // Send typing indicator on WhatsApp while brain processes
    await this.deps.sendTypingIndicator(channelId, replyTo);

    // Start response timer: refreshes typing indicator + sends interim messages
    const responseTimer = new ResponseTimer({
      sendTyping: () => this.deps.sendTypingIndicator(channelId, replyTo),
      sendInterim: async (message) => {
        // Send as real WhatsApp message (ephemeral, not saved to transcript)
        await this.deps.sendViaTransport(channelId, replyTo, {
          content: message,
        });
        // Also broadcast to web dashboard
        this.deps.connectionRegistry.broadcastToConversation(conversation.id, {
          type: "interim_status",
          message,
        });
      },
    });
    responseTimer.start();

    // Get or create session for this conversation
    const sessionManager = await this.deps.sessionRegistry.getOrCreate(
      conversation.id,
    );
    sessionManager.setChannel(channelId);

    // Stream brain response — split on first tool use so the ack
    // is delivered immediately and the user doesn't wait in silence.
    let assistantContent = "";
    let firstToken = true;
    let hasSplit = false;
    try {
      for await (const event of sessionManager.streamMessage(messageContent)) {
        if (event.type === "text_delta") {
          if (firstToken) {
            responseTimer.cancel();
            firstToken = false;
          }
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

        // Split on first tool use: send ack portion immediately
        if (
          event.type === "tool_use_start" &&
          !hasSplit &&
          assistantContent.trim().length > 0
        ) {
          hasSplit = true;

          // Save and send message 1 (the ack)
          const ackTurn: TranscriptTurn = {
            type: "turn",
            role: "assistant",
            content: assistantContent,
            timestamp: new Date().toISOString(),
            turnNumber,
            channel: channelId,
          };
          await this.deps.conversationManager.appendTurn(
            conversation.id,
            ackTurn,
          );

          const replyTo = first.groupId ?? first.from;
          await this.deps.sendViaTransport(channelId, replyTo, {
            content: assistantContent,
          });

          // Broadcast completed message 1 to web UI
          this.deps.connectionRegistry.broadcastToConversation(
            conversation.id,
            { type: "done" },
          );
          this.deps.connectionRegistry.broadcastToConversation(
            conversation.id,
            {
              type: "conversation_updated",
              conversationId: conversation.id,
              turn: {
                role: "assistant",
                content: assistantContent,
                timestamp: ackTurn.timestamp,
                turnNumber,
              },
            },
          );

          // Advance to message 2
          turnNumber++;
          assistantContent = "";

          // Signal new message to web UI
          this.deps.connectionRegistry.broadcastToConversation(
            conversation.id,
            { type: "start" },
          );
        }

        // On subsequent tool uses after the split, discard intermediate
        // thinking text so only the final text segment is sent to the channel.
        if (event.type === "tool_use_start" && hasSplit) {
          assistantContent = "";
        }
      }
    } catch (err) {
      responseTimer.cancel();
      console.error(
        `Brain error for channel message in ${conversation.id}:`,
        err,
      );
      assistantContent = "I encountered an error processing your message.";
    } finally {
      responseTimer.cancel();
    }

    // Save and send message 2 (or the only message if no split occurred).
    // Skip if split produced an empty message 2.
    if (assistantContent.trim() || !hasSplit) {
      const assistantTurn: TranscriptTurn = {
        type: "turn",
        role: "assistant",
        content: assistantContent,
        timestamp: new Date().toISOString(),
        turnNumber,
        channel: channelId,
      };

      await this.deps.conversationManager.appendTurn(
        conversation.id,
        assistantTurn,
      );

      // Send response back via channel (use group JID for groups, sender JID for DMs)
      const replyTo = first.groupId ?? first.from;

      // Voice reply: if original was a voice note, try to send audio
      let sentAsAudio = false;
      if (first.isVoiceNote && this.deps.sendAudioViaTransport) {
        try {
          sentAsAudio = await this.deps.sendAudioViaTransport(
            channelId,
            replyTo,
            assistantContent,
            first.detectedLanguage,
          );
        } catch (err) {
          console.warn(
            "[ChannelMessageHandler] Voice reply failed, falling back to text:",
            err,
          );
        }
      }
      if (!sentAsAudio) {
        await this.deps.sendViaTransport(channelId, replyTo, {
          content: assistantContent,
        });
      }

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

      // Post-response hooks (task extraction, visual augmentation) — fire-and-forget
      this.deps.postResponseHooks
        ?.run(conversation.id, textContent, assistantContent, {
          turnNumber: 0,
          imagesStoredDuringTurn: 0,
          source: "channel",
        })
        .catch(() => {});
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
