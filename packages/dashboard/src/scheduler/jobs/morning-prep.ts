/**
 * Morning Prep Job (Morning Brief)
 *
 * Reads summary stack + calendar + properties + staging,
 * produces operations/current-state.md with past+future temporal context.
 *
 * Design spec: docs/sprints/m6.6-s6-knowledge-lifecycle/design.md Section 7.3
 */

import { queryModel } from "../query-model.js";

export const SYSTEM_PROMPT = `You produce a daily briefing by synthesizing past and future context.

STRICT RULES:
1. Output ONLY the briefing -- no preamble, no explanation, no thinking out loud
2. Use ONLY facts from the provided content -- NEVER invent or assume
3. If the content is empty, respond with EXACTLY: "No context available yet."
4. HARD CAP: Output must be under 3000 characters
5. Use the past+future format provided
6. Write in English regardless of input language
7. Do NOT attempt to read files, search, or use tools`;

export const USER_PROMPT_TEMPLATE = `Based on the following context, write a current-state briefing.

Format:
## Today -- {date}
- [today's events, deadlines, plans]

## This Week Ahead
- [upcoming events, milestones]

## This Month Ahead
- [bigger picture, travel, goals]

## Yesterday
- [key events from yesterday]

## Past 7 Days
- [weekly summary highlights]

## Past 30 Days
- [monthly summary highlights]

Only include sections where you have information. Skip sections with no data.
Hard cap: 3000 characters.

---

{context}`;

/**
 * Run the morning prep (morning brief) prompt.
 */
export async function runMorningPrep(assembledContext: string): Promise<string> {
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const userPrompt = USER_PROMPT_TEMPLATE.replace("{date}", today).replace(
    "{context}",
    assembledContext,
  );

  // TODO: M6.9-S2 upgrades morning brief to sonnet/opus for higher-judgement synthesis
  return queryModel(userPrompt, SYSTEM_PROMPT, "haiku");
}
