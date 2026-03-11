/**
 * Weekly Review Job
 *
 * Reads knowledge/* and reference/*, then:
 * - Promotes facts seen 3+ times to reference/
 * - Tags facts older than 30 days with no reinforcement as [stale]
 * - Resolves conflicts between knowledge/ and reference/ (via Haiku)
 *
 * The promotion logic is deterministic (count-based).
 * Conflict resolution is Haiku-assisted.
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
} from "node:fs";
import { queryHaiku } from "../haiku-query.js";

export interface ReviewAction {
  action: "promote" | "archive" | "conflict";
  fact: string;
  source: string;
  detail?: string;
}

export const SYSTEM_PROMPT = `You are a knowledge review agent. You analyze extracted facts and produce a structured review.

STRICT RULES:
1. Output ONLY structured review actions - no preamble, no explanation
2. Use ONLY facts from the provided content - NEVER invent or assume
3. One action per line with the tag prefix
4. If no actions needed, respond with EXACTLY: "NO_ACTIONS"

Action types:
[PROMOTE] fact text - this fact appeared 3+ times and should be promoted to reference
[ARCHIVE] fact text - this fact is >30 days old with no recent reinforcement, mark as stale
[CONFLICT] knowledge fact vs reference fact - conflicting information, suggest resolution
[UPDATE_REF] file: field = new value - update a reference file field with newer information`;

export const USER_PROMPT_TEMPLATE = `Review the following knowledge and reference files. Identify promotions, stale facts, and conflicts.

Today's date: {date}

## Knowledge Files
{knowledge}

## Reference Files
{reference}

Instructions:
1. Facts appearing 3+ times in knowledge - [PROMOTE] to reference
2. Facts with dates >30 days ago and no recent repetition - [ARCHIVE] as stale
3. Knowledge contradicts reference - [CONFLICT] with both versions
4. Knowledge has newer info than reference - [UPDATE_REF] with the update`;

/**
 * Analyze knowledge/ files for deterministic review actions.
 * Returns promotion candidates (facts with 3+ occurrences).
 */
export function analyzeKnowledge(agentDir: string): ReviewAction[] {
  const knowledgeDir = join(agentDir, "notebook", "knowledge");
  const actions: ReviewAction[] = [];

  if (!existsSync(knowledgeDir)) return actions;

  // Read all knowledge files
  let files: string[];
  try {
    files = readdirSync(knowledgeDir).filter((f) => f.endsWith(".md"));
  } catch {
    return actions;
  }

  for (const file of files) {
    const content = readFileSync(join(knowledgeDir, file), "utf-8");
    const lines = content
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) =>
        l
          .replace(/^- /, "")
          .replace(/ _\(.*?\)_$/, "")
          .trim(),
      );

    // Count occurrences of each fact (normalized)
    const counts = new Map<string, number>();
    for (const line of lines) {
      const key = line.toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    // Flag facts with 3+ occurrences for promotion
    for (const [fact, count] of counts) {
      if (count >= 3) {
        // Find original casing from first occurrence
        const original = lines.find((l) => l.toLowerCase() === fact) || fact;
        actions.push({
          action: "promote",
          fact: original,
          source: file,
          detail: `Seen ${count} times`,
        });
      }
    }
  }

  return actions;
}

/**
 * Apply deterministic promotions: move facts to reference/promoted-facts.md
 */
export function applyPromotions(
  agentDir: string,
  actions: ReviewAction[],
): string[] {
  const referenceDir = join(agentDir, "notebook", "reference");
  const promotions = actions.filter((a) => a.action === "promote");
  const applied: string[] = [];

  if (promotions.length === 0) return applied;

  if (!existsSync(referenceDir)) {
    mkdirSync(referenceDir, { recursive: true });
  }

  const today = new Date().toISOString().split("T")[0];
  const promotedPath = join(referenceDir, "promoted-facts.md");

  for (const promotion of promotions) {
    const line = `- ${promotion.fact} _(promoted ${today})_\n`;

    if (!existsSync(promotedPath)) {
      writeFileSync(promotedPath, `# Promoted Facts\n\n${line}`, "utf-8");
    } else {
      // Check if already promoted
      const existing = readFileSync(promotedPath, "utf-8");
      if (existing.toLowerCase().includes(promotion.fact.toLowerCase())) {
        continue; // Already promoted
      }
      appendFileSync(promotedPath, line, "utf-8");
    }

    applied.push(`Promoted: ${promotion.fact} (${promotion.detail})`);
  }

  return applied;
}

/**
 * Run the full weekly review via Haiku.
 * Combines deterministic analysis with Haiku-powered conflict resolution.
 */
export async function runWeeklyReview(agentDir: string): Promise<string> {
  const knowledgeDir = join(agentDir, "notebook", "knowledge");
  const referenceDir = join(agentDir, "notebook", "reference");

  // Read knowledge files
  let knowledgeContent = "";
  if (existsSync(knowledgeDir)) {
    const files = readdirSync(knowledgeDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      knowledgeContent += `### ${file}\n${readFileSync(join(knowledgeDir, file), "utf-8")}\n\n`;
    }
  }

  // Read reference files
  let referenceContent = "";
  if (existsSync(referenceDir)) {
    const files = readdirSync(referenceDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      referenceContent += `### ${file}\n${readFileSync(join(referenceDir, file), "utf-8")}\n\n`;
    }
  }

  if (!knowledgeContent.trim()) {
    return "No knowledge files to review.";
  }

  // Step 1: Deterministic promotions
  const deterministicActions = analyzeKnowledge(agentDir);
  const appliedActions = applyPromotions(agentDir, deterministicActions);

  // Step 2: Haiku-assisted conflict resolution and archiving
  const today = new Date().toISOString().split("T")[0];
  const prompt = USER_PROMPT_TEMPLATE.replace("{date}", today)
    .replace("{knowledge}", knowledgeContent || "(empty)")
    .replace("{reference}", referenceContent || "(empty)");

  const response = await queryHaiku(prompt, SYSTEM_PROMPT);

  const summary =
    appliedActions.length > 0
      ? `Applied ${appliedActions.length} promotions:\n${appliedActions.map((a) => `- ${a}`).join("\n")}\n\nHaiku review:\n${response}`
      : `No promotions needed.\n\nHaiku review:\n${response}`;

  return summary;
}
