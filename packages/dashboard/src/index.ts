import { findAgentDir, resolveAuth, isHatched } from "@my-agent/core";
import { createServer } from "./server.js";

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

  // Create and start server
  const port = parseInt(process.env.PORT ?? "4321", 10);
  const server = await createServer({ agentDir });
  server.isHatched = hatched;

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
