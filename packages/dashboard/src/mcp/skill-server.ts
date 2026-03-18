import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  validateSkillName,
  validateSkillContent,
  PROTECTED_ORIGINS,
} from "./skill-validation.js";
import type { SkillService } from "../services/skill-service.js";

const DESCRIPTION_GUIDANCE = `
Tip: The description field determines when this skill triggers. Good descriptions:
- State what the skill does AND when to use it
- Include specific keywords users might say
- Are slightly "pushy" — mention edge cases where the skill should trigger
- Example: "Generate charts from data — use when user mentions graphs, visualizations, plotting, data display, or asks to see numbers visually"`;

interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

function skillsDir(agentDir: string): string {
  return join(agentDir, ".claude", "skills");
}

function readSkillOrigin(skillMdPath: string): string | null {
  try {
    const content = readFileSync(skillMdPath, "utf-8");
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) return null;
    const fm = parseYaml(fmMatch[1]) as Record<string, unknown>;
    return (fm.origin as string) || "user";
  } catch {
    return null;
  }
}

export async function handleCreateSkill(
  args: { name: string; description: string; content: string },
  agentDir: string,
): Promise<ToolResult> {
  // Validate name
  const nameResult = validateSkillName(args.name);
  if (!nameResult.valid) {
    return {
      content: [{ type: "text" as const, text: nameResult.reason! }],
      isError: true,
    };
  }

  // Validate content
  const contentResult = validateSkillContent(args.content);
  if (!contentResult.valid) {
    return {
      content: [{ type: "text" as const, text: contentResult.reason! }],
      isError: true,
    };
  }

  const dir = skillsDir(agentDir);
  const skillDir = join(dir, args.name);
  const skillMdPath = join(skillDir, "SKILL.md");

  // Check for collision
  if (existsSync(skillMdPath)) {
    const origin = readSkillOrigin(skillMdPath);
    if (origin && PROTECTED_ORIGINS.includes(origin as any)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Cannot create "${args.name}" — a ${origin} skill with that name already exists.`,
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: `Skill "${args.name}" already exists. Use update_skill to modify it.`,
        },
      ],
      isError: true,
    };
  }

  // Create directory and write SKILL.md
  mkdirSync(skillDir, { recursive: true });

  const frontmatter = `---\nname: ${args.name}\ndescription: ${args.description}\norigin: user\n---\n\n`;
  writeFileSync(skillMdPath, frontmatter + args.content);

  return {
    content: [
      {
        type: "text" as const,
        text: `Skill "${args.name}" created successfully.\n${DESCRIPTION_GUIDANCE}`,
      },
    ],
  };
}

export async function handleGetSkill(
  args: { name: string },
  agentDir: string,
): Promise<ToolResult> {
  const skillMdPath = join(skillsDir(agentDir), args.name, "SKILL.md");

  if (!existsSync(skillMdPath)) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Skill "${args.name}" not found.`,
        },
      ],
      isError: true,
    };
  }

  const content = readFileSync(skillMdPath, "utf-8");
  return {
    content: [{ type: "text" as const, text: content }],
  };
}

export async function handleUpdateSkill(
  args: { name: string; description: string; content: string },
  agentDir: string,
): Promise<ToolResult> {
  const skillMdPath = join(skillsDir(agentDir), args.name, "SKILL.md");

  if (!existsSync(skillMdPath)) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Skill "${args.name}" not found. Use create_skill to create it.`,
        },
      ],
      isError: true,
    };
  }

  // Check origin — cannot update system/curated skills
  const origin = readSkillOrigin(skillMdPath);
  if (origin && PROTECTED_ORIGINS.includes(origin as any)) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Cannot update "${args.name}" — it is a ${origin} skill and cannot be modified.`,
        },
      ],
      isError: true,
    };
  }

  // Validate content
  const contentResult = validateSkillContent(args.content);
  if (!contentResult.valid) {
    return {
      content: [{ type: "text" as const, text: contentResult.reason! }],
      isError: true,
    };
  }

  // Full rewrite with new frontmatter
  const frontmatter = `---\nname: ${args.name}\ndescription: ${args.description}\norigin: user\n---\n\n`;
  writeFileSync(skillMdPath, frontmatter + args.content);

  return {
    content: [
      {
        type: "text" as const,
        text: `Skill "${args.name}" updated successfully.\n${DESCRIPTION_GUIDANCE}`,
      },
    ],
  };
}

export async function handleDeleteSkill(
  args: { name: string },
  agentDir: string,
): Promise<ToolResult> {
  const skillDir = join(skillsDir(agentDir), args.name);
  const skillMdPath = join(skillDir, "SKILL.md");

  if (!existsSync(skillMdPath)) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Skill "${args.name}" not found.`,
        },
      ],
      isError: true,
    };
  }

  // Check origin — cannot delete system/curated skills
  const origin = readSkillOrigin(skillMdPath);
  if (origin && PROTECTED_ORIGINS.includes(origin as any)) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Cannot delete "${args.name}" — it is a ${origin} skill and cannot be removed.`,
        },
      ],
      isError: true,
    };
  }

  rmSync(skillDir, { recursive: true, force: true });

  return {
    content: [
      {
        type: "text" as const,
        text: `Skill "${args.name}" deleted.`,
      },
    ],
  };
}

export async function handleListSkills(agentDir: string, skillService?: SkillService): Promise<ToolResult> {
  if (skillService) {
    const skills = skillService.list();
    if (skills.length === 0) {
      return { content: [{ type: "text" as const, text: "No skills found." }] };
    }
    const lines = skills.map(s => `- **${s.name}** [${s.origin}]: ${s.description}${s.disabled ? " (disabled)" : ""}`);
    return { content: [{ type: "text" as const, text: `${skills.length} skill(s):\n${lines.join("\n")}` }] };
  }

  // Fallback: direct file I/O when no SkillService provided
  const dir = skillsDir(agentDir);

  if (!existsSync(dir)) {
    return {
      content: [{ type: "text" as const, text: "No skills found." }],
    };
  }

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return {
      content: [{ type: "text" as const, text: "No skills found." }],
    };
  }

  const skills: { name: string; description: string; origin: string }[] = [];

  for (const entry of entries) {
    const skillMdPath = join(dir, entry, "SKILL.md");
    if (!existsSync(skillMdPath)) continue;

    try {
      const content = readFileSync(skillMdPath, "utf-8");
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch) continue;

      const fm = parseYaml(fmMatch[1]) as Record<string, unknown>;
      skills.push({
        name: (fm.name as string) || entry,
        description: (fm.description as string) || "(no description)",
        origin: (fm.origin as string) || "user",
      });
    } catch {
      continue;
    }
  }

  if (skills.length === 0) {
    return {
      content: [{ type: "text" as const, text: "No skills found." }],
    };
  }

  const lines = skills.map(
    (s) => `- **${s.name}** [${s.origin}]: ${s.description}`,
  );
  return {
    content: [
      {
        type: "text" as const,
        text: `${skills.length} skill(s):\n${lines.join("\n")}`,
      },
    ],
  };
}

export interface SkillServerDeps {
  agentDir: string;
  onSkillCreated?: () => void | Promise<void>;
  skillService?: SkillService;
}

export function createSkillServer(deps: SkillServerDeps) {
  const createSkillTool = tool(
    "create_skill",
    "Create a new capability skill. Use when the user wants to teach you something reusable — a procedure, format, or technique.",
    {
      name: z.string().describe("Kebab-case skill name (e.g. 'weekly-report')"),
      description: z
        .string()
        .describe(
          "What the skill does and when to trigger it — this determines SDK invocation",
        ),
      content: z
        .string()
        .describe("The skill body (markdown) — instructions for execution"),
    },
    async (args) => {
      const result = await handleCreateSkill(args, deps.agentDir);
      if (!result.isError && deps.onSkillCreated) {
        try {
          await deps.onSkillCreated();
        } catch {
          // Non-fatal — skill was created, filtering just didn't re-run
        }
      }
      return result;
    },
  );

  const getSkillTool = tool(
    "get_skill",
    "Read a skill's full content and metadata. Use before updating to understand current content.",
    {
      name: z.string().describe("Skill name to read"),
    },
    async (args) => handleGetSkill(args, deps.agentDir),
  );

  const updateSkillTool = tool(
    "update_skill",
    "Replace a skill's content entirely. Read the skill first (get_skill), apply changes, send the full new body.",
    {
      name: z.string().describe("Skill name to update"),
      description: z.string().describe("New description"),
      content: z.string().describe("Complete new skill body (full rewrite)"),
    },
    async (args) => {
      const result = await handleUpdateSkill(args, deps.agentDir);
      if (!result.isError && deps.onSkillCreated) {
        try {
          await deps.onSkillCreated();
        } catch {
          // Non-fatal
        }
      }
      return result;
    },
  );

  const deleteSkillTool = tool(
    "delete_skill",
    "Remove a user-created skill. Cannot delete system or curated skills.",
    {
      name: z.string().describe("Skill name to delete"),
    },
    async (args) => handleDeleteSkill(args, deps.agentDir),
  );

  const listSkillsTool = tool(
    "list_skills",
    "List all skills with their names, descriptions, and origins.",
    {},
    async () => handleListSkills(deps.agentDir, deps.skillService),
  );

  return createSdkMcpServer({
    name: "skills",
    tools: [
      createSkillTool,
      getSkillTool,
      updateSkillTool,
      deleteSkillTool,
      listSkillsTool,
    ],
  });
}
