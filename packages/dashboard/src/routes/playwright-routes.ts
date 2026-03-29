import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  detectPlaywrightStatus,
  installPlaywrightBrowsers,
} from "../playwright/playwright-status.js";

export async function registerPlaywrightRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const agentDir = fastify.agentDir;
  const flagFile = join(agentDir, ".playwright-disabled");

  function isEnabled(): boolean {
    return !existsSync(flagFile);
  }

  fastify.get("/api/debug/playwright-status", async () => {
    return detectPlaywrightStatus(isEnabled());
  });

  fastify.post("/api/debug/playwright-toggle", async () => {
    const currentlyEnabled = isEnabled();
    if (currentlyEnabled) {
      await writeFile(flagFile, new Date().toISOString(), "utf-8");
    } else {
      await unlink(flagFile).catch(() => {});
    }
    return { enabled: !currentlyEnabled };
  });

  fastify.post("/api/debug/playwright-install", async () => {
    return installPlaywrightBrowsers();
  });
}
