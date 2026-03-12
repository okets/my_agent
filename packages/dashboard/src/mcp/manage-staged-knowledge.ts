/**
 * manage_staged_knowledge MCP Tool Handler (M6.9-S2)
 *
 * Handles approve, reject, and skip actions for staged knowledge facts.
 * Approve writes to the appropriate reference file and removes from staging.
 * Reject removes from staging without writing anywhere.
 * Skip increments the attempts counter on the fact.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import {
  incrementFactAttempts,
  deleteStagedFact,
} from "../conversations/knowledge-staging.js";

const SUBCATEGORY_TO_FILE: Record<string, string> = {
  "user-info": "reference/user-info.md",
  "contact": "reference/contacts.md",
  "preference:personal": "reference/preferences/personal.md",
  "preference:work": "reference/preferences/work.md",
  "preference:communication": "reference/preferences/communication.md",
};

export interface ManageStagedKnowledgeArgs {
  action: "approve" | "reject" | "skip";
  stagingFile: string;
  factText: string;
  enrichment?: string;
  agentDir: string;
}

export type ManageStagedKnowledgeResult =
  | { approved: true; destination: string }
  | { rejected: true }
  | { skipped: true; attempts: number };

export async function handleManageStagedKnowledge(
  args: ManageStagedKnowledgeArgs,
): Promise<ManageStagedKnowledgeResult> {
  const { action, stagingFile, factText, enrichment, agentDir } = args;

  // Read staging file to find the fact
  const content = await readFile(stagingFile, "utf-8");
  const lines = content.split("\n");
  const factLine = lines.find((line) => {
    const match = line.match(/^- \[([^,]+), attempts: (\d+)\] (.+)$/);
    return match && match[3].includes(factText);
  });

  if (!factLine) {
    throw new Error(`Fact not found in staging file: "${factText}"`);
  }

  const factMatch = factLine.match(/^- \[([^,]+), attempts: (\d+)\] (.+)$/);
  if (!factMatch) throw new Error("Invalid fact format");
  const [, subcategory, , fullText] = factMatch;

  if (action === "approve") {
    const relPath = SUBCATEGORY_TO_FILE[subcategory];
    if (!relPath) throw new Error(`Unknown subcategory: ${subcategory}`);

    const destPath = join(agentDir, "notebook", relPath);
    const factContent = enrichment ? `${fullText}\n  - ${enrichment}` : fullText;

    // Ensure directory exists, append to file
    await mkdir(dirname(destPath), { recursive: true });
    const existing = existsSync(destPath) ? await readFile(destPath, "utf-8") : "";
    const separator = existing && !existing.endsWith("\n") ? "\n" : "";
    await writeFile(destPath, `${existing}${separator}- ${factContent}\n`, "utf-8");

    // Remove from staging
    await deleteStagedFact(stagingFile, factText);

    return { approved: true, destination: relPath };
  }

  if (action === "reject") {
    await deleteStagedFact(stagingFile, factText);
    return { rejected: true };
  }

  if (action === "skip") {
    const newCount = await incrementFactAttempts(stagingFile, factText);
    return { skipped: true, attempts: newCount };
  }

  throw new Error(`Unknown action: ${action}`);
}
