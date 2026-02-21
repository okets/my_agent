/**
 * Task Extractor — Deterministic task creation from conversation
 *
 * Detects task-worthy requests in user messages and extracts
 * structured task data using a fast LLM call.
 */

import { createBrainQuery } from "@my-agent/core";

export interface ExtractedTask {
  title: string;
  instructions: string;
  steps: string;
  type: "immediate" | "scheduled";
  scheduledFor?: string;
}

export interface ExtractionResult {
  shouldCreateTask: boolean;
  task?: ExtractedTask;
}

const EXTRACTION_PROMPT = `You are a task extraction assistant. Analyze the user's message and determine if it requires creating a task.

CREATE A TASK when the message:
- Requests research or information lookup
- Asks to send/deliver something via a channel (WhatsApp, email, etc.)
- Requests something to happen at a specific time
- Is complex enough to benefit from background execution

DO NOT create a task for:
- Simple questions answerable from knowledge
- Greetings or conversational messages
- Clarification requests

If a task should be created, extract:
1. title: Brief description (max 80 chars)
2. instructions: What needs to be done
3. steps: Markdown checkboxes for each action (CRITICAL: every delivery instruction must be a separate step)
4. type: "immediate" or "scheduled"
5. scheduledFor: ISO datetime if scheduled

Respond with ONLY valid JSON:
{"shouldCreateTask": false}
or
{"shouldCreateTask": true, "task": {"title": "...", "instructions": "...", "steps": "- [ ] step1\\n- [ ] step2", "type": "immediate"}}`;

/**
 * Extract task from user message
 *
 * Uses Haiku for fast, cheap extraction.
 */
export async function extractTaskFromMessage(
  userMessage: string,
  conversationContext?: string,
): Promise<ExtractionResult> {
  const prompt = conversationContext
    ? `Context:\n${conversationContext}\n\nUser message:\n${userMessage}`
    : `User message:\n${userMessage}`;

  try {
    const q = createBrainQuery(prompt, {
      model: "claude-haiku-4-5-20251001",
      systemPrompt: EXTRACTION_PROMPT,
      continue: false,
      includePartialMessages: false,
    });

    let response = "";
    for await (const msg of q) {
      if (msg.type === "assistant") {
        const assistantMsg = msg as {
          type: string;
          message: { content: Array<{ type: string; text?: string }> };
        };
        response = assistantMsg.message.content
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("");
      }
      if (msg.type === "result") break;
    }

    // Parse JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[TaskExtractor] No JSON in response:", response);
      return { shouldCreateTask: false };
    }

    const result = JSON.parse(jsonMatch[0]) as ExtractionResult;
    return result;
  } catch (err) {
    console.error("[TaskExtractor] Extraction failed:", err);
    return { shouldCreateTask: false };
  }
}
