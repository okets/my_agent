/**
 * Abbreviation Queue
 *
 * Background worker for generating conversation abbreviations.
 * Processes one conversation at a time to avoid duplicate work.
 */

import { ConversationManager } from "./manager.js";
import { NamingService } from "./naming.js";
import { createBrainQuery } from "@my-agent/core";
import type { Query } from "@my-agent/core";
import {
  extractClassifiedFacts,
  routeFacts,
} from "./knowledge-extractor.js";
import { writeStagingFile } from "./knowledge-staging.js";
import { updateProperty } from "./properties.js";
import { existsSync } from "node:fs";
import { appendFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

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
  private agentDir: string;
  private namingService: NamingService;
  private queue: AbbreviationTask[] = [];
  private processing = false;
  private pendingIds = new Set<string>();
  private currentQuery: Query | null = null;

  /** Minimum turns between auto-renames */
  private static readonly MIN_TURNS_BETWEEN_RENAMES = 10;

  /** Callback invoked when a conversation is auto-renamed after abbreviation */
  onRenamed?: (conversationId: string, title: string) => void;

  /** Callback invoked when fact extraction completes (for calendar visibility) */
  onExtractionComplete?: (result: {
    conversationId: string;
    newFactCount: number;
    durationMs: number;
    error?: string;
  }) => void;

  constructor(manager: ConversationManager, apiKey: string, agentDir: string) {
    this.manager = manager;
    this.apiKey = apiKey;
    this.agentDir = agentDir;
    this.namingService = new NamingService();
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

    try {
      // Check if extraction is needed (new turns since last extraction)
      const needsExtraction =
        conversation.lastExtractedAtTurn === null ||
        conversation.turnCount > conversation.lastExtractedAtTurn;

      // Run abbreviation and fact extraction in parallel
      // Both operate on the ORIGINAL transcript, not chained
      const [abbreviationResult, extractionResult] = await Promise.allSettled([
        this.generateAbbreviation(transcriptText),
        needsExtraction
          ? this.extractAndPersistFacts(
              conversationId,
              transcriptText,
              conversation.turnCount,
            )
          : Promise.resolve(null),
      ]);

      this.currentQuery = null;

      // Handle abbreviation result
      if (
        abbreviationResult.status === "fulfilled" &&
        abbreviationResult.value
      ) {
        const abbreviationText = abbreviationResult.value;

        // Check if turn count changed during processing
        const conversationAfter = await this.manager.get(conversationId);
        if (
          conversationAfter &&
          conversationAfter.turnCount !== turnCountBefore
        ) {
          console.warn(
            `Conversation ${conversationId} was updated during abbreviation, re-queuing`,
          );
          this.enqueue(conversationId);
          return;
        }

        await this.manager.setAbbreviation(conversationId, abbreviationText);
        console.log(
          `Generated abbreviation for conversation ${conversationId}`,
        );
      } else if (abbreviationResult.status === "rejected") {
        console.error(
          `Abbreviation failed for ${conversationId}:`,
          abbreviationResult.reason,
        );
        throw abbreviationResult.reason;
      }

      // Log extraction result (non-fatal)
      if (extractionResult.status === "rejected") {
        console.error(
          `Fact extraction failed for ${conversationId}:`,
          extractionResult.reason,
        );
      } else if (
        extractionResult.status === "fulfilled" &&
        extractionResult.value !== null
      ) {
        console.log(
          `Extracted facts for conversation ${conversationId}: ${extractionResult.value} new facts`,
        );
      }

      // Re-generate name if not manually named and enough turns since last rename
      const shouldRename =
        !conversation.manuallyNamed &&
        (conversation.lastRenamedAtTurn === null ||
          conversation.turnCount - conversation.lastRenamedAtTurn >=
            AbbreviationQueue.MIN_TURNS_BETWEEN_RENAMES);

      if (shouldRename) {
        try {
          const result = await this.namingService.generateName(turns);
          await this.manager.setTitle(conversationId, result.title);
          await this.manager.setTopics(conversationId, result.topics);

          await this.manager.update(conversationId, {
            lastRenamedAtTurn: conversation.turnCount,
          });
          this.onRenamed?.(conversationId, result.title);

          console.log(
            `Re-named conversation ${conversationId}: ${result.title} [${result.topics.join(", ")}]`,
          );
        } catch (namingErr) {
          console.error(
            `Failed to re-name conversation ${conversationId}:`,
            namingErr,
          );
          // Non-fatal — abbreviation still succeeded
        }
      }
    } catch (err) {
      console.error(`Error generating abbreviation:`, err);
      throw err;
    }
  }

  /**
   * Generate abbreviation text via Haiku (extracted from abbreviateConversation)
   */
  private async generateAbbreviation(transcriptText: string): Promise<string> {
    const fullPrompt = `${ABBREVIATION_PROMPT}\n\n---\n\nConversation transcript:\n\n${transcriptText}`;

    const query = createBrainQuery(fullPrompt, {
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "You are a conversation summarizer.",
      continue: false,
      includePartialMessages: false,
    });

    this.currentQuery = query;

    let abbreviationText = "";

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

    if (!abbreviationText.trim()) {
      throw new Error("Generated empty abbreviation");
    }

    return abbreviationText;
  }

  /**
   * Extract facts from transcript and persist via classified pipeline
   */
  private async extractAndPersistFacts(
    conversationId: string,
    transcriptText: string,
    turnCount: number,
  ): Promise<number> {
    const startTime = Date.now();
    try {
      const classified = await extractClassifiedFacts(transcriptText);
      const routed = routeFacts(classified);
      let newCount = 0;

      // Ensure daily dir exists
      const dailyDir = join(this.agentDir, "notebook", "daily");
      if (!existsSync(dailyDir)) {
        await mkdir(dailyDir, { recursive: true });
      }
      const today = new Date().toISOString().split("T")[0];
      const logPath = join(dailyDir, `${today}.md`);

      // Route permanent facts to staging
      if (routed.staging.length > 0) {
        const title = this.getConversationTitle(conversationId);
        await writeStagingFile(this.agentDir, conversationId, title, routed.staging);
        newCount += routed.staging.length;
      }

      // Route temporal facts to daily log
      if (routed.dailyLog.length > 0) {
        const lines = routed.dailyLog.map((f) => `- ${f.text}`);
        const block = "\n" + lines.join("\n") + "\n";

        if (!existsSync(logPath)) {
          await writeFile(logPath, `# Daily Log -- ${today}\n${block}`, "utf-8");
        } else {
          await appendFile(logPath, block, "utf-8");
        }
        newCount += routed.dailyLog.length;
      }

      // Route properties to status.yaml
      for (const prop of routed.properties) {
        await updateProperty(this.agentDir, prop.key, {
          value: prop.value,
          confidence: prop.confidence,
          source: `extraction from ${conversationId}`,
        });
      }
      newCount += routed.properties.length;

      // Append [conv] summary to daily log
      const time = new Date().toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const title = this.getConversationTitle(conversationId);
      const convLine = `\n- [conv] ${title} (${time})\n`;

      if (!existsSync(logPath)) {
        await writeFile(logPath, `# Daily Log -- ${today}\n${convLine}`, "utf-8");
      } else {
        await appendFile(logPath, convLine, "utf-8");
      }

      // Update lastExtractedAtTurn
      await this.manager.update(conversationId, {
        lastExtractedAtTurn: turnCount,
      });

      const durationMs = Date.now() - startTime;
      this.onExtractionComplete?.({
        conversationId,
        newFactCount: newCount,
        durationMs,
      });

      return newCount;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      this.onExtractionComplete?.({
        conversationId,
        newFactCount: 0,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Get conversation title (falls back to id on error)
   */
  private getConversationTitle(conversationId: string): string {
    try {
      const conv = this.manager.get(conversationId);
      return (conv as unknown as { title?: string })?.title ?? conversationId;
    } catch {
      return conversationId;
    }
  }

  /**
   * Cancel a pending abbreviation task
   *
   * Removes the conversation from the queue if not yet processing.
   * Does NOT stop a task that's already in progress.
   */
  cancel(conversationId: string): void {
    if (!this.pendingIds.has(conversationId)) {
      return; // Not in queue
    }

    this.pendingIds.delete(conversationId);
    this.queue = this.queue.filter(
      (task) => task.conversationId !== conversationId,
    );
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
