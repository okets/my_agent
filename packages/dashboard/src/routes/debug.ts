/**
 * Debug API Routes
 *
 * Read-only inspection of agent internals for debugging and QA testing.
 * All routes are localhost-only.
 *
 * @see docs/design/debug-api.md
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { join } from "node:path";
import {
  assembleSystemPrompt,
  assembleCalendarContext,
  loadCalendarConfig,
  loadCalendarCredentials,
  createCalDAVClient,
  CalDAVClient,
} from "@my-agent/core";
import type { CapabilityFailureSymptom } from "@my-agent/core";
import {
  getBrainStatus,
  getBrainFiles,
  getSkills,
  getSystemPrompt,
} from "../debug/debug-queries.js";

// Cache state tracking (module-level for introspection)
interface CacheStats {
  calendarContext: {
    cached: boolean;
    ageMs: number | null;
    ttlMs: number;
  };
}

// We'll track cache state via inspection of the core module
const CALENDAR_CACHE_TTL_MS = 60_000;

/**
 * Localhost-only middleware
 */
function localhostOnly(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
) {
  const ip = request.ip;
  const isLocalhost =
    ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";

  if (!isLocalhost) {
    reply.code(403).send({ error: "Debug API is localhost-only" });
    return;
  }
  done();
}

// listFilesRecursive and loadSkills extracted to src/debug/debug-queries.ts

/**
 * Register debug routes
 */
export async function registerDebugRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // Apply localhost-only middleware to all debug routes
  fastify.addHook("onRequest", localhostOnly);

  /**
   * GET /brain/status
   *
   * Agent status overview: hatching, auth, model, brain directory
   */
  fastify.get("/brain/status", async () => {
    return getBrainStatus(fastify.agentDir);
  });

  /**
   * GET /brain/prompt
   *
   * Assembled system prompt with component breakdown
   */
  fastify.get("/brain/prompt", async () => {
    const agentDir = fastify.agentDir;

    // Load calendar context (same pattern as SessionManager)
    let calendarContext: string | undefined;
    try {
      console.log(
        `[Debug] Loading calendar context from agentDir: ${agentDir}`,
      );
      const calendarConfig = loadCalendarConfig(agentDir);
      const credentials = loadCalendarCredentials(agentDir);
      console.log(
        `[Debug] Config: ${!!calendarConfig}, Credentials: ${!!credentials}`,
      );
      if (calendarConfig && credentials) {
        const calendarRepo = await createCalDAVClient(
          calendarConfig,
          credentials,
        );
        calendarContext = await assembleCalendarContext(calendarRepo);
        console.log(
          `[Debug] Calendar context: ${calendarContext?.length ?? 0} chars`,
        );
        console.log(
          `[Debug] Calendar context preview: ${calendarContext?.slice(0, 100)?.replace(/\n/g, "\\n")}`,
        );
      }
    } catch (err) {
      console.warn(`[Debug] Calendar context error: ${err}`);
    }

    // Delegate data assembly to pure function
    return getSystemPrompt(agentDir, { calendarContext });
  });

  /**
   * GET /brain/caches
   *
   * Cache status for all runtime caches
   */
  fastify.get("/brain/caches", async () => {
    // Note: We can't directly inspect the cache state from here since it's
    // module-private in @my-agent/core. For now, return what we know about
    // cache configuration. A future enhancement could export cache stats.

    return {
      calendarContext: {
        description: "Formatted calendar events for system prompt",
        ttlMs: CALENDAR_CACHE_TTL_MS,
        note: "Cache state not directly observable from dashboard",
      },
      caldavCalendars: {
        description: "List of CalDAV calendars from Radicale",
        ttlMs: CALENDAR_CACHE_TTL_MS,
        note: "Cache state not directly observable from dashboard",
      },
      dedup: {
        description: "Message deduplication for channels",
        ttlMs: 1200000, // 20 minutes
        maxEntries: 5000,
        note: "Per-channel instances, not globally trackable",
      },
      debouncer: {
        description: "Message batching for rapid channel messages",
        note: "Per-channel instances, not globally trackable",
      },
    };
  });

  /**
   * GET /brain/files
   *
   * List all brain files with metadata
   */
  fastify.get("/brain/files", async () => {
    return getBrainFiles(fastify.agentDir);
  });

  /**
   * GET /brain/skills
   *
   * Skill inventory from framework and user directories
   */
  fastify.get("/brain/skills", async () => {
    return getSkills(fastify.agentDir);
  });

  /**
   * GET /calendar/events
   *
   * Raw upcoming calendar events (not formatted as markdown)
   */
  fastify.get("/calendar/events", async () => {
    const agentDir = fastify.agentDir;

    try {
      const config = await loadCalendarConfig(agentDir);
      const credentials = await loadCalendarCredentials(agentDir);

      if (!credentials) {
        return {
          error: "Calendar credentials not configured",
          events: [],
          fetchedAt: null,
        };
      }

      const client = createCalDAVClient(config, credentials);
      const events = await client.getUpcoming(48, 20); // 48 hours, max 20 events

      return {
        events: events.map((e) => ({
          uid: e.uid,
          calendarId: e.calendarId,
          title: e.title,
          start: e.start.toISOString(),
          end: e.end.toISOString(),
          allDay: e.allDay,
          recurring: !!e.rrule,
          status: e.status,
          location: e.location,
        })),
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
        events: [],
        fetchedAt: null,
      };
    }
  });

  /**
   * GET /api-spec
   *
   * Machine-readable API specification for agent discovery.
   * Agents can call this to learn what APIs are available.
   */
  fastify.get("/api-spec", async () => {
    return {
      version: "1.0.0",
      description:
        "my_agent REST API specification. Use these endpoints via curl or fetch.",
      calendar: {
        base: "/api/calendar",
        description: "Calendar management (CalDAV-backed)",
        endpoints: [
          {
            method: "GET",
            path: "/events",
            description: "List calendar events",
            query: [
              { name: "start", required: false, description: "ISO date start" },
              { name: "end", required: false, description: "ISO date end" },
              {
                name: "calendars",
                required: false,
                description: "Comma-separated calendar IDs",
              },
            ],
            response: "Array of FullCalendar events",
          },
          {
            method: "GET",
            path: "/events/today",
            description: "Get today's events",
            query: [],
            response: "Array of today's events",
          },
          {
            method: "POST",
            path: "/events",
            description: "Create a new event",
            body: [
              {
                name: "calendarId",
                required: true,
                description: "Target calendar (user or system)",
              },
              { name: "title", required: true, description: "Event title" },
              {
                name: "start",
                required: true,
                description: "ISO 8601 start datetime",
              },
              {
                name: "end",
                required: false,
                description: "ISO 8601 end datetime (default: start + 1 hour)",
              },
              {
                name: "description",
                required: false,
                description: "Event description/notes",
              },
              {
                name: "location",
                required: false,
                description: "Event location",
              },
              {
                name: "allDay",
                required: false,
                description: "Boolean for all-day events",
              },
              {
                name: "rrule",
                required: false,
                description: "RRULE for recurring events",
              },
            ],
            response: "Created event object",
          },
          {
            method: "PUT",
            path: "/events/:uid",
            description: "Update an existing event",
            body: [
              { name: "title", required: false, description: "New title" },
              { name: "start", required: false, description: "New start time" },
              { name: "end", required: false, description: "New end time" },
              {
                name: "description",
                required: false,
                description: "New description",
              },
              {
                name: "location",
                required: false,
                description: "New location",
              },
            ],
            response: "Updated event object",
          },
          {
            method: "DELETE",
            path: "/events/:uid",
            description: "Delete an event",
            query: [
              {
                name: "calendarId",
                required: false,
                description: "Calendar ID (auto-detected if not provided)",
              },
            ],
            response: "{ success: true }",
          },
          {
            method: "GET",
            path: "/config",
            description: "Get calendar configuration",
            query: [],
            response: "Calendar list with colors and visibility",
          },
          {
            method: "GET",
            path: "/health",
            description: "Check calendar system health",
            query: [],
            response: "Health status with Radicale reachability",
          },
        ],
        examples: {
          createEvent: `curl -X POST http://localhost:4321/api/calendar/events \\
  -H "Content-Type: application/json" \\
  -d '{"calendarId": "user", "title": "Meeting", "start": "2026-02-20T14:00:00"}'`,
          listEvents: `curl http://localhost:4321/api/calendar/events`,
          deleteEvent: `curl -X DELETE http://localhost:4321/api/calendar/events/EVENT_UID?calendarId=user`,
        },
      },
      conversations: {
        base: "/api",
        description: "Conversation management (via WebSocket for chat)",
        note: "Most conversation operations use WebSocket at /api/chat/ws",
        endpoints: [],
      },
      debug: {
        base: "/api/debug",
        description: "Read-only inspection endpoints (localhost-only)",
        endpoints: [
          {
            method: "GET",
            path: "/brain/status",
            description: "Agent status overview",
          },
          {
            method: "GET",
            path: "/brain/prompt",
            description: "Assembled system prompt",
          },
          {
            method: "GET",
            path: "/brain/caches",
            description: "Cache configuration",
          },
          {
            method: "GET",
            path: "/brain/files",
            description: "List brain files",
          },
          {
            method: "GET",
            path: "/brain/skills",
            description: "List available skills",
          },
          {
            method: "GET",
            path: "/calendar/events",
            description: "Raw calendar events",
          },
          {
            method: "GET",
            path: "/api-spec",
            description: "This endpoint (API discovery)",
          },
          {
            method: "GET",
            path: "/scheduler/status",
            description: "Calendar scheduler status",
          },
        ],
      },
      admin: {
        base: "/api/admin",
        description: "Mutating operations (localhost-only)",
        endpoints: [
          {
            method: "POST",
            path: "/caches/:name/invalidate",
            description: "Invalidate a cache",
          },
          {
            method: "POST",
            path: "/hatching/reset",
            description: "Reset hatching state (destructive)",
          },
          {
            method: "POST",
            path: "/conversation/:id/delete",
            description: "Delete conversation",
          },
          {
            method: "POST",
            path: "/conversation/:id/rename",
            description: "Rename conversation",
          },
          {
            method: "POST",
            path: "/notebook/:name/write",
            description: "Write to notebook file",
          },
          {
            method: "POST",
            path: "/inject-message",
            description: "Inject message into conversation",
          },
          {
            method: "POST",
            path: "/channel/:id/simulate-message",
            description: "Simulate channel message",
          },
        ],
      },
    };
  });

  /**
   * GET /conversation/:id/context
   *
   * Full context being sent to model for a specific conversation
   */
  fastify.get<{ Params: { id: string } }>(
    "/conversation/:id/context",
    async (request, reply) => {
      const { id } = request.params;
      const conversationManager = fastify.conversationManager;

      if (!conversationManager) {
        return reply
          .code(503)
          .send({ error: "Conversation manager not initialized" });
      }

      const conversation = await conversationManager.get(id);
      if (!conversation) {
        return reply.code(404).send({ error: "Conversation not found" });
      }

      // Load turns
      const turns = await conversationManager.getTurns(id, { limit: 100 });

      // Assemble system prompt
      const brainDir = join(fastify.agentDir, "brain");
      const systemPrompt = await assembleSystemPrompt(brainDir);

      // Rough token estimate (4 chars per token)
      const transcriptChars = turns.reduce(
        (sum, t) => sum + t.content.length,
        0,
      );

      return {
        conversationId: id,
        systemPrompt,
        transcript: turns.map((t) => ({
          role: t.role,
          content: t.content,
          turnNumber: t.turnNumber,
        })),
        tokenEstimate: {
          system: Math.ceil(systemPrompt.length / 4),
          transcript: Math.ceil(transcriptChars / 4),
          total: Math.ceil((systemPrompt.length + transcriptChars) / 4),
        },
      };
    },
  );

  /**
   * GET /scheduler/status
   *
   * Calendar scheduler status for monitoring
   */
  fastify.get("/scheduler/status", async () => {
    const scheduler = fastify.calendarScheduler;

    if (!scheduler) {
      return {
        running: false,
        error: "Scheduler not initialized",
        pollIntervalMs: 0,
        lookAheadMinutes: 0,
        firedCount: 0,
        lastPollAt: null,
        nextPollAt: null,
        recentlyFired: [],
      };
    }

    return scheduler.getStatus();
  });

  // POST /test-notification - Create test notification (M5-S4)
  fastify.post<{
    Body: {
      type?: "notify" | "request_input" | "escalate";
      message?: string;
      importance?: "info" | "warning" | "success" | "error";
      question?: string;
      options?: string[];
      problem?: string;
      severity?: "low" | "medium" | "high" | "critical";
    };
  }>("/test-notification", async (request) => {
    const service = fastify.notificationService;
    if (!service) {
      return { error: "Notification service not available" };
    }

    const {
      type = "notify",
      message,
      importance,
      question,
      options,
      problem,
      severity,
    } = request.body || {};

    switch (type) {
      case "notify":
        return service.notify({
          message: message || "Test notification from debug API",
          importance: importance || "info",
        });
      case "request_input":
        return service.requestInput({
          question: question || "Test question from debug API?",
          options: options || ["Yes", "No", "Maybe"],
        });
      case "escalate":
        return service.escalate({
          problem: problem || "Test escalation from debug API",
          severity: severity || "medium",
        });
      default:
        return { error: "Unknown notification type" };
    }
  });

  // ============================================================
  // MEMORY DEBUG ENDPOINTS (M6-S1)
  // ============================================================

  /**
   * GET /memory/status
   *
   * Memory index statistics and embeddings plugin status
   */
  fastify.get("/memory/status", async (request, reply) => {
    const memoryDb = fastify.memoryDb;

    if (!memoryDb) {
      return reply.code(503).send({
        error: "Memory system not initialized",
        embeddingsReady: false,
      });
    }

    return memoryDb.getStatus();
  });

  /**
   * GET /memory/search
   *
   * Raw search results for debugging hybrid search
   */
  fastify.get<{
    Querystring: {
      q: string;
      maxResults?: string;
      minScore?: string;
    };
  }>("/memory/search", async (request, reply) => {
    const searchService = fastify.searchService;

    if (!searchService) {
      return reply.code(503).send({
        error: "Search service not initialized",
      });
    }

    const { q, maxResults, minScore } = request.query;

    if (!q || !q.trim()) {
      return reply.code(400).send({ error: "Query parameter 'q' is required" });
    }

    const results = await searchService.recall(q, {
      maxResults: maxResults ? parseInt(maxResults, 10) : undefined,
      minScore: minScore ? parseFloat(minScore) : undefined,
    });

    return {
      query: q,
      notebook: results.notebook,
      daily: results.daily,
      totalResults: results.notebook.length + results.daily.length,
    };
  });

  /**
   * GET /memory/files
   *
   * List all indexed files with metadata
   */
  fastify.get("/memory/files", async (request, reply) => {
    const memoryDb = fastify.memoryDb;

    if (!memoryDb) {
      return reply.code(503).send({
        error: "Memory system not initialized",
      });
    }

    const files = memoryDb.listFiles();

    return {
      count: files.length,
      files: files.map((f) => ({
        path: f.path,
        hash: f.hash.slice(0, 8) + "...", // Truncate for readability
        size: f.size,
        mtime: f.mtime,
        indexedAt: f.indexedAt,
      })),
    };
  });

  /**
   * GET /memory/embeddings
   *
   * Embeddings plugin status and available plugins
   */
  fastify.get("/memory/embeddings", async (request, reply) => {
    const pluginRegistry = fastify.pluginRegistry;

    if (!pluginRegistry) {
      return reply.code(503).send({
        error: "Plugin registry not initialized",
      });
    }

    const active = pluginRegistry.getActive();
    const available = pluginRegistry.list();

    return {
      activePlugin: active
        ? {
            id: active.id,
            name: active.name,
            model: active.modelName,
            dimensions: active.getDimensions(),
          }
        : null,
      availablePlugins: available.map((p) => ({
        id: p.id,
        name: p.name,
        model: p.modelName,
        dimensions: p.getDimensions(),
        settings: p.getSettings?.() ?? null,
      })),
    };
  });

  /**
   * POST /memory/publish
   *
   * Trigger a memory state broadcast to all connected WebSocket clients.
   * Used for testing live updates.
   */
  fastify.post("/memory/publish", async (request, reply) => {
    if (!fastify.app) {
      return reply.code(503).send({
        error: "App not initialized",
      });
    }

    fastify.app.memory.emitChanged();

    return {
      success: true,
      message: "Memory state broadcast triggered",
    };
  });

  /**
   * POST /api/debug/initiate — Test the ConversationInitiator bridge
   *
   * Body: { mode: "alert" | "initiate" | "auto", prompt?: string }
   *
   * - alert: inject into active conversation
   * - initiate: start new conversation on preferred channel
   * - auto: try alert, fall back to initiate (debrief delivery flow)
   */
  fastify.post<{
    Body: { mode?: string; prompt?: string };
  }>("/initiate", { preHandler: localhostOnly }, async (request, reply) => {
    const initiator = fastify.conversationInitiator;
    if (!initiator) {
      return reply
        .code(503)
        .send({ error: "ConversationInitiator not initialized" });
    }

    const mode = request.body?.mode || "auto";
    const prompt =
      request.body?.prompt ||
      "A working agent just finished preparing the debrief.\n\nYou are the conversation layer — ask the user if they'd like to go through it now. Don't acknowledge this system message itself.";

    if (mode === "alert") {
      const result = await initiator.alert(prompt);
      return { mode: "alert", result };
    }

    if (mode === "initiate") {
      const { conversation: conv, delivery } = await initiator.initiate({
        firstTurnPrompt: prompt,
      });
      return { mode: "initiate", conversation: conv, delivery };
    }

    // auto: debrief delivery flow
    const result = await initiator.alert(prompt);
    if (result.status === "no_conversation") {
      const { conversation: conv, delivery } = await initiator.initiate({
        firstTurnPrompt: prompt,
      });
      return {
        mode: "auto",
        result,
        initiated: true,
        initiateDelivery: delivery,
        conversation: conv,
      };
    }
    return { mode: "auto", result, initiated: false };
  });

  /**
   * POST /api/debug/notification — M9.4-S4.2 fast-iteration probe.
   *
   * Synthetically enqueue a `job_completed` notification and drain the
   * heartbeat immediately. Used by `scripts/soak-probe.sh` to exercise the
   * full delivery path (notificationQueue → heartbeat.formatNotification →
   * conversationInitiator.alert → sendActionRequest → SDK) without waiting
   * for a real automation to fire.
   *
   * Body: `{ summary, run_dir?, automation_id?, type? }`
   *  - `summary` is the resolved deliverable content (what fu2 inlines into
   *    the action-request prompt body).
   *  - `run_dir` is logged for telemetry only (post-fu2: prompt does NOT
   *    reference it; provenance only).
   *  - `automation_id` and `type` default to "probe" / "job_completed".
   *
   * Heartbeat alerts via `getCurrent()` — caller is responsible for ensuring
   * the desired conversation is current (Strategy A: create fresh conv via
   * `POST /api/admin/conversations`; Strategy B: pre-rotate `sdk_session_id`
   * for an existing conv).
   */
  fastify.post<{
    Body: {
      summary?: string;
      run_dir?: string;
      automation_id?: string;
      type?: "job_completed" | "job_failed" | "job_interrupted" | "job_needs_review";
      conversation_id?: string; // accepted but not used — see jsdoc
    };
  }>("/notification", { preHandler: localhostOnly }, async (request, reply) => {
    const app = fastify.app;
    if (!app) {
      return reply.code(503).send({ error: "App not initialized" });
    }
    if (!app.notificationQueue) {
      return reply
        .code(503)
        .send({ error: "Notification queue not initialized (hatching incomplete?)" });
    }
    if (!app.heartbeatService) {
      return reply
        .code(503)
        .send({ error: "Heartbeat service not initialized (hatching incomplete?)" });
    }

    const body = request.body || {};
    const summary = body.summary;
    if (!summary || typeof summary !== "string" || summary.length < 10) {
      return reply
        .code(400)
        .send({ error: "summary is required (string, ≥10 chars)" });
    }

    const automation_id = body.automation_id ?? "probe";
    const type = body.type ?? "job_completed";
    const job_id = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const run_dir = body.run_dir; // optional; logged only post-fu2

    app.notificationQueue.enqueue({
      job_id,
      automation_id,
      type,
      summary,
      run_dir,
      created: new Date().toISOString(),
      delivery_attempts: 0,
    });

    // Fast-fire: drain immediately rather than waiting for the 30s tick.
    try {
      await app.heartbeatService.drainNow();
    } catch (err) {
      return reply.code(500).send({
        error: "drainNow failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      ok: true,
      enqueued: { job_id, automation_id, type, summary_length: summary.length, run_dir },
      drained: true,
    };
  });

  /**
   * POST /task-tools/update_property
   *
   * Invoke updateProperty directly. Tests property file writes.
   */
  fastify.post<{
    Body: {
      key: string;
      value: string;
      confidence: "high" | "medium" | "low";
      source?: string;
    };
  }>("/task-tools/update_property", async (request, reply) => {
    const { key, value, confidence, source } = request.body || {};
    if (!key || !value || !confidence) {
      return reply
        .code(400)
        .send({ error: "key, value, and confidence are required" });
    }

    try {
      const { updateProperty } = await import("../conversations/properties.js");
      const agentDir = fastify.agentDir;
      if (!agentDir) {
        return reply.code(503).send({ error: "agentDir not available" });
      }

      await updateProperty(agentDir, key, {
        value,
        confidence,
        source: source ?? "e2e-test",
      });

      // Read back to verify
      const { readProperties } = await import("../conversations/properties.js");
      const props = await readProperties(agentDir);

      return {
        success: true,
        property: props[key],
      };
    } catch (err) {
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  });

  // ── Capability Test (M9-S5) ──

  /**
   * GET /api/debug/capabilities — list all capabilities with health status
   */
  fastify.get("/capabilities", async () => {
    const registry = fastify.app?.capabilityRegistry;
    if (!registry) return { capabilities: [] };
    return { capabilities: registry.list() };
  });

  /**
   * POST /api/debug/capabilities/test/:type — run test harness for a capability type
   */
  fastify.post<{ Params: { type: string } }>(
    "/capabilities/test/:type",
    async (request) => {
      const registry = fastify.app?.capabilityRegistry;
      if (!registry) {
        return {
          status: "error",
          latencyMs: 0,
          message: "No capability registry",
        };
      }
      return registry.test(request.params.type);
    },
  );

  /**
   * POST /api/debug/capabilities/test-all — run test harness for all capabilities
   */
  fastify.post("/capabilities/test-all", async () => {
    const registry = fastify.app?.capabilityRegistry;
    if (!registry) {
      return { results: [] };
    }
    await registry.testAll();
    return {
      results: registry.list().map((c) => ({
        name: c.name,
        type: c.provides,
        health: c.health,
        latencyMs: c.lastTestLatencyMs,
        degradedReason: c.degradedReason,
      })),
    };
  });

  /**
   * POST /api/debug/cfr/inject — inject a synthetic CapabilityFailure into the live orchestrator.
   *
   * Constructs a real CapabilityFailure and calls cfr.emitFailure(), which triggers the
   * same orchestrator path as a live chat-service emit. Used for wall-time measurement
   * (M9.6-S16 gate) and future CFR regression testing.
   *
   * Body:
   *   capabilityType  string   — e.g. "audio-to-text"
   *   capabilityName  string?  — e.g. "stt-deepgram"
   *   symptom         string   — one of the CapabilityFailureSymptom literals
   *   detail          string?  — human-readable error tail
   *
   * Returns { ok: true, failureId: string } or { ok: false, error: string }
   */
  fastify.post<{
    Body: {
      capabilityType: string;
      capabilityName?: string;
      symptom: string;
      detail?: string;
    };
  }>("/cfr/inject", async (request, reply) => {
    const app = fastify.app;
    if (!app?.cfr) {
      return reply.code(503).send({ ok: false, error: "CFR not initialized" });
    }

    const { capabilityType, capabilityName, symptom, detail } = request.body ?? {};

    if (!capabilityType || !symptom) {
      return reply
        .code(400)
        .send({ ok: false, error: "capabilityType and symptom are required" });
    }

    const validSymptoms = [
      "not-installed",
      "not-enabled",
      "deps-missing",
      "execution-error",
      "empty-result",
      "timeout",
      "validation-failed",
    ];
    if (!validSymptoms.includes(symptom)) {
      return reply.code(400).send({
        ok: false,
        error: `symptom must be one of: ${validSymptoms.join(", ")}`,
      });
    }

    const failure = app.cfr.emitFailure({
      capabilityType,
      capabilityName,
      symptom: symptom as CapabilityFailureSymptom,
      detail,
      triggeringInput: {
        origin: { kind: "system", component: "debug-cfr-inject" },
      },
    });

    fastify.log.info(
      `[debug-cfr-inject] Injected failure ${failure.id} for ${capabilityType}`,
    );

    return { ok: true, failureId: failure.id };
  });
}
