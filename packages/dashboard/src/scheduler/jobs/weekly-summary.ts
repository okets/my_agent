/**
 * Weekly Summary Job
 *
 * Reads daily summaries since the last weekly summary,
 * produces a compressed weekly rollup.
 *
 * Design spec: docs/sprints/m6.6-s6-knowledge-lifecycle/design.md Section 5.2
 */

import { queryModel } from "../query-model.js";

export const SYSTEM_PROMPT = `You produce a weekly summary from daily summaries.

STRICT RULES:
1. Output ONLY the summary -- no preamble, no explanation
2. Use ONLY facts from the provided daily summaries -- NEVER invent or assume
3. If no content provided, respond with EXACTLY: "Quiet week -- no significant activity."
4. Keep it concise -- key themes, decisions, milestones. Around 500 chars max.
5. Write in English regardless of input language
6. Do NOT attempt to read files, search, or use tools`;

export const USER_PROMPT_TEMPLATE = `Compress these daily summaries into a concise weekly summary.

Focus on: key themes, decisions made, milestones reached, recurring patterns.

---

{context}`;

export async function runWeeklySummary(
  dailySummariesContent: string,
): Promise<string> {
  const userPrompt = USER_PROMPT_TEMPLATE.replace(
    "{context}",
    dailySummariesContent,
  );
  return queryModel(userPrompt, SYSTEM_PROMPT, "haiku");
}
