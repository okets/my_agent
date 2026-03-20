/**
 * Chat WebSocket adapter — thin transport layer.
 *
 * Parses JSON → calls app.chat.* → sends results as JSON.
 * Business logic lives in AppChatService (src/chat/chat-service.ts).
 *
 * M6.10-S3: Design spec §S3 (Chat Handler Decomposition)
 */

import type { FastifyInstance } from "fastify";
import * as path from "node:path";
import { ScriptedHatchingEngine } from "../hatching/scripted-engine.js";
import { createHatchingSession } from "../hatching/hatching-tools.js";
import { resolveAuth, isAuthenticated, loadModels } from "@my-agent/core";
import { IdleTimerManager } from "../conversations/idle-timer.js";
import { ConnectionRegistry } from "./connection-registry.js";
import { AttachmentService } from "../conversations/attachments.js";
import { ResponseTimer } from "../channels/response-timer.js";
import { isValidConversationId } from "../chat/chat-service.js";
import type { ChatEvent, StartEffects } from "../chat/types.js";
import type { ClientMessage, ServerMessage } from "./protocol.js";

// Global connection registry for multi-tab sync (exported for index.ts wiring)
export const connectionRegistry = new ConnectionRegistry();

// Lazily initialized on first WS connection
let idleTimerManager: IdleTimerManager | null = null;
let attachmentService: AttachmentService | null = null;

export async function registerChatWebSocket(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.get("/api/chat/ws", { websocket: true }, (socket, req) => {
    fastify.log.info("Chat WebSocket connected");

    const pingInterval = setInterval(() => {
      if (socket.readyState === 1) socket.ping();
    }, 30000);

    const app = fastify.app!;

    // Initialize attachment service once
    if (!attachmentService) {
      attachmentService = new AttachmentService(fastify.agentDir);
    }

    // Wire ChatService deps once (idempotent)
    if (!idleTimerManager && fastify.abbreviationQueue) {
      idleTimerManager = new IdleTimerManager(
        fastify.abbreviationQueue,
        connectionRegistry,
      );
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

    app.chat.setDeps({
      abbreviationQueue: fastify.abbreviationQueue,
      idleTimerManager,
      attachmentService,
      conversationSearchService: fastify.conversationSearchService,
      postResponseHooks: fastify.postResponseHooks,
      log: (msg) => fastify.log.info(msg),
      logError: (err, msg) => fastify.log.error(err, msg),
    });

    // Per-connection state
    let currentConversationId: string | null = null;
    let currentTurnNumber = 0;
    let isStreaming = false;

    // Hatching state
    let scriptedEngine: ScriptedHatchingEngine | null = null;
    let hatchingSession: ReturnType<typeof createHatchingSession> | null = null;
    let isAuthCompleted = false;

    connectionRegistry.add(socket, null);

    // ── Auth gate ───────────────────────────────────────────────────

    function startHatchingPhase2(): void {
      try {
        resolveAuth(fastify.agentDir);
      } catch {}

      hatchingSession = createHatchingSession(fastify.agentDir, {
        send,
        onComplete: (agentName) => {
          hatchingSession = null;
          fastify.isHatched = true;
          send({ type: "hatching_complete", agentName });
        },
      });

      (async () => {
        try {
          for await (const event of hatchingSession!.start()) {
            // Events forwarded by session callbacks
          }
        } catch (err) {
          fastify.log.error(err, "Phase 2 hatching error");
          send({
            type: "error",
            message: err instanceof Error ? err.message : "Hatching error",
          });
        }
      })();
    }

    function proceedAfterAuth(): void {
      isAuthCompleted = true;
      send({ type: "auth_ok" });

      if (!fastify.isHatched) {
        startHatchingPhase2();
      } else {
        (async () => {
          try {
            const result = await app.chat.connect(null);
            currentConversationId = result.conversation?.id ?? null;
            currentTurnNumber =
              result.conversation?.turnCount ?? 0;

            if (currentConversationId) {
              // Get/create session for resumption
              const storedSid = app.conversationManager
                .getConversationDb()
                .getSdkSessionId(currentConversationId);
              await app.sessionRegistry.getOrCreate(
                currentConversationId,
                storedSid,
              );
              connectionRegistry.switchConversation(
                socket,
                currentConversationId,
              );
            }

            send({
              type: "conversation_loaded",
              conversation: result.conversation,
              turns: result.turns,
              hasMore: result.hasMore,
            });
            send({
              type: "conversation_list",
              conversations: result.allConversations,
            });

            if (fastify.statePublisher) {
              await fastify.statePublisher.publishAllTo(socket);
            }
          } catch (err) {
            fastify.log.error(err, "Error loading conversation on connect");
            send({ type: "error", message: "Failed to load conversation history" });
          }
        })();
      }
    }

    if (!isAuthenticated()) {
      send({ type: "auth_required" });
      const envPath = path.resolve(import.meta.dirname, "../../.env");
      scriptedEngine = new ScriptedHatchingEngine(fastify.agentDir, envPath, {
        send,
        onComplete: () => {
          scriptedEngine = null;
          proceedAfterAuth();
        },
      });
      scriptedEngine.start();
    } else {
      proceedAfterAuth();
    }

    // ── Message routing ─────────────────────────────────────────────

    socket.on("message", async (raw: Buffer) => {
      try {
        const msg: ClientMessage = JSON.parse(raw.toString());

        if (msg.type === "abort") {
          if (scriptedEngine) scriptedEngine = null;
          if (hatchingSession) {
            if (hatchingSession.query) await hatchingSession.query.interrupt();
            hatchingSession.cleanup();
            hatchingSession = null;
          }
          // Abort active session by removing it (remove() calls abort() internally)
          if (currentConversationId && app.sessionRegistry.isWarm(currentConversationId)) {
            app.sessionRegistry.remove(currentConversationId);
          }
          return;
        }

        if (msg.type === "control_response") {
          if (scriptedEngine) scriptedEngine.handleControlResponse(msg.controlId, msg.value);
          else if (hatchingSession) hatchingSession.handleControlResponse(msg.controlId, msg.value);
          return;
        }

        if (!isAuthCompleted) {
          send({ type: "error", message: "Authentication required" });
          return;
        }

        if (msg.type === "message") {
          if (scriptedEngine) { scriptedEngine.handleFreeText(msg.content); return; }
          if (hatchingSession) {
            if (!hatchingSession.handleFreeText(msg.content)) {
              send({ type: "error", message: "Please wait for the question to finish loading" });
            }
            return;
          }
        }

        if (!fastify.isHatched) return;

        // ── Conversation management ───────────────────────────────
        await handleMessage(msg);
      } catch {
        send({ type: "error", message: "Invalid message format" });
      }
    });

    async function handleMessage(msg: ClientMessage): Promise<void> {
      switch (msg.type) {
        case "connect": {
          if (msg.conversationId && !isValidConversationId(msg.conversationId)) {
            send({ type: "error", message: "Invalid conversation ID" });
            return;
          }
          try {
            const result = await app.chat.connect(msg.conversationId);
            currentConversationId = result.conversation?.id ?? null;
            currentTurnNumber = result.conversation?.turnCount ?? 0;
            if (currentConversationId) {
              const storedSid = app.conversationManager.getConversationDb().getSdkSessionId(currentConversationId);
              await app.sessionRegistry.getOrCreate(currentConversationId, storedSid);
              connectionRegistry.switchConversation(socket, currentConversationId);
            }
            send({ type: "conversation_loaded", conversation: result.conversation, turns: result.turns, hasMore: result.hasMore });
            send({ type: "conversation_list", conversations: result.allConversations });
          } catch (err) {
            send({ type: "error", message: err instanceof Error ? err.message : "Error" });
          }
          return;
        }

        case "new_conversation": {
          if (currentConversationId) {
            await app.chat.deleteIfEmpty(currentConversationId);
            if (fastify.abbreviationQueue) fastify.abbreviationQueue.enqueue(currentConversationId);
          }
          const result = await app.chat.newConversation();
          currentConversationId = result.conversation.id;
          currentTurnNumber = 0;
          await app.sessionRegistry.getOrCreate(result.conversation.id);
          connectionRegistry.switchConversation(socket, result.conversation.id);
          send({ type: "conversation_created", conversation: result.conversation });
          connectionRegistry.broadcastToAll({ type: "conversation_created", conversation: result.conversation }, socket);
          return;
        }

        case "switch_conversation": {
          if (!isValidConversationId(msg.conversationId)) {
            send({ type: "error", message: "Invalid conversation ID" });
            return;
          }
          if (currentConversationId) {
            await app.chat.deleteIfEmpty(currentConversationId);
            if (fastify.abbreviationQueue) fastify.abbreviationQueue.enqueue(currentConversationId);
          }
          try {
            const result = await app.chat.switchConversation(msg.conversationId);
            currentConversationId = result.conversation.id;
            currentTurnNumber = result.conversation.turnCount;
            const storedSid = app.conversationManager.getConversationDb().getSdkSessionId(msg.conversationId);
            await app.sessionRegistry.getOrCreate(msg.conversationId, storedSid);
            connectionRegistry.switchConversation(socket, result.conversation.id);
            send({ type: "conversation_loaded", conversation: result.conversation, turns: result.turns, hasMore: result.hasMore });
          } catch (err) {
            send({ type: "error", message: err instanceof Error ? err.message : "Error" });
          }
          return;
        }

        case "rename_conversation": {
          if (!currentConversationId) { send({ type: "error", message: "No active conversation" }); return; }
          const trimmed = await app.chat.renameConversation(currentConversationId, msg.title);
          connectionRegistry.broadcastToConversation(currentConversationId, {
            type: "conversation_renamed", conversationId: currentConversationId, title: trimmed,
          });
          return;
        }

        case "load_more_turns": {
          if (!currentConversationId) { send({ type: "error", message: "No active conversation" }); return; }
          const result = await app.chat.loadMoreTurns(currentConversationId, msg.before);
          send({ type: "turns_loaded", turns: result.turns, hasMore: result.hasMore });
          return;
        }

        case "delete_conversation": {
          if (!isValidConversationId(msg.conversationId)) {
            send({ type: "error", message: "Invalid conversation ID" });
            return;
          }
          try {
            await app.chat.deleteConversation(msg.conversationId, {
              cancelAbbreviation: (id) => fastify.abbreviationQueue?.cancel(id),
              clearIdleTimer: (id) => idleTimerManager?.clear(id),
              deleteAttachments: (id) => attachmentService?.deleteConversationAttachments(id),
              removeSearchEmbeddings: (id) => fastify.conversationSearchService?.removeConversation(id),
            });
            if (currentConversationId === msg.conversationId) {
              currentConversationId = null;
              currentTurnNumber = 0;
            }
            connectionRegistry.broadcastToAll({ type: "conversation_deleted", conversationId: msg.conversationId });
          } catch (err) {
            send({ type: "error", message: err instanceof Error ? err.message : "Error" });
          }
          return;
        }

        case "set_model": {
          if (!currentConversationId) { send({ type: "error", message: "No active conversation" }); return; }
          try {
            await app.chat.setModel(currentConversationId, msg.model);
            fastify.log.info(`Set model for conversation ${currentConversationId}: ${msg.model}`);
          } catch (err) {
            send({ type: "error", message: err instanceof Error ? err.message : "Error" });
          }
          return;
        }

        // ── Notifications ───────────────────────────────────────────
        case "get_notifications": {
          const service = fastify.notificationService;
          if (service) {
            const notifications = service.getAll().map((n) => ({
              id: n.id, type: n.type, taskId: n.taskId,
              created: n.created.toISOString(), status: n.status,
              ...(n.type === "notify" && { message: n.message, importance: n.importance }),
              ...(n.type === "request_input" && { question: n.question, options: n.options, response: n.response, respondedAt: n.respondedAt?.toISOString() }),
              ...(n.type === "escalate" && { problem: n.problem, severity: n.severity }),
            }));
            send({ type: "notification_list", notifications, pendingCount: service.getPending().length });
          }
          return;
        }
        case "notification_read": { fastify.notificationService?.markRead(msg.notificationId); return; }
        case "notification_respond": { fastify.notificationService?.respond(msg.notificationId, msg.response); return; }
        case "notification_dismiss": { fastify.notificationService?.dismiss(msg.notificationId); return; }

        // ── Chat message ────────────────────────────────────────────
        case "message": {
          const hasContent = msg.content?.trim();
          const hasAttachments = msg.attachments && msg.attachments.length > 0;
          if (!hasContent && !hasAttachments) return;
          if (isStreaming) { send({ type: "error", message: "Already processing a message" }); return; }

          await handleChatMessage(msg.content, msg.reasoning, msg.model, msg.attachments, msg.context);
          return;
        }
      }
    }

    // ── Chat message handling ───────────────────────────────────────

    async function handleChatMessage(
      content: string,
      reasoning?: boolean,
      model?: string,
      attachments?: Array<{ filename: string; base64Data: string; mimeType: string }>,
      context?: { type: string; title: string; file?: string; taskId?: string } | null,
    ): Promise<void> {
      const textContent = content.trim().toLowerCase();

      // /new command
      if (textContent === "/new") {
        if (currentConversationId) {
          await app.chat.deleteIfEmpty(currentConversationId);
          if (fastify.abbreviationQueue) fastify.abbreviationQueue.enqueue(currentConversationId);
        }
        const result = await app.chat.newConversationWithWelcome();
        currentConversationId = result.conversation.id;
        currentTurnNumber = 0;
        await app.sessionRegistry.getOrCreate(result.conversation.id);
        connectionRegistry.switchConversation(socket, result.conversation.id);
        send({ type: "conversation_loaded", conversation: result.conversation, turns: result.turns, hasMore: result.hasMore });
        send({ type: "conversation_created", conversation: result.conversation });
        connectionRegistry.broadcastToAll({ type: "conversation_created", conversation: result.conversation }, socket);
        return;
      }

      // /model command
      const modelMatch = textContent.match(/^\/model(?:\s+(\w+))?$/);
      if (modelMatch) {
        for await (const event of app.chat.handleModelCommand(currentConversationId, modelMatch[1])) {
          send(chatEventToServerMessage(event));
        }
        if (modelMatch[1] && currentConversationId) {
          const models = loadModels();
          const newModelId = { opus: models.opus, sonnet: models.sonnet, haiku: models.haiku }[modelMatch[1]];
          if (newModelId) {
            connectionRegistry.broadcastToConversation(currentConversationId, {
              type: "conversation_model_changed", conversationId: currentConversationId, model: newModelId,
            });
          }
        }
        return;
      }

      // Normal message — stream via ChatService
      isStreaming = true;
      currentTurnNumber++;

      // Response timer (adapter-owned for interim status UX)
      const responseTimer = new ResponseTimer({
        sendTyping: async () => {},
        sendInterim: async (message) => send({ type: "interim_status", message }),
      });
      responseTimer.start();

      try {
        let firstToken = true;
        for await (const event of app.chat.sendMessage(
          currentConversationId,
          content,
          currentTurnNumber,
          { reasoning, model, attachments, context },
        )) {
          // Handle start effects
          if (event.type === "start" && event._effects) {
            const effects = event._effects as StartEffects;
            currentConversationId = effects.conversationId;
            if (effects.conversationCreated) {
              connectionRegistry.switchConversation(socket, effects.conversationId);
              send({ type: "conversation_created", conversation: effects.conversationCreated });
              connectionRegistry.broadcastToAll({ type: "conversation_created", conversation: effects.conversationCreated }, socket);
            }
            connectionRegistry.broadcastToConversation(
              effects.conversationId,
              { type: "conversation_updated", conversationId: effects.conversationId, turn: effects.userTurn },
              socket,
            );
          }

          const serverMsg = chatEventToServerMessage(event);
          if (serverMsg.type === "text_delta" && firstToken) {
            responseTimer.cancel();
            firstToken = false;
          }
          send(serverMsg);
        }

        // Broadcast assistant turn to other tabs
        // (The assistant content was saved by ChatService; we need the turn for broadcast)
        // Naming broadcasts are handled via app events → StatePublisher
      } catch (err) {
        responseTimer.cancel();
        send({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
      } finally {
        responseTimer.cancel();
        isStreaming = false;
      }
    }

    // ── Socket close ────────────────────────────────────────────────

    socket.on("close", async () => {
      fastify.log.info("Chat WebSocket disconnected");
      clearInterval(pingInterval);

      const wasLastViewer = currentConversationId && connectionRegistry.getViewerCount(currentConversationId) === 1;
      connectionRegistry.remove(socket);

      if (wasLastViewer && currentConversationId && fastify.abbreviationQueue) {
        fastify.abbreviationQueue.enqueue(currentConversationId);
      }

      scriptedEngine = null;
      if (hatchingSession) {
        if (hatchingSession.query) await hatchingSession.query.interrupt();
        hatchingSession.cleanup();
        hatchingSession = null;
      }
    });

    // ── Send helper ─────────────────────────────────────────────────

    function send(msg: ServerMessage): void {
      if (socket.readyState === 1) socket.send(JSON.stringify(msg));
    }
  });
}

/** Map ChatEvent to ServerMessage wire format. */
function chatEventToServerMessage(event: ChatEvent): ServerMessage {
  switch (event.type) {
    case "start":
      return { type: "start" };
    case "text_delta":
      return { type: "text_delta", content: event.text };
    case "thinking_delta":
      return { type: "thinking_delta", content: event.text };
    case "thinking_end":
      return { type: "thinking_end" };
    case "done":
      return { type: "done", cost: event.cost, usage: event.usage };
    case "error":
      return { type: "error", message: event.message };
  }
}
