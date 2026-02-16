/**
 * Conversation Naming Service
 *
 * Generates haiku-style display names and topic tags for conversations
 * using Claude Haiku at turn 5.
 *
 * Uses createBrainQuery (Agent SDK) for auth compatibility with both
 * API keys and OAuth setup tokens.
 */

import { createBrainQuery } from "@my-agent/core";
import type { TranscriptTurn } from "./types.js";

export interface NamingResult {
  /** Haiku-style title: three lowercase words separated by hyphens */
  title: string;
  /** Topic tags (kebab-case) */
  topics: string[];
}

const NAMING_PROMPT = `You are a conversation naming assistant. Your task is to generate a concise, evocative title and topic tags for a conversation based on its transcript.

TITLE FORMAT:
- Exactly 3 words
- Lowercase
- Separated by hyphens
- Evocative, haiku-style (capture the essence, not literal description)
- Examples: "autumn-wind-drifts", "midnight-code-whispers", "database-blues-symphony"

TOPICS FORMAT:
- 1-5 kebab-case tags
- Technical terms, domains, or themes
- Examples: ["server-monitoring", "deployment"], ["react", "typescript", "hooks"]

Return ONLY valid JSON in this exact format:
{
  "title": "three-word-title",
  "topics": ["topic-one", "topic-two"]
}`;

export class NamingService {
  /**
   * Generate a haiku-style name and topic tags for a conversation
   */
  async generateName(turns: TranscriptTurn[]): Promise<NamingResult> {
    // Truncate to last 10 turns if conversation is long
    const recentTurns = turns.slice(-10);

    // Format turns into readable text
    const transcript = recentTurns
      .map((turn) => `${turn.role}: ${turn.content}`)
      .join("\n\n");

    const fullPrompt = `${NAMING_PROMPT}\n\nTranscript:\n${transcript}\n\nGenerate the title and topics:`;

    // Call Haiku via Agent SDK (works with both API keys and OAuth tokens)
    let attempt = 0;
    const maxAttempts = 2;

    while (attempt < maxAttempts) {
      attempt++;

      try {
        const q = createBrainQuery(fullPrompt, {
          model: "claude-haiku-4-5-20251001",
          systemPrompt:
            "You are a conversation naming assistant. Return only valid JSON.",
          continue: false,
          includePartialMessages: false,
        });

        // Collect response text from SDK messages.
        // With includePartialMessages: false, the SDK returns complete
        // "assistant" messages (not streaming "stream_event" deltas).
        let responseText = "";

        for await (const msg of q) {
          if (msg.type === "assistant") {
            // Extract text from assistant message content blocks
            const message = (
              msg as {
                message?: { content?: Array<{ type: string; text?: string }> };
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
            // Result message also contains the full text as a fallback
            const result = msg as { result?: string };
            if (!responseText && result.result) {
              responseText = result.result;
            }
            break;
          }
        }

        const text = responseText.trim();
        if (!text) {
          throw new Error("Empty response from Haiku");
        }

        // Try to parse JSON response
        let result: NamingResult;
        try {
          result = JSON.parse(text);
        } catch {
          // If JSON parsing fails, try to extract from markdown code block
          const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
          if (jsonMatch) {
            result = JSON.parse(jsonMatch[1]);
          } else {
            // Try to find JSON object in the response
            const objMatch = text.match(/\{[\s\S]*\}/);
            if (objMatch) {
              result = JSON.parse(objMatch[0]);
            } else {
              throw new Error("Invalid JSON response");
            }
          }
        }

        // Validate format
        if (!this.isValidTitle(result.title)) {
          if (attempt < maxAttempts) {
            continue; // Retry
          }
          throw new Error(
            `Invalid title format: "${result.title}" (must be 3 lowercase words with hyphens)`,
          );
        }

        if (!Array.isArray(result.topics) || result.topics.length === 0) {
          throw new Error("Topics must be a non-empty array");
        }

        // Ensure topics are kebab-case
        result.topics = result.topics.map((topic) =>
          topic.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        );

        return result;
      } catch (err) {
        if (attempt === maxAttempts) {
          throw new Error(
            `Naming failed after ${maxAttempts} attempts: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        // Otherwise continue to retry
      }
    }

    // This should never be reached, but TypeScript needs it
    throw new Error("Naming failed");
  }

  /**
   * Validate title format: exactly 3 lowercase words separated by hyphens
   */
  private isValidTitle(title: string): boolean {
    if (!title) return false;

    const parts = title.split("-");
    if (parts.length !== 3) return false;

    // Each part must be lowercase letters only
    return parts.every((part) => /^[a-z]+$/.test(part));
  }
}
