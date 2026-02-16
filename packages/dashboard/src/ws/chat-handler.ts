import type { FastifyInstance } from "fastify";
import { SessionRegistry } from "../agent/session-registry.js";
import type { SessionManager } from "../agent/session-manager.js";
import { ScriptedHatchingEngine } from "../hatching/scripted-engine.js";
import { createHatchingSession } from "../hatching/hatching-tools.js";
import { resolveAuth } from "@my-agent/core";
import { IdleTimerManager, NamingService } from "../conversations/index.js";
import type { ConversationManager } from "../conversations/index.js";
import type { Conversation, TranscriptTurn } from "../conversations/types.js";
import { ConnectionRegistry } from "./connection-registry.js";
import type {
  ClientMessage,
  ServerMessage,
  ConversationMeta,
  Turn,
} from "./protocol.js";

const MAX_MESSAGE_LENGTH = 10000;
const MAX_TITLE_LENGTH = 100;
const TURNS_PER_PAGE = 50;
const CONVERSATION_ID_RE = /^conv-[A-Z0-9]{26}$/;

// Global connection registry for multi-tab sync
const connectionRegistry = new ConnectionRegistry();

// Global idle timer manager (lazily initialized on first WS connection)
let idleTimerManager: IdleTimerManager | null = null;

// Global naming service (lazily initialized when needed)
let namingService: NamingService | null = null;

// Global session registry for conversation-bound sessions
const sessionRegistry = new SessionRegistry(5); // Max 5 concurrent sessions

function isValidConversationId(id: string): boolean {
  return CONVERSATION_ID_RE.test(id);
}

export async function registerChatWebSocket(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.get("/api/chat/ws", { websocket: true }, (socket, req) => {
    fastify.log.info("Chat WebSocket connected");

    // Use shared ConversationManager from fastify decorator
    const conversationManager = fastify.conversationManager!;

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
        }

        // Handle regular messages
        if (msg.type === "message") {
          if (!msg.content?.trim()) return;

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

          await handleChatMessage(msg.content);
        }
      } catch (err) {
        send({ type: "error", message: "Invalid message format" });
      }
    });

    socket.on("close", async () => {
      fastify.log.info("Chat WebSocket disconnected");

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

        // Get or create session for this conversation
        sessionManager = await sessionRegistry.getOrCreate(
          conversation.id,
          conversationManager,
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

      // Send conversation list for sidebar
      const conversations = await conversationManager.list({
        channel: "web",
        limit: 50,
      });

      send({
        type: "conversation_list",
        conversations: conversations.map(toConversationMeta),
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

      // Switch to session for new conversation
      sessionManager = await sessionRegistry.getOrCreate(
        conversationId,
        conversationManager,
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
     * Handle chat message
     */
    async function handleChatMessage(content: string): Promise<void> {
      // Create conversation if needed
      if (!currentConversationId) {
        const conversation = await conversationManager.create("web");
        currentConversationId = conversation.id;
        currentTurnNumber = 0;

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
      }

      // Get or create session for this conversation
      if (!sessionManager) {
        sessionManager = await sessionRegistry.getOrCreate(
          currentConversationId,
          conversationManager,
        );
        const isWarm = sessionRegistry.isWarm(currentConversationId);
        fastify.log.info(
          `Session ${isWarm ? "warm" : "cold"} for conversation ${currentConversationId}`,
        );
      }

      // Increment turn number
      currentTurnNumber++;
      const turnNumber = currentTurnNumber;
      const userTimestamp = new Date().toISOString();

      // Save user turn
      const userTurn: TranscriptTurn = {
        type: "turn",
        role: "user",
        content,
        timestamp: userTimestamp,
        turnNumber,
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

      try {
        for await (const event of sessionManager.streamMessage(content)) {
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
  };
}
