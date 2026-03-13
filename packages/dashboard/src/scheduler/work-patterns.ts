/**
 * Work Patterns Parser
 *
 * Reads job definitions from `notebook/config/work-patterns.md` YAML frontmatter.
 * The markdown body is for humans/LLMs — only the frontmatter is machine-parsed.
 *
 * Malformed entries are logged and skipped (no crash).
 */

import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { readFrontmatter, writeFrontmatter } from "../metadata/frontmatter.js";

const DEFAULT_WORK_PATTERNS_DATA = {
  jobs: {
    "morning-prep": { cadence: "daily:08:00", model: "haiku" },
    "daily-summary": { cadence: "daily:23:00", model: "haiku" },
  },
};

const DEFAULT_WORK_PATTERNS_BODY = `# Work Patterns

Morning prep runs at 08:00 in the user's local timezone.
Daily summary compresses the day's log at 23:00.
`;

export interface WorkPattern {
  /** Job name (from H2 heading), kebab-cased for API use */
  name: string;
  /** Display name (original H2 heading text) */
  displayName: string;
  /** When to run: "daily:HH:MM" or "weekly:DAYNAME:HH:MM" */
  cadence: string;
  /** Model to use (default: "haiku") */
  model: string;
}

/**
 * Validate a timezone string using Intl.DateTimeFormat.
 */
export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a cadence string and check if a job is due.
 *
 * @param cadence - "daily:HH:MM" or "weekly:DAYNAME:HH:MM"
 * @param lastRun - When the job last ran (null = never ran)
 * @param now - Current time
 * @param timezone - Optional IANA timezone string (e.g. "Asia/Bangkok")
 * @returns true if the job should run now
 */
export function isDue(
  cadence: string,
  lastRun: Date | null,
  now: Date = new Date(),
  timezone?: string,
): boolean {
  // Resolve timezone: if provided and valid, use it; if provided but invalid, fall back to UTC
  const tz = timezone
    ? (isValidTimezone(timezone) ? timezone : "UTC")
    : undefined;
  if (timezone && !isValidTimezone(timezone)) {
    console.warn(`[WorkPatterns] Invalid timezone '${timezone}', falling back to UTC`);
  }

  const parts = cadence.toLowerCase().split(":");

  if (parts[0] === "daily" && parts.length === 3) {
    const hour = parseInt(parts[1], 10);
    const minute = parseInt(parts[2], 10);
    if (isNaN(hour) || isNaN(minute)) return false;

    if (tz) {
      // Timezone-aware: compare in the user's local time
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const timeParts = formatter.formatToParts(now);
      const nowHour = parseInt(timeParts.find((p) => p.type === "hour")!.value, 10);
      const nowMinute = parseInt(timeParts.find((p) => p.type === "minute")!.value, 10);
      const nowMinutes = nowHour * 60 + nowMinute;
      const targetMinutes = hour * 60 + minute;

      if (nowMinutes < targetMinutes) return false;
      if (!lastRun) return true;

      // Check if last run was before today in user's timezone
      const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
      const todayStr = dateFormatter.format(now);
      const lastRunDayStr = dateFormatter.format(lastRun);
      return lastRunDayStr < todayStr;
    }

    // No timezone: use server local time (backward compatible)
    const scheduled = new Date(now);
    scheduled.setHours(hour, minute, 0, 0);

    // Job is due if: current time >= scheduled time AND
    // (never ran OR last ran before today's scheduled time)
    if (now < scheduled) return false;
    if (!lastRun) return true;
    return lastRun < scheduled;
  }

  if (parts[0] === "weekly" && parts.length === 4) {
    const dayName = parts[1];
    const hour = parseInt(parts[2], 10);
    const minute = parseInt(parts[3], 10);
    if (isNaN(hour) || isNaN(minute)) return false;

    const dayMap: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };

    const targetDay = dayMap[dayName];
    if (targetDay === undefined) return false;

    if (tz) {
      // Timezone-aware: get local day of week
      const dayFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
      });
      const localDayStr = dayFormatter.format(now).toLowerCase();
      const localDayMap: Record<string, number> = {
        sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
      };
      const localDay = localDayMap[localDayStr];
      if (localDay !== targetDay) return false;

      // Check time
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const timeParts = formatter.formatToParts(now);
      const nowHour = parseInt(timeParts.find((p) => p.type === "hour")!.value, 10);
      const nowMinute = parseInt(timeParts.find((p) => p.type === "minute")!.value, 10);
      const nowMinutes = nowHour * 60 + nowMinute;
      const targetMinutes = hour * 60 + minute;

      if (nowMinutes < targetMinutes) return false;
      if (!lastRun) return true;

      const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
      const todayStr = dateFormatter.format(now);
      const lastRunDayStr = dateFormatter.format(lastRun);
      return lastRunDayStr < todayStr;
    }

    // No timezone: server local time
    if (now.getDay() !== targetDay) return false;

    // Build today's scheduled time
    const scheduled = new Date(now);
    scheduled.setHours(hour, minute, 0, 0);

    if (now < scheduled) return false;
    if (!lastRun) return true;
    return lastRun < scheduled;
  }

  console.warn(`[WorkPatterns] Unknown cadence format: ${cadence}`);
  return false;
}

/**
 * Get the next scheduled time for a cadence pattern.
 *
 * @returns Next scheduled Date, or null if cadence is invalid
 */
export function getNextScheduledTime(
  cadence: string,
  now: Date = new Date(),
  timezone?: string,
): Date | null {
  const tz = timezone
    ? (isValidTimezone(timezone) ? timezone : "UTC")
    : undefined;
  const parts = cadence.toLowerCase().split(":");

  if (parts[0] === "daily" && parts.length === 3) {
    const hour = parseInt(parts[1], 10);
    const minute = parseInt(parts[2], 10);
    if (isNaN(hour) || isNaN(minute)) return null;

    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);

    // If already past today's time, move to tomorrow
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    return next;
  }

  if (parts[0] === "weekly" && parts.length === 4) {
    const dayName = parts[1];
    const hour = parseInt(parts[2], 10);
    const minute = parseInt(parts[3], 10);
    if (isNaN(hour) || isNaN(minute)) return null;

    const dayMap: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };

    const targetDay = dayMap[dayName];
    if (targetDay === undefined) return null;

    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);

    // Calculate days until target day
    let daysUntil = targetDay - now.getDay();
    if (daysUntil < 0) daysUntil += 7;
    if (daysUntil === 0 && next <= now) daysUntil = 7;

    next.setDate(next.getDate() + daysUntil);
    return next;
  }

  return null;
}

/**
 * Format job name for display: "morning-prep" → "Morning Prep"
 */
function toDisplayName(name: string): string {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Shape of the YAML frontmatter in work-patterns.md */
export interface WorkPatternsFrontmatter {
  jobs: Record<string, { cadence: string; model?: string }>;
}

/**
 * Parse work-patterns.md YAML frontmatter into job definitions.
 *
 * @param filePath - Absolute path to work-patterns.md
 * @returns Parsed work patterns
 */
export function parseWorkPatterns(filePath: string): WorkPattern[] {
  const { data } = readFrontmatter<WorkPatternsFrontmatter>(filePath);

  if (!data.jobs || typeof data.jobs !== "object") {
    console.warn("[WorkPatterns] No 'jobs' key in frontmatter");
    return [];
  }

  const patterns: WorkPattern[] = [];

  for (const [name, config] of Object.entries(data.jobs)) {
    if (!config || !config.cadence) {
      console.warn(`[WorkPatterns] Skipping job '${name}': missing cadence`);
      continue;
    }

    patterns.push({
      name,
      displayName: toDisplayName(name),
      cadence: config.cadence,
      model: config.model ?? "haiku",
    });
  }

  return patterns;
}

/**
 * Load and parse work patterns from the file system.
 *
 * @param agentDir - Path to the agent directory
 * @returns Parsed work patterns, or empty array if file doesn't exist
 */
export async function loadWorkPatterns(
  agentDir: string,
): Promise<WorkPattern[]> {
  const filePath = `${agentDir}/notebook/config/work-patterns.md`;

  if (!existsSync(filePath)) {
    // Create default work patterns file with YAML frontmatter
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    writeFrontmatter(filePath, DEFAULT_WORK_PATTERNS_DATA, DEFAULT_WORK_PATTERNS_BODY);
    console.log("[WorkPatterns] Created default work-patterns.md");
  }

  try {
    const patterns = parseWorkPatterns(filePath);
    console.log(
      `[WorkPatterns] Loaded ${patterns.length} job(s): ${patterns.map((p) => p.name).join(", ")}`,
    );
    return patterns;
  } catch (err) {
    console.error(
      "[WorkPatterns] Failed to read work-patterns.md:",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}
