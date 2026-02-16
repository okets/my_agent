// Stream events emitted by the stream processor
export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "thinking_end" }
  | {
      type: "done";
      cost?: number;
      usage?: { input: number; output: number };
    }
  | { type: "error"; message: string };

/**
 * Process SDK messages from a query async generator and yield StreamEvents.
 *
 * The Agent SDK yields multiple message types simultaneously:
 * - "stream_event" — raw SSE events (content_block_start/delta/stop) — token-level granularity
 * - "assistant" — partial/complete messages with content blocks
 * - "result" — final result with cost/usage
 * - "system" — system messages (ignored)
 *
 * IMPORTANT: The SDK sends BOTH stream_event AND assistant for the same content.
 * We use only stream_event for streaming (finer granularity) and ignore assistant messages.
 */
export async function* processStream(
  messages: AsyncIterable<{ type: string; [key: string]: unknown }>,
): AsyncGenerator<StreamEvent> {
  // Track current content block type to know when thinking ends
  let currentBlockType: string | null = null;

  for await (const msg of messages) {
    // Handle raw SSE stream events (token-level granularity)
    if (msg.type === "stream_event") {
      const event = msg.event as {
        type: string;
        content_block?: { type: string };
        delta?: { type: string; text?: string; thinking?: string };
      };

      switch (event.type) {
        case "content_block_start":
          currentBlockType = event.content_block?.type ?? null;
          break;

        case "content_block_delta":
          if (event.delta?.type === "text_delta" && event.delta.text) {
            yield { type: "text_delta", text: event.delta.text };
          } else if (
            event.delta?.type === "thinking_delta" &&
            event.delta.thinking
          ) {
            yield { type: "thinking_delta", text: event.delta.thinking };
          }
          break;

        case "content_block_stop":
          if (currentBlockType === "thinking") {
            yield { type: "thinking_end" };
          }
          currentBlockType = null;
          break;
      }

      continue;
    }

    // Skip assistant messages — SDK sends these alongside stream_event
    // and we'd double-count content if we processed both
    if (msg.type === "assistant") {
      continue;
    }

    // Handle final result
    if (msg.type === "result") {
      // Emit thinking_end if we were still in thinking mode
      if (currentBlockType === "thinking") {
        yield { type: "thinking_end" };
        currentBlockType = null;
      }

      const result = msg as {
        type: string;
        subtype?: string;
        total_cost_usd?: number;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
        };
        errors?: string[];
      };

      if (
        result.subtype &&
        result.subtype !== "success" &&
        result.subtype !== "interrupt"
      ) {
        yield {
          type: "error",
          message:
            (result.errors as string[])?.join("; ") ?? "Unknown SDK error",
        };
      }

      yield {
        type: "done",
        cost: result.total_cost_usd,
        usage: result.usage
          ? {
              input: result.usage.input_tokens ?? 0,
              output: result.usage.output_tokens ?? 0,
            }
          : undefined,
      };
      break;
    }
  }
}
