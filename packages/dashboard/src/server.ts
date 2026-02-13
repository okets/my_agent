import Fastify, { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import fastifyWebSocket from "@fastify/websocket";
import fastifyMultipart from "@fastify/multipart";
import { join } from "node:path";
import { registerChatWebSocket } from "./ws/chat-handler.js";

export interface ServerOptions {
  agentDir: string;
}

// Augment Fastify types to include our custom decorators
declare module "fastify" {
  interface FastifyInstance {
    agentDir: string;
    isHatched: boolean;
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

  // Register WebSocket support
  await fastify.register(fastifyWebSocket);

  // Register multipart/form-data support for file uploads
  await fastify.register(fastifyMultipart);

  // Serve static files from public/ directory
  await fastify.register(fastifyStatic, {
    root: join(import.meta.dirname, "../public"),
    prefix: "/",
  });

  // Store agentDir and isHatched status as decorators for route handlers
  fastify.decorate("agentDir", agentDir);
  fastify.decorate("isHatched", false); // Will be set by index.ts after checking

  // Register WebSocket chat route
  await registerChatWebSocket(fastify);

  return fastify;
}
