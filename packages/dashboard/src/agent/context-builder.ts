/**
 * Context Builder
 *
 * Builds history injection prompts for cold-start conversation resumption.
 * Injects recent turns and abbreviation into system prompt for context continuity.
 */

import type { TranscriptTurn } from "../conversations/types.js";

/**
 * Build a context injection string for resuming a conversation
 *
 * Used when:
 * - Server restarts (session lost)
 * - Session evicted from LRU cache
 * - Long gap between messages
 *
 * @param turns - Recent turns from the conversation (typically last 10)
 * @param abbreviation - Conversation abbreviation (if available)
 * @param lastActivity - When the conversation was last active
 * @returns Formatted context injection string
 */
export function buildContextInjection(
  turns: TranscriptTurn[],
  abbreviation: string | null,
  lastActivity: Date,
): string {
  const now = new Date();
  const gapMs = now.getTime() - lastActivity.getTime();
  const gapText = formatTimeGap(gapMs);

  let context = `[Prior conversation - ${gapText} ago]\n`;

  // Add abbreviation if available
  if (abbreviation) {
    context += `Summary: ${abbreviation}\n\n`;
  }

  // Add recent messages
  if (turns.length > 0) {
    context += "Recent messages:\n";

    for (const turn of turns) {
      const role = turn.role === "user" ? "User" : "Assistant";
      // Truncate very long messages for context efficiency
      const content =
        turn.content.length > 500
          ? turn.content.substring(0, 500) + "..."
          : turn.content;
      context += `${role}: ${content}\n`;
    }
  }

  context += "[End prior conversation]\n";

  return context;
}

/**
 * Format a time gap into human-readable text
 */
function formatTimeGap(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days > 1 ? "s" : ""}`;
  } else if (hours > 0) {
    return `${hours} hour${hours > 1 ? "s" : ""}`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? "s" : ""}`;
  } else {
    return "a few seconds";
  }
}
