/**
 * Abbreviation Queue
 *
 * Background worker for generating conversation abbreviations.
 * Processes one conversation at a time to avoid duplicate work.
 */

import { ConversationManager } from "./manager.js";
import { createBrainQuery } from "@my-agent/core";
import type { Query } from "@my-agent/core";

const ABBREVIATION_PROMPT = `Abbreviate this conversation into a concise meeting-notes style summary (~100-200 words).

Focus on:
- Key topics discussed
- Important entities (names, projects, systems)
- Decisions made or pending
- Action items or open threads
- Context needed for resuming

Omit:
- Pleasantries and greetings
- Repetition
- Thinking-out-loud
- Small talk

Write in third person, past tense. Be factual and preserve details that matter.`;

/**
 * Task in the abbreviation queue
 */
interface AbbreviationTask {
  conversationId: string;
  enqueuedAt: number;
}

/**
 * Background queue for generating conversation abbreviations
 */
export class AbbreviationQueue {
  private manager: ConversationManager;
  private apiKey: string;
  private queue: AbbreviationTask[] = [];
  private processing = false;
  private pendingIds = new Set<string>();
  private currentQuery: Query | null = null;

  constructor(manager: ConversationManager, apiKey: string) {
    this.manager = manager;
    this.apiKey = apiKey;
  }

  /**
   * Enqueue a conversation for abbreviation
   *
   * Deduplicates - if already queued or processing, ignores.
   */
  enqueue(conversationId: string): void {
    if (this.pendingIds.has(conversationId)) {
      return; // Already queued
    }

    this.pendingIds.add(conversationId);
    this.queue.push({
      conversationId,
      enqueuedAt: Date.now(),
    });

    // Start processing if not already running
    if (!this.processing) {
      this.processNext().catch((err) => {
        console.error("Error processing abbreviation queue:", err);
      });
    }
  }

  /**
   * Process the next task in the queue
   */
  async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.pendingIds.delete(task.conversationId);

      try {
        await this.abbreviateConversation(task.conversationId);
      } catch (err) {
        console.error(
          `Failed to abbreviate conversation ${task.conversationId}:`,
          err,
        );
        // Mark as needing abbreviation for retry
        await this.manager.markNeedsAbbreviation(task.conversationId);
      }
    }

    this.processing = false;
  }

  /**
   * Generate abbreviation for a conversation
   */
  private async abbreviateConversation(conversationId: string): Promise<void> {
    // Get conversation metadata
    const conversation = await this.manager.get(conversationId);
    if (!conversation) {
      console.warn(`Conversation ${conversationId} not found, skipping`);
      return;
    }

    // Get turn count before abbreviation
    const turnCountBefore = conversation.turnCount;

    // Load full transcript
    const turns = await this.manager.getTurns(conversationId);

    if (turns.length === 0) {
      console.warn(`Conversation ${conversationId} has no turns, skipping`);
      return;
    }

    // Build transcript text
    const transcriptText = turns
      .map((turn) => {
        const role = turn.role === "user" ? "User" : "Assistant";
        return `${role}: ${turn.content}`;
      })
      .join("\n\n");

    // Generate abbreviation using Haiku
    const fullPrompt = `${ABBREVIATION_PROMPT}\n\n---\n\nConversation transcript:\n\n${transcriptText}`;

    try {
      const query = createBrainQuery(fullPrompt, {
        model: "claude-haiku-4-5-20251001", // Use Haiku for fast, cheap abbreviations
        systemPrompt: "You are a conversation summarizer.",
        continue: false,
        includePartialMessages: false,
      });

      this.currentQuery = query;

      let abbreviationText = "";

      // With includePartialMessages: false, the SDK returns complete
      // "assistant" messages (not streaming "stream_event" deltas).
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
                abbreviationText += block.text;
              }
            }
          }
        } else if (msg.type === "result") {
          const result = msg as { result?: string };
          if (!abbreviationText && result.result) {
            abbreviationText = result.result;
          }
          break;
        }
      }

      this.currentQuery = null;

      if (!abbreviationText.trim()) {
        throw new Error("Generated empty abbreviation");
      }

      // Check if turn count changed during processing
      const conversationAfter = await this.manager.get(conversationId);
      if (
        conversationAfter &&
        conversationAfter.turnCount !== turnCountBefore
      ) {
        // Conversation was updated during abbreviation - re-queue
        console.warn(
          `Conversation ${conversationId} was updated during abbreviation, re-queuing`,
        );
        this.enqueue(conversationId);
        return;
      }

      // Save abbreviation
      await this.manager.setAbbreviation(conversationId, abbreviationText);

      console.log(`Generated abbreviation for conversation ${conversationId}`);
    } catch (err) {
      console.error(`Error generating abbreviation:`, err);
      throw err;
    }
  }

  /**
   * Retry pending abbreviations from database
   *
   * Called on startup to process conversations that failed previously.
   */
  async retryPending(): Promise<void> {
    const pendingIds = await this.manager.getPendingAbbreviations();

    for (const id of pendingIds) {
      this.enqueue(id);
    }

    if (pendingIds.length > 0) {
      console.log(`Queued ${pendingIds.length} pending abbreviation(s)`);
    }
  }

  /**
   * Graceful shutdown - finish current task, mark rest as needs_abbreviation
   */
  async drain(): Promise<void> {
    console.log("Draining abbreviation queue...");

    // Wait for current task to finish
    while (this.processing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Mark remaining tasks as needing abbreviation
    for (const task of this.queue) {
      await this.manager.markNeedsAbbreviation(task.conversationId);
    }

    this.queue = [];
    this.pendingIds.clear();

    console.log("Abbreviation queue drained");
  }

  /**
   * Get queue status for debugging
   */
  getStatus(): {
    queueLength: number;
    processing: boolean;
    pendingCount: number;
  } {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      pendingCount: this.pendingIds.size,
    };
  }
}
