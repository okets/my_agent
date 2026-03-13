/**
 * Model-selectable background query utility
 *
 * Resolves model aliases ("haiku", "sonnet", "opus") via the central
 * loadModels() from @my-agent/core. Users configure overrides in
 * config.yaml under `preferences.models`.
 */

import { createBrainQuery, loadModels } from "@my-agent/core";

export type ModelAlias = "haiku" | "sonnet" | "opus";

/**
 * Resolve a model alias to the configured model ID.
 * Reads from config.yaml, falls back to defaults.
 */
export function resolveModelId(
  alias: ModelAlias,
  agentDir?: string,
): string {
  const models = loadModels(agentDir);
  return models[alias];
}

export async function queryModel(
  prompt: string,
  systemPrompt: string,
  model: ModelAlias = "haiku",
  agentDir?: string,
): Promise<string> {
  const modelId = resolveModelId(model, agentDir);

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
