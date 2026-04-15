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
import type { ConnectionRegistry } from "../ws/connection-registry.js";
import { ExternalMessageStore } from "./external-store.js";
import { ResponseTimer } from "./response-timer.js";
import { AuthorizationGate } from "../routing/authorization-gate.js";
import { TokenManager } from "../routing/token-manager.js";
import { MessageRouter, normalizeIdentity } from "../routing/message-router.js";

interface MessageHandlerDeps {
  conversationManager: ConversationManager;
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
}

export class ChannelMessageHandler {
  private deps: MessageHandlerDeps;
  private externalStore: ExternalMessageStore;
  private gate: AuthorizationGate;
  private router: MessageRouter;
  private tokenManager: TokenManager;
  private configWriter: ConfigWriter;

  constructor(deps: MessageHandlerDeps, initialBindings: ChannelBinding[]) {
    this.deps = deps;
    this.externalStore = new ExternalMessageStore(
      deps.conversationManager.getDb(),
    );
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
    // Two cases force a new conversation:
    // 1. The found conversation's last turn was on a different channel
    // 2. The user is currently on web (current conv != found conv) — switching to WhatsApp
    let forceNewConversation = false;
    if (existingConversation) {
      // Case 2: user is on web, incoming message is from channel
      // The found externalParty conversation is from a previous session;
      // the user has since started a web conversation. This is a channel switch.
      const currentConv = await this.deps.conversationManager.getCurrent();
      if (currentConv && currentConv.id !== existingConversation.id) {
        // Current conversation is different from the found channel conversation
        // — user switched to web, now incoming channel message = channel switch
        console.log(`[ChannelMessageHandler] Channel switch detected: current=${currentConv.id} found=${existingConversation.id} — forcing new conversation`);
        await this.deps.app.conversations.unpin(existingConversation.id);
        forceNewConversation = true;
      } else {
        // Case 1: same conversation is current, check last turn's channel
        const recentTurns = await this.deps.conversationManager.getRecentTurns(
          existingConversation.id,
          1,
        );
        if (recentTurns.length > 0) {
          const lastTurnChannel = recentTurns[0].channel ?? "web";
          if (lastTurnChannel !== channelId) {
            // Last turn was on a different channel — force new conversation
            await this.deps.app.conversations.unpin(existingConversation.id);
            forceNewConversation = true;
          }
        }
        // If conversation has no turns yet, continue using it
      }
    }

    // ── Slash command: /new ───────────────────────────────────────────
    if (commandText === "/new") {
      const currentModel = existingConversation?.model ?? null;

      // Unpin current conversation if it exists
      if (existingConversation) {
        await this.deps.app.conversations.unpin(existingConversation.id);

        // Broadcast unpin to dashboard
        this.deps.connectionRegistry.broadcastToAll({
          type: "conversation_unpinned",
          conversationId: existingConversation.id,
        });
      }

      // Create new pinned conversation (inherits model)
      const title = first.senderName ?? first.groupName ?? undefined;
      const newConversation = await this.deps.app.conversations.create({
        externalParty,
        title,
        model: currentModel,
      });

      // Send confirmation via channel
      await this.deps.sendViaTransport(channelId, replyTo, {
        content: "Starting fresh! How can I help?",
      });

      // app.conversations.create() emits conversation:created → StatePublisher
      // refreshes the conversation list for all WS clients.

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

      // Update conversation model (through App — emits conversation:updated)
      await this.deps.app.chat.setModel(
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
      await this.deps.app.conversations.makeCurrent(conversation.id);
    }

    if (!conversation) {
      // Create new conversation for this channel + party
      const title = first.senderName ?? first.groupName ?? undefined;
      conversation = await this.deps.app.conversations.create({
        externalParty,
        title,
      });

      // app.conversations.create() emits conversation:created → StatePublisher.
      // sendMessage() below emits chat:conversation_created → broadcastToAll.
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

    // ── Build ChatMessageOptions ─────────────────────────────────────
    // Convert channel attachments to ChatMessageOptions format
    const chatAttachments: Array<{ filename: string; base64Data: string; mimeType: string }> = [];

    // Audio attachment from voice notes (STT happens in sendMessage)
    if (first.isVoiceNote && first.audioAttachment) {
      chatAttachments.push({
        filename: `voice-note-${Date.now()}.ogg`,
        base64Data: first.audioAttachment.buffer.toString("base64"),
        mimeType: first.audioAttachment.mimeType,
      });
    }

    // Image/file attachments
    if (first.attachments?.length) {
      for (const att of first.attachments) {
        chatAttachments.push({
          filename: att.filename,
          base64Data: att.data.toString("base64"),
          mimeType: att.mimeType,
        });
      }
    }

    // Persist raw media for CFR recovery (M9.6-S1).
    // Saves the primary media buffer to disk before STT or any downstream processing.
    let rawMediaPath: string | undefined;
    if (this.deps.app.rawMediaStore) {
      try {
        if (first.isVoiceNote && first.audioAttachment) {
          rawMediaPath = await this.deps.app.rawMediaStore.save(
            conversation.id,
            first.id,
            first.audioAttachment.mimeType,
            first.audioAttachment.buffer,
          );
        } else if (first.attachments?.length) {
          const firstAtt = first.attachments[0];
          rawMediaPath = await this.deps.app.rawMediaStore.save(
            conversation.id,
            `${first.id}-${firstAtt.filename}`,
            firstAtt.mimeType,
            firstAtt.data,
          );
        }
      } catch (err) {
        console.warn("[ChannelMessageHandler] Failed to persist raw media:", err);
      }
    }

    // Send typing indicator
    await this.deps.sendTypingIndicator(channelId, replyTo);

    // Start response timer
    const responseTimer = new ResponseTimer({
      sendTyping: () => this.deps.sendTypingIndicator(channelId, replyTo),
      sendInterim: async (message) => {
        await this.deps.sendViaTransport(channelId, replyTo, { content: message });
        this.deps.connectionRegistry.broadcastToConversation(conversation.id, {
          type: "interim_status",
          message,
        });
      },
    });
    responseTimer.start();

    // ── Delegate to app.chat for brain interaction ────────────────────
    // sendMessage() handles: user turn saving, STT transcription, session management,
    // brain streaming, assistant turn saving, WS broadcasting, post-response hooks.

    let currentText = "";
    let firstToken = true;
    let isFirstMessage = true;
    let detectedLanguage: string | undefined;

    try {
      for await (const event of this.deps.app.chat.sendMessage(
        conversation.id,
        textContent,
        turnNumber,
        {
          channel: {
            transportId: channelId,
            channelId,
            sender: first.from,
            replyTo: first.replyTo?.text,
            senderName: first.senderName,
            groupId: first.groupId,
            isVoiceNote: first.isVoiceNote,
            detectedLanguage: first.detectedLanguage,
          },
          source: "channel",
          attachments: chatAttachments.length > 0 ? chatAttachments : undefined,
          inputMedium: first.isVoiceNote && first.audioAttachment ? "audio" : undefined,
          rawMediaPath,
        },
      )) {
        switch (event.type) {
          case "text_delta":
            if (firstToken) { responseTimer.cancel(); firstToken = false; }
            currentText += event.text;
            break;
          case "turn_advanced":
            if (currentText.trim()) {
              await this.deps.sendViaTransport(channelId, replyTo, { content: currentText });
            }
            currentText = "";
            isFirstMessage = false;
            break;
          case "done":
            if ("detectedLanguage" in event && event.detectedLanguage) {
              detectedLanguage = event.detectedLanguage;
            }
            break;
        }
      }
    } catch (err) {
      responseTimer.cancel();
      console.error(`Brain error for channel message in ${conversation.id}:`, err);
      currentText = "I encountered an error processing your message.";
    } finally {
      responseTimer.cancel();
    }

    // ── Send final response via channel ──────────────────────────────
    if (currentText.trim() || isFirstMessage) {
      let sentAsAudio = false;
      if (first.isVoiceNote && this.deps.sendAudioViaTransport) {
        try {
          sentAsAudio = await this.deps.sendAudioViaTransport(
            channelId, replyTo, currentText,
            detectedLanguage ?? first.detectedLanguage,
          );
        } catch (err) {
          console.warn("[ChannelMessageHandler] Voice reply failed, falling back to text:", err);
        }
      }
      if (!sentAsAudio) {
        await this.deps.sendViaTransport(channelId, replyTo, { content: currentText });
      }
    }

    // Channel conversations are now streamed via App events (chat:text_delta, etc.)
    // No conversation_ready needed — dashboard clients receive streaming events
    // through broadcastToConversation() and conversation_created via broadcastToAll().
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

      this.deps.app.emit("external_message:created", {
        id: msg.id,
        channelId,
        from: msg.from,
        content: msg.content,
      });
    }
  }
}
