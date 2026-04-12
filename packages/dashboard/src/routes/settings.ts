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
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import {
  loadPreferences,
  loadModels,
  resolveEnvPath,
  getEnvValue,
  setEnvValue,
  removeEnvValue,
  readFrontmatter,
  scanCapabilities,
  isBrainModelTier,
  type UserPreferences,
  type ModelDefaults,
  type BrainModelTier,
  type CapabilityFrontmatter,
} from "@my-agent/core";

/** Keys that must not be modified via the API */
const READ_ONLY_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
]);

/** Keys that are configuration, not secrets */
const CONFIG_KEYS = new Set(["PORT", "HOST", "NODE_ENV"]);

interface SecretEntry {
  key: string;
  maskedValue: string;
  readOnly: boolean;
  capabilities: string[];
}

/**
 * Parse all KEY=VALUE lines from a .env file.
 * Skips comments and blank lines.
 */
function parseEnvFile(envPath: string): Array<{ key: string; value: string }> {
  if (!existsSync(envPath)) return [];
  const lines = readFileSync(envPath, "utf-8").split("\n");
  const entries: Array<{ key: string; value: string }> = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    entries.push({
      key: trimmed.slice(0, eqIndex),
      value: trimmed.slice(eqIndex + 1),
    });
  }
  return entries;
}

/**
 * Mask a secret value: show last 4 chars with leading dots.
 * For short values (< 8 chars), use fewer dots.
 */
function maskValue(value: string): string {
  if (!value) return "";
  if (value.length < 8) return "••••" + value.slice(-4);
  return "••••••" + value.slice(-4);
}

/**
 * Build a map of env key -> capability names that require it.
 * Reads CAPABILITY.md frontmatter from each capability folder.
 */
function buildEnvCapabilityMap(agentDir: string): Map<string, string[]> {
  const capDir = join(agentDir, "capabilities");
  const map = new Map<string, string[]>();
  if (!existsSync(capDir)) return map;

  let entries: string[];
  try {
    entries = readdirSync(capDir);
  } catch {
    return map;
  }

  for (const entry of entries) {
    const mdPath = join(capDir, entry, "CAPABILITY.md");
    if (!existsSync(mdPath)) continue;
    try {
      const { data } = readFrontmatter<CapabilityFrontmatter>(mdPath);
      if (!data.name || !data.requires?.env) continue;
      for (const envKey of data.requires.env) {
        const existing = map.get(envKey) ?? [];
        existing.push(data.name);
        map.set(envKey, existing);
      }
    } catch {
      // Skip malformed capability files
    }
  }

  return map;
}

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
   * Returns current user preferences (debrief + timezone).
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

    const body = request.body as Partial<UserPreferences> & {
      outboundChannel?: string;
    };

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

      // Merge preferences — deep-merge debrief sub-object
      const existingPrefs = (yaml.preferences as Record<string, unknown>) ?? {};
      const existingDebrief =
        (existingPrefs.debrief as Record<string, unknown>) ?? {};

      const newDebrief = body.debrief
        ? {
            ...existingDebrief,
            ...(body.debrief as unknown as Record<string, unknown>),
          }
        : existingDebrief;

      yaml.preferences = {
        ...existingPrefs,
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.outboundChannel !== undefined
          ? { outboundChannel: body.outboundChannel }
          : {}),
        debrief: newDebrief,
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
      return reply.code(500).send({
        error: "Failed to save preferences",
      } as unknown as UserPreferences);
    }
  });

  /**
   * GET /api/settings/models
   *
   * Returns configured model IDs (with defaults).
   */
  fastify.get<{ Reply: ModelDefaults }>("/api/settings/models", async () => {
    return loadModels(fastify.agentDir);
  });

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
          yaml =
            (parse(readFileSync(configPath, "utf-8")) as Record<
              string,
              unknown
            >) ?? {};
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
   * GET /api/settings/brain-model
   *
   * Returns the default conversation model tier (sonnet/haiku/opus).
   * If brain.model is a literal model ID (legacy or env override), reverse-maps
   * it through preferences.models; falls back to "sonnet" if no match.
   */
  fastify.get<{ Reply: { tier: BrainModelTier } }>(
    "/api/settings/brain-model",
    async () => {
      const agentDir = fastify.agentDir;
      const configPath = join(agentDir, "config.yaml");

      let stored: unknown;
      if (existsSync(configPath)) {
        try {
          const yaml =
            (parse(readFileSync(configPath, "utf-8")) as Record<
              string,
              unknown
            >) ?? {};
          stored = (yaml.brain as Record<string, unknown> | undefined)?.model;
        } catch {
          stored = undefined;
        }
      }

      if (isBrainModelTier(stored)) return { tier: stored };

      // Reverse-map a concrete model ID through configured tier versions.
      if (typeof stored === "string") {
        const models = loadModels(agentDir);
        for (const tier of ["sonnet", "haiku", "opus"] as const) {
          if (models[tier] === stored) return { tier };
        }
      }

      return { tier: "sonnet" };
    },
  );

  /**
   * PUT /api/settings/brain-model
   *
   * Updates the default conversation model tier. Writes tier name to
   * brain.model in config.yaml. Takes effect on next new conversation.
   */
  fastify.put<{
    Body: { tier: unknown };
    Reply: { tier: BrainModelTier } | { error: string };
  }>("/api/settings/brain-model", async (request, reply) => {
    const tier = (request.body as { tier?: unknown } | undefined)?.tier;
    if (!isBrainModelTier(tier)) {
      return reply
        .code(400)
        .send({ error: "tier must be 'sonnet', 'haiku', or 'opus'" });
    }

    const agentDir = fastify.agentDir;
    const configPath = join(agentDir, "config.yaml");

    try {
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

      const brain = (yaml.brain as Record<string, unknown>) ?? {};
      brain.model = tier;
      yaml.brain = brain;

      writeFileSync(configPath, stringify(yaml, { lineWidth: 120 }), "utf-8");
      fastify.log.info(`[Settings] Brain model tier set to ${tier}`);

      return { tier };
    } catch (err) {
      fastify.log.error(
        "[Settings] Failed to save brain model: %s",
        err instanceof Error ? err.message : String(err),
      );
      return reply.code(500).send({ error: "Failed to save brain model" });
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
        return { models: [] };
      }

      try {
        const res = await fetch("https://api.anthropic.com/v1/models", {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
        });

        if (!res.ok) {
          fastify.log.warn(
            "[Settings] Failed to fetch models from API: %s",
            res.status,
          );
          return { models: cachedAvailableModels ?? [] };
        }

        const data = (await res.json()) as { data?: Array<{ id: string }> };
        const rawIds = (data.data ?? []).map((m) => m.id);

        // Don't synthesize undated aliases — the API already returns working
        // undated IDs (e.g. claude-sonnet-4-6). Synthesizing from dated models
        // creates phantom IDs (e.g. claude-sonnet-4-5) that the API silently
        // accepts but returns empty responses for.
        const idSet = new Set(rawIds);

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

  // ── Secrets CRUD ─────────────────────────────────────────────────────

  /**
   * GET /api/settings/secrets
   *
   * Returns all env keys (excluding config keys like PORT) with masked
   * values, read-only flags, and capability associations.
   */
  fastify.get<{ Reply: { secrets: SecretEntry[] } }>(
    "/api/settings/secrets",
    async () => {
      const agentDir = fastify.agentDir;
      const envPath = resolveEnvPath(agentDir);
      const entries = parseEnvFile(envPath);
      const capMap = buildEnvCapabilityMap(agentDir);

      const secrets: SecretEntry[] = entries
        .filter((e) => !CONFIG_KEYS.has(e.key))
        .map((e) => ({
          key: e.key,
          maskedValue: maskValue(e.value),
          readOnly: READ_ONLY_KEYS.has(e.key),
          capabilities: capMap.get(e.key) ?? [],
        }));

      return { secrets };
    },
  );

  /**
   * GET /api/settings/secrets/:key/value
   *
   * Returns the unmasked value for a single secret.
   * Blocks read-only keys (ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN).
   */
  fastify.get<{
    Params: { key: string };
    Reply: { value: string } | { error: string };
  }>("/api/settings/secrets/:key/value", async (request, reply) => {
    const { key } = request.params;

    if (READ_ONLY_KEYS.has(key)) {
      return reply.code(403).send({ error: `${key} is read-only` });
    }

    const agentDir = fastify.agentDir;
    const envPath = resolveEnvPath(agentDir);
    const value = getEnvValue(envPath, key);

    if (value === null) {
      return reply.code(404).send({ error: "Key not found" });
    }

    return { value };
  });

  /**
   * PUT /api/settings/secrets/:key
   *
   * Set or update a secret. Blocks read-only keys (ANTHROPIC_API_KEY,
   * CLAUDE_CODE_OAUTH_TOKEN). Triggers capability re-scan after write.
   */
  fastify.put<{
    Params: { key: string };
    Body: { value: string };
    Reply: { ok: true } | { error: string };
  }>("/api/settings/secrets/:key", async (request, reply) => {
    const { key } = request.params;
    const { value } = request.body as { value: string };

    if (READ_ONLY_KEYS.has(key)) {
      return reply.code(403).send({ error: `${key} is read-only` });
    }

    if (!value || typeof value !== "string") {
      return reply.code(400).send({ error: "value is required" });
    }

    const agentDir = fastify.agentDir;
    const envPath = resolveEnvPath(agentDir);

    setEnvValue(envPath, key, value);
    process.env[key] = value;
    fastify.log.info("[Settings] Secret set: %s", key);

    // Re-scan capabilities so status reflects the new secret
    await rescanCapabilities(fastify, agentDir, envPath);

    return { ok: true as const };
  });

  /**
   * DELETE /api/settings/secrets/:key
   *
   * Remove a secret. Blocks read-only keys. Triggers capability re-scan.
   */
  fastify.delete<{
    Params: { key: string };
    Reply: { ok: true } | { error: string };
  }>("/api/settings/secrets/:key", async (request, reply) => {
    const { key } = request.params;

    if (READ_ONLY_KEYS.has(key)) {
      return reply.code(403).send({ error: `${key} is read-only` });
    }

    const agentDir = fastify.agentDir;
    const envPath = resolveEnvPath(agentDir);

    removeEnvValue(envPath, key);
    delete process.env[key];
    fastify.log.info("[Settings] Secret removed: %s", key);

    // Re-scan capabilities so status reflects the removal
    await rescanCapabilities(fastify, agentDir, envPath);

    return { ok: true as const };
  });
}

/**
 * Trigger a capability re-scan and emit change event.
 * Shared by PUT and DELETE secrets endpoints.
 */
async function rescanCapabilities(
  fastify: FastifyInstance,
  agentDir: string,
  envPath: string,
): Promise<void> {
  const app = fastify.app;
  if (!app?.capabilityRegistry) return;

  try {
    const capabilitiesDir = join(agentDir, "capabilities");
    const caps = await app.capabilityRegistry.rescan(() =>
      scanCapabilities(capabilitiesDir, envPath),
    );
    app.emit("capability:changed", caps);
  } catch (err) {
    fastify.log.warn(
      "[Settings] Capability re-scan failed: %s",
      err instanceof Error ? err.message : String(err),
    );
  }
}
