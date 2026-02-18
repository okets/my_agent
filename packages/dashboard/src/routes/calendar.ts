/**
 * Calendar API Routes
 *
 * Health endpoint for calendar/Radicale status.
 */

import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface CalendarHealth {
  status: "healthy" | "degraded" | "offline";
  radicale: {
    reachable: boolean;
    latencyMs?: number;
    error?: string;
  };
  calendars: string[];
  lastSync: string | null;
}

interface CalendarCredentials {
  username: string;
  password: string;
}

/**
 * Load credentials from .my_agent/calendar/credentials.json
 */
async function loadCredentials(
  agentDir: string,
): Promise<CalendarCredentials | null> {
  const credentialsPath = join(agentDir, "calendar", "credentials.json");
  try {
    const raw = await readFile(credentialsPath, "utf-8");
    return JSON.parse(raw) as CalendarCredentials;
  } catch {
    return null;
  }
}

/**
 * Check Radicale health by attempting a PROPFIND request
 */
async function checkRadicaleHealth(
  credentials: CalendarCredentials,
): Promise<CalendarHealth["radicale"]> {
  const start = Date.now();
  const url = "http://127.0.0.1:5232/";

  try {
    const auth = Buffer.from(
      `${credentials.username}:${credentials.password}`,
    ).toString("base64");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: "PROPFIND",
      headers: {
        Authorization: `Basic ${auth}`,
        Depth: "0",
        "Content-Type": "application/xml",
      },
      body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 207 || response.status === 200) {
      return {
        reachable: true,
        latencyMs: Date.now() - start,
      };
    } else if (response.status === 401) {
      return {
        reachable: true,
        latencyMs: Date.now() - start,
        error: "Authentication failed",
      };
    } else {
      return {
        reachable: false,
        error: `Unexpected status: ${response.status}`,
      };
    }
  } catch (err) {
    return {
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Register calendar routes
 */
export async function registerCalendarRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  /**
   * GET /api/calendar/health
   *
   * Returns calendar system health status
   */
  fastify.get<{ Reply: CalendarHealth }>("/api/calendar/health", async () => {
    const credentials = await loadCredentials(fastify.agentDir);

    if (!credentials) {
      return {
        status: "offline",
        radicale: {
          reachable: false,
          error: "Credentials not configured",
        },
        calendars: [],
        lastSync: null,
      };
    }

    const radicaleHealth = await checkRadicaleHealth(credentials);

    // Determine overall status
    let status: CalendarHealth["status"];
    if (!radicaleHealth.reachable) {
      status = "offline";
    } else if (radicaleHealth.error) {
      status = "degraded";
    } else {
      status = "healthy";
    }

    // TODO: Fetch actual calendar list when healthy
    const calendars = radicaleHealth.reachable ? ["system", "user"] : [];

    return {
      status,
      radicale: radicaleHealth,
      calendars,
      lastSync: radicaleHealth.reachable ? new Date().toISOString() : null,
    };
  });
}
