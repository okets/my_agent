/**
 * Monthly Summary Job
 *
 * Reads weekly summaries since the last monthly summary,
 * produces a high-level monthly narrative.
 *
 * Design spec: docs/sprints/m6.6-s6-knowledge-lifecycle/design.md Section 5.3
 */

import { queryModel } from "../query-model.js";

export const SYSTEM_PROMPT = `You produce a monthly summary from weekly summaries.

STRICT RULES:
1. Output ONLY the summary -- no preamble, no explanation
2. Use ONLY facts from the provided weekly summaries -- NEVER invent or assume
3. If no content provided, respond with EXACTLY: "Quiet month."
4. Keep it high-level -- what happened this month. Around 300 chars max.
5. Write in English regardless of input language
6. Do NOT attempt to read files, search, or use tools`;

export const USER_PROMPT_TEMPLATE = `Compress these weekly summaries into a high-level monthly narrative.

---

{context}`;

export async function runMonthlySummary(
  weeklySummariesContent: string,
): Promise<string> {
  const userPrompt = USER_PROMPT_TEMPLATE.replace(
    "{context}",
    weeklySummariesContent,
  );
  return queryModel(userPrompt, SYSTEM_PROMPT, "haiku");
}
