/**
 * Calendar Scheduler
 *
 * Polls for upcoming events and fires actions when their time arrives.
 * Used for reminders, scheduled tasks, and recurring system events.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  CalendarRepository,
  CalendarEvent,
  SchedulerConfig,
  SchedulerStatus,
  FiredEventRecord,
} from './types.js'

/**
 * Default configuration values.
 */
const DEFAULT_POLL_INTERVAL_MS = 60_000 // 1 minute
const DEFAULT_LOOK_AHEAD_MINUTES = 5
const MAX_RECENT_FIRED = 10 // Keep last 10 fired events in memory

/**
 * CalendarScheduler polls for upcoming events and fires them when due.
 *
 * Features:
 * - Configurable poll interval and look-ahead window
 * - Persists fired events to disk to survive restarts
 * - Avoids re-firing events by tracking UIDs
 * - Provides status endpoint for monitoring
 */
export class CalendarScheduler {
  private repo: CalendarRepository
  private config: SchedulerConfig
  private pollInterval: NodeJS.Timeout | null = null
  private firedEvents: Set<string> = new Set()
  private recentlyFired: FiredEventRecord[] = []
  private firedCount = 0
  private lastPollAt: Date | null = null
  private running = false

  constructor(
    repo: CalendarRepository,
    config: Partial<SchedulerConfig> & Pick<SchedulerConfig, 'onEventFired'>,
  ) {
    this.repo = repo
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      lookAheadMinutes: config.lookAheadMinutes ?? DEFAULT_LOOK_AHEAD_MINUTES,
      onEventFired: config.onEventFired,
      firedEventsPath: config.firedEventsPath,
    }
  }

  /**
   * Start the scheduler polling loop.
   */
  async start(): Promise<void> {
    if (this.running) {
      console.log('[Scheduler] Already running')
      return
    }

    // Load persisted fired events
    await this.loadFiredEvents()

    // Clean up old fired events (older than 24 hours)
    this.cleanupOldFiredEvents()

    this.running = true
    console.log(
      `[Scheduler] Starting with poll interval ${this.config.pollIntervalMs}ms, look-ahead ${this.config.lookAheadMinutes}min`,
    )

    // Do an initial poll immediately
    await this.poll()

    // Set up recurring poll
    this.pollInterval = setInterval(async () => {
      try {
        await this.poll()
      } catch (err) {
        console.error('[Scheduler] Poll error:', err)
      }
    }, this.config.pollIntervalMs)
  }

  /**
   * Stop the scheduler.
   */
  stop(): void {
    if (!this.running) {
      return
    }

    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }

    this.running = false
    console.log('[Scheduler] Stopped')
  }

  /**
   * Get current scheduler status for monitoring.
   */
  getStatus(): SchedulerStatus {
    const nextPollAt =
      this.running && this.lastPollAt
        ? new Date(this.lastPollAt.getTime() + this.config.pollIntervalMs)
        : null

    return {
      running: this.running,
      pollIntervalMs: this.config.pollIntervalMs,
      lookAheadMinutes: this.config.lookAheadMinutes,
      firedCount: this.firedCount,
      lastPollAt: this.lastPollAt?.toISOString() ?? null,
      nextPollAt: nextPollAt?.toISOString() ?? null,
      recentlyFired: [...this.recentlyFired],
    }
  }

  /**
   * Poll for events to fire.
   */
  private async poll(): Promise<void> {
    const now = new Date()
    this.lastPollAt = now

    try {
      // Get events in the look-ahead window
      // We look at events that started up to lookAheadMinutes ago (in case we missed them)
      // and events starting now
      const lookBackMs = this.config.lookAheadMinutes * 60 * 1000
      const events = await this.repo.getUpcoming(this.config.lookAheadMinutes, 50)

      // Filter to events that:
      // 1. Have started (start <= now)
      // 2. Started recently (within look-ahead window, so we don't fire old events on restart)
      // 3. Haven't been fired yet
      const eventsToFire = events.filter((event) => {
        const startTime = event.start.getTime()
        const nowTime = now.getTime()

        // Event has started
        const hasStarted = startTime <= nowTime

        // Event started within the look-ahead window (not too old)
        const notTooOld = startTime >= nowTime - lookBackMs

        // Not already fired
        const notFired = !this.firedEvents.has(this.getEventKey(event))

        return hasStarted && notTooOld && notFired
      })

      // Fire each event
      for (const event of eventsToFire) {
        await this.fireEvent(event)
      }
    } catch (err) {
      console.error('[Scheduler] Error fetching events:', err)
    }
  }

  /**
   * Fire a single event.
   */
  private async fireEvent(event: CalendarEvent): Promise<void> {
    const key = this.getEventKey(event)
    const firedAt = new Date()

    // Mark as fired (before callback, to avoid double-firing on slow callbacks)
    this.firedEvents.add(key)

    // Create record
    const record: FiredEventRecord = {
      uid: event.uid,
      calendarId: event.calendarId,
      title: event.title,
      scheduledStart: event.start.toISOString(),
      firedAt: firedAt.toISOString(),
      action: event.action,
    }

    // Add to recently fired
    this.recentlyFired.unshift(record)
    if (this.recentlyFired.length > MAX_RECENT_FIRED) {
      this.recentlyFired.pop()
    }

    this.firedCount++

    console.log(`[Scheduler] Firing event: "${event.title}" (${event.uid})`)

    // Persist fired events
    await this.saveFiredEvents()

    // Call the callback
    try {
      await this.config.onEventFired(event)
    } catch (err) {
      console.error(`[Scheduler] Error in onEventFired callback for "${event.title}":`, err)
    }
  }

  /**
   * Generate a unique key for an event.
   * For recurring events, we include the start time to fire each occurrence.
   */
  private getEventKey(event: CalendarEvent): string {
    // Include start time for recurring events (each occurrence fires separately)
    return `${event.uid}:${event.start.toISOString()}`
  }

  /**
   * Load fired events from disk.
   */
  private async loadFiredEvents(): Promise<void> {
    if (!this.config.firedEventsPath) {
      return
    }

    try {
      const content = await readFile(this.config.firedEventsPath, 'utf-8')
      const data = JSON.parse(content) as { firedKeys: string[]; recentlyFired: FiredEventRecord[] }

      this.firedEvents = new Set(data.firedKeys)
      this.recentlyFired = data.recentlyFired || []

      console.log(`[Scheduler] Loaded ${this.firedEvents.size} fired events from disk`)
    } catch {
      // File doesn't exist or is invalid, start fresh
      console.log('[Scheduler] No persisted fired events found, starting fresh')
    }
  }

  /**
   * Save fired events to disk.
   */
  private async saveFiredEvents(): Promise<void> {
    if (!this.config.firedEventsPath) {
      return
    }

    try {
      // Ensure directory exists
      await mkdir(dirname(this.config.firedEventsPath), { recursive: true })

      const data = {
        firedKeys: Array.from(this.firedEvents),
        recentlyFired: this.recentlyFired,
        savedAt: new Date().toISOString(),
      }

      await writeFile(this.config.firedEventsPath, JSON.stringify(data, null, 2))
    } catch (err) {
      console.error('[Scheduler] Error saving fired events:', err)
    }
  }

  /**
   * Clean up fired events older than 24 hours.
   * This prevents the set from growing indefinitely.
   */
  private cleanupOldFiredEvents(): void {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)

    // Filter recently fired
    this.recentlyFired = this.recentlyFired.filter((r) => new Date(r.firedAt) >= cutoff)

    // For the firedEvents set, we need to parse the key to get the time
    // Key format: "uid:isoTimestamp"
    const keysToRemove: string[] = []
    for (const key of this.firedEvents) {
      const parts = key.split(':')
      if (parts.length >= 2) {
        // Reconstruct ISO timestamp (it may contain colons)
        const isoTimestamp = parts.slice(1).join(':')
        try {
          const eventTime = new Date(isoTimestamp)
          if (eventTime < cutoff) {
            keysToRemove.push(key)
          }
        } catch {
          // Invalid timestamp, keep it to be safe
        }
      }
    }

    for (const key of keysToRemove) {
      this.firedEvents.delete(key)
    }

    if (keysToRemove.length > 0) {
      console.log(`[Scheduler] Cleaned up ${keysToRemove.length} old fired events`)
    }
  }
}

/**
 * Default event handler that just logs.
 * Used for MVP before full action dispatch is implemented.
 */
export async function defaultEventHandler(event: CalendarEvent): Promise<void> {
  console.log(`[Scheduler] Event fired: "${event.title}" at ${event.start.toISOString()}`)

  if (event.action) {
    switch (event.action) {
      case 'daily-summary':
        console.log('[Scheduler] daily-summary action — not yet implemented')
        break
      default:
        console.log(`[Scheduler] Unknown action: ${event.action}`)
    }
  }

  // Future: Spawn brain query with event context
  // For now, just log
}
