import Fastify, { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import fastifyWebSocket from "@fastify/websocket";
import fastifyMultipart from "@fastify/multipart";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { registerChatWebSocket } from "./ws/chat-handler.js";
import type { ConnectionRegistry } from "./ws/connection-registry.js";
import { registerHatchingRoutes } from "./routes/hatching.js";
import { registerTransportRoutes } from "./routes/transports.js";
import { registerChannelRoutes } from "./routes/channels.js";
import { registerCalendarRoutes } from "./routes/calendar.js";
import { registerDebugRoutes } from "./routes/debug.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerNotebookRoutes } from "./routes/notebook.js";
import { registerMemoryRoutes } from "./routes/memory.js";
import { registerConversationSearchRoutes } from "./routes/conversation-search.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerCapabilityRoutes } from "./routes/capabilities.js";
import { registerSkillRoutes } from "./routes/skills.js";
import { registerSpaceRoutes } from "./routes/spaces.js";
import { registerAutomationRoutes } from "./routes/automations.js";
import { registerTimelineRoutes } from "./routes/timeline.js";
import { registerAssetRoutes } from "./routes/asset-routes.js";
import { SkillService } from "./services/skill-service.js";
import type { ConversationManager } from "./conversations/index.js";
import type { AbbreviationQueue } from "./conversations/abbreviation.js";
import type { TransportManager } from "./channels/index.js";
import type { ChannelMessageHandler } from "./channels/message-handler.js";
import type {
  CalendarScheduler,
  NotificationService,
  MemoryDb,
  SyncService,
  SearchService,
  PluginRegistry,
} from "@my-agent/core";
import type { StatePublisher } from "./state/state-publisher.js";
import type { ConversationSearchService } from "./conversations/search-service.js";

export interface ServerOptions {
  agentDir: string;
  connectionRegistry: ConnectionRegistry;
}

// Augment Fastify types to include our custom decorators
declare module "fastify" {
  interface FastifyInstance {
    app: import("./app.js").App | null;
    agentDir: string;
    connectionRegistry: import("./ws/connection-registry.js").ConnectionRegistry;
    isHatched: boolean;
    conversationManager: ConversationManager | null;
    abbreviationQueue: AbbreviationQueue | null;
    transportManager: TransportManager | null;
    channelMessageHandler: ChannelMessageHandler | null;
    calendarScheduler: CalendarScheduler | null;
    notificationService: NotificationService | null;
    statePublisher: StatePublisher | null;
    // Memory system (M6-S1)
    memoryDb: MemoryDb | null;
    syncService: SyncService | null;
    searchService: SearchService | null;
    pluginRegistry: PluginRegistry | null;
    conversationSearchService: ConversationSearchService | null;
    conversationInitiator: {
      alert(
        prompt: string,
        options?: { sourceChannel?: string },
      ): Promise<boolean>;
      initiate(options?: { firstTurnPrompt?: string }): Promise<unknown>;
    } | null;
    postResponseHooks:
      | import("./conversations/post-response-hooks.js").PostResponseHooks
      | null;
    skillService: SkillService;
  }
}

export async function createServer(
  options: ServerOptions,
): Promise<FastifyInstance> {
  const { agentDir, connectionRegistry } = options;

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

  // Store agentDir, app, and isHatched status as decorators for route handlers
  fastify.decorate("app", null);
  fastify.decorate("agentDir", agentDir);
  fastify.decorate("connectionRegistry", connectionRegistry);
  fastify.decorate("isHatched", false); // Will be set by index.ts after checking
  fastify.decorate("conversationManager", null);
  fastify.decorate("abbreviationQueue", null);
  fastify.decorate("transportManager", null);
  fastify.decorate("channelMessageHandler", null);
  fastify.decorate("calendarScheduler", null);
  fastify.decorate("notificationService", null);
  fastify.decorate("statePublisher", null);
  // Memory system (M6-S1)
  fastify.decorate("memoryDb", null);
  fastify.decorate("syncService", null);
  fastify.decorate("searchService", null);
  fastify.decorate("pluginRegistry", null);
  fastify.decorate("conversationSearchService", null);
  fastify.decorate("conversationInitiator", null);
  fastify.decorate("postResponseHooks", null);
  fastify.decorate("skillService", new SkillService(agentDir));

  // Register WebSocket chat route
  await registerChatWebSocket(fastify, connectionRegistry);

  // Register hatching routes
  await registerHatchingRoutes(fastify);

  // Register transport routes
  await registerTransportRoutes(fastify);

  // Register channel binding routes
  await registerChannelRoutes(fastify);

  // Register calendar routes
  await registerCalendarRoutes(fastify);

  // Register notification routes
  await registerNotificationRoutes(fastify);

  // Register space routes
  await registerSpaceRoutes(fastify);

  // Register automation routes (M7-S3)
  await registerAutomationRoutes(fastify);

  // Register timeline routes (M7-S4)
  await registerTimelineRoutes(fastify);

  // Register asset serving routes (M8-S1)
  await registerAssetRoutes(fastify);

  // Register debug API routes (localhost-only)
  await fastify.register(
    async (instance) => {
      await registerDebugRoutes(instance);
    },
    { prefix: "/api/debug" },
  );

  // Register auth routes (accessible from any client)
  fastify.post("/api/auth/logout", async (_request, reply) => {
    const { clearAuth, removeEnvValue, resolveEnvPath } =
      await import("@my-agent/core");
    clearAuth();
    const envPath = resolveEnvPath(agentDir);
    removeEnvValue(envPath, "ANTHROPIC_API_KEY");
    removeEnvValue(envPath, "CLAUDE_CODE_OAUTH_TOKEN");
    fastify.connectionRegistry.broadcastToAll({ type: "auth_required" });
    fastify.log.info("[Auth] Logged out — credentials cleared");
    return reply.send({ ok: true });
  });

  // Register admin API routes (localhost-only)
  await fastify.register(
    async (instance) => {
      await registerAdminRoutes(instance);
    },
    { prefix: "/api/admin" },
  );

  // Register notebook routes (M6-S3)
  await fastify.register(
    async (instance) => {
      await registerNotebookRoutes(instance);
    },
    { prefix: "/api/notebook" },
  );

  // Register skill routes (M6.8-S6)
  await fastify.register(
    async (instance) => {
      await registerSkillRoutes(instance);
    },
    { prefix: "/api/skills" },
  );

  // Register memory routes (M6-S3)
  await fastify.register(
    async (instance) => {
      await registerMemoryRoutes(instance);
    },
    { prefix: "/api/memory" },
  );

  // Register conversation search routes (M6.7-S4)
  await fastify.register(
    async (instance) => {
      await registerConversationSearchRoutes(instance);
    },
    { prefix: "/api/conversations" },
  );

  // Register settings routes (M6.9-S2)
  await registerSettingsRoutes(fastify);

  // Register capability settings routes (M9.5-S2)
  await registerCapabilityRoutes(fastify);

  // Legacy notebook API - read runtime files (backward compatibility)
  // TODO: Remove after migration to notebook/ is complete
  fastify.get<{ Params: { name: string } }>(
    "/api/runtime/:name",
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
