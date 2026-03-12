/**
 * Knowledge Staging
 *
 * Manages the knowledge/extracted/ work queue.
 * Permanent facts sit here until the morning brief proposes them.
 *
 * Design spec: docs/sprints/m6.6-s6-knowledge-lifecycle/design.md Section 4.5
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile, readdir, unlink, mkdir } from "node:fs/promises";
import type { PermanentFact } from "./knowledge-extractor.js";

export interface StagedFact {
  subcategory: string;
  text: string;
  attempts: number;
}

export interface StagingFile {
  filePath: string;
  conversationId: string;
  conversationTitle: string;
  extractedAt: string;
  facts: StagedFact[];
}

function getStagingDir(agentDir: string): string {
  return join(agentDir, "notebook", "knowledge", "extracted");
}

export async function writeStagingFile(
  agentDir: string,
  conversationId: string,
  conversationTitle: string,
  facts: PermanentFact[],
): Promise<string> {
  if (facts.length === 0) return "";

  const stagingDir = getStagingDir(agentDir);
  if (!existsSync(stagingDir)) {
    await mkdir(stagingDir, { recursive: true });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${conversationId}-${ts}.md`;
  const filePath = join(stagingDir, filename);

  const lines = [
    `# Extracted: ${new Date().toISOString()}`,
    `# Source: ${conversationId} ("${conversationTitle}")`,
    "",
    "## Pending -- Propose in Morning Brief",
    ...facts.map((f) => `- [${f.subcategory}, attempts: 0] ${f.text}`),
  ];

  await writeFile(filePath, lines.join("\n") + "\n", "utf-8");
  return filePath;
}

export async function readStagingFiles(
  agentDir: string,
): Promise<StagingFile[]> {
  const stagingDir = getStagingDir(agentDir);

  if (!existsSync(stagingDir)) {
    return [];
  }

  const entries = await readdir(stagingDir);
  const files: StagingFile[] = [];

  for (const entry of entries.filter((e) => e.endsWith(".md")).sort()) {
    const filePath = join(stagingDir, entry);
    const content = await readFile(filePath, "utf-8");

    const sourceMatch = content.match(/^# Source: (\S+) \("(.+)"\)/m);
    const extractedMatch = content.match(/^# Extracted: (.+)/m);

    const facts: StagedFact[] = [];
    const factPattern = /^- \[(\S+), attempts: (\d+)\] (.+)$/gm;
    for (const m of content.matchAll(factPattern)) {
      facts.push({
        subcategory: m[1],
        text: m[3],
        attempts: parseInt(m[2], 10),
      });
    }

    files.push({
      filePath,
      conversationId: sourceMatch?.[1] ?? entry,
      conversationTitle: sourceMatch?.[2] ?? "",
      extractedAt: extractedMatch?.[1] ?? "",
      facts,
    });
  }

  return files;
}

export async function incrementAttempts(filePath: string): Promise<void> {
  const content = await readFile(filePath, "utf-8");
  const updated = content.replace(
    /attempts: (\d+)/g,
    (_match, count) => `attempts: ${parseInt(count, 10) + 1}`,
  );
  await writeFile(filePath, updated, "utf-8");
}

export async function deleteStagingFile(filePath: string): Promise<void> {
  await unlink(filePath);
}
