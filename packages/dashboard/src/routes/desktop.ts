/**
 * Desktop Control API Routes (M8-S2)
 *
 * Exposes desktop environment status for the Settings UI.
 * No localhostOnly middleware: users access the dashboard via Tailscale.
 */

import type { FastifyInstance } from "fastify";
import { join } from "path";
import { existsSync } from "fs";
import { writeFile, unlink } from "fs/promises";

/**
 * Register desktop routes
 */
export async function registerDesktopRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const enabledFlagPath = join(fastify.agentDir, ".desktop-enabled");

  function isDesktopEnabled(): boolean {
    return existsSync(enabledFlagPath);
  }

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
      hasDisplay: !!app.desktopEnv?.hasDisplay,
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
      enabled: isDesktopEnabled(),
    };
  });

  /**
   * POST /api/debug/desktop-toggle
   *
   * Toggles desktop control enabled/disabled.
   * Writes or removes a .desktop-enabled flag file in agentDir.
   */
  fastify.post("/api/debug/desktop-toggle", async (_request, reply) => {
    const currentlyEnabled = isDesktopEnabled();
    if (currentlyEnabled) {
      await unlink(enabledFlagPath).catch(() => {});
    } else {
      await writeFile(enabledFlagPath, new Date().toISOString(), "utf-8");
    }
    return { enabled: !currentlyEnabled };
  });

  /**
   * POST /api/debug/desktop-install
   *
   * Runs the setup-desktop.sh script to install missing tools.
   * Returns stdout/stderr output.
   */
  fastify.post("/api/debug/desktop-install", async (_request, reply) => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    // scripts/setup-desktop.sh is at the repo root, not inside agentDir
    const scriptPath = join(fastify.agentDir, "..", "scripts", "setup-desktop.sh");

    try {
      const { stdout, stderr } = await execFileAsync("bash", [scriptPath], { timeout: 120000 });
      return { success: true, output: stdout + stderr };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; message?: string };
      return {
        success: false,
        output: (execErr.stdout ?? "") + (execErr.stderr ?? ""),
        error: execErr.message ?? String(err),
      };
    }
  });
}
