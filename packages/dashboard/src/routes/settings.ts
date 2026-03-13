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
import { loadPreferences, loadModels, type UserPreferences, type ModelDefaults } from "@my-agent/core";

/** Cached available models (refreshed every 10 minutes) */
let cachedAvailableModels: string[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 10 * 60_000;

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

  /**
   * GET /api/settings/models
   *
   * Returns configured model IDs (with defaults).
   */
  fastify.get<{ Reply: ModelDefaults }>(
    "/api/settings/models",
    async () => {
      return loadModels(fastify.agentDir);
    },
  );

  /**
   * PUT /api/settings/models
   *
   * Updates model IDs. Merges into config.yaml preferences.models.
   */
  fastify.put<{
    Body: Partial<ModelDefaults>;
    Reply: ModelDefaults | { error: string };
  }>("/api/settings/models", async (request, reply) => {
    const agentDir = fastify.agentDir;
    const configPath = join(agentDir, "config.yaml");
    const body = request.body as Partial<ModelDefaults>;

    try {
      let yaml: Record<string, unknown> = {};
      if (existsSync(configPath)) {
        try {
          yaml = (parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>) ?? {};
        } catch {
          yaml = {};
        }
      }

      const prefs = (yaml.preferences as Record<string, unknown>) ?? {};
      const existing = (prefs.models as Record<string, unknown>) ?? {};

      prefs.models = { ...existing, ...body };
      yaml.preferences = prefs;

      writeFileSync(configPath, stringify(yaml, { lineWidth: 120 }), "utf-8");
      fastify.log.info("[Settings] Model IDs updated");

      return loadModels(agentDir);
    } catch (err) {
      fastify.log.error(
        "[Settings] Failed to save models: %s",
        err instanceof Error ? err.message : String(err),
      );
      return reply
        .code(500)
        .send({ error: "Failed to save models" } as unknown as ModelDefaults);
    }
  });

  /**
   * GET /api/settings/available-models
   *
   * Lists models available on the Anthropic API (cached 10 min).
   */
  fastify.get<{ Reply: { models: string[] } }>(
    "/api/settings/available-models",
    async (_request, reply) => {
      const now = Date.now();
      if (cachedAvailableModels && now - cacheTimestamp < CACHE_TTL_MS) {
        return { models: cachedAvailableModels };
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return reply.code(500).send({ models: [] } as any);
      }

      try {
        const res = await fetch("https://api.anthropic.com/v1/models", {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
        });

        if (!res.ok) {
          fastify.log.warn("[Settings] Failed to fetch models from API: %s", res.status);
          return { models: cachedAvailableModels ?? [] };
        }

        const data = (await res.json()) as { data?: Array<{ id: string }> };
        const rawIds = (data.data ?? []).map((m) => m.id);

        // Synthesize undated aliases for dated models that lack them.
        // Only strip date when model has a minor version before the date,
        // e.g. claude-opus-4-5-20251101 → claude-opus-4-5 (has minor version "5")
        // but NOT claude-opus-4-20250514 → claude-opus-4 (no minor version)
        const idSet = new Set(rawIds);
        for (const id of rawIds) {
          // Match: name-major-minor-YYYYMMDD (minor must be a short number, not 8-digit date)
          const match = id.match(/^(.+-\d+-\d{1,2})-\d{8}$/);
          if (match && !idSet.has(match[1])) {
            idSet.add(match[1]);
          }
        }

        const models = [...idSet].sort();

        cachedAvailableModels = models;
        cacheTimestamp = now;

        return { models };
      } catch (err) {
        fastify.log.warn(
          "[Settings] Failed to fetch models: %s",
          err instanceof Error ? err.message : String(err),
        );
        return { models: cachedAvailableModels ?? [] };
      }
    },
  );
}
