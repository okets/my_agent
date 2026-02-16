import Fastify, { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import fastifyWebSocket from "@fastify/websocket";
import fastifyMultipart from "@fastify/multipart";
import { join } from "node:path";
import { registerChatWebSocket } from "./ws/chat-handler.js";
import { registerHatchingRoutes } from "./routes/hatching.js";
import type { ConversationManager } from "./conversations/index.js";
import type { AbbreviationQueue } from "./conversations/abbreviation.js";

export interface ServerOptions {
  agentDir: string;
}

// Augment Fastify types to include our custom decorators
declare module "fastify" {
  interface FastifyInstance {
    agentDir: string;
    isHatched: boolean;
    conversationManager: ConversationManager | null;
    abbreviationQueue: AbbreviationQueue | null;
  }
}

export async function createServer(
  options: ServerOptions,
): Promise<FastifyInstance> {
  const { agentDir } = options;

  const fastify = Fastify({
    logger: {
      level: "info",
      transport: {
        target: "pino-pretty",
        options: {
          translateTime: "HH:MM:ss Z",
          ignore: "pid,hostname",
        },
      },
    },
  });

  // Register CORS (allow all origins — single-user app)
  await fastify.register(fastifyCors, {
    origin: true,
  });

  // Register WebSocket support with increased payload for file uploads (6MB)
  await fastify.register(fastifyWebSocket, {
    options: {
      maxPayload: 6 * 1024 * 1024,
    },
  });

  // Register multipart/form-data support for file uploads
  await fastify.register(fastifyMultipart);

  // Serve static files from public/ directory
  await fastify.register(fastifyStatic, {
    root: join(import.meta.dirname, "../public"),
    prefix: "/",
  });

  // Serve attachments from {agentDir}/conversations/
  await fastify.register(fastifyStatic, {
    root: join(agentDir, "conversations"),
    prefix: "/attachments/",
    decorateReply: false, // Avoid conflict with first static plugin
  });

  // Store agentDir and isHatched status as decorators for route handlers
  fastify.decorate("agentDir", agentDir);
  fastify.decorate("isHatched", false); // Will be set by index.ts after checking
  fastify.decorate("conversationManager", null);
  fastify.decorate("abbreviationQueue", null);

  // Register WebSocket chat route
  await registerChatWebSocket(fastify);

  // Register hatching routes
  await registerHatchingRoutes(fastify);

  return fastify;
}
