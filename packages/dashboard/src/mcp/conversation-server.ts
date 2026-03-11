/**
 * Conversation MCP Server (M6.7-S4)
 *
 * Exposes conversation search and read as MCP tools for the brain agent.
 * Follows the same pattern as memory-server.ts in @my-agent/core.
 *
 * @module mcp/conversation-server
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ConversationSearchService } from "../conversations/search-service.js";
import type { ConversationManager } from "../conversations/manager.js";

export interface ConversationServerDeps {
  conversationSearchService: ConversationSearchService;
  conversationManager: ConversationManager;
}

export function createConversationServer(deps: ConversationServerDeps) {
  const { conversationSearchService, conversationManager } = deps;

  const conversationSearchTool = tool(
    "conversation_search",
    "Search past conversation transcripts using hybrid keyword + semantic search. Returns matching turns with conversation context. Use to find what was discussed previously.",
    {
      query: z.string().describe("Search query — what you want to find"),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of results (default: 10)"),
    },
    async (args) => {
      const results = await conversationSearchService.search(
        args.query,
        args.limit ?? 10,
      );

      if (results.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "No conversation matches found." },
          ],
        };
      }

      // Enrich results with conversation titles
      const lines: string[] = [`CONVERSATIONS (${results.length} results)`];

      for (const result of results) {
        const conversation = await conversationManager.get(
          result.conversationId,
        );
        const title = conversation?.title ?? "Untitled";

        lines.push(
          `  ${result.conversationId} — "${title}" (turn ${result.turnNumber}, ${result.timestamp})`,
        );

        // Show snippet (first 200 chars of content)
        const snippet =
          result.content.length > 200
            ? result.content.slice(0, 200) + "..."
            : result.content;
        lines.push(`    ${result.role}: "${snippet}"`);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );

  const conversationReadTool = tool(
    "conversation_read",
    "Read the full transcript of a conversation by ID. Returns metadata and all turns as readable text. Use after conversation_search to read the full context.",
    {
      conversationId: z
        .string()
        .describe("The conversation ID (e.g., conv-01JXYZ...)"),
    },
    async (args) => {
      const conversation = await conversationManager.get(args.conversationId);
      if (!conversation) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Conversation not found: ${args.conversationId}`,
            },
          ],
          isError: true,
        };
      }

      const turns = await conversationManager.getTurns(args.conversationId);

      // Format metadata header
      const lines: string[] = [
        `CONVERSATION: ${conversation.id}`,
        `Title: ${conversation.title ?? "Untitled"}`,
        `Created: ${conversation.created.toISOString()}`,
        `Updated: ${conversation.updated.toISOString()}`,
        `Turns: ${conversation.turnCount}`,
      ];

      if (conversation.topics.length > 0) {
        lines.push(`Topics: ${conversation.topics.join(", ")}`);
      }

      if (conversation.externalParty) {
        lines.push(`External party: ${conversation.externalParty}`);
      }

      lines.push("", "--- TRANSCRIPT ---", "");

      // Format each turn
      for (const turn of turns) {
        const role = turn.role === "user" ? "User" : "Assistant";
        lines.push(`[${turn.timestamp}] ${role}:`);
        lines.push(turn.content);
        lines.push("");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );

  return createSdkMcpServer({
    name: "conversations",
    tools: [conversationSearchTool, conversationReadTool],
  });
}
