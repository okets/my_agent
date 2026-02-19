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
import { readFile, readdir, stat } from "node:fs/promises";
import {
  assembleSystemPrompt,
  assembleCalendarContext,
  loadCalendarConfig,
  loadCalendarCredentials,
  createCalDAVClient,
  CalDAVClient,
  isHatched,
  resolveAuth,
} from "@my-agent/core";

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

/**
 * Recursively list files in a directory
 */
async function listFilesRecursive(
  dir: string,
  basePath: string = "",
): Promise<Array<{ path: string; size: number; modified: string }>> {
  const results: Array<{ path: string; size: number; modified: string }> = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        const subFiles = await listFilesRecursive(fullPath, relativePath);
        results.push(...subFiles);
      } else if (entry.isFile()) {
        try {
          const stats = await stat(fullPath);
          results.push({
            path: relativePath,
            size: stats.size,
            modified: stats.mtime.toISOString(),
          });
        } catch {
          // Skip files we can't stat
        }
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return results;
}

/**
 * Load skill descriptions from a directory
 */
async function loadSkills(
  dir: string,
  type: string,
): Promise<Array<{ name: string; path: string; description?: string }>> {
  const skills: Array<{ name: string; path: string; description?: string }> =
    [];

  try {
    const entries = await readdir(dir);
    for (const entry of entries.sort()) {
      const skillMdPath = join(dir, entry, "SKILL.md");
      try {
        const content = await readFile(skillMdPath, "utf-8");
        const firstLine = content
          .split("\n")
          .find((l) => l.trim() && !l.trim().startsWith("#"));
        skills.push({
          name: entry,
          path: join(dir, entry),
          description: firstLine?.trim(),
        });
      } catch {
        // No SKILL.md, skip
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return skills;
}

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
    const agentDir = fastify.agentDir;
    const hatched = await isHatched(agentDir);

    let authSource: string | null = null;
    let authType: string | null = null;

    try {
      const auth = resolveAuth(agentDir);
      authSource = auth.source;
      authType = auth.type;
    } catch {
      authSource = "none";
      authType = "none";
    }

    // Load model from config
    let model = "claude-sonnet-4-5-20250929"; // default
    try {
      const configPath = join(agentDir, "config.yaml");
      const configContent = await readFile(configPath, "utf-8");
      const modelMatch = configContent.match(/model:\s*(\S+)/);
      if (modelMatch) {
        model = modelMatch[1];
      }
    } catch {
      // Config not found, use default
    }

    return {
      hatched,
      authSource,
      authType,
      model,
      brainDir: agentDir,
    };
  });

  /**
   * GET /brain/prompt
   *
   * Assembled system prompt with component breakdown
   */
  fastify.get("/brain/prompt", async () => {
    const agentDir = fastify.agentDir;
    const brainDir = join(agentDir, "brain");

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

    // Assemble full system prompt with calendar context
    const systemPrompt = await assembleSystemPrompt(brainDir, {
      calendarContext,
    });

    // Load individual components for breakdown
    const components: Record<string, { source: string; chars: number } | null> =
      {};

    // Personality (CLAUDE.md)
    try {
      const content = await readFile(join(brainDir, "CLAUDE.md"), "utf-8");
      components.personality = {
        source: "brain/CLAUDE.md",
        chars: content.length,
      };
    } catch {
      components.personality = null;
    }

    // Identity
    try {
      const content = await readFile(
        join(brainDir, "memory/core/identity.md"),
        "utf-8",
      );
      components.identity = {
        source: "brain/memory/core/identity.md",
        chars: content.length,
      };
    } catch {
      components.identity = null;
    }

    // Contacts
    try {
      const content = await readFile(
        join(brainDir, "memory/core/contacts.md"),
        "utf-8",
      );
      components.contacts = {
        source: "brain/memory/core/contacts.md",
        chars: content.length,
      };
    } catch {
      components.contacts = null;
    }

    // Preferences
    try {
      const content = await readFile(
        join(brainDir, "memory/core/preferences.md"),
        "utf-8",
      );
      components.preferences = {
        source: "brain/memory/core/preferences.md",
        chars: content.length,
      };
    } catch {
      components.preferences = null;
    }

    // Notebooks
    const notebooks: Record<string, { chars: number }> = {};
    for (const name of [
      "external-communications",
      "reminders",
      "standing-orders",
    ]) {
      try {
        const content = await readFile(
          join(agentDir, "runtime", `${name}.md`),
          "utf-8",
        );
        notebooks[name] = { chars: content.length };
      } catch {
        notebooks[name] = { chars: 0 };
      }
    }

    // Skills count
    const frameworkSkills = await loadSkills(
      join(import.meta.dirname, "../../core/skills"),
      "framework",
    );
    const userSkills = await loadSkills(join(brainDir, "skills"), "user");

    return {
      systemPrompt,
      components: {
        ...components,
        notebooks,
        skills: {
          framework: frameworkSkills.length,
          user: userSkills.length,
        },
      },
      totalChars: systemPrompt.length,
    };
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
    const agentDir = fastify.agentDir;
    const brainDir = join(agentDir, "brain");

    const files = await listFilesRecursive(brainDir);

    return {
      root: brainDir,
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
    };
  });

  /**
   * GET /brain/skills
   *
   * Skill inventory from framework and user directories
   */
  fastify.get("/brain/skills", async () => {
    const agentDir = fastify.agentDir;
    const brainDir = join(agentDir, "brain");

    // Framework skills - relative to dashboard package
    const frameworkSkillsDir = join(
      import.meta.dirname,
      "../../../core/skills",
    );
    const frameworkSkills = await loadSkills(frameworkSkillsDir, "framework");

    // User skills
    const userSkillsDir = join(brainDir, "skills");
    const userSkills = await loadSkills(userSkillsDir, "user");

    return {
      framework: frameworkSkills,
      user: userSkills,
    };
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

    const { type = "notify", message, importance, question, options, problem, severity } = request.body || {};

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
}
