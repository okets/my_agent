/**
 * Calendar System
 *
 * CalDAV-based calendar with Radicale backend.
 * See docs/design/calendar-system.md for architecture.
 */

// Types
export type {
  CalendarEvent,
  CreateEventInput,
  UpdateEventInput,
  Calendar,
  RecurringEditMode,
  CalendarRepository,
  CalendarHealth,
  CalendarConfig,
  CalendarCredentials,
} from './types.js'

// Implementation
export { CalDAVClient, createCalDAVClient } from './caldav-client.js'
export { loadCalendarConfig, loadCalendarCredentials, getRadicaleUrl } from './config.js'
export { assembleCalendarContext, invalidateCalendarContextCache } from './context.js'
export { initializeCalendars, checkRadicaleHealth } from './init.js'
