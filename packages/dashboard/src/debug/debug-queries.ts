/**
 * Debug Queries — pure functions for headless agent access.
 *
 * Extracted from routes/debug.ts to allow both HTTP routes and headless
 * agents to call the same data-assembly logic without going through Fastify.
 *
 * M6.10-S4: Sprint 4 (Headless App) extraction.
 */

import { join } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import {
  isHatched,
  resolveAuth,
  loadModels,
  assembleSystemPrompt,
} from "@my-agent/core";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BrainStatus {
  hatched: boolean;
  authSource: string | null;
  authType: string | null;
  model: string;
  brainDir: string;
}

export interface FileEntry {
  path: string;
  size: number;
  modified: string;
}

export interface BrainFiles {
  root: string;
  files: FileEntry[];
}

export interface SkillEntry {
  name: string;
  path: string;
  description?: string;
}

export interface SkillInventory {
  framework: SkillEntry[];
  user: SkillEntry[];
}

export interface ComponentInfo {
  source: string;
  chars: number;
}

export interface SystemPromptResult {
  systemPrompt: string;
  components: {
    personality: ComponentInfo | null;
    identity: ComponentInfo | null;
    contacts: ComponentInfo | null;
    preferences: ComponentInfo | null;
    notebooks: Record<string, { chars: number }>;
    skills: {
      framework: number;
      user: number;
    };
  };
  totalChars: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Recursively list files in a directory.
 */
export async function listFilesRecursive(
  dir: string,
  basePath: string = "",
): Promise<FileEntry[]> {
  const results: FileEntry[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        const subFiles = await listFilesRecursive(fullPath, relativePath);
        results.push(...subFiles);
      } else if (entry.isFile()) {
        try {
          const stats = await stat(fullPath);
          results.push({
            path: relativePath,
            size: stats.size,
            modified: stats.mtime.toISOString(),
          });
        } catch {
          // Skip files we can't stat
        }
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return results;
}

/**
 * Load skill descriptions from a directory.
 */
export async function loadSkillsFromDir(dir: string): Promise<SkillEntry[]> {
  const skills: SkillEntry[] = [];

  try {
    const entries = await readdir(dir);
    for (const entry of entries.sort()) {
      const skillMdPath = join(dir, entry, "SKILL.md");
      try {
        const content = await readFile(skillMdPath, "utf-8");
        const firstLine = content
          .split("\n")
          .find((l) => l.trim() && !l.trim().startsWith("#"));
        skills.push({
          name: entry,
          path: join(dir, entry),
          description: firstLine?.trim(),
        });
      } catch {
        // No SKILL.md, skip
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return skills;
}

// ─── Pure Query Functions ─────────────────────────────────────────────────────

/**
 * Get brain status: hatching, auth, model, brainDir.
 */
export async function getBrainStatus(agentDir: string): Promise<BrainStatus> {
  const hatched = isHatched(agentDir);

  let authSource: string | null = null;
  let authType: string | null = null;

  try {
    const auth = resolveAuth(agentDir);
    authSource = auth.source;
    authType = auth.type;
  } catch {
    authSource = "none";
    authType = "none";
  }

  // Load model from config
  let model = loadModels(agentDir).sonnet; // default
  try {
    const configPath = join(agentDir, "config.yaml");
    const configContent = await readFile(configPath, "utf-8");
    const modelMatch = configContent.match(/model:\s*(\S+)/);
    if (modelMatch) {
      model = modelMatch[1];
    }
  } catch {
    // Config not found, use default
  }

  return {
    hatched,
    authSource,
    authType,
    model,
    brainDir: agentDir,
  };
}

/**
 * List all files in the brain directory recursively.
 */
export async function getBrainFiles(agentDir: string): Promise<BrainFiles> {
  const brainDir = join(agentDir, "brain");
  const files = await listFilesRecursive(brainDir);

  return {
    root: brainDir,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/**
 * Get skill inventory from framework and user directories.
 *
 * @param agentDir - The agent's data directory
 * @param frameworkSkillsDir - Path to framework skills (defaults to core package skills)
 */
export async function getSkills(
  agentDir: string,
  frameworkSkillsDir?: string,
): Promise<SkillInventory> {
  const resolvedFrameworkDir =
    frameworkSkillsDir ?? join(import.meta.dirname, "../../../core/skills");

  const frameworkSkills = await loadSkillsFromDir(resolvedFrameworkDir);

  const sdkSkillsDir = join(agentDir, ".claude", "skills");
  const userSkills = await loadSkillsFromDir(sdkSkillsDir);

  return {
    framework: frameworkSkills,
    user: userSkills,
  };
}

/**
 * Assemble the system prompt with component breakdown.
 *
 * Note: Calendar context is not included here (it requires live CalDAV connection).
 * Pass calendarContext explicitly if needed.
 */
export async function getSystemPrompt(
  agentDir: string,
  options: { calendarContext?: string; frameworkSkillsDir?: string } = {},
): Promise<SystemPromptResult> {
  const brainDir = join(agentDir, "brain");

  // Assemble full system prompt
  const systemPrompt = await assembleSystemPrompt(brainDir, {
    calendarContext: options.calendarContext,
  });

  // Load individual components for breakdown
  const components: {
    personality: ComponentInfo | null;
    identity: ComponentInfo | null;
    contacts: ComponentInfo | null;
    preferences: ComponentInfo | null;
    notebooks: Record<string, { chars: number }>;
    skills: { framework: number; user: number };
  } = {
    personality: null,
    identity: null,
    contacts: null,
    preferences: null,
    notebooks: {},
    skills: { framework: 0, user: 0 },
  };

  // Personality (AGENTS.md, with CLAUDE.md fallback for transition)
  try {
    let content: string;
    try {
      content = await readFile(join(brainDir, "AGENTS.md"), "utf-8");
    } catch {
      content = await readFile(join(brainDir, "CLAUDE.md"), "utf-8");
    }
    components.personality = {
      source: "brain/AGENTS.md",
      chars: content.length,
    };
  } catch {
    components.personality = null;
  }

  // Identity
  try {
    const content = await readFile(
      join(brainDir, "memory/core/identity.md"),
      "utf-8",
    );
    components.identity = {
      source: "brain/memory/core/identity.md",
      chars: content.length,
    };
  } catch {
    components.identity = null;
  }

  // Contacts
  try {
    const content = await readFile(
      join(brainDir, "memory/core/contacts.md"),
      "utf-8",
    );
    components.contacts = {
      source: "brain/memory/core/contacts.md",
      chars: content.length,
    };
  } catch {
    components.contacts = null;
  }

  // Preferences
  try {
    const content = await readFile(
      join(brainDir, "memory/core/preferences.md"),
      "utf-8",
    );
    components.preferences = {
      source: "brain/memory/core/preferences.md",
      chars: content.length,
    };
  } catch {
    components.preferences = null;
  }

  // Notebooks
  const notebooks: Record<string, { chars: number }> = {};
  for (const name of [
    "external-communications",
    "reminders",
    "standing-orders",
  ]) {
    try {
      const content = await readFile(
        join(agentDir, "runtime", `${name}.md`),
        "utf-8",
      );
      notebooks[name] = { chars: content.length };
    } catch {
      notebooks[name] = { chars: 0 };
    }
  }
  components.notebooks = notebooks;

  // Skills count
  const resolvedFrameworkDir =
    options.frameworkSkillsDir ??
    join(import.meta.dirname, "../../../core/skills");
  const frameworkSkills = await loadSkillsFromDir(resolvedFrameworkDir);
  const userSkills = await loadSkillsFromDir(join(brainDir, "skills"));
  components.skills = {
    framework: frameworkSkills.length,
    user: userSkills.length,
  };

  return {
    systemPrompt,
    components,
    totalChars: systemPrompt.length,
  };
}
