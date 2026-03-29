/**
 * Desktop Control API Routes (M8-S2)
 *
 * Exposes desktop environment status for the Settings UI.
 * No localhostOnly middleware: users access the dashboard via Tailscale.
 */

import type { FastifyInstance } from "fastify";

/**
 * Register desktop routes
 */
export async function registerDesktopRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  /**
   * GET /api/debug/desktop-status
   *
   * Returns current desktop environment detection results.
   * Used by the Settings UI to show capability status.
   */
  fastify.get("/api/debug/desktop-status", async (_request, reply) => {
    const app = fastify.app;
    if (!app) return reply.code(503).send({ error: "App not ready" });

    return {
      available: !!(app.desktopEnv?.hasDisplay && app.desktopBackend),
      displayServer: app.desktopEnv?.displayServer ?? "none",
      backend: app.desktopEnv?.backend ?? null,
      capabilities: app.desktopEnv?.capabilities ?? {
        screenshot: false,
        mouse: false,
        keyboard: false,
        windowManagement: false,
        accessibility: false,
      },
      setupNeeded: app.desktopEnv?.setupNeeded ?? [],
      computerUseAvailable: !!app.desktopComputerUse,
    };
  });
}
