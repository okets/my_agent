/**
 * Daily Summary Job
 *
 * Reads today's daily log and conversation abbreviations, produces a
 * consolidated summary. Output is appended to the daily log by the scheduler.
 *
 * This module exports the pure prompt function for testability.
 * The scheduler handles file I/O.
 */

import { queryHaiku } from "../haiku-query.js";

export const SYSTEM_PROMPT = `You consolidate a day's activity log and conversation summaries into a brief recap.

STRICT RULES:
1. Output ONLY the summary — no preamble, no "I'll analyze...", no explanation, no thinking out loud
2. Use ONLY facts explicitly stated in the user's message — NEVER invent, assume, or use outside knowledge
3. If the provided content shows no activity, respond with EXACTLY: "Quiet day — no significant activity."
4. Highlight key events, decisions, and recurring patterns
5. Note open items or follow-ups needed for tomorrow
6. Be concise — this seeds tomorrow's morning prep
7. Write in English regardless of input language
8. Do NOT attempt to read files, search, or use tools — all content is already provided`;

export const USER_PROMPT_TEMPLATE = `Summarize today's activity into an end-of-day recap.

Format:
## Daily Summary
- **Key events:** [main things that happened]
- **Decisions:** [any decisions made or commitments]
- **Patterns:** [recurring themes or notable observations]
- **Tomorrow:** [open items, upcoming events, follow-ups]

Only include sections where you have information. Skip sections with no data.

---

{context}`;

/**
 * Run the daily summary prompt and return the summary text.
 *
 * @param dailyContext - Pre-assembled daily log + conversation abbreviations
 * @returns The daily summary text
 */
export async function runDailySummary(dailyContext: string): Promise<string> {
  const userPrompt = USER_PROMPT_TEMPLATE.replace("{context}", dailyContext);
  return queryHaiku(userPrompt, SYSTEM_PROMPT);
}
