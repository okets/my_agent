import type { FastifyInstance } from "fastify";
import { SessionManager } from "../agent/session-manager.js";
import { ScriptedHatchingEngine } from "../hatching/scripted-engine.js";
import { createHatchingSession } from "../hatching/hatching-tools.js";
import { resolveAuth } from "@my-agent/core";
import type { ClientMessage, ServerMessage } from "./protocol.js";

const MAX_MESSAGE_LENGTH = 10000;

export async function registerChatWebSocket(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.get("/api/chat/ws", { websocket: true }, (socket, req) => {
    fastify.log.info("Chat WebSocket connected");
    const sessionManager = new SessionManager();
    let isStreaming = false;

    // Hatching state
    let scriptedEngine: ScriptedHatchingEngine | null = null;
    let hatchingSession: ReturnType<typeof createHatchingSession> | null = null;

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
          await sessionManager.abort();
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

          // Send start
          send({ type: "start" });
          isStreaming = true;

          try {
            for await (const event of sessionManager.streamMessage(
              msg.content,
            )) {
              switch (event.type) {
                case "text_delta":
                  send({ type: "text_delta", content: event.text });
                  break;
                case "thinking_delta":
                  send({ type: "thinking_delta", content: event.text });
                  break;
                case "thinking_end":
                  send({ type: "thinking_end" });
                  break;
                case "done":
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
          } catch (err) {
            send({
              type: "error",
              message: err instanceof Error ? err.message : "Unknown error",
            });
          } finally {
            isStreaming = false;
          }
        }
      } catch (err) {
        send({ type: "error", message: "Invalid message format" });
      }
    });

    socket.on("close", async () => {
      fastify.log.info("Chat WebSocket disconnected");
      scriptedEngine = null;
      if (hatchingSession) {
        if (hatchingSession.query) {
          await hatchingSession.query.interrupt();
        }
        hatchingSession.cleanup();
        hatchingSession = null;
      }
      sessionManager.abort();
    });

    function send(msg: ServerMessage) {
      if (socket.readyState === 1) {
        // WebSocket.OPEN
        socket.send(JSON.stringify(msg));
      }
    }
  });
}
