import { readProperties } from "../conversations/properties.js";
import { loadPreferences } from "@my-agent/core";

/**
 * Resolve the agent's timezone.
 * Priority: properties/status.yaml → preferences.timezone → "UTC"
 */
export async function resolveTimezone(agentDir: string): Promise<string> {
  try {
    const props = await readProperties(agentDir);
    if (props.timezone?.value) {
      const raw = props.timezone.value.split(/\s*\(/)[0].trim();
      if (isValidTimezone(raw)) return raw;
    }
  } catch {
    // Properties unavailable — continue to preferences
  }

  try {
    const prefs = loadPreferences(agentDir);
    if (prefs.timezone) return prefs.timezone;
  } catch {
    // Preferences unavailable — continue to fallback
  }

  return "UTC";
}

function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
