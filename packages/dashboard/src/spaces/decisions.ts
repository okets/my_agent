import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const DECISIONS_TEMPLATE = `# Decisions

Operational history for this tool. Agents read this before modifying or repairing.

---

`;

/** Ensure DECISIONS.md exists with template content */
export function ensureDecisionsFile(spaceDir: string): string {
  const filePath = path.join(spaceDir, "DECISIONS.md");
  if (!existsSync(filePath)) {
    writeFileSync(filePath, DECISIONS_TEMPLATE, "utf-8");
  }
  return filePath;
}

/** Read DECISIONS.md content. Returns empty string if not found. */
export function readDecisions(spaceDir: string): string {
  const filePath = path.join(spaceDir, "DECISIONS.md");
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf-8");
}

/** Append a decision entry with timestamp and category */
export function appendDecision(
  spaceDir: string,
  entry: {
    category: "created" | "modified" | "repaired" | "failed";
    summary: string;
  },
): void {
  const filePath = ensureDecisionsFile(spaceDir);
  const timestamp = new Date().toISOString();
  const line = `\n## ${timestamp} -- ${entry.category}\n\n${entry.summary}\n`;
  const content = readFileSync(filePath, "utf-8");
  writeFileSync(filePath, content + line, "utf-8");
}
