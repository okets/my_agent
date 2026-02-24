import Fastify, { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import fastifyWebSocket from "@fastify/websocket";
import fastifyMultipart from "@fastify/multipart";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { registerChatWebSocket } from "./ws/chat-handler.js";
import { registerHatchingRoutes } from "./routes/hatching.js";
import { registerChannelRoutes } from "./routes/channels.js";
import { registerCalendarRoutes } from "./routes/calendar.js";
import { registerDebugRoutes } from "./routes/debug.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import type { ConversationManager } from "./conversations/index.js";
import type { AbbreviationQueue } from "./conversations/abbreviation.js";
import type { ChannelManager } from "./channels/index.js";
import type { ChannelMessageHandler } from "./channels/message-handler.js";
import type {
  TaskManager,
  TaskLogStorage,
  TaskProcessor,
  TaskScheduler,
} from "./tasks/index.js";
import type {
  CalendarScheduler,
  NotificationService,
  MemoryDb,
  SyncService,
  SearchService,
  PluginRegistry,
} from "@my-agent/core";
import type { StatePublisher } from "./state/state-publisher.js";

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
    taskProcessor: TaskProcessor | null;
    taskScheduler: TaskScheduler | null;
    calendarScheduler: CalendarScheduler | null;
    notificationService: NotificationService | null;
    statePublisher: StatePublisher | null;
    // Memory system (M6-S1)
    memoryDb: MemoryDb | null;
    syncService: SyncService | null;
    searchService: SearchService | null;
    pluginRegistry: PluginRegistry | null;
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

  // Generate build version from git hash (falls back to startup timestamp)
  let buildVersion: string;
  try {
    buildVersion = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf-8",
    }).trim();
  } catch {
    buildVersion = Date.now().toString(36);
  }
  fastify.log.info(`Build version: ${buildVersion}`);

  // Serve index.html with build version injected (replaces __BUILD_VERSION__)
  const publicDir = join(import.meta.dirname, "../public");
  fastify.get("/", async (_request, reply) => {
    const html = await readFile(join(publicDir, "index.html"), "utf-8");
    return reply
      .type("text/html")
      .send(html.replaceAll("__BUILD_VERSION__", buildVersion));
  });

  // Serve static files from public/ directory (index: false — / is handled by custom route above)
  await fastify.register(fastifyStatic, {
    root: publicDir,
    prefix: "/",
    index: false,
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
  fastify.decorate("taskProcessor", null);
  fastify.decorate("taskScheduler", null);
  fastify.decorate("calendarScheduler", null);
  fastify.decorate("notificationService", null);
  fastify.decorate("statePublisher", null);
  // Memory system (M6-S1)
  fastify.decorate("memoryDb", null);
  fastify.decorate("syncService", null);
  fastify.decorate("searchService", null);
  fastify.decorate("pluginRegistry", null);

  // Register WebSocket chat route
  await registerChatWebSocket(fastify);

  // Register hatching routes
  await registerHatchingRoutes(fastify);

  // Register channel routes
  await registerChannelRoutes(fastify);

  // Register calendar routes
  await registerCalendarRoutes(fastify);

  // Register notification routes
  await registerNotificationRoutes(fastify);

  // Register task routes
  await registerTaskRoutes(fastify);

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
