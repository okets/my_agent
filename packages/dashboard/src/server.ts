import Fastify, { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import fastifyWebSocket from "@fastify/websocket";
import fastifyMultipart from "@fastify/multipart";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { registerChatWebSocket } from "./ws/chat-handler.js";
import { registerHatchingRoutes } from "./routes/hatching.js";
import { registerChannelRoutes } from "./routes/channels.js";
import { registerCalendarRoutes } from "./routes/calendar.js";
import { registerDebugRoutes } from "./routes/debug.js";
import { registerAdminRoutes } from "./routes/admin.js";
import type { ConversationManager } from "./conversations/index.js";
import type { AbbreviationQueue } from "./conversations/abbreviation.js";
import type { ChannelManager } from "./channels/index.js";
import type { ChannelMessageHandler } from "./channels/message-handler.js";
import type { TaskManager, TaskLogStorage } from "./tasks/index.js";
import type { CalendarScheduler } from "@my-agent/core";

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
    channelManager: ChannelManager | null;
    channelMessageHandler: ChannelMessageHandler | null;
    taskManager: TaskManager | null;
    logStorage: TaskLogStorage | null;
    calendarScheduler: CalendarScheduler | null;
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
  fastify.decorate("channelManager", null);
  fastify.decorate("channelMessageHandler", null);
  fastify.decorate("taskManager", null);
  fastify.decorate("logStorage", null);
  fastify.decorate("calendarScheduler", null);

  // Register WebSocket chat route
  await registerChatWebSocket(fastify);

  // Register hatching routes
  await registerHatchingRoutes(fastify);

  // Register channel routes
  await registerChannelRoutes(fastify);

  // Register calendar routes
  await registerCalendarRoutes(fastify);

  // Register debug API routes (localhost-only)
  await fastify.register(
    async (instance) => {
      await registerDebugRoutes(instance);
    },
    { prefix: "/api/debug" },
  );

  // Register admin API routes (localhost-only)
  await fastify.register(
    async (instance) => {
      await registerAdminRoutes(instance);
    },
    { prefix: "/api/admin" },
  );

  // Notebook API - read runtime files
  fastify.get<{ Params: { name: string } }>(
    "/api/notebook/:name",
    async (request, reply) => {
      const { name } = request.params;

      // Only allow specific notebook files (security)
      const allowedFiles = [
        "external-communications",
        "reminders",
        "standing-orders",
      ];
      if (!allowedFiles.includes(name)) {
        return reply.code(404).send({ error: "File not found" });
      }

      const filePath = join(agentDir, "runtime", `${name}.md`);
      try {
        const content = await readFile(filePath, "utf-8");
        return { content };
      } catch {
        // Return empty content if file doesn't exist
        return { content: "" };
      }
    },
  );

  return fastify;
}
