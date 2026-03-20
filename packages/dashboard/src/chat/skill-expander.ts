/**
 * Skill command expansion for /my-agent:* commands.
 *
 * Pure functions extracted from chat-handler.ts (M6.10-S3).
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";

/** Skills directories: SDK skills (primary) + framework skills (fallback) */
function getSkillsDirs(agentDir: string): string[] {
  return [
    path.join(agentDir, ".claude", "skills"),
    path.resolve(import.meta.dirname, "../../../core/skills"),
  ];
}

/**
 * Load skill content for /my-agent:* commands.
 * Searches SDK skills first, then framework skills.
 */
async function loadSkillContent(
  skillName: string,
  agentDir: string,
): Promise<string | null> {
  for (const dir of getSkillsDirs(agentDir)) {
    const skillPath = path.join(dir, skillName, "SKILL.md");
    try {
      return await readFile(skillPath, "utf-8");
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Expand /my-agent:* commands in message content.
 * Returns expanded content with skill instructions prepended.
 */
export async function expandSkillCommand(
  content: string,
  agentDir: string,
): Promise<string> {
  const match = content.match(/^\/my-agent:(\S+)/);
  if (!match) return content;

  const skillName = match[1];
  const skillContent = await loadSkillContent(skillName, agentDir);

  if (!skillContent) {
    return content;
  }

  const lines = content.split("\n");
  const contextLines = lines.slice(1);
  const context = contextLines.join("\n").trim();

  return `[SKILL: ${skillName}]\n\n${skillContent.trim()}\n\n---\n\n${context}`;
}
