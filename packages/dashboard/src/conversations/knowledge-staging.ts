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

/** @deprecated Use incrementAllAttempts instead */
export async function incrementAttempts(filePath: string): Promise<void> {
  return incrementAllAttempts(filePath);
}

export async function deleteStagingFile(filePath: string): Promise<void> {
  await unlink(filePath);
}

export function findStagedFact(facts: StagedFact[], factText: string): number {
  return facts.findIndex((f) => f.text.includes(factText));
}

export async function incrementFactAttempts(
  filePath: string,
  factText: string,
): Promise<number> {
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n");
  let newCount = -1;

  const updated = lines.map((line) => {
    const match = line.match(/^- \[([^,]+), attempts: (\d+)\] (.+)$/);
    if (match && match[3].includes(factText)) {
      newCount = parseInt(match[2], 10) + 1;
      return `- [${match[1]}, attempts: ${newCount}] ${match[3]}`;
    }
    return line;
  });

  if (newCount === -1) throw new Error(`Fact not found: "${factText}"`);
  await writeFile(filePath, updated.join("\n"), "utf-8");
  return newCount;
}

export async function incrementAllAttempts(filePath: string): Promise<void> {
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n");

  const updated = lines.map((line) => {
    const match = line.match(/^- \[([^,]+), attempts: (\d+)\] (.+)$/);
    if (match) {
      const newCount = parseInt(match[2], 10) + 1;
      return `- [${match[1]}, attempts: ${newCount}] ${match[3]}`;
    }
    return line;
  });

  await writeFile(filePath, updated.join("\n"), "utf-8");
}

export async function deleteStagedFact(
  filePath: string,
  factText: string,
): Promise<void> {
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n");
  const filtered = lines.filter((line) => {
    const match = line.match(/^- \[([^,]+), attempts: (\d+)\] (.+)$/);
    return !(match && match[3].includes(factText));
  });

  const hasFacts = filtered.some((l) => l.match(/^- \[/));
  if (!hasFacts) {
    await unlink(filePath);
  } else {
    await writeFile(filePath, filtered.join("\n"), "utf-8");
  }
}

export async function cleanExpiredFacts(
  agentDir: string,
  maxAttempts: number,
): Promise<number> {
  const files = await readStagingFiles(agentDir);
  let deletedCount = 0;

  for (const file of files) {
    const expired = file.facts.filter((f) => f.attempts >= maxAttempts);
    for (const fact of expired) {
      await deleteStagedFact(file.filePath, fact.text);
      deletedCount++;
    }
  }

  return deletedCount;
}
