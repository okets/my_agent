/**
 * Calendar System Types
 *
 * Core interfaces for the CalDAV-based calendar system.
 * See docs/design/calendar-system.md for architecture details.
 */

/**
 * Calendar event representation.
 * Maps to iCalendar VEVENT with my_agent extensions.
 */
export interface CalendarEvent {
  /** Stable unique ID (UUID format) */
  uid: string

  /** Which calendar this event belongs to */
  calendarId: string

  /** Event title/summary */
  title: string

  /** Optional description/notes */
  description?: string

  /** Event start time */
  start: Date

  /** Event end time */
  end: Date

  /** True if this is an all-day event */
  allDay: boolean

  /** RFC 5545 RRULE string for recurring events */
  rrule?: string

  /** Event status */
  status: 'confirmed' | 'tentative' | 'cancelled'

  /** Transparency for free/busy - opaque blocks time, transparent doesn't */
  transparency: 'opaque' | 'transparent'

  /** Optional location */
  location?: string

  // ─── my_agent Extensions (stored as X- properties in iCal) ───

  /** Links to a task folder ID */
  taskId?: string

  /** Type of task-related event */
  taskType?: 'scheduled' | 'deadline' | 'reminder'

  /** Action identifier for system events (e.g., "daily-summary") */
  action?: string
}

/**
 * Input for creating a new event (uid generated automatically)
 */
export type CreateEventInput = Omit<CalendarEvent, 'uid'>

/**
 * Input for updating an event (partial updates allowed)
 */
export type UpdateEventInput = Partial<Omit<CalendarEvent, 'uid' | 'calendarId'>>

/**
 * Calendar representation.
 * Maps to a CalDAV calendar collection.
 */
export interface Calendar {
  /** Calendar identifier (e.g., "system", "user", "personal") */
  id: string

  /** Human-readable display name */
  displayName: string

  /** CalDAV URL for this calendar */
  url: string

  /** Color for UI display (Catppuccin color name or hex) */
  color: string

  /** Ownership role */
  role: 'owned' | 'subscribed'

  /** Notification behavior */
  notifications: boolean | 'passthrough'

  /** Whether visible by default in UI */
  defaultVisible: boolean
}

/**
 * Edit mode for recurring event modifications.
 * Standard 3-option pattern from calendar UIs.
 */
export type RecurringEditMode = 'this' | 'following' | 'all'

/**
 * Repository interface for calendar operations.
 * Allows swapping backends (Radicale → SQLite → Google) without changing business logic.
 */
export interface CalendarRepository {
  /**
   * List all available calendars.
   */
  listCalendars(): Promise<Calendar[]>

  /**
   * Get events within a date range.
   * Recurring events are expanded into individual occurrences.
   *
   * @param calendarId - Calendar to query (or "all" for all calendars)
   * @param from - Start of date range
   * @param to - End of date range
   */
  getEvents(calendarId: string | 'all', from: Date, to: Date): Promise<CalendarEvent[]>

  /**
   * Create a new event.
   *
   * @param calendarId - Calendar to create event in
   * @param event - Event data (uid will be generated)
   * @returns Created event with generated uid
   */
  createEvent(calendarId: string, event: CreateEventInput): Promise<CalendarEvent>

  /**
   * Update an existing event.
   *
   * @param calendarId - Calendar containing the event
   * @param uid - Event unique ID
   * @param updates - Fields to update
   * @param editMode - For recurring events: which occurrences to update
   */
  updateEvent(
    calendarId: string,
    uid: string,
    updates: UpdateEventInput,
    editMode?: RecurringEditMode,
  ): Promise<CalendarEvent>

  /**
   * Delete an event.
   *
   * @param calendarId - Calendar containing the event
   * @param uid - Event unique ID
   * @param editMode - For recurring events: which occurrences to delete
   */
  deleteEvent(calendarId: string, uid: string, editMode?: RecurringEditMode): Promise<void>

  /**
   * Get upcoming events within a time window.
   * Convenience method for prompt context.
   *
   * @param windowHours - Hours to look ahead (default: 48)
   * @param maxEvents - Maximum events to return (default: 10)
   */
  getUpcoming(windowHours?: number, maxEvents?: number): Promise<CalendarEvent[]>
}

/**
 * Calendar health status for monitoring.
 */
export interface CalendarHealth {
  /** Overall status */
  status: 'healthy' | 'degraded' | 'offline'

  /** Radicale server status */
  radicale: {
    reachable: boolean
    latencyMs?: number
    error?: string
  }

  /** Available calendars */
  calendars: string[]

  /** Last successful sync time */
  lastSync: Date | null
}

/**
 * Calendar configuration from .my_agent/config.yaml
 */
export interface CalendarConfig {
  server: {
    host: string
    port: number
  }

  calendars: Record<
    string,
    {
      url?: string
      role: 'owned' | 'subscribed'
      color: string
      notifications: boolean | 'passthrough'
      defaultVisible: boolean
      syncIntervalMinutes?: number
    }
  >
}

/**
 * Credentials for CalDAV authentication.
 * Stored in .my_agent/calendar/credentials.json
 */
export interface CalendarCredentials {
  username: string
  password: string
}
