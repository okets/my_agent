/**
 * Morning Prep Job
 *
 * Reads notebook context (reference/*, daily/*, knowledge/*) and produces
 * a concise current-state briefing. Output is written to
 * notebook/operations/current-state.md by the scheduler.
 *
 * This module exports the pure prompt function for testability.
 * The scheduler handles file I/O.
 */

import { queryHaiku } from "../haiku-query.js";

const SYSTEM_PROMPT = `You produce a daily briefing from notebook content provided by the user.

STRICT RULES:
1. Output ONLY the briefing — no preamble, no "I'll read...", no explanation, no thinking out loud
2. Use ONLY facts explicitly stated in the user's message — NEVER invent, assume, or use outside knowledge
3. If the provided content is empty or has no useful information, respond with EXACTLY: "No context available yet."
4. If information conflicts, use the MOST RECENT source (daily logs > reference files)
5. Be concise: bullet points, not paragraphs
6. Write in English regardless of input language
7. Do NOT attempt to read files, search, or use tools — all content is already provided in the user message`;

const USER_PROMPT_TEMPLATE = `Based on the following notebook content, write a current-state briefing.

Format:
## Current State (updated {date})
- Location: [where the owner is, if known]
- Focus: [what they're doing / vacation / work / etc.]
- Schedule: [upcoming events today or soon]
- Pending: [open items, tasks, things to follow up on]

Only include sections where you have information. Skip sections with no data.

---

{context}`;

/**
 * Run the morning prep prompt and return the briefing text.
 *
 * @param notebookContext - Pre-assembled notebook content (reference + daily + knowledge)
 * @returns The current-state briefing text
 */
export async function runMorningPrep(notebookContext: string): Promise<string> {
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const userPrompt = USER_PROMPT_TEMPLATE.replace("{date}", today).replace(
    "{context}",
    notebookContext,
  );

  return queryHaiku(userPrompt, SYSTEM_PROMPT);
}
