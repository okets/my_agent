import { loadPreferences } from "@my-agent/core";

/**
 * Resolve the agent's timezone.
 * Single source of truth: config.yaml preferences.timezone → "UTC"
 *
 * Properties/status.yaml may contain an auto-detected timezone from
 * conversations, but it is never used directly. Instead, loadProperties()
 * surfaces mismatches as a prompt for the brain to ask the user.
 */
export async function resolveTimezone(agentDir: string): Promise<string> {
  try {
    const prefs = loadPreferences(agentDir);
    if (prefs.timezone) return prefs.timezone;
  } catch {
    // Preferences unavailable — fall back to UTC
  }

  return "UTC";
}

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
