/**
 * Desktop Safety Hooks
 *
 * Rate limiter and audit logger for desktop tool invocations.
 * Wire these into the event loop around desktop_task and desktop_screenshot
 * to prevent runaway automation and maintain an audit trail.
 */

// ── Rate Limiter ──────────────────────────────────────────────────────────────

/**
 * Sliding-window rate limiter.
 * Tracks invocation timestamps within the last 60 seconds.
 */
export function createDesktopRateLimiter(options: { maxPerMinute: number }): {
  check(): { allowed: boolean; reason?: string };
} {
  const { maxPerMinute } = options;
  const windowMs = 60_000;
  const timestamps: number[] = [];

  return {
    check() {
      const now = Date.now();
      const cutoff = now - windowMs;

      // Remove timestamps outside the sliding window
      while (timestamps.length > 0 && timestamps[0] < cutoff) {
        timestamps.shift();
      }

      if (timestamps.length >= maxPerMinute) {
        return {
          allowed: false,
          reason: `Rate limit exceeded: ${timestamps.length} desktop actions in the last 60 seconds (max ${maxPerMinute}).`,
        };
      }

      timestamps.push(now);
      return { allowed: true };
    },
  };
}

// ── Audit Logger ──────────────────────────────────────────────────────────────

export interface DesktopAuditEntry {
  tool: string;
  instruction?: string;
  timestamp: string;
}

/**
 * Audit logger for desktop tool invocations.
 * Forwards each entry to the provided sink (e.g. append to a log file,
 * write to a database, or stream to monitoring).
 */
export function createDesktopAuditLogger(
  sink: (entry: DesktopAuditEntry) => void,
): {
  log(entry: DesktopAuditEntry): void;
} {
  return {
    log(entry: DesktopAuditEntry) {
      const enriched: DesktopAuditEntry = {
        ...entry,
        timestamp: entry.timestamp ?? new Date().toISOString(),
      };
      sink(enriched);
    },
  };
}
