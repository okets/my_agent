/**
 * Calendar Context for System Prompt
 *
 * Assembles a markdown summary of upcoming events for inclusion
 * in the agent's system prompt.
 */

import { DateTime } from 'luxon'
import type { CalendarRepository, CalendarEvent } from './types.js'

/** Default look-ahead window in hours */
const DEFAULT_WINDOW_HOURS = 48

/** Maximum events to include in context */
const DEFAULT_MAX_EVENTS = 10

/** Cache TTL in milliseconds */
const CACHE_TTL_MS = 60_000 // 60 seconds

// Simple in-memory cache
let cachedContext: string | null = null
let cacheExpiry = 0

/**
 * Format a single event for display
 */
function formatEvent(event: CalendarEvent): string {
  const start = DateTime.fromJSDate(event.start)
  const parts: string[] = []

  // Time or "All day"
  if (event.allDay) {
    parts.push('All day')
  } else {
    parts.push(start.toFormat('HH:mm'))
  }

  // Title
  parts.push('—')
  parts.push(event.title)

  // Annotations
  const annotations: string[] = []

  if (event.rrule) {
    annotations.push('recurring')
  }

  if (event.taskType === 'deadline') {
    annotations.push('DEADLINE')
  }

  if (event.transparency === 'transparent') {
    annotations.push('tentative')
  }

  // Calendar source if not user calendar
  if (event.calendarId === 'personal') {
    annotations.push('from: personal')
  } else if (event.calendarId === 'system') {
    annotations.push('system')
  }

  if (annotations.length > 0) {
    parts.push(`[${annotations.join(', ')}]`)
  }

  return `- ${parts.join(' ')}`
}

/**
 * Group events by date and format as markdown
 */
function formatEventsAsMarkdown(events: CalendarEvent[]): string {
  if (events.length === 0) {
    return 'No upcoming events.'
  }

  const now = DateTime.now()
  const today = now.startOf('day')
  const tomorrow = today.plus({ days: 1 })
  const endOfWeek = today.plus({ days: 7 })

  // Group events by date category
  const todayEvents: CalendarEvent[] = []
  const tomorrowEvents: CalendarEvent[] = []
  const thisWeekEvents: CalendarEvent[] = []

  for (const event of events) {
    const eventDate = DateTime.fromJSDate(event.start).startOf('day')

    if (eventDate.equals(today)) {
      todayEvents.push(event)
    } else if (eventDate.equals(tomorrow)) {
      tomorrowEvents.push(event)
    } else if (eventDate < endOfWeek) {
      thisWeekEvents.push(event)
    }
  }

  const sections: string[] = []

  // Today
  if (todayEvents.length > 0) {
    const dateStr = today.toFormat('LLL d')
    sections.push(`Today (${dateStr}):`)
    for (const event of todayEvents) {
      sections.push(formatEvent(event))
    }
  }

  // Tomorrow
  if (tomorrowEvents.length > 0) {
    const dateStr = tomorrow.toFormat('LLL d')
    sections.push('')
    sections.push(`Tomorrow (${dateStr}):`)
    for (const event of tomorrowEvents) {
      sections.push(formatEvent(event))
    }
  }

  // This week (remaining days)
  if (thisWeekEvents.length > 0) {
    sections.push('')
    sections.push('This week:')
    for (const event of thisWeekEvents) {
      const eventDate = DateTime.fromJSDate(event.start)
      const datePrefix = eventDate.toFormat('ccc d')
      const formatted = formatEvent(event)
      // Replace the leading "- " with "- <date> "
      sections.push(formatted.replace(/^- /, `- ${datePrefix} `))
    }
  }

  return sections.join('\n')
}

/**
 * Assemble calendar context for the system prompt.
 *
 * Returns a markdown-formatted summary of upcoming events,
 * or a fallback message if the calendar is unavailable.
 *
 * @param repo - CalendarRepository instance
 * @param windowHours - Hours to look ahead (default: 48)
 * @param maxEvents - Maximum events to include (default: 10)
 * @returns Markdown string for system prompt
 */
export async function assembleCalendarContext(
  repo: CalendarRepository,
  windowHours: number = DEFAULT_WINDOW_HOURS,
  maxEvents: number = DEFAULT_MAX_EVENTS,
): Promise<string> {
  // Check cache
  const now = Date.now()
  if (cachedContext && now < cacheExpiry) {
    return cachedContext
  }

  try {
    const events = await repo.getUpcoming(windowHours, maxEvents)
    const content = formatEventsAsMarkdown(events)

    const markdown = `## Calendar

You have access to a local CalDAV calendar system (Radicale). You can view, create, and manage calendar events.

### Upcoming Events

${content}`

    // Update cache
    cachedContext = markdown
    cacheExpiry = now + CACHE_TTL_MS

    return markdown
  } catch (err) {
    console.warn(
      `Calendar context unavailable: ${err instanceof Error ? err.message : String(err)}`,
    )
    return `## Calendar

You have a local CalDAV calendar system (Radicale), but it is currently offline.`
  }
}

/**
 * Invalidate the calendar context cache.
 * Call this when events are modified.
 */
export function invalidateCalendarContextCache(): void {
  cachedContext = null
  cacheExpiry = 0
}
