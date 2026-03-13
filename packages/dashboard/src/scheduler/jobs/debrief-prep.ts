/**
 * Debrief Prep Job
 *
 * Reads summary stack + calendar + properties + staging,
 * produces operations/current-state.md with past+future temporal context.
 *
 * Design spec: docs/sprints/m6.6-s6-knowledge-lifecycle/design.md Section 7.3
 */

import { queryModel, type ModelAlias } from "../query-model.js";
import type { StagingFile } from "../../conversations/knowledge-staging.js";
import type { StaleProperty } from "../../conversations/properties.js";

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
 * Format staged facts for inclusion in the debrief prompt.
 */
export function formatStagedFactsSection(stagingFiles: StagingFile[]): string {
  const allFacts = stagingFiles.flatMap((f) =>
    f.facts.map(
      (fact) =>
        `- [${fact.subcategory}] ${fact.text} (source: "${f.conversationTitle}", attempts: ${fact.attempts})`,
    ),
  );
  if (allFacts.length === 0) return "";
  return [
    "",
    "PENDING KNOWLEDGE — propose these to the user naturally:",
    ...allFacts,
    "",
    "For each pending fact, include a brief natural proposal in today's section.",
    'Example: "I noted you mentioned Noa and Maya — shall I add them to your profile?"',
    "If the user has ignored a fact multiple times (high attempts), give it lower priority.",
  ].join("\n");
}

/**
 * Format stale properties for inclusion in the debrief prompt.
 */
export function formatStalePropertiesSection(
  staleProps: StaleProperty[],
): string {
  if (staleProps.length === 0) return "";
  return [
    "",
    "STALE PROPERTIES — ask the user if these are still current:",
    ...staleProps.map(
      (p) =>
        `- ${p.key}: "${p.value}" (last updated ${p.daysSinceUpdate} days ago, threshold: ${p.threshold} days)`,
    ),
  ].join("\n");
}

/**
 * Run the debrief prep prompt.
 */
export async function runDebriefPrep(
  assembledContext: string,
  model: ModelAlias = "sonnet",
  stagedFactsSection: string = "",
  stalePropertiesSection: string = "",
): Promise<string> {
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const fullContext =
    assembledContext + stagedFactsSection + stalePropertiesSection;

  const userPrompt = USER_PROMPT_TEMPLATE.replace("{date}", today).replace(
    "{context}",
    fullContext,
  );

  return queryModel(userPrompt, SYSTEM_PROMPT, model);
}
