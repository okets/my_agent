/**
 * Calendar API Routes
 *
 * REST API for calendar operations + health endpoint.
 * Uses CalDAVClient from @my-agent/core for Radicale communication.
 */

import type { FastifyInstance } from "fastify";
import {
  createCalDAVClient,
  loadCalendarConfig,
  loadCalendarCredentials,
  type CalDAVClient,
  type CalendarEvent,
  type Calendar,
  type CreateEventInput,
  type UpdateEventInput,
  type RecurringEditMode,
} from "@my-agent/core";

// ─── FullCalendar Event Format ───

interface FullCalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  color?: string;
  textColor?: string;
  extendedProps: {
    calendarId: string;
    description?: string;
    location?: string;
    status: string;
    transparency: string;
    rrule?: string;
    taskId?: string;
    taskType?: string;
    action?: string;
  };
}

interface CalendarConfigResponse {
  calendars: Array<{
    id: string;
    name: string;
    color: string;
    defaultVisible: boolean;
    role: "owned" | "subscribed";
  }>;
}

// ─── Catppuccin Mocha Colors ───

const CATPPUCCIN_COLORS: Record<string, string> = {
  blue: "#89b4fa",
  purple: "#cba6f7",
  green: "#a6e3a1",
  red: "#f38ba8",
  orange: "#fab387",
  yellow: "#f9e2af",
  cyan: "#94e2d5",
  pink: "#f5c2e7",
  overlay1: "#7f849c",
  overlay0: "#6c7086",
  surface2: "#585b70",
};

/**
 * Resolve color name to hex (supports Catppuccin names and hex codes)
 */
function resolveColor(color: string): string {
  if (color.startsWith("#")) {
    return color;
  }
  return CATPPUCCIN_COLORS[color] ?? CATPPUCCIN_COLORS.blue;
}

/**
 * Convert CalendarEvent to FullCalendar format
 */
function toFullCalendarEvent(
  event: CalendarEvent,
  calendarColor: string,
): FullCalendarEvent {
  return {
    id: event.uid,
    title: event.title,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
    allDay: event.allDay,
    color: resolveColor(calendarColor),
    textColor: "#ffffff",
    extendedProps: {
      calendarId: event.calendarId,
      description: event.description,
      location: event.location,
      status: event.status,
      transparency: event.transparency,
      rrule: event.rrule,
      taskId: event.taskId,
      taskType: event.taskType,
      action: event.action,
    },
  };
}

// ─── Singleton Client ───

let calendarClient: CalDAVClient | null = null;

function getCalendarClient(agentDir: string): CalDAVClient | null {
  if (calendarClient) {
    return calendarClient;
  }

  const config = loadCalendarConfig(agentDir);
  const credentials = loadCalendarCredentials(agentDir);

  if (!credentials) {
    return null;
  }

  calendarClient = createCalDAVClient(config, credentials);
  return calendarClient;
}

// ─── Route Types ───

interface GetEventsQuery {
  start?: string;
  end?: string;
  calendars?: string;
}

interface CreateEventBody {
  calendarId: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  description?: string;
  location?: string;
  rrule?: string;
}

interface UpdateEventBody {
  title?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  description?: string;
  location?: string;
  editMode?: RecurringEditMode;
}

interface EventParams {
  uid: string;
}

interface DeleteEventQuery {
  calendarId?: string;
  editMode?: RecurringEditMode;
}

// ─── Health Types ───

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
    const client = getCalendarClient(fastify.agentDir);

    if (!client) {
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

    const health = await client.checkHealth();

    let status: CalendarHealth["status"];
    if (!health.reachable) {
      status = "offline";
    } else if (health.error) {
      status = "degraded";
    } else {
      status = "healthy";
    }

    const calendars = health.reachable ? ["system", "user"] : [];

    return {
      status,
      radicale: health,
      calendars,
      lastSync: health.reachable ? new Date().toISOString() : null,
    };
  });

  /**
   * GET /api/calendar/config
   *
   * Returns calendar list with colors and visibility settings
   */
  fastify.get<{ Reply: CalendarConfigResponse }>(
    "/api/calendar/config",
    async () => {
      const client = getCalendarClient(fastify.agentDir);

      if (!client) {
        return { calendars: [] };
      }

      try {
        const calendars = await client.listCalendars();
        return {
          calendars: calendars.map((cal: Calendar) => ({
            id: cal.id,
            name: cal.displayName,
            color: resolveColor(cal.color),
            defaultVisible: cal.defaultVisible,
            role: cal.role,
          })),
        };
      } catch (err) {
        fastify.log.error(`Failed to list calendars: ${err}`);
        return { calendars: [] };
      }
    },
  );

  /**
   * GET /api/calendar/events
   *
   * Returns events in FullCalendar format
   * Query params:
   *   - start: ISO date string (default: now)
   *   - end: ISO date string (default: +30 days)
   *   - calendars: comma-separated calendar IDs (default: all)
   */
  fastify.get<{ Querystring: GetEventsQuery; Reply: FullCalendarEvent[] }>(
    "/api/calendar/events",
    async (request) => {
      const client = getCalendarClient(fastify.agentDir);

      if (!client) {
        return [];
      }

      const { start, end, calendars } = request.query;

      const startDate = start ? new Date(start) : new Date();
      const endDate = end
        ? new Date(end)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      // Get calendar colors
      const calendarList = await client.listCalendars();
      const colorMap = new Map<string, string>();
      for (const cal of calendarList) {
        colorMap.set(cal.id, cal.color);
      }

      // Filter calendars if specified
      const calendarIds = calendars ? calendars.split(",") : null;

      try {
        const events = await client.getEvents("all", startDate, endDate);

        // Filter by calendar if specified
        const filtered = calendarIds
          ? events.filter((e: CalendarEvent) =>
              calendarIds.includes(e.calendarId),
            )
          : events;

        return filtered.map((e: CalendarEvent) =>
          toFullCalendarEvent(e, colorMap.get(e.calendarId) ?? "blue"),
        );
      } catch (err) {
        fastify.log.error(`Failed to get events: ${err}`);
        return [];
      }
    },
  );

  /**
   * GET /api/calendar/events/today
   *
   * Returns today's events for mini calendar widget
   */
  fastify.get<{ Reply: FullCalendarEvent[] }>(
    "/api/calendar/events/today",
    async () => {
      const client = getCalendarClient(fastify.agentDir);

      if (!client) {
        return [];
      }

      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      // Get calendar colors
      const calendarList = await client.listCalendars();
      const colorMap = new Map<string, string>();
      for (const cal of calendarList) {
        colorMap.set(cal.id, cal.color);
      }

      try {
        const events = await client.getEvents("all", startOfDay, endOfDay);
        return events.map((e: CalendarEvent) =>
          toFullCalendarEvent(e, colorMap.get(e.calendarId) ?? "blue"),
        );
      } catch (err) {
        fastify.log.error(`Failed to get today's events: ${err}`);
        return [];
      }
    },
  );

  /**
   * POST /api/calendar/events
   *
   * Create a new event
   */
  fastify.post<{ Body: CreateEventBody; Reply: FullCalendarEvent }>(
    "/api/calendar/events",
    async (request, reply) => {
      const client = getCalendarClient(fastify.agentDir);

      if (!client) {
        return reply.code(503).send({
          error: "Calendar not configured",
        } as unknown as FullCalendarEvent);
      }

      const {
        calendarId,
        title,
        start,
        end,
        allDay,
        description,
        location,
        rrule,
      } = request.body;

      if (!calendarId || !title || !start) {
        return reply.code(400).send({
          error: "calendarId, title, and start are required",
        } as unknown as FullCalendarEvent);
      }

      const startDate = new Date(start);
      const endDate = end
        ? new Date(end)
        : new Date(startDate.getTime() + 60 * 60 * 1000); // Default: 1 hour

      const eventInput: CreateEventInput = {
        calendarId,
        title,
        start: startDate,
        end: endDate,
        allDay: allDay ?? false,
        description,
        location,
        rrule,
        status: "confirmed",
        transparency: "opaque",
      };

      try {
        const created = await client.createEvent(calendarId, eventInput);

        // Get calendar color
        const calendars = await client.listCalendars();
        const cal = calendars.find((c: Calendar) => c.id === calendarId);

        // Broadcast updated calendar state
        fastify.statePublisher?.publishCalendar();

        return toFullCalendarEvent(created, cal?.color ?? "blue");
      } catch (err) {
        fastify.log.error(`Failed to create event: ${err}`);
        return reply.code(500).send({
          error: err instanceof Error ? err.message : String(err),
        } as unknown as FullCalendarEvent);
      }
    },
  );

  /**
   * PUT /api/calendar/events/:uid
   *
   * Update an existing event
   */
  fastify.put<{
    Params: EventParams;
    Body: UpdateEventBody;
    Reply: FullCalendarEvent;
  }>("/api/calendar/events/:uid", async (request, reply) => {
    const client = getCalendarClient(fastify.agentDir);

    if (!client) {
      return reply.code(503).send({
        error: "Calendar not configured",
      } as unknown as FullCalendarEvent);
    }

    const { uid } = request.params;
    const { title, start, end, allDay, description, location, editMode } =
      request.body;

    // We need to find which calendar contains this event
    // For now, search all calendars
    const calendars = await client.listCalendars();
    let targetCalendarId: string | null = null;

    for (const cal of calendars) {
      try {
        const events = await client.getEvents(
          cal.id,
          new Date(0),
          new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        );
        if (events.some((e: CalendarEvent) => e.uid === uid)) {
          targetCalendarId = cal.id;
          break;
        }
      } catch {
        // Calendar might be empty or inaccessible
      }
    }

    if (!targetCalendarId) {
      return reply
        .code(404)
        .send({ error: "Event not found" } as unknown as FullCalendarEvent);
    }

    const updates: UpdateEventInput = {};
    if (title !== undefined) updates.title = title;
    if (start !== undefined) updates.start = new Date(start);
    if (end !== undefined) updates.end = new Date(end);
    if (allDay !== undefined) updates.allDay = allDay;
    if (description !== undefined) updates.description = description;
    if (location !== undefined) updates.location = location;

    try {
      const updated = await client.updateEvent(
        targetCalendarId,
        uid,
        updates,
        editMode,
      );

      // Broadcast updated calendar state
      fastify.statePublisher?.publishCalendar();

      const cal = calendars.find((c: Calendar) => c.id === targetCalendarId);
      return toFullCalendarEvent(updated, cal?.color ?? "blue");
    } catch (err) {
      fastify.log.error(`Failed to update event: ${err}`);
      return reply.code(500).send({
        error: err instanceof Error ? err.message : String(err),
      } as unknown as FullCalendarEvent);
    }
  });

  /**
   * DELETE /api/calendar/events/:uid
   *
   * Delete an event
   */
  fastify.delete<{
    Params: EventParams;
    Querystring: DeleteEventQuery;
    Reply: { success: boolean };
  }>("/api/calendar/events/:uid", async (request, reply) => {
    const client = getCalendarClient(fastify.agentDir);

    if (!client) {
      return reply.code(503).send({ success: false });
    }

    const { uid } = request.params;
    const { calendarId, editMode } = request.query;

    // Find calendar containing the event
    let targetCalendarId = calendarId;

    if (!targetCalendarId) {
      const calendars = await client.listCalendars();
      for (const cal of calendars) {
        try {
          const events = await client.getEvents(
            cal.id,
            new Date(0),
            new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          );
          if (events.some((e: CalendarEvent) => e.uid === uid)) {
            targetCalendarId = cal.id;
            break;
          }
        } catch {
          // Calendar might be empty
        }
      }
    }

    if (!targetCalendarId) {
      return reply.code(404).send({ success: false });
    }

    try {
      await client.deleteEvent(targetCalendarId, uid, editMode);

      // Broadcast updated calendar state
      fastify.statePublisher?.publishCalendar();

      return { success: true };
    } catch (err) {
      fastify.log.error(`Failed to delete event: ${err}`);
      return reply.code(500).send({ success: false });
    }
  });
}
