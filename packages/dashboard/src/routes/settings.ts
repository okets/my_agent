/**
 * Settings API Routes (M6.9-S2)
 *
 * User preferences endpoints:
 * - GET  /api/settings/preferences  — read current user preferences
 * - PUT  /api/settings/preferences  — update user preferences (partial or full)
 *
 * No localhostOnly middleware: users access the dashboard via Tailscale.
 */

import type { FastifyInstance } from "fastify";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { loadPreferences, type UserPreferences } from "@my-agent/core";

/**
 * Register settings API routes
 */
export async function registerSettingsRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  /**
   * GET /api/settings/preferences
   *
   * Returns current user preferences (morningBrief + timezone).
   * Falls back to defaults when not configured.
   */
  fastify.get<{ Reply: UserPreferences }>(
    "/api/settings/preferences",
    async (request, reply) => {
      const agentDir = fastify.agentDir;
      try {
        const preferences = loadPreferences(agentDir);
        return preferences;
      } catch (err) {
        fastify.log.error(
          "[Settings] Failed to load preferences: %s",
          err instanceof Error ? err.message : String(err),
        );
        return reply.code(500).send({
          error: "Failed to load preferences",
        } as unknown as UserPreferences);
      }
    },
  );

  /**
   * PUT /api/settings/preferences
   *
   * Updates user preferences. Merges the supplied fields into the existing
   * config.yaml preferences section — unrecognised config keys are preserved.
   */
  fastify.put<{
    Body: Partial<UserPreferences>;
    Reply: UserPreferences | { error: string };
  }>("/api/settings/preferences", async (request, reply) => {
    const agentDir = fastify.agentDir;
    const configPath = join(agentDir, "config.yaml");

    const body = request.body as Partial<UserPreferences>;

    try {
      // Read existing YAML (preserves all other config keys)
      let yaml: Record<string, unknown> = {};
      if (existsSync(configPath)) {
        try {
          yaml =
            (parse(readFileSync(configPath, "utf-8")) as Record<
              string,
              unknown
            >) ?? {};
        } catch {
          yaml = {};
        }
      }

      // Merge preferences — deep-merge morningBrief sub-object
      const existingPrefs = (yaml.preferences as Record<string, unknown>) ?? {};
      const existingBrief =
        (existingPrefs.morningBrief as Record<string, unknown>) ?? {};

      const newBrief = body.morningBrief
        ? { ...existingBrief, ...(body.morningBrief as unknown as Record<string, unknown>) }
        : existingBrief;

      yaml.preferences = {
        ...existingPrefs,
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        morningBrief: newBrief,
      };

      writeFileSync(configPath, stringify(yaml, { lineWidth: 120 }), "utf-8");
      fastify.log.info("[Settings] Preferences updated");

      // Return the merged preferences
      const updated = loadPreferences(agentDir);
      return updated;
    } catch (err) {
      fastify.log.error(
        "[Settings] Failed to save preferences: %s",
        err instanceof Error ? err.message : String(err),
      );
      return reply
        .code(500)
        .send({ error: "Failed to save preferences" } as unknown as UserPreferences);
    }
  });
}
