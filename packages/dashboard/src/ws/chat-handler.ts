import type { FastifyInstance } from "fastify";
import { SessionManager } from "../agent/session-manager.js";
import type { ClientMessage, ServerMessage } from "./protocol.js";

const MAX_MESSAGE_LENGTH = 10000;

export async function registerChatWebSocket(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.get("/api/chat/ws", { websocket: true }, (socket, req) => {
    fastify.log.info("Chat WebSocket connected");
    const sessionManager = new SessionManager();

    socket.on("message", async (raw: Buffer) => {
      try {
        const msg: ClientMessage = JSON.parse(raw.toString());

        if (msg.type !== "message" || !msg.content?.trim()) return;

        if (msg.content.length > MAX_MESSAGE_LENGTH) {
          send({
            type: "error",
            message: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)`,
          });
          return;
        }

        // Check if agent is hatched
        if (!fastify.isHatched) {
          send({
            type: "error",
            message:
              "Agent not set up yet. Complete the hatching wizard first.",
          });
          return;
        }

        // Send start
        send({ type: "start" });

        try {
          const response = await sessionManager.sendMessage(msg.content);
          send({ type: "chunk", content: response });
          send({ type: "done" });
        } catch (err) {
          send({
            type: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
        }
      } catch (err) {
        send({ type: "error", message: "Invalid message format" });
      }
    });

    socket.on("close", () => {
      fastify.log.info("Chat WebSocket disconnected");
    });

    function send(msg: ServerMessage) {
      if (socket.readyState === 1) {
        // WebSocket.OPEN
        socket.send(JSON.stringify(msg));
      }
    }
  });
}
