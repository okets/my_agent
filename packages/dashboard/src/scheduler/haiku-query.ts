/**
 * Background Haiku query utility
 *
 * Lightweight wrapper around createBrainQuery for background work loop jobs.
 * No MCP tools — all context is pre-assembled into the prompt.
 */

import { createBrainQuery } from "@my-agent/core";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

/**
 * Send a single prompt to Haiku with a system prompt, return the text response.
 *
 * Used by morning prep, daily summary, and weekly review jobs.
 * No MCP tools, no agents, no hooks — simple prompt → response.
 */
export async function queryHaiku(
  prompt: string,
  systemPrompt: string,
): Promise<string> {
  const query = createBrainQuery(prompt, {
    model: HAIKU_MODEL,
    systemPrompt,
    continue: false,
    includePartialMessages: false,
  });

  let responseText = "";

  for await (const msg of query) {
    if (msg.type === "assistant") {
      const message = (
        msg as {
          message?: {
            content?: Array<{ type: string; text?: string }>;
          };
        }
      ).message;
      if (message?.content) {
        for (const block of message.content) {
          if (block.type === "text" && block.text) {
            responseText += block.text;
          }
        }
      }
    } else if (msg.type === "result") {
      const result = msg as { result?: string };
      if (!responseText && result.result) {
        responseText = result.result;
      }
      break;
    }
  }

  if (!responseText.trim()) {
    throw new Error("Haiku returned empty response");
  }

  return responseText.trim();
}
