import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { SessionRegistry } from "../agent/session-registry.js";
import type { SessionManager } from "../agent/session-manager.js";
import { ScriptedHatchingEngine } from "../hatching/scripted-engine.js";
import { createHatchingSession } from "../hatching/hatching-tools.js";
import {
  resolveAuth,
  createCalDAVClient,
  loadCalendarConfig,
  loadCalendarCredentials,
} from "@my-agent/core";
import { IdleTimerManager, NamingService } from "../conversations/index.js";
import type { ConversationManager } from "../conversations/index.js";
import type { Conversation, TranscriptTurn } from "../conversations/types.js";
import { ConnectionRegistry } from "./connection-registry.js";
import { AttachmentService } from "../conversations/attachments.js";
import {
  extractTaskFromMessage,
  type ExtractedTask,
} from "../tasks/task-extractor.js";
import type {
  Attachment,
  ClientMessage,
  ServerMessage,
  ConversationMeta,
  Turn,
  ViewContext,
} from "./protocol.js";

// Framework skills directory (relative to packages/dashboard/src/ws/)
const FRAMEWORK_SKILLS_DIR = path.resolve(
  import.meta.dirname,
  "../../../core/skills",
);

/**
 * Load skill content for /my-agent:* commands
 * Returns null if skill not found
 */
async function loadSkillContent(skillName: string): Promise<string | null> {
  const skillPath = path.join(FRAMEWORK_SKILLS_DIR, skillName, "SKILL.md");
  try {
    return await readFile(skillPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Expand /my-agent:* commands in message content
 * Returns expanded content with skill instructions prepended
 */
async function expandSkillCommand(content: string): Promise<string> {
  const match = content.match(/^\/my-agent:(\S+)/);
  if (!match) return content;

  const skillName = match[1];
  const skillContent = await loadSkillContent(skillName);

  if (!skillContent) {
    // Skill not found, return original
    return content;
  }

  // Extract context (everything after the command line)
  const lines = content.split("\n");
  const contextLines = lines.slice(1); // Skip command line
  const context = contextLines.join("\n").trim();

  // Build expanded message: skill content + context
  return `[SKILL: ${skillName}]\n\n${skillContent.trim()}\n\n---\n\n${context}`;
}

const MAX_MESSAGE_LENGTH = 10000;
const MAX_TITLE_LENGTH = 100;
const TURNS_PER_PAGE = 50;
const CONVERSATION_ID_RE = /^conv-[A-Z0-9]{26}$/;

// Global connection registry for multi-tab sync (exported for channel wiring)
export const connectionRegistry = new ConnectionRegistry();

// Global idle timer manager (lazily initialized on first WS connection)
let idleTimerManager: IdleTimerManager | null = null;

// Global naming service (lazily initialized when needed)
let namingService: NamingService | null = null;

// Global session registry for conversation-bound sessions (exported for channel wiring)
export const sessionRegistry = new SessionRegistry(5); // Max 5 concurrent sessions

// Attachment service (initialized per connection with agentDir)
let attachmentService: AttachmentService | null = null;

function isValidConversationId(id: string): boolean {
  return CONVERSATION_ID_RE.test(id);
}

export async function registerChatWebSocket(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.get("/api/chat/ws", { websocket: true }, (socket, req) => {
    fastify.log.info("Chat WebSocket connected");

    // Keepalive: ping every 30s to prevent idle timeouts
    const pingInterval = setInterval(() => {
      if (socket.readyState === 1) {
        socket.ping();
      }
    }, 30000);

    // Use shared ConversationManager from fastify decorator
    const conversationManager = fastify.conversationManager!;

    // Initialize attachment service if not already done
    if (!attachmentService) {
      attachmentService = new AttachmentService(fastify.agentDir);
    }

    // Lazily initialize IdleTimerManager on first WS connection
    if (!idleTimerManager && fastify.abbreviationQueue) {
      idleTimerManager = new IdleTimerManager(
        fastify.abbreviationQueue,
        connectionRegistry,
      );

      // Wire rename callback so abbreviation-triggered renames broadcast to all clients
      if (!fastify.abbreviationQueue.onRenamed) {
        fastify.abbreviationQueue.onRenamed = (conversationId, title) => {
          connectionRegistry.broadcastToAll({
            type: "conversation_renamed",
            conversationId,
            title,
          });
        };
      }
    }

    let sessionManager: SessionManager | null = null;
    let isStreaming = false;
    let currentConversationId: string | null = null;
    let currentTurnNumber = 0;

    // Hatching state
    let scriptedEngine: ScriptedHatchingEngine | null = null;
    let hatchingSession: ReturnType<typeof createHatchingSession> | null = null;

    // Register connection
    connectionRegistry.add(socket, null);

    // Start hatching if not hatched
    if (!fastify.isHatched) {
      scriptedEngine = new ScriptedHatchingEngine(fastify.agentDir, {
        send,
        onComplete: () => {
          // Phase 1 (scripted) complete, start Phase 2 (LLM)
          scriptedEngine = null;

          // Resolve auth so the SDK can find the API key
          try {
            resolveAuth(fastify.agentDir);
          } catch {
            // Auth might not be ready yet if using env auth
          }

          hatchingSession = createHatchingSession(fastify.agentDir, {
            send,
            onComplete: (agentName) => {
              // Hatching complete
              hatchingSession = null;
              fastify.isHatched = true;
              send({ type: "hatching_complete", agentName });
            },
          });

          // Verify auth is ready before starting
          const authKey = process.env.ANTHROPIC_API_KEY;
          const authOAuth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
          fastify.log.info(
            `Phase 2 starting — API key set: ${!!authKey}, OAuth set: ${!!authOAuth}`,
          );

          // Start the LLM hatching session
          (async () => {
            try {
              for await (const event of hatchingSession!.start()) {
                // Events are already forwarded by the session's callbacks
                // We just need to consume the generator
              }
            } catch (err) {
              // Log full error details to server console
              fastify.log.error(err, "Phase 2 hatching error");
              if (err instanceof Error) {
                fastify.log.error(
                  `Error details — name: ${err.name}, message: ${err.message}`,
                );
                if ("stderr" in err)
                  fastify.log.error(`stderr: ${(err as any).stderr}`);
                if ("stdout" in err)
                  fastify.log.error(`stdout: ${(err as any).stdout}`);
                if (err.cause)
                  fastify.log.error(`cause: ${JSON.stringify(err.cause)}`);
              }
              send({
                type: "error",
                message: err instanceof Error ? err.message : "Hatching error",
              });
            }
          })();
        },
      });

      scriptedEngine.start();
    } else {
      // If already hatched, send conversation state on connect
      (async () => {
        try {
          await handleConnect(null);
          // Push full entity snapshots to the newly connected client
          if (fastify.statePublisher) {
            await fastify.statePublisher.publishAllTo(socket);
          }
        } catch (err) {
          fastify.log.error(err, "Error loading conversation on connect");
          send({
            type: "error",
            message: "Failed to load conversation history",
          });
        }
      })();
    }

    socket.on("message", async (raw: Buffer) => {
      try {
        const msg: ClientMessage = JSON.parse(raw.toString());

        // Handle abort
        if (msg.type === "abort") {
          if (scriptedEngine) {
            scriptedEngine = null;
          }
          if (hatchingSession) {
            if (hatchingSession.query) {
              await hatchingSession.query.interrupt();
            }
            hatchingSession.cleanup();
            hatchingSession = null;
          }
          if (sessionManager) {
            await sessionManager.abort();
          }
          return;
        }

        // Handle control responses
        if (msg.type === "control_response") {
          if (scriptedEngine) {
            scriptedEngine.handleControlResponse(msg.controlId, msg.value);
          } else if (hatchingSession) {
            hatchingSession.handleControlResponse(msg.controlId, msg.value);
          }
          return;
        }

        // Handle conversation management (only after hatching complete)
        if (fastify.isHatched) {
          if (msg.type === "connect") {
            if (
              msg.conversationId &&
              !isValidConversationId(msg.conversationId)
            ) {
              send({ type: "error", message: "Invalid conversation ID" });
              return;
            }
            await handleConnect(msg.conversationId);
            return;
          }

          if (msg.type === "new_conversation") {
            await handleNewConversation();
            return;
          }

          if (msg.type === "switch_conversation") {
            if (!isValidConversationId(msg.conversationId)) {
              send({ type: "error", message: "Invalid conversation ID" });
              return;
            }
            await handleSwitchConversation(msg.conversationId);
            return;
          }

          if (msg.type === "rename_conversation") {
            await handleRenameConversation(msg.title);
            return;
          }

          if (msg.type === "load_more_turns") {
            await handleLoadMoreTurns(msg.before);
            return;
          }

          if (msg.type === "delete_conversation") {
            if (!isValidConversationId(msg.conversationId)) {
              send({ type: "error", message: "Invalid conversation ID" });
              return;
            }
            await handleDeleteConversation(msg.conversationId);
            return;
          }

          if (msg.type === "set_model") {
            await handleSetModel(msg.model);
            return;
          }

          // Handle notification interactions
          if (msg.type === "get_notifications") {
            const service = fastify.notificationService;
            if (service) {
              const notifications = service.getAll().map((n) => ({
                id: n.id,
                type: n.type,
                taskId: n.taskId,
                created: n.created.toISOString(),
                status: n.status,
                ...(n.type === "notify" && {
                  message: n.message,
                  importance: n.importance,
                }),
                ...(n.type === "request_input" && {
                  question: n.question,
                  options: n.options,
                  response: n.response,
                  respondedAt: n.respondedAt?.toISOString(),
                }),
                ...(n.type === "escalate" && {
                  problem: n.problem,
                  severity: n.severity,
                }),
              }));
              send({
                type: "notification_list",
                notifications,
                pendingCount: service.getPending().length,
              });
            }
            return;
          }

          if (msg.type === "notification_read") {
            const service = fastify.notificationService;
            if (service) {
              service.markRead(msg.notificationId);
            }
            return;
          }

          if (msg.type === "notification_respond") {
            const service = fastify.notificationService;
            if (service) {
              service.respond(msg.notificationId, msg.response);
            }
            return;
          }

          if (msg.type === "notification_dismiss") {
            const service = fastify.notificationService;
            if (service) {
              service.dismiss(msg.notificationId);
            }
            return;
          }
        }

        // Handle regular messages
        if (msg.type === "message") {
          // Need either text content or attachments
          const hasContent = msg.content?.trim();
          const hasAttachments = msg.attachments && msg.attachments.length > 0;
          if (!hasContent && !hasAttachments) return;

          // If in scripted hatching, treat as free text
          if (scriptedEngine) {
            scriptedEngine.handleFreeText(msg.content);
            return;
          }

          // If in LLM hatching, try to handle as free text
          if (hatchingSession) {
            const handled = hatchingSession.handleFreeText(msg.content);
            if (!handled) {
              // No pending control - the LLM is still processing
              send({
                type: "error",
                message: "Please wait for the question to finish loading",
              });
            }
            return;
          }

          // Normal chat mode
          if (isStreaming) {
            send({
              type: "error",
              message: "Already processing a message",
            });
            return;
          }

          if (msg.content.length > MAX_MESSAGE_LENGTH) {
            send({
              type: "error",
              message: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)`,
            });
            return;
          }

          await handleChatMessage(
            msg.content,
            msg.reasoning,
            msg.model,
            msg.attachments,
            msg.context,
          );
        }
      } catch (err) {
        send({ type: "error", message: "Invalid message format" });
      }
    });

    socket.on("close", async () => {
      fastify.log.info("Chat WebSocket disconnected");

      // Stop keepalive pings
      clearInterval(pingInterval);

      // Check if we need to queue abbreviation before removing from registry
      const wasLastViewer =
        currentConversationId &&
        connectionRegistry.getViewerCount(currentConversationId) === 1;

      // Remove from registry
      connectionRegistry.remove(socket);

      // If this was the last viewer, queue abbreviation
      if (wasLastViewer && currentConversationId && fastify.abbreviationQueue) {
        fastify.abbreviationQueue.enqueue(currentConversationId);
        fastify.log.info(
          `Last viewer left conversation ${currentConversationId}, queued for abbreviation`,
        );
      }

      // Cleanup hatching state
      scriptedEngine = null;
      if (hatchingSession) {
        if (hatchingSession.query) {
          await hatchingSession.query.interrupt();
        }
        hatchingSession.cleanup();
        hatchingSession = null;
      }
      if (sessionManager) {
        sessionManager.abort();
      }
    });

    /**
     * Handle connect - load conversation state
     */
    async function handleConnect(
      requestedConversationId?: string | null,
    ): Promise<void> {
      let conversation;

      if (requestedConversationId) {
        // Load specific conversation
        conversation = await conversationManager.get(requestedConversationId);
        if (!conversation) {
          send({
            type: "error",
            message: "Conversation not found",
          });
          return;
        }
      } else {
        // Load most recent web conversation
        conversation = await conversationManager.getMostRecent("web");
      }

      if (conversation) {
        // Load turns
        const turns = await conversationManager.getTurns(conversation.id, {
          limit: TURNS_PER_PAGE,
        });

        currentConversationId = conversation.id;
        currentTurnNumber = conversation.turnCount;

        // Get or create session for this conversation (load stored SDK session ID for resumption)
        const storedSessionId = conversationManager
          .getConversationDb()
          .getSdkSessionId(conversation.id);
        sessionManager = await sessionRegistry.getOrCreate(
          conversation.id,
          conversationManager,
          storedSessionId,
        );

        // Update registry
        connectionRegistry.switchConversation(socket, conversation.id);

        // Send conversation state
        send({
          type: "conversation_loaded",
          conversation: toConversationMeta(conversation),
          turns: turns.map(toTurn),
          hasMore: turns.length === TURNS_PER_PAGE,
        });
      } else {
        // No conversation yet - send empty state
        send({
          type: "conversation_loaded",
          conversation: null,
          turns: [],
          hasMore: false,
        });
      }

      // Get all conversations and split by pinned status
      const allConversations = await conversationManager.list({});

      // Pinned channel conversations → show in Channels section (read-only)
      const pinnedChannelConvs = allConversations.filter(
        (c) => c.channel !== "web" && c.isPinned,
      );

      // Web conversations + unpinned channel conversations → regular list
      const regularConvs = allConversations.filter(
        (c) => c.channel === "web" || !c.isPinned,
      );

      send({
        type: "conversation_list",
        conversations: regularConvs.slice(0, 50).map(toConversationMeta),
        channelConversations: pinnedChannelConvs.map(toConversationMeta),
      });
    }

    /**
     * Queue abbreviation+naming for the old conversation when switching away
     */
    function queueAbbreviationForCurrent(): void {
      if (currentConversationId && fastify.abbreviationQueue) {
        fastify.abbreviationQueue.enqueue(currentConversationId);
      }
    }

    /**
     * Handle new conversation
     */
    async function handleNewConversation(): Promise<void> {
      // Queue abbreviation for the conversation we're leaving
      queueAbbreviationForCurrent();

      // Create new conversation
      const conversation = await conversationManager.create("web");

      currentConversationId = conversation.id;
      currentTurnNumber = 0;

      // Create session for new conversation (will be cold/empty)
      sessionManager = await sessionRegistry.getOrCreate(
        conversation.id,
        conversationManager,
      );

      // Update registry
      connectionRegistry.switchConversation(socket, conversation.id);

      // Send conversation created to this socket (frontend handles reset + switch)
      send({
        type: "conversation_created",
        conversation: toConversationMeta(conversation),
      });

      // Broadcast to other sockets so their sidebar updates
      connectionRegistry.broadcastToAll(
        {
          type: "conversation_created",
          conversation: toConversationMeta(conversation),
        },
        socket,
      );

      // Broadcast updated conversation list as state snapshot
      fastify.statePublisher?.publishConversations();
    }

    /**
     * Handle switch conversation
     */
    async function handleSwitchConversation(
      conversationId: string,
    ): Promise<void> {
      // Queue abbreviation for the conversation we're leaving
      queueAbbreviationForCurrent();

      const conversation = await conversationManager.get(conversationId);

      if (!conversation) {
        send({
          type: "error",
          message: "Conversation not found",
        });
        return;
      }

      // Load turns
      const turns = await conversationManager.getTurns(conversation.id, {
        limit: TURNS_PER_PAGE,
      });

      currentConversationId = conversation.id;
      currentTurnNumber = conversation.turnCount;

      // Switch to session for new conversation (load stored SDK session ID for resumption)
      const storedSessionId = conversationManager
        .getConversationDb()
        .getSdkSessionId(conversationId);
      sessionManager = await sessionRegistry.getOrCreate(
        conversationId,
        conversationManager,
        storedSessionId,
      );

      // Update registry
      connectionRegistry.switchConversation(socket, conversation.id);

      // Send conversation state
      send({
        type: "conversation_loaded",
        conversation: toConversationMeta(conversation),
        turns: turns.map(toTurn),
        hasMore: turns.length === TURNS_PER_PAGE,
      });
    }

    /**
     * Handle rename conversation
     */
    async function handleRenameConversation(title: string): Promise<void> {
      if (!currentConversationId) {
        send({ type: "error", message: "No active conversation" });
        return;
      }

      const trimmedTitle = title.slice(0, MAX_TITLE_LENGTH);
      await conversationManager.setTitleManual(
        currentConversationId,
        trimmedTitle,
      );

      // Broadcast rename to all viewers including sender
      connectionRegistry.broadcastToConversation(currentConversationId, {
        type: "conversation_renamed",
        conversationId: currentConversationId,
        title: trimmedTitle,
      });
    }

    /**
     * Handle load more turns (pagination)
     */
    async function handleLoadMoreTurns(before: string): Promise<void> {
      if (!currentConversationId) {
        send({ type: "error", message: "No active conversation" });
        return;
      }

      const { turns, hasMore } = await conversationManager.getTurnsBefore(
        currentConversationId,
        before,
        TURNS_PER_PAGE,
      );

      send({
        type: "turns_loaded",
        turns: turns.map(toTurn),
        hasMore,
      });
    }

    /**
     * Handle delete conversation
     *
     * Cleanup includes:
     * - Cancel pending abbreviation task
     * - Clear idle timer
     * - Remove from session registry
     * - Delete from database + transcript
     * - Broadcast deletion to all tabs
     */
    async function handleDeleteConversation(
      conversationId: string,
    ): Promise<void> {
      // Verify conversation exists
      const conversation = await conversationManager.get(conversationId);
      if (!conversation) {
        send({ type: "error", message: "Conversation not found" });
        return;
      }

      // Cancel pending abbreviation task if exists
      if (fastify.abbreviationQueue) {
        fastify.abbreviationQueue.cancel(conversationId);
      }

      // Clear idle timer if exists
      if (idleTimerManager) {
        idleTimerManager.clear(conversationId);
      }

      // Remove from session registry if active
      sessionRegistry.remove(conversationId);

      // If this was the current conversation, clear local state
      if (currentConversationId === conversationId) {
        currentConversationId = null;
        currentTurnNumber = 0;
        sessionManager = null;
      }

      // Delete attachments folder
      if (attachmentService) {
        attachmentService.deleteConversationAttachments(conversationId);
      }

      // Delete from database + transcript
      await conversationManager.delete(conversationId);

      fastify.log.info(`Deleted conversation ${conversationId}`);

      // Broadcast deletion to all tabs
      connectionRegistry.broadcastToAll({
        type: "conversation_deleted",
        conversationId,
      });

      // Broadcast updated conversation list as state snapshot
      fastify.statePublisher?.publishConversations();
    }

    /**
     * Handle set model
     */
    async function handleSetModel(model: string): Promise<void> {
      if (!currentConversationId) {
        send({ type: "error", message: "No active conversation" });
        return;
      }

      // Validate model (basic validation - allow known models)
      const validModels = [
        "claude-sonnet-4-5-20250929",
        "claude-haiku-4-5-20251001",
        "claude-opus-4-6",
      ];
      if (!validModels.includes(model)) {
        send({ type: "error", message: "Invalid model" });
        return;
      }

      // Persist model to database
      await conversationManager.setModel(currentConversationId, model);

      fastify.log.info(
        `Set model for conversation ${currentConversationId}: ${model}`,
      );
    }

    /**
     * Handle chat message
     */
    async function handleChatMessage(
      content: string,
      reasoning?: boolean,
      model?: string,
      attachments?: Attachment[],
      context?: ViewContext | null,
    ): Promise<void> {
      // Log context if user is viewing something specific
      if (context) {
        fastify.log.info(
          `[Context] User viewing: ${context.title} (${context.type}${context.file ? `, file: ${context.file}` : ""})`,
        );
      }
      const textContent = content.trim().toLowerCase();

      // ── Slash command: /new ─────────────────────────────────────────
      if (textContent === "/new") {
        // Queue abbreviation for the conversation we're leaving
        queueAbbreviationForCurrent();

        // Create new conversation
        const conversation = await conversationManager.create("web");

        currentConversationId = conversation.id;
        currentTurnNumber = 0;

        // Create session for new conversation
        sessionManager = await sessionRegistry.getOrCreate(
          conversation.id,
          conversationManager,
        );

        // Update registry
        connectionRegistry.switchConversation(socket, conversation.id);

        // Build confirmation message as a turn (included in conversation_loaded)
        const confirmationTurn: Turn = {
          role: "assistant",
          content: "Starting fresh! How can I help?",
          timestamp: new Date().toISOString(),
          turnNumber: 0,
        };

        // Send conversation_loaded with the confirmation message included
        // This resets frontend state AND shows the welcome message in one event
        send({
          type: "conversation_loaded",
          conversation: toConversationMeta(conversation),
          turns: [confirmationTurn],
          hasMore: false,
        });

        // Also send conversation_created to update sidebar for THIS socket
        send({
          type: "conversation_created",
          conversation: toConversationMeta(conversation),
        });

        // Broadcast to other sockets so their sidebars update
        connectionRegistry.broadcastToAll(
          {
            type: "conversation_created",
            conversation: toConversationMeta(conversation),
          },
          socket,
        );

        // Broadcast updated conversation list as state snapshot
        fastify.statePublisher?.publishConversations();

        return;
      }

      // ── Slash command: /model ───────────────────────────────────────
      const modelMatch = textContent.match(/^\/model(?:\s+(\w+))?$/);
      if (modelMatch) {
        const modelArg = modelMatch[1];

        if (!modelArg) {
          // Show current model and options
          const conversation = currentConversationId
            ? await conversationManager.get(currentConversationId)
            : null;
          const currentModel =
            conversation?.model || "claude-sonnet-4-5-20250929";
          const modelName = currentModel.includes("opus")
            ? "Opus"
            : currentModel.includes("haiku")
              ? "Haiku"
              : "Sonnet";

          send({ type: "start" });
          send({
            type: "text_delta",
            content: `Current model: ${modelName}\n\nAvailable: /model opus, /model sonnet, /model haiku`,
          });
          send({ type: "done" });
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
          send({ type: "start" });
          send({
            type: "text_delta",
            content: `Unknown model "${modelArg}". Available: opus, sonnet, haiku`,
          });
          send({ type: "done" });
          return;
        }

        if (!currentConversationId) {
          send({ type: "start" });
          send({
            type: "text_delta",
            content: `No active conversation. Send a message first to start one.`,
          });
          send({ type: "done" });
          return;
        }

        // Update conversation model
        await conversationManager.setModel(currentConversationId, newModelId);

        // Invalidate cached session and stored SDK session so next message uses the new model fresh
        sessionRegistry.remove(currentConversationId);
        sessionManager = null;
        // Clear stored SDK session — model change requires a fresh SDK session
        conversationManager
          .getConversationDb()
          .updateSdkSessionId(currentConversationId, null);

        const modelName = modelArg.charAt(0).toUpperCase() + modelArg.slice(1);
        send({ type: "start" });
        send({ type: "text_delta", content: `Switched to ${modelName}.` });
        send({ type: "done" });

        // Broadcast model change to this and other clients
        connectionRegistry.broadcastToConversation(currentConversationId, {
          type: "conversation_model_changed",
          conversationId: currentConversationId,
          model: newModelId,
        });

        return;
      }

      // ── Normal message processing ───────────────────────────────────

      // Expand /my-agent:* skill commands (inject skill content)
      const expandedContent = await expandSkillCommand(content);
      const isSkillCommand = expandedContent !== content;
      if (isSkillCommand) {
        fastify.log.info(`Expanded skill command in message`);
      }

      // Create conversation if needed
      if (!currentConversationId) {
        const conversation = await conversationManager.create("web");
        currentConversationId = conversation.id;
        currentTurnNumber = 0;

        // Set model if provided (user selected before first message)
        if (model) {
          await conversationManager.setModel(conversation.id, model);
          conversation.model = model;
        }

        connectionRegistry.switchConversation(socket, conversation.id);

        send({
          type: "conversation_created",
          conversation: toConversationMeta(conversation),
        });

        // Broadcast to other sockets so their sidebar updates
        connectionRegistry.broadcastToAll(
          {
            type: "conversation_created",
            conversation: toConversationMeta(conversation),
          },
          socket,
        );

        // Broadcast updated conversation list as state snapshot
        fastify.statePublisher?.publishConversations();
      }

      // Get or create session for this conversation (load stored SDK session ID for resumption)
      if (!sessionManager) {
        const storedSid = conversationManager
          .getConversationDb()
          .getSdkSessionId(currentConversationId);
        sessionManager = await sessionRegistry.getOrCreate(
          currentConversationId,
          conversationManager,
          storedSid,
        );
        const isWarm = sessionRegistry.isWarm(currentConversationId);
        fastify.log.info(
          `Session ${isWarm ? "warm" : "cold"} for conversation ${currentConversationId}, sdkSessionId: ${storedSid ?? "none"}`,
        );
      }

      // Increment turn number
      currentTurnNumber++;
      const turnNumber = currentTurnNumber;
      const userTimestamp = new Date().toISOString();

      // Process attachments and build content blocks for Agent SDK
      type ContentBlock =
        | { type: "text"; text: string }
        | {
            type: "image";
            source: { type: "base64"; media_type: string; data: string };
          };

      let contentBlocks: ContentBlock[] | undefined;
      const savedAttachments: Array<{
        id: string;
        filename: string;
        localPath: string;
        mimeType: string;
        size: number;
      }> = [];

      if (attachments && attachments.length > 0 && attachmentService) {
        contentBlocks = [];

        // Add text content first if present, or a placeholder for image-only messages
        // Use expandedContent for brain (includes skill instructions if any)
        if (expandedContent.trim()) {
          contentBlocks.push({ type: "text", text: expandedContent });
        } else {
          // Image-only message — add minimal context for Claude
          contentBlocks.push({ type: "text", text: "What is this?" });
        }

        // Process each attachment
        for (const attachment of attachments) {
          try {
            const saved = await attachmentService.save(
              currentConversationId,
              attachment.filename,
              attachment.mimeType,
              attachment.base64Data,
            );
            savedAttachments.push(saved.meta);

            // Build content block based on type
            if (attachmentService.isImage(attachment.mimeType)) {
              // Image: add as image block
              contentBlocks.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: attachment.mimeType,
                  data: attachment.base64Data,
                },
              });
            } else {
              // Text file: decode and include as text
              const textContent = Buffer.from(
                attachment.base64Data,
                "base64",
              ).toString("utf-8");
              contentBlocks.push({
                type: "text",
                text: `<file name="${attachment.filename}">\n${textContent}\n</file>`,
              });
            }
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "Failed to save attachment";
            send({ type: "error", message });
            fastify.log.error(err, `Attachment save failed: ${message}`);
          }
        }

        // If no text content and contentBlocks is empty (all attachments failed), fall back
        if (contentBlocks.length === 0) {
          contentBlocks = undefined;
        }
      }

      // Save user turn (include attachment metadata if present)
      const userTurn: TranscriptTurn = {
        type: "turn",
        role: "user",
        content,
        timestamp: userTimestamp,
        turnNumber,
        attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
      };

      await conversationManager.appendTurn(currentConversationId, userTurn);

      // Touch idle timer on user message
      if (idleTimerManager) {
        idleTimerManager.touch(currentConversationId);
      }

      // Broadcast user turn to other tabs
      connectionRegistry.broadcastToConversation(
        currentConversationId,
        {
          type: "conversation_updated",
          conversationId: currentConversationId,
          turn: toTurn(userTurn),
        },
        socket,
      );

      // Send start
      send({ type: "start" });
      isStreaming = true;

      let assistantContent = "";
      let thinkingText = "";
      let usage: { input: number; output: number } | undefined;
      let cost: number | undefined;

      // Get model: prefer message's model, fall back to stored model
      const conversation = await conversationManager.get(currentConversationId);
      const modelOverride = model || conversation?.model || undefined;

      // Debug logging to trace model flow
      fastify.log.info(
        `[Model Debug] Message model: ${model}, Conversation model: ${conversation?.model}, Override: ${modelOverride}, ConvId: ${currentConversationId}`,
      );

      // If message specifies model and it differs from stored, persist it
      if (model && model !== conversation?.model) {
        await conversationManager.setModel(currentConversationId, model);
      }

      try {
        // Use content blocks if we have attachments, otherwise plain text
        // For brain: use expandedContent (with skill instructions)
        const messageContent = contentBlocks || expandedContent;
        fastify.log.info(
          `Sending message with ${Array.isArray(messageContent) ? messageContent.length + " content blocks" : "text"}`,
        );
        if (Array.isArray(messageContent)) {
          fastify.log.info(
            `Content block types: ${messageContent.map((b) => b.type).join(", ")}`,
          );
        }
        fastify.log.info("Starting stream iteration...");
        for await (const event of sessionManager.streamMessage(messageContent, {
          model: modelOverride,
          reasoning,
        })) {
          fastify.log.info(`Stream event: ${event.type}`);
          switch (event.type) {
            case "text_delta":
              assistantContent += event.text;
              send({ type: "text_delta", content: event.text });
              break;
            case "thinking_delta":
              thinkingText += event.text;
              send({ type: "thinking_delta", content: event.text });
              break;
            case "thinking_end":
              send({ type: "thinking_end" });
              break;
            case "done":
              usage = event.usage;
              cost = event.cost;
              send({
                type: "done",
                cost: event.cost,
                usage: event.usage,
              });
              break;
            case "error":
              send({ type: "error", message: event.message });
              break;
          }
        }
        fastify.log.info("Stream iteration complete");

        // Save assistant turn
        const assistantTurn: TranscriptTurn = {
          type: "turn",
          role: "assistant",
          content: assistantContent,
          timestamp: new Date().toISOString(),
          turnNumber,
          thinkingText: thinkingText || undefined,
          usage,
          cost,
        };

        await conversationManager.appendTurn(
          currentConversationId,
          assistantTurn,
        );

        // Persist SDK session ID for future resumption (cold starts, server restarts)
        const sdkSid = sessionManager?.getSessionId();
        if (sdkSid && currentConversationId) {
          conversationManager
            .getConversationDb()
            .updateSdkSessionId(currentConversationId, sdkSid);
        }

        // Touch idle timer on assistant response complete
        if (idleTimerManager) {
          idleTimerManager.touch(currentConversationId);
        }

        // Log turn completion for diagnostics
        fastify.log.info(
          `Turn ${currentTurnNumber} completed for ${currentConversationId}`,
        );

        // Trigger naming at turn 5 (fire-and-forget)
        if (currentTurnNumber === 5 && currentConversationId) {
          // Capture conversation ID to avoid closure issues if user switches
          const convIdForNaming = currentConversationId;

          // Lazily initialize naming service (auth handled by createBrainQuery)
          if (!namingService) {
            namingService = new NamingService();
          }

          // Fire-and-forget naming
          (async () => {
            try {
              // Check if title already set (user may have renamed manually)
              const conv = await conversationManager.get(convIdForNaming);
              if (conv?.title) {
                return;
              }

              const turns = await conversationManager.getRecentTurns(
                convIdForNaming,
                10,
              );
              const result = await namingService!.generateName(turns);
              await conversationManager.setTitle(convIdForNaming, result.title);
              await conversationManager.setTopics(
                convIdForNaming,
                result.topics,
              );

              // Broadcast to ALL clients
              connectionRegistry.broadcastToAll({
                type: "conversation_renamed",
                conversationId: convIdForNaming,
                title: result.title,
              });

              fastify.log.info(
                `Named conversation ${convIdForNaming}: ${result.title} [${result.topics.join(", ")}]`,
              );
            } catch (err) {
              fastify.log.error(
                err,
                `Naming failed for conversation ${convIdForNaming}`,
              );
            }
          })();
        }

        // ═══════════════════════════════════════════════════════════════════
        // Task Extraction — Deterministic task creation from user message
        // ═══════════════════════════════════════════════════════════════════
        if (
          fastify.taskManager &&
          fastify.taskProcessor &&
          currentConversationId
        ) {
          const convIdForTask = currentConversationId;

          // Fire-and-forget task extraction
          (async () => {
            try {
              const extraction = await extractTaskFromMessage(
                textContent,
                assistantContent,
              );

              if (extraction.shouldCreateTask && extraction.task) {
                // Build list of tasks to create: use tasks[] if multiple, otherwise single task
                const extractedTasks: ExtractedTask[] =
                  extraction.tasks && extraction.tasks.length > 1
                    ? extraction.tasks
                    : [extraction.task];

                for (const extracted of extractedTasks) {
                  const task = fastify.taskManager!.create({
                    type: extracted.type,
                    sourceType: "conversation",
                    title: extracted.title,
                    instructions: extracted.instructions,
                    work: extracted.work,
                    delivery: extracted.delivery,
                    scheduledFor: extracted.scheduledFor
                      ? new Date(extracted.scheduledFor)
                      : undefined,
                    createdBy: "agent",
                  });

                  // Link task to conversation
                  fastify.taskManager!.linkTaskToConversation(
                    task.id,
                    convIdForTask,
                  );

                  fastify.log.info(
                    `[TaskExtractor] Created task "${task.title}" (${task.id}) for conversation ${convIdForTask}`,
                  );

                  // Create calendar event for scheduled tasks (bidirectional linking)
                  if (task.type === "scheduled" && task.scheduledFor) {
                    try {
                      const calConfig = loadCalendarConfig(fastify.agentDir);
                      const credentials = loadCalendarCredentials(
                        fastify.agentDir,
                      );
                      if (calConfig && credentials) {
                        const calendarClient = createCalDAVClient(
                          calConfig,
                          credentials,
                        );
                        // Use the "user" calendar (personal calendar)
                        const calendarId = "user";
                        const endTime = new Date(
                          task.scheduledFor.getTime() + 5 * 60 * 1000,
                        ); // 5 min duration
                        const calEvent = await calendarClient.createEvent(
                          calendarId,
                          {
                            calendarId,
                            title: task.title,
                            start: task.scheduledFor,
                            end: endTime,
                            description: task.instructions,
                            taskId: task.id, // Link calendar event to task
                            taskType: "scheduled",
                            allDay: false,
                            status: "confirmed",
                            transparency: "opaque",
                          },
                        );
                        // Store calendar event UID back to task (bidirectional link)
                        fastify.taskManager!.update(task.id, {
                          sourceRef: `${calendarId}:${calEvent.uid}`,
                        });
                        fastify.log.info(
                          `[TaskExtractor] Created calendar event ${calEvent.uid} for scheduled task "${task.title}"`,
                        );
                      }
                    } catch (calErr) {
                      fastify.log.warn(
                        calErr,
                        `[TaskExtractor] Failed to create calendar event for task ${task.id}`,
                      );
                    }
                  }

                  // Trigger immediate task execution
                  fastify.taskProcessor!.onTaskCreated(task);

                  // Broadcast task creation to clients
                  connectionRegistry.broadcastToConversation(convIdForTask, {
                    type: "task:created",
                    task: {
                      id: task.id,
                      title: task.title,
                      type: task.type,
                      status: task.status,
                      work: task.work,
                      delivery: task.delivery,
                    },
                  } as any);
                }

                // Broadcast updated task list as state snapshot (once, after all tasks created)
                fastify.statePublisher?.publishTasks();
              }
            } catch (err) {
              fastify.log.error(
                err,
                `[TaskExtractor] Failed to extract task for conversation ${convIdForTask}`,
              );
            }
          })();
        }

        // Broadcast assistant turn to other tabs
        connectionRegistry.broadcastToConversation(
          currentConversationId,
          {
            type: "conversation_updated",
            conversationId: currentConversationId,
            turn: toTurn(assistantTurn),
          },
          socket,
        );
      } catch (err) {
        fastify.log.error(err, "Error in streamMessage");
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        isStreaming = false;
      }
    }

    function send(msg: ServerMessage) {
      if (socket.readyState === 1) {
        // WebSocket.OPEN
        socket.send(JSON.stringify(msg));
      }
    }
  });
}

/**
 * Convert Conversation to ConversationMeta for protocol
 */
function toConversationMeta(conv: Conversation): ConversationMeta {
  return {
    id: conv.id,
    channel: conv.channel,
    title: conv.title,
    topics: conv.topics,
    created: conv.created.toISOString(),
    updated: conv.updated.toISOString(),
    turnCount: conv.turnCount,
    model: conv.model,
    externalParty: conv.externalParty,
    isPinned: conv.isPinned,
  };
}

/**
 * Convert TranscriptTurn to Turn for protocol
 */
function toTurn(turn: TranscriptTurn): Turn {
  return {
    role: turn.role,
    content: turn.content,
    timestamp: turn.timestamp,
    turnNumber: turn.turnNumber,
    thinkingText: turn.thinkingText,
    usage: turn.usage,
    cost: turn.cost,
    attachments: turn.attachments,
  };
}
