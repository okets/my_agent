/**
 * Calendar Configuration Loader
 *
 * Loads calendar config from .my_agent/config.yaml and credentials
 * from .my_agent/calendar/credentials.json
 */

import * as path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { findAgentDir } from '../config.js'
import type { CalendarConfig, CalendarCredentials } from './types.js'

const DEFAULT_SERVER_HOST = '127.0.0.1'
const DEFAULT_SERVER_PORT = 5232

const DEFAULT_CALENDARS: CalendarConfig['calendars'] = {
  system: {
    role: 'owned',
    color: 'overlay1',
    notifications: false,
    defaultVisible: false,
  },
  user: {
    role: 'owned',
    color: 'blue',
    notifications: true,
    defaultVisible: true,
  },
}

interface YamlCalendarSection {
  server?: {
    host?: string
    port?: number
  }
  calendars?: Record<
    string,
    {
      url?: string
      role?: 'owned' | 'subscribed'
      color?: string
      notifications?: boolean | 'passthrough'
      defaultVisible?: boolean
      syncIntervalMinutes?: number
    }
  >
}

/**
 * Load calendar configuration from config.yaml
 */
export function loadCalendarConfig(agentDir?: string): CalendarConfig {
  const dir = agentDir ?? process.env.MY_AGENT_DIR ?? findAgentDir()
  const configPath = path.join(dir, 'config.yaml')

  let yaml: { calendar?: YamlCalendarSection } = {}
  if (existsSync(configPath)) {
    try {
      yaml = parse(readFileSync(configPath, 'utf-8')) as typeof yaml
    } catch (err) {
      console.warn(
        `Warning: Could not parse ${configPath}: ${err instanceof Error ? err.message : String(err)}. Using calendar defaults.`,
      )
    }
  }

  const calendarSection = yaml.calendar ?? {}

  // Build server config
  const server = {
    host: calendarSection.server?.host ?? DEFAULT_SERVER_HOST,
    port: calendarSection.server?.port ?? DEFAULT_SERVER_PORT,
  }

  // Build calendars config, merging with defaults
  const calendars: CalendarConfig['calendars'] = {}
  const yamlCalendars = calendarSection.calendars ?? {}

  // Start with defaults
  for (const [id, defaults] of Object.entries(DEFAULT_CALENDARS)) {
    const override = yamlCalendars[id] ?? {}
    calendars[id] = {
      url: override.url ?? `http://${server.host}:${server.port}/agent/${id}/`,
      role: override.role ?? defaults.role,
      color: override.color ?? defaults.color,
      notifications: override.notifications ?? defaults.notifications,
      defaultVisible: override.defaultVisible ?? defaults.defaultVisible,
      syncIntervalMinutes: override.syncIntervalMinutes,
    }
  }

  // Add any additional calendars from config (e.g., personal)
  for (const [id, config] of Object.entries(yamlCalendars)) {
    if (!(id in DEFAULT_CALENDARS)) {
      calendars[id] = {
        url: config.url ?? `http://${server.host}:${server.port}/agent/${id}/`,
        role: config.role ?? 'subscribed',
        color: config.color ?? 'purple',
        notifications: config.notifications ?? 'passthrough',
        defaultVisible: config.defaultVisible ?? true,
        syncIntervalMinutes: config.syncIntervalMinutes,
      }
    }
  }

  return { server, calendars }
}

/**
 * Load CalDAV credentials from credentials.json
 */
export function loadCalendarCredentials(agentDir?: string): CalendarCredentials | null {
  const dir = agentDir ?? process.env.MY_AGENT_DIR ?? findAgentDir()
  const credentialsPath = path.join(dir, 'calendar', 'credentials.json')

  if (!existsSync(credentialsPath)) {
    console.warn(
      `Calendar credentials not found at ${credentialsPath}. Calendar features disabled.`,
    )
    return null
  }

  try {
    const raw = readFileSync(credentialsPath, 'utf-8')
    const parsed = JSON.parse(raw) as CalendarCredentials

    if (!parsed.username || !parsed.password) {
      console.warn(`Invalid credentials file at ${credentialsPath}: missing username or password.`)
      return null
    }

    return parsed
  } catch (err) {
    console.warn(
      `Could not load calendar credentials: ${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }
}

/**
 * Get the full Radicale server URL
 */
export function getRadicaleUrl(config: CalendarConfig): string {
  return `http://${config.server.host}:${config.server.port}`
}
