/**
 * Debrief Prep Job
 *
 * Reads summary stack + calendar + properties + staging,
 * produces operations/current-state.md with past+future temporal context.
 *
 * Design spec: docs/sprints/m6.6-s6-knowledge-lifecycle/design.md Section 7.3
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { queryModel, type ModelAlias } from "../query-model.js";
import type { StagingFile } from "../../conversations/knowledge-staging.js";
import type { StaleProperty } from "../../conversations/properties.js";
import { readFrontmatter } from "../../metadata/frontmatter.js";

interface CfrRecoveryFrontmatter {
  plug_name?: string;
  plug_type?: string;
  outcome?: string;
  attempts?: number;
  surrender_reason?: string;
}

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
 * Read CFR_RECOVERY.md from a job's run directory and format it for the
 * debrief prompt.  Returns an empty string if the file is absent or
 * unreadable (graceful skip — never throws).
 */
export function formatCfrRecoverySection(runDir: string): string {
  const cfrPath = join(runDir, "CFR_RECOVERY.md");
  if (!existsSync(cfrPath)) return "";

  try {
    const { data, body } = readFrontmatter<CfrRecoveryFrontmatter>(cfrPath);

    const plugName = data.plug_name ?? "unknown";
    const plugType = data.plug_type ?? "unknown";
    const outcome = data.outcome ?? "unknown";
    const attempts = data.attempts ?? 0;

    // First non-empty paragraph of the body (before any ## heading),
    // excluding any H1 title line (the file starts with "# <name> recovery summary").
    const preHeadings = body
      .split(/\n#{2,}/)   // split on ## (or deeper) headings; keep everything before first
      .shift()             // take the section before the first ## heading
      ?? "";

    const summary = preHeadings
      .split(/\n\n+/)       // split into blank-line-separated paragraphs
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((p) => !p.startsWith("#"))  // drop any H1/H2/... title paragraphs
      .shift()              // take first non-empty, non-heading paragraph
      ?? "";

    const lines = [
      "",
      "Capability recovery during this job:",
      `- Plug: ${plugName} (${plugType})`,
      `- Outcome: ${outcome}`,
      `- Attempts: ${attempts}`,
    ];
    if (summary) {
      lines.push(`- Summary: ${summary}`);
    }
    lines.push("");

    return lines.join("\n");
  } catch {
    // Malformed YAML or unreadable file — silently skip
    return "";
  }
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
 *
 * @param assembledContext  - Pre-assembled context (summaries, calendar, etc.)
 * @param model            - Model alias to use
 * @param stagedFactsSection     - Formatted staged facts section (or "")
 * @param stalePropertiesSection - Formatted stale properties section (or "")
 * @param runDir           - Optional: job run directory; when provided, any
 *                           CFR_RECOVERY.md file in that directory is read and
 *                           injected into the prompt.
 */
export async function runDebriefPrep(
  assembledContext: string,
  model: ModelAlias = "sonnet",
  stagedFactsSection: string = "",
  stalePropertiesSection: string = "",
  runDir?: string,
): Promise<string> {
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const cfrSection = runDir ? formatCfrRecoverySection(runDir) : "";

  const fullContext =
    assembledContext + stagedFactsSection + stalePropertiesSection + cfrSection;

  const userPrompt = USER_PROMPT_TEMPLATE.replace("{date}", today).replace(
    "{context}",
    fullContext,
  );

  return queryModel(userPrompt, SYSTEM_PROMPT, model);
}
