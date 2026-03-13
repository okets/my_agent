/**
 * Knowledge MCP Server (M6.9-S2)
 *
 * Exposes knowledge staging management as MCP tools for the brain agent.
 * Follows the same pattern as conversation-server.ts.
 *
 * @module mcp/knowledge-server
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { handleManageStagedKnowledge } from "./manage-staged-knowledge.js";

export interface KnowledgeServerDeps {
  agentDir: string;
}

export function createKnowledgeServer(deps: KnowledgeServerDeps) {
  const { agentDir } = deps;

  const manageStagedKnowledgeTool = tool(
    "manage_staged_knowledge",
    "Approve, reject, or skip a staged knowledge fact. Approve writes to the appropriate reference file. Reject deletes from staging. Skip increments the attempts counter.",
    {
      action: z
        .enum(["approve", "reject", "skip"])
        .describe("The action to take on the fact"),
      stagingFile: z
        .string()
        .describe("Absolute path to the staging file containing the fact"),
      factText: z
        .string()
        .describe("The text of the fact to act on (substring match)"),
      enrichment: z
        .string()
        .optional()
        .describe(
          "Additional detail from user to merge into the approved fact",
        ),
    },
    async (args) => {
      const result = await handleManageStagedKnowledge({
        ...args,
        agentDir,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );

  return createSdkMcpServer({
    name: "knowledge",
    tools: [manageStagedKnowledgeTool],
  });
}
