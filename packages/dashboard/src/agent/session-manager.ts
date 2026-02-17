import {
  createBrainQuery,
  loadConfig,
  assembleSystemPrompt,
} from "@my-agent/core";
import type { Query, ContentBlock, PromptContent } from "@my-agent/core";
import { processStream, type StreamEvent } from "./stream-processor.js";

interface TurnRecord {
  role: "user" | "assistant";
  content: string;
}

interface StreamOptions {
  /** Override the default model */
  model?: string;
  /** Enable extended thinking */
  reasoning?: boolean;
}

export class SessionManager {
  private conversationId: string | null;
  private contextInjection: string | null;
  private config: { model: string; brainDir: string } | null = null;
  private baseSystemPrompt: string | null = null;
  private initPromise: Promise<void> | null = null;
  private activeQuery: Query | null = null;
  private turns: TurnRecord[] = [];

  constructor(
    conversationId?: string | null,
    contextInjection?: string | null,
  ) {
    this.conversationId = conversationId ?? null;
    this.contextInjection = contextInjection ?? null;
  }

  private ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInitialize();
    }
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    this.config = loadConfig();
    this.baseSystemPrompt = await assembleSystemPrompt(this.config.brainDir);
  }

  /**
   * Build system prompt with conversation history.
   *
   * The SDK's `continue: true` resumes the last subprocess globally,
   * not per conversation. So we always start fresh and inject history.
   */
  private buildPromptWithHistory(): string {
    let prompt = this.baseSystemPrompt!;

    // Add cold-start context injection (abbreviation + older turns from transcript)
    if (this.contextInjection) {
      prompt += `\n\n${this.contextInjection}`;
    }

    // Add in-session conversation history
    if (this.turns.length > 0) {
      prompt += "\n\n[Current conversation]\n";
      for (const turn of this.turns) {
        const role = turn.role === "user" ? "User" : "Assistant";
        prompt += `${role}: ${turn.content}\n`;
      }
      prompt += "[End conversation history]\n";
    }

    return prompt;
  }

  async *streamMessage(
    content: string | ContentBlock[],
    options?: StreamOptions,
  ): AsyncGenerator<StreamEvent> {
    await this.ensureInitialized();

    // Record user turn (extract text for history)
    const textContent =
      typeof content === "string"
        ? content
        : content
            .filter(
              (b): b is { type: "text"; text: string } => b.type === "text",
            )
            .map((b) => b.text)
            .join("\n");
    this.turns.push({ role: "user", content: textContent });

    // Build prompt with full history — each query is independent
    const systemPrompt = this.buildPromptWithHistory();

    // Use override model if provided, otherwise use config default
    const model = options?.model || this.config!.model;

    // Debug logging to trace model flow
    console.log(
      `[SessionManager] options.model: ${options?.model}, config.model: ${this.config!.model}, final: ${model}`,
    );

    // Haiku doesn't support extended thinking — ignore reasoning flag for Haiku
    const isHaiku = model.includes("haiku");
    const reasoning = options?.reasoning && !isHaiku;

    const q = createBrainQuery(content, {
      model,
      systemPrompt,
      continue: false, // Always fresh — SDK continue is global, not per-conversation
      includePartialMessages: true,
      reasoning,
    });

    this.activeQuery = q;
    let assistantContent = "";

    try {
      for await (const event of processStream(q)) {
        if (event.type === "text_delta") {
          assistantContent += event.text;
        }
        yield event;
      }

      // Record assistant turn for future history
      if (assistantContent) {
        this.turns.push({ role: "assistant", content: assistantContent });
      }
    } finally {
      this.activeQuery = null;
    }
  }

  async abort(): Promise<void> {
    if (this.activeQuery) {
      await this.activeQuery.interrupt();
    }
  }
}
