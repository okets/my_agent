import {
  findAgentDir,
  resolveAuth,
  isHatched,
  loadConfig,
  toDisplayStatus,
} from "@my-agent/core";
import { createServer } from "./server.js";
import {
  ConversationManager,
  AbbreviationQueue,
} from "./conversations/index.js";
import {
  ChannelManager,
  MockChannelPlugin,
  ChannelMessageHandler,
} from "./channels/index.js";
import { connectionRegistry, sessionRegistry } from "./ws/chat-handler.js";

// Clear CLAUDECODE env var so the Agent SDK can spawn claude subprocesses.
// When the dashboard is started from within a Claude Code session (e.g. during dev),
// this var would otherwise block nested claude processes.
delete process.env.CLAUDECODE;

async function main() {
  // Find agent directory
  const agentDir = findAgentDir();

  // Check if agent is hatched
  const hatched = isHatched(agentDir);

  // Try to resolve auth (warn but don't crash if not configured)
  if (hatched) {
    try {
      resolveAuth(agentDir);
      console.log("Authentication configured.");
    } catch (err) {
      console.warn(
        "Warning: Authentication not configured. Use the hatching wizard to set up auth.",
      );
      console.warn("Error:", err instanceof Error ? err.message : String(err));
    }
  } else {
    console.log(
      "Agent not hatched yet. Hatching wizard will be available in the web UI.",
    );
  }

  // Create shared ConversationManager
  const conversationManager = new ConversationManager(agentDir);

  // Initialize abbreviation queue (only if hatched and auth available)
  let abbreviationQueue: AbbreviationQueue | null = null;

  if (hatched) {
    try {
      const apiKey =
        process.env.ANTHROPIC_API_KEY ||
        process.env.CLAUDE_CODE_OAUTH_TOKEN ||
        "";

      if (apiKey) {
        abbreviationQueue = new AbbreviationQueue(conversationManager, apiKey);
        await abbreviationQueue.retryPending();
      } else {
        console.warn(
          "No API key available - abbreviation queue will not start",
        );
      }
    } catch (err) {
      console.warn("Failed to initialize abbreviation queue:", err);
    }
  }

  // Create and start server
  const port = parseInt(process.env.PORT ?? "4321", 10);
  const server = await createServer({ agentDir });
  server.isHatched = hatched;
  server.conversationManager = conversationManager;
  server.abbreviationQueue = abbreviationQueue;

  // Initialize channel system
  let channelManager: ChannelManager | null = null;
  const config = loadConfig();

  if (Object.keys(config.channels).length > 0 && hatched) {
    channelManager = new ChannelManager();

    // Register built-in plugin factories
    channelManager.registerPlugin("mock", (cfg) => {
      const plugin = new MockChannelPlugin();
      return plugin;
    });

    // Wire message handler
    const messageHandler = new ChannelMessageHandler({
      conversationManager,
      sessionRegistry,
      connectionRegistry,
      sendViaChannel: (channelId, to, message) =>
        channelManager!.send(channelId, to, message),
    });

    channelManager.onMessage((channelId, messages) => {
      messageHandler.handleMessages(channelId, messages).catch((err) => {
        console.error(
          `[Channels] Error handling messages from ${channelId}:`,
          err,
        );
      });
    });

    // Wire status change → WS broadcast
    channelManager.onStatusChange((channelId, status) => {
      connectionRegistry.broadcastToAll({
        type: "channel_status_changed",
        channelId,
        status: toDisplayStatus(status),
        reconnectAttempts: status.reconnectAttempts,
      });
    });

    // Initialize all configured channels
    await channelManager.initAll(config.channels);
    server.channelManager = channelManager;
    console.log(
      `Channel system initialized with ${Object.keys(config.channels).length} channel(s)`,
    );
  }

  try {
    await server.listen({ port, host: "0.0.0.0" });
    console.log(`\nDashboard running at http://localhost:${port}`);
    console.log("Press Ctrl+C to stop\n");
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down gracefully...`);
    try {
      // Disconnect all channels first (clears reconnect + watchdog timers)
      if (channelManager) {
        await channelManager.disconnectAll();
      }

      // Drain abbreviation queue
      if (abbreviationQueue) {
        await abbreviationQueue.drain();
      }

      // Then close server
      await server.close();
      console.log("Server closed.");
      process.exit(0);
    } catch (err) {
      console.error("Error during shutdown:", err);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
