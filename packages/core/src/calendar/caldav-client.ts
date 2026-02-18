/**
 * CalDAV Client Implementation
 *
 * Implements CalendarRepository using tsdav for CalDAV operations
 * and ical-expander for recurring event expansion.
 */

import { createDAVClient, type DAVCalendar } from 'tsdav'
import IcalExpander from 'ical-expander'
import { DateTime } from 'luxon'
import { randomUUID } from 'node:crypto'
import type {
  CalendarRepository,
  CalendarEvent,
  Calendar,
  CreateEventInput,
  UpdateEventInput,
  RecurringEditMode,
  CalendarConfig,
  CalendarCredentials,
} from './types.js'

// Type for the DAV client returned by createDAVClient
type DAVClientInstance = Awaited<ReturnType<typeof createDAVClient>>

// Types for ical-expander results (not exported by the library)
interface ICalExpanderEvent {
  startDate: { toJSDate(): Date; isDate: boolean }
  endDate: { toJSDate(): Date; isDate: boolean }
  component: ICalComponent
}

interface ICalExpanderOccurrence {
  startDate: { toJSDate(): Date; isDate: boolean }
  endDate: { toJSDate(): Date; isDate: boolean }
  item: { component: ICalComponent }
}

interface ICalComponent {
  getFirstPropertyValue(name: string): unknown
}

interface ICalExpanderResult {
  events: ICalExpanderEvent[]
  occurrences: ICalExpanderOccurrence[]
}

/**
 * CalDAV-based implementation of CalendarRepository
 */
export class CalDAVClient implements CalendarRepository {
  private client: DAVClientInstance | null = null
  private config: CalendarConfig
  private credentials: CalendarCredentials
  private calendarsCache: Map<string, DAVCalendar> = new Map()
  private cacheExpiry: number = 0
  private readonly CACHE_TTL_MS = 60_000 // 60 seconds

  constructor(config: CalendarConfig, credentials: CalendarCredentials) {
    this.config = config
    this.credentials = credentials
  }

  /**
   * Get or create the DAV client connection
   */
  private async getClient(): Promise<DAVClientInstance> {
    if (this.client) {
      return this.client
    }

    const serverUrl = `http://${this.config.server.host}:${this.config.server.port}`

    this.client = await createDAVClient({
      serverUrl,
      credentials: {
        username: this.credentials.username,
        password: this.credentials.password,
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    })

    return this.client
  }

  /**
   * Get DAVCalendar objects, with caching
   */
  private async getDAVCalendars(): Promise<Map<string, DAVCalendar>> {
    const now = Date.now()
    if (this.calendarsCache.size > 0 && now < this.cacheExpiry) {
      return this.calendarsCache
    }

    const client = await this.getClient()
    const davCalendars = await client.fetchCalendars()

    this.calendarsCache.clear()
    for (const cal of davCalendars) {
      // Extract calendar ID from URL (last path segment)
      const urlParts = cal.url.replace(/\/$/, '').split('/')
      const id = urlParts[urlParts.length - 1]
      this.calendarsCache.set(id, cal)
    }

    this.cacheExpiry = now + this.CACHE_TTL_MS
    return this.calendarsCache
  }

  /**
   * Find a specific DAVCalendar by ID
   */
  private async findDAVCalendar(calendarId: string): Promise<DAVCalendar> {
    const calendars = await this.getDAVCalendars()
    const calendar = calendars.get(calendarId)
    if (!calendar) {
      throw new Error(`Calendar not found: ${calendarId}`)
    }
    return calendar
  }

  /**
   * Generate iCalendar VEVENT string
   */
  private generateICalEvent(event: CreateEventInput & { uid: string }): string {
    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//my_agent//calendar//EN',
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${DateTime.now().toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`,
    ]

    // Date formatting
    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${DateTime.fromJSDate(event.start).toFormat('yyyyMMdd')}`)
      lines.push(`DTEND;VALUE=DATE:${DateTime.fromJSDate(event.end).toFormat('yyyyMMdd')}`)
    } else {
      lines.push(`DTSTART:${DateTime.fromJSDate(event.start).toFormat("yyyyMMdd'T'HHmmss")}`)
      lines.push(`DTEND:${DateTime.fromJSDate(event.end).toFormat("yyyyMMdd'T'HHmmss")}`)
    }

    lines.push(`SUMMARY:${this.escapeICalText(event.title)}`)

    if (event.description) {
      lines.push(`DESCRIPTION:${this.escapeICalText(event.description)}`)
    }

    if (event.location) {
      lines.push(`LOCATION:${this.escapeICalText(event.location)}`)
    }

    if (event.rrule) {
      lines.push(`RRULE:${event.rrule}`)
    }

    lines.push(`STATUS:${event.status.toUpperCase()}`)
    lines.push(`TRANSP:${event.transparency.toUpperCase()}`)

    // my_agent extensions
    if (event.taskId) {
      lines.push(`X-MYAGENT-TASK-ID:${event.taskId}`)
    }
    if (event.taskType) {
      lines.push(`X-MYAGENT-TASK-TYPE:${event.taskType}`)
    }
    if (event.action) {
      lines.push(`X-MYAGENT-ACTION:${event.action}`)
    }

    lines.push('END:VEVENT', 'END:VCALENDAR')

    return lines.join('\r\n')
  }

  /**
   * Escape text for iCalendar format
   */
  private escapeICalText(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n')
  }

  /**
   * Parse iCalendar data into CalendarEvent objects
   */
  private parseICalEvents(
    icalData: string,
    calendarId: string,
    from: Date,
    to: Date,
  ): CalendarEvent[] {
    const events: CalendarEvent[] = []

    try {
      const expander = new IcalExpander({
        ics: icalData,
        maxIterations: 365, // Limit recurring event expansion
      })

      const expanded = expander.between(from, to) as ICalExpanderResult

      // Process non-recurring events
      for (const event of expanded.events) {
        events.push(this.veventToCalendarEvent(event, calendarId))
      }

      // Process recurring event occurrences
      for (const occurrence of expanded.occurrences) {
        events.push(this.occurrenceToCalendarEvent(occurrence, calendarId))
      }
    } catch (err) {
      console.warn(`Error parsing iCal data: ${err}`)
    }

    return events
  }

  /**
   * Convert ical-expander event to CalendarEvent
   */
  private veventToCalendarEvent(event: ICalExpanderEvent, calendarId: string): CalendarEvent {
    const vevent = event.component

    return {
      uid: vevent.getFirstPropertyValue('uid') as string,
      calendarId,
      title: (vevent.getFirstPropertyValue('summary') as string) ?? 'Untitled',
      description: vevent.getFirstPropertyValue('description') as string | undefined,
      start: event.startDate.toJSDate(),
      end: event.endDate.toJSDate(),
      allDay: event.startDate.isDate,
      rrule: this.extractRrule(vevent.getFirstPropertyValue('rrule')),
      status: this.parseStatus(vevent.getFirstPropertyValue('status') as string),
      transparency: this.parseTransparency(vevent.getFirstPropertyValue('transp') as string),
      location: vevent.getFirstPropertyValue('location') as string | undefined,
      taskId: vevent.getFirstPropertyValue('x-myagent-task-id') as string | undefined,
      taskType: vevent.getFirstPropertyValue('x-myagent-task-type') as
        | 'scheduled'
        | 'deadline'
        | 'reminder'
        | undefined,
      action: vevent.getFirstPropertyValue('x-myagent-action') as string | undefined,
    }
  }

  /**
   * Convert ical-expander occurrence to CalendarEvent
   */
  private occurrenceToCalendarEvent(
    occurrence: ICalExpanderOccurrence,
    calendarId: string,
  ): CalendarEvent {
    const vevent = occurrence.item.component

    return {
      uid: vevent.getFirstPropertyValue('uid') as string,
      calendarId,
      title: (vevent.getFirstPropertyValue('summary') as string) ?? 'Untitled',
      description: vevent.getFirstPropertyValue('description') as string | undefined,
      start: occurrence.startDate.toJSDate(),
      end: occurrence.endDate.toJSDate(),
      allDay: occurrence.startDate.isDate,
      rrule: this.extractRrule(vevent.getFirstPropertyValue('rrule')),
      status: this.parseStatus(vevent.getFirstPropertyValue('status') as string),
      transparency: this.parseTransparency(vevent.getFirstPropertyValue('transp') as string),
      location: vevent.getFirstPropertyValue('location') as string | undefined,
      taskId: vevent.getFirstPropertyValue('x-myagent-task-id') as string | undefined,
      taskType: vevent.getFirstPropertyValue('x-myagent-task-type') as
        | 'scheduled'
        | 'deadline'
        | 'reminder'
        | undefined,
      action: vevent.getFirstPropertyValue('x-myagent-action') as string | undefined,
    }
  }

  /**
   * Extract RRULE string from property value (can be string or object)
   */
  private extractRrule(value: unknown): string | undefined {
    if (!value) return undefined
    if (typeof value === 'string') return value
    if (typeof value === 'object' && value !== null && 'toString' in value) {
      return (value as { toString(): string }).toString()
    }
    return undefined
  }

  private parseStatus(status: string | null): 'confirmed' | 'tentative' | 'cancelled' {
    switch (status?.toUpperCase()) {
      case 'TENTATIVE':
        return 'tentative'
      case 'CANCELLED':
        return 'cancelled'
      default:
        return 'confirmed'
    }
  }

  private parseTransparency(transp: string | null): 'opaque' | 'transparent' {
    return transp?.toUpperCase() === 'TRANSPARENT' ? 'transparent' : 'opaque'
  }

  // ─── CalendarRepository Implementation ───

  async listCalendars(): Promise<Calendar[]> {
    const davCalendars = await this.getDAVCalendars()
    const result: Calendar[] = []

    for (const [id, dav] of davCalendars) {
      const configEntry = this.config.calendars[id]
      // displayName can be string or object, extract string value
      const displayName = typeof dav.displayName === 'string' ? dav.displayName : id
      result.push({
        id,
        displayName,
        url: dav.url,
        color: configEntry?.color ?? 'blue',
        role: configEntry?.role ?? 'owned',
        notifications: configEntry?.notifications ?? true,
        defaultVisible: configEntry?.defaultVisible ?? true,
      })
    }

    return result
  }

  async getEvents(calendarId: string | 'all', from: Date, to: Date): Promise<CalendarEvent[]> {
    const client = await this.getClient()
    const calendars = await this.getDAVCalendars()

    const targetCalendars =
      calendarId === 'all'
        ? Array.from(calendars.values())
        : [await this.findDAVCalendar(calendarId)]

    const allEvents: CalendarEvent[] = []

    for (const calendar of targetCalendars) {
      const urlParts = calendar.url.replace(/\/$/, '').split('/')
      const calId = urlParts[urlParts.length - 1]

      const objects = await client.fetchCalendarObjects({ calendar })

      for (const obj of objects) {
        if (obj.data) {
          const events = this.parseICalEvents(obj.data, calId, from, to)
          allEvents.push(...events)
        }
      }
    }

    // Sort by start time
    allEvents.sort((a, b) => a.start.getTime() - b.start.getTime())

    return allEvents
  }

  async createEvent(calendarId: string, event: CreateEventInput): Promise<CalendarEvent> {
    const client = await this.getClient()
    const calendar = await this.findDAVCalendar(calendarId)

    const uid = `${randomUUID()}@my_agent`
    const eventWithUid = { ...event, uid }
    const icalData = this.generateICalEvent(eventWithUid)

    await client.createCalendarObject({
      calendar,
      filename: `${uid}.ics`,
      iCalString: icalData,
    })

    // Invalidate cache
    this.cacheExpiry = 0

    return {
      ...event,
      uid,
      calendarId,
    }
  }

  async updateEvent(
    calendarId: string,
    uid: string,
    updates: UpdateEventInput,
    _editMode?: RecurringEditMode,
  ): Promise<CalendarEvent> {
    const client = await this.getClient()
    const calendar = await this.findDAVCalendar(calendarId)

    // Fetch current event
    const objects = await client.fetchCalendarObjects({ calendar })
    const existing = objects.find((o) => o.data?.includes(`UID:${uid}`))

    if (!existing) {
      throw new Error(`Event not found: ${uid}`)
    }

    // For now, we do a simple full replacement
    // TODO: Implement editMode for recurring events (EXDATE, RECURRENCE-ID)

    // Parse existing event to get current values
    const from = new Date(0)
    const to = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    const currentEvents = this.parseICalEvents(existing.data!, calendarId, from, to)
    const current = currentEvents[0]

    if (!current) {
      throw new Error(`Could not parse existing event: ${uid}`)
    }

    // Merge updates
    const updated: CalendarEvent = {
      ...current,
      ...updates,
      uid,
      calendarId,
    }

    // Generate new iCal data
    const icalData = this.generateICalEvent(updated)

    // Update via CalDAV
    await client.updateCalendarObject({
      calendarObject: {
        ...existing,
        data: icalData,
      },
    })

    // Invalidate cache
    this.cacheExpiry = 0

    return updated
  }

  async deleteEvent(calendarId: string, uid: string, _editMode?: RecurringEditMode): Promise<void> {
    const client = await this.getClient()
    const calendar = await this.findDAVCalendar(calendarId)

    // Find the calendar object containing this event
    const objects = await client.fetchCalendarObjects({ calendar })
    const existing = objects.find((o) => o.data?.includes(`UID:${uid}`))

    if (!existing) {
      throw new Error(`Event not found: ${uid}`)
    }

    // TODO: Implement editMode for recurring events (add EXDATE)

    await client.deleteCalendarObject({
      calendarObject: existing,
    })

    // Invalidate cache
    this.cacheExpiry = 0
  }

  async getUpcoming(windowHours: number = 48, maxEvents: number = 10): Promise<CalendarEvent[]> {
    const now = new Date()
    const end = new Date(now.getTime() + windowHours * 60 * 60 * 1000)

    const events = await this.getEvents('all', now, end)

    return events.slice(0, maxEvents)
  }

  /**
   * Check if Radicale is reachable
   */
  async checkHealth(): Promise<{
    reachable: boolean
    latencyMs?: number
    error?: string
  }> {
    const start = Date.now()
    try {
      await this.getClient()
      await this.getDAVCalendars()
      return {
        reachable: true,
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      return {
        reachable: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /**
   * Invalidate all caches
   */
  invalidateCache(): void {
    this.cacheExpiry = 0
    this.calendarsCache.clear()
  }

  /**
   * Close the client connection
   */
  close(): void {
    this.client = null
    this.invalidateCache()
  }
}

/**
 * Create a CalDAVClient instance
 */
export function createCalDAVClient(
  config: CalendarConfig,
  credentials: CalendarCredentials,
): CalDAVClient {
  return new CalDAVClient(config, credentials)
}
