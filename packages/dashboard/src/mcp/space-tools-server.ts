import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";
import { writeFrontmatter } from "../metadata/frontmatter.js";
import type { ConversationDatabase } from "../conversations/db.js";

export interface SpaceToolsServerDeps {
  agentDir: string;
  db: ConversationDatabase;
}

export function createSpaceToolsServer(deps: SpaceToolsServerDeps) {
  const createSpaceTool = tool(
    "create_space",
    "Create a new space — a managed folder with a SPACE.md manifest. Use for organizing tools, data, external folder references, or code projects.",
    {
      name: z
        .string()
        .describe("Space name (used as directory name, lowercase-kebab)"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags for discovery (e.g. ['tool', 'scraper'])"),
      path: z
        .string()
        .optional()
        .describe(
          "External path (for shared folders, repos). Omit for internal spaces.",
        ),
      runtime: z
        .string()
        .optional()
        .describe("Runtime if executable: 'uv', 'node', or 'bash'"),
      entry: z
        .string()
        .optional()
        .describe("Entry point file (e.g. 'src/scraper.py')"),
      description: z
        .string()
        .optional()
        .describe("What this space contains or does"),
    },
    async (args) => {
      // Validate name: lowercase kebab-case
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.name)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Invalid space name "${args.name}". Use lowercase-kebab-case (e.g. "web-scraper").`,
            },
          ],
          isError: true,
        };
      }

      const spacesDir = join(deps.agentDir, "spaces");
      if (!existsSync(spacesDir)) {
        mkdirSync(spacesDir, { recursive: true });
      }

      const spaceDir = join(spacesDir, args.name);
      if (existsSync(spaceDir)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Space "${args.name}" already exists at ${spaceDir}`,
            },
          ],
          isError: true,
        };
      }

      mkdirSync(spaceDir, { recursive: true });

      const frontmatter: Record<string, unknown> = {
        name: args.name,
        created: new Date().toISOString(),
      };
      if (args.tags?.length) frontmatter.tags = args.tags;
      if (args.path) frontmatter.path = args.path;
      if (args.runtime) frontmatter.runtime = args.runtime;
      if (args.entry) frontmatter.entry = args.entry;

      writeFrontmatter(
        join(spaceDir, "SPACE.md"),
        frontmatter,
        args.description ?? "",
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Space "${args.name}" created at ${spaceDir}`,
          },
        ],
      };
    },
  );

  const listSpacesTool = tool(
    "list_spaces",
    "List and search spaces. Filter by tag, runtime, or free-text search across names and descriptions.",
    {
      tag: z.string().optional().describe("Filter by tag"),
      runtime: z.string().optional().describe("Filter by runtime"),
      search: z
        .string()
        .optional()
        .describe("Search name/description/tags"),
    },
    async (args) => {
      const spaces = deps.db.listSpaces({
        tag: args.tag,
        runtime: args.runtime,
        search: args.search,
      });

      if (spaces.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No spaces found." }],
        };
      }

      const lines = spaces.map((s) => {
        const parts = [`- **${s.name}**`];
        if (s.tags.length) parts.push(`[${s.tags.join(", ")}]`);
        if (s.runtime) parts.push(`(${s.runtime})`);
        if (s.description) parts.push(`— ${s.description}`);
        return parts.join(" ");
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `${spaces.length} space(s):\n${lines.join("\n")}`,
          },
        ],
      };
    },
  );

  return createSdkMcpServer({
    name: "space-tools",
    tools: [createSpaceTool, listSpacesTool],
  });
}
