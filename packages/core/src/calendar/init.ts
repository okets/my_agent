/**
 * Calendar Initialization
 *
 * Creates the system and user calendars on first startup
 * if they don't already exist.
 */

import { createDAVClient } from 'tsdav'
import type { CalendarConfig, CalendarCredentials } from './types.js'

/**
 * Initialize calendars on Radicale if they don't exist.
 * This is idempotent - safe to call multiple times.
 *
 * @param config - Calendar configuration
 * @param credentials - CalDAV credentials
 * @returns List of calendar IDs that were created
 */
export async function initializeCalendars(
  config: CalendarConfig,
  credentials: CalendarCredentials,
): Promise<string[]> {
  const serverUrl = `http://${config.server.host}:${config.server.port}`

  const client = await createDAVClient({
    serverUrl,
    credentials: {
      username: credentials.username,
      password: credentials.password,
    },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  })

  // Fetch existing calendars
  const existingCalendars = await client.fetchCalendars()
  const existingIds = new Set(
    existingCalendars.map((cal) => {
      const urlParts = cal.url.replace(/\/$/, '').split('/')
      return urlParts[urlParts.length - 1]
    }),
  )

  const created: string[] = []

  // Create calendars that don't exist
  for (const [id, calConfig] of Object.entries(config.calendars)) {
    // Only create owned calendars (not subscribed)
    if (calConfig.role !== 'owned') {
      continue
    }

    if (existingIds.has(id)) {
      console.log(`Calendar '${id}' already exists`)
      continue
    }

    const calendarUrl = `${serverUrl}/${credentials.username}/${id}/`

    console.log(`Creating calendar '${id}' at ${calendarUrl}`)

    try {
      await client.makeCalendar({
        url: calendarUrl,
        props: {
          displayname: getDisplayName(id),
        },
      })
      created.push(id)
      console.log(`Calendar '${id}' created successfully`)
    } catch (err) {
      console.error(
        `Failed to create calendar '${id}': ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return created
}

/**
 * Get human-readable display name for a calendar ID
 */
function getDisplayName(id: string): string {
  switch (id) {
    case 'system':
      return 'System (Nina)'
    case 'user':
      return 'User Events'
    case 'personal':
      return 'Personal (synced)'
    default:
      return id.charAt(0).toUpperCase() + id.slice(1)
  }
}

/**
 * Check if Radicale is reachable
 */
export async function checkRadicaleHealth(
  config: CalendarConfig,
  credentials: CalendarCredentials,
): Promise<{ reachable: boolean; latencyMs?: number; error?: string }> {
  const start = Date.now()
  const serverUrl = `http://${config.server.host}:${config.server.port}`

  try {
    const client = await createDAVClient({
      serverUrl,
      credentials: {
        username: credentials.username,
        password: credentials.password,
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    })

    // Try to fetch calendars as a health check
    await client.fetchCalendars()

    return {
      reachable: true,
      latencyMs: Date.now() - start,
    }
  } catch (err) {
    return {
      reachable: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
