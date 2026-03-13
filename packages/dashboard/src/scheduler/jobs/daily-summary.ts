/**
 * Daily Summary Job
 *
 * Reads yesterday's raw daily log and produces a condensed summary.
 * Output is written to summaries/daily/YYYY-MM-DD.md by the scheduler.
 *
 * Design spec: docs/sprints/m6.6-s6-knowledge-lifecycle/design.md Section 5.1
 */

import { queryModel } from "../query-model.js";

export const SYSTEM_PROMPT = `You produce a daily summary from a raw activity log.

STRICT RULES:
1. Output ONLY the summary -- no preamble, no explanation
2. Use ONLY facts explicitly stated in the user's message -- NEVER invent or assume
3. If the provided content shows no activity, respond with EXACTLY: "Quiet day -- no significant activity."
4. Write in English regardless of input language
5. Do NOT attempt to read files, search, or use tools -- all content is already provided`;

export const USER_PROMPT_TEMPLATE = `Summarize this day's activity log into a concise daily summary.

Format:
## Key Events
- [main things that happened]

## Decisions Made
- [any decisions made or commitments]

## Open Items
- [things to follow up on]

Only include sections where you have information. Skip sections with no data.

---

{context}`;

/**
 * Run the daily summary prompt and return the summary text.
 */
export async function runDailySummary(
  dailyLogContent: string,
): Promise<string> {
  const userPrompt = USER_PROMPT_TEMPLATE.replace("{context}", dailyLogContent);
  return queryModel(userPrompt, SYSTEM_PROMPT, "haiku");
}
