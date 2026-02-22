/**
 * Task Extractor — Deterministic task creation from conversation
 *
 * Detects task-worthy requests in user messages and extracts
 * structured task data using a fast LLM call.
 */

import { createBrainQuery } from "@my-agent/core";
import type { WorkItem, DeliveryAction } from "@my-agent/core";

export interface ExtractedTask {
  title: string;
  instructions: string;
  work: WorkItem[];
  delivery: DeliveryAction[];
  type: "immediate" | "scheduled";
  scheduledFor?: string;
}

export interface ExtractionResult {
  shouldCreateTask: boolean;
  task?: ExtractedTask;
}

/**
 * Build the extraction system prompt with current timestamp
 */
function buildExtractionPrompt(currentTime: Date): string {
  const isoTime = currentTime.toISOString();
  // Example: if current time is 08:03, "in 5 minutes" = 08:08
  const fiveMinutesLater = new Date(currentTime.getTime() + 5 * 60 * 1000);
  const exampleScheduledTime = fiveMinutesLater.toISOString();

  return `You are a JSON-only task extraction API. You output raw JSON with no other text.

CURRENT TIME: ${isoTime}

RULES:
- Output ONLY a single JSON object. No explanation, no markdown, no prose.
- Never wrap JSON in code fences or backticks.
- For scheduled tasks, calculate scheduledFor as ISO datetime relative to CURRENT TIME above.

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
2. instructions: Detailed, self-contained instructions. Include ALL specifics from both the user's request AND the assistant's planned response. The executor runs in a separate context with NO access to the conversation — instructions must contain everything needed.
3. work: Array of work items the brain should complete (research, compose, etc.). Each item: { "description": "..." }
4. delivery: Array of delivery actions. Each item: { "channel": "whatsapp"|"email"|"dashboard" }
   - If the user provides exact text to send, include it as "content" on the delivery action
   - If the brain needs to compose content, omit "content" (brain will produce it)
5. type: "immediate" or "scheduled"
6. scheduledFor: ISO datetime calculated from CURRENT TIME (e.g., "in 5 minutes" = CURRENT TIME + 5 minutes)

EXAMPLES:

User: "Research Bangkok attractions and send me the list on WhatsApp"
{"shouldCreateTask": true, "task": {"title": "Research Bangkok attractions", "instructions": "Research family-friendly attractions in Bangkok. Compile a list with brief descriptions.", "work": [{"description": "Research family-friendly attractions in Bangkok"}], "delivery": [{"channel": "whatsapp"}], "type": "immediate"}}

User: "In 5 minutes send me a WhatsApp saying Don't forget to call mom" (if current time is ${isoTime})
{"shouldCreateTask": true, "task": {"title": "Send WhatsApp reminder", "instructions": "Send a WhatsApp message with the exact text provided.", "work": [], "delivery": [{"channel": "whatsapp", "content": "Don't forget to call mom"}], "type": "scheduled", "scheduledFor": "${exampleScheduledTime}"}}

User: "What's the weather like?"
{"shouldCreateTask": false}

OUTPUT FORMAT (no other text allowed):
{"shouldCreateTask": false}
or
{"shouldCreateTask": true, "task": {"title": "...", "instructions": "...", "work": [...], "delivery": [...], "type": "immediate"}}`;
}

/**
 * Run a single extraction attempt via Haiku
 */
async function runExtraction(
  prompt: string,
  currentTime: Date,
): Promise<string> {
  const systemPrompt = buildExtractionPrompt(currentTime);
  const q = createBrainQuery(prompt, {
    model: "claude-haiku-4-5-20251001",
    systemPrompt,
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

  return response;
}

/**
 * Normalize extraction result to ensure correct types on work/delivery items
 */
function normalizeExtractedTask(raw: any): ExtractedTask {
  const work: WorkItem[] = (raw.work ?? []).map((w: any) => ({
    description: String(w.description ?? ""),
    status: "pending" as const,
  }));

  const delivery: DeliveryAction[] = (raw.delivery ?? []).map((d: any) => ({
    channel: d.channel ?? "dashboard",
    recipient: d.recipient,
    content: d.content,
    status: "pending" as const,
  }));

  return {
    title: String(raw.title ?? ""),
    instructions: String(raw.instructions ?? ""),
    work,
    delivery,
    type: raw.type === "scheduled" ? "scheduled" : "immediate",
    scheduledFor: raw.scheduledFor,
  };
}

/**
 * Extract task from user message
 *
 * Uses Haiku for fast, cheap extraction. Retries once if no JSON returned.
 */
export async function extractTaskFromMessage(
  userMessage: string,
  assistantResponse?: string,
): Promise<ExtractionResult> {
  const currentTime = new Date();
  let prompt = `User message:\n${userMessage}`;
  if (assistantResponse) {
    prompt += `\n\nAssistant's planned response:\n${assistantResponse}`;
  }

  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await runExtraction(prompt, currentTime);

      // Parse JSON response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        if (attempt < MAX_ATTEMPTS) {
          console.warn(
            `[TaskExtractor] No JSON in response (attempt ${attempt}/${MAX_ATTEMPTS}), retrying...`,
          );
          continue;
        }
        console.warn(
          "[TaskExtractor] No JSON in response after retries:",
          response.substring(0, 200),
        );
        return { shouldCreateTask: false };
      }

      const result = JSON.parse(jsonMatch[0]);

      if (!result.shouldCreateTask) {
        return { shouldCreateTask: false };
      }

      return {
        shouldCreateTask: true,
        task: normalizeExtractedTask(result.task),
      };
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        console.warn(
          `[TaskExtractor] Attempt ${attempt} failed, retrying:`,
          err instanceof Error ? err.message : String(err),
        );
        continue;
      }
      console.error("[TaskExtractor] Extraction failed after retries:", err);
      return { shouldCreateTask: false };
    }
  }

  return { shouldCreateTask: false };
}
