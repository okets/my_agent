/**
 * Model-selectable background query utility
 *
 * Replaces queryHaiku with model-parameterized queries.
 * Model param resolves to the latest version internally.
 * Callers never specify version strings.
 */

import { createBrainQuery } from "@my-agent/core";

export type ModelAlias = "haiku" | "sonnet" | "opus";

export const MODEL_MAP: Record<ModelAlias, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6-20250627",
  opus: "claude-opus-4-6-20250627",
};

export async function queryModel(
  prompt: string,
  systemPrompt: string,
  model: ModelAlias = "haiku",
): Promise<string> {
  const modelId = MODEL_MAP[model];

  const query = createBrainQuery(prompt, {
    model: modelId,
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
    throw new Error(`${model} returned empty response`);
  }

  return responseText.trim();
}
