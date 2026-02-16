/**
 * Conversation System — Transcript Storage
 *
 * Handles reading and writing JSONL transcript files.
 * Each conversation has a single append-only JSONL file.
 */

import fs from "node:fs";
import path from "node:path";
import type {
  TranscriptLine,
  TranscriptMeta,
  TranscriptTurn,
  GetTurnsOptions,
} from "./types.js";

/**
 * Manages JSONL transcript files for conversations
 */
export class TranscriptManager {
  private conversationsDir: string;

  constructor(agentDir: string) {
    this.conversationsDir = path.join(agentDir, "conversations");
    this.ensureConversationsDir();
  }

  /**
   * Ensure the conversations directory exists
   */
  private ensureConversationsDir(): void {
    if (!fs.existsSync(this.conversationsDir)) {
      fs.mkdirSync(this.conversationsDir, { recursive: true });
    }
  }

  /**
   * Get the transcript file path for a conversation
   */
  private getTranscriptPath(conversationId: string): string {
    return path.join(this.conversationsDir, `${conversationId}.jsonl`);
  }

  /**
   * Create a new transcript file with metadata header
   */
  createTranscript(meta: TranscriptMeta): void {
    const transcriptPath = this.getTranscriptPath(meta.id);

    // Write metadata header as first line
    const metaLine = JSON.stringify(meta) + "\n";
    fs.writeFileSync(transcriptPath, metaLine, "utf-8");
  }

  /**
   * Append a turn to the transcript
   *
   * Uses synchronous append to ensure durability.
   */
  appendTurn(conversationId: string, turn: TranscriptTurn): void {
    const transcriptPath = this.getTranscriptPath(conversationId);
    const turnLine = JSON.stringify(turn) + "\n";

    try {
      fs.appendFileSync(transcriptPath, turnLine, "utf-8");
    } catch (error) {
      // Retry once on failure
      try {
        fs.appendFileSync(transcriptPath, turnLine, "utf-8");
      } catch (retryError) {
        console.error(
          `Failed to append turn to ${conversationId}:`,
          retryError,
        );
        throw retryError;
      }
    }
  }

  /**
   * Append an event to the transcript
   */
  appendEvent(conversationId: string, event: TranscriptLine): void {
    const transcriptPath = this.getTranscriptPath(conversationId);
    const eventLine = JSON.stringify(event) + "\n";

    try {
      fs.appendFileSync(transcriptPath, eventLine, "utf-8");
    } catch (error) {
      console.error(`Failed to append event to ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Read all turns from a transcript
   *
   * Skips malformed JSON lines (crash mid-write protection).
   */
  readTurns(conversationId: string): TranscriptTurn[] {
    const transcriptPath = this.getTranscriptPath(conversationId);

    if (!fs.existsSync(transcriptPath)) {
      return [];
    }

    const content = fs.readFileSync(transcriptPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());

    const turns: TranscriptTurn[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as TranscriptLine;

        // Only collect turn lines
        if (parsed.type === "turn") {
          turns.push(parsed);
        }
      } catch (error) {
        // Skip malformed lines (crash mid-write protection)
        console.warn(`Skipping malformed line in ${conversationId}:`, line);
        continue;
      }
    }

    return turns;
  }

  /**
   * Read turns with pagination options
   */
  getTurns(
    conversationId: string,
    options?: GetTurnsOptions,
  ): TranscriptTurn[] {
    const allTurns = this.readTurns(conversationId);

    if (!options) {
      return allTurns;
    }

    const { offset = 0, limit } = options;
    let result = allTurns.slice(offset);

    if (limit !== undefined) {
      result = result.slice(0, limit);
    }

    return result;
  }

  /**
   * Read the most recent N turns from a transcript
   *
   * Used for context injection on cold start.
   * Keeps only the last `limit` turns during reading to cap memory.
   */
  getRecentTurns(conversationId: string, limit: number): TranscriptTurn[] {
    const transcriptPath = this.getTranscriptPath(conversationId);

    if (!fs.existsSync(transcriptPath)) {
      return [];
    }

    const content = fs.readFileSync(transcriptPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());

    const turns: TranscriptTurn[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as TranscriptLine;
        if (parsed.type === "turn") {
          turns.push(parsed);
          if (turns.length > limit) {
            turns.shift();
          }
        }
      } catch {
        continue;
      }
    }

    return turns;
  }

  /**
   * Get turns before a given timestamp (cursor-based pagination)
   *
   * Returns up to `limit` turns that appear before the given timestamp,
   * plus a `hasMore` flag indicating if older turns exist.
   */
  getTurnsBefore(
    conversationId: string,
    beforeTimestamp: string,
    limit: number,
  ): { turns: TranscriptTurn[]; hasMore: boolean } {
    const allTurns = this.readTurns(conversationId);
    const beforeIndex = allTurns.findIndex(
      (t) => t.timestamp === beforeTimestamp,
    );

    if (beforeIndex === -1) {
      return { turns: [], hasMore: false };
    }

    const start = Math.max(0, beforeIndex - limit);
    const turns = allTurns.slice(start, beforeIndex);
    return { turns, hasMore: start > 0 };
  }

  /**
   * Read the full transcript including all line types
   */
  readFullTranscript(conversationId: string): TranscriptLine[] {
    const transcriptPath = this.getTranscriptPath(conversationId);

    if (!fs.existsSync(transcriptPath)) {
      return [];
    }

    const content = fs.readFileSync(transcriptPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());

    const transcript: TranscriptLine[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as TranscriptLine;
        transcript.push(parsed);
      } catch (error) {
        // Skip malformed lines
        console.warn(`Skipping malformed line in ${conversationId}:`, line);
        continue;
      }
    }

    return transcript;
  }

  /**
   * Check if a transcript exists
   */
  exists(conversationId: string): boolean {
    const transcriptPath = this.getTranscriptPath(conversationId);
    return fs.existsSync(transcriptPath);
  }

  /**
   * Get the turn count from a transcript
   */
  getTurnCount(conversationId: string): number {
    const turns = this.readTurns(conversationId);
    // Count unique turn numbers (user + assistant share same turn number)
    const turnNumbers = new Set(turns.map((t) => t.turnNumber));
    return turnNumbers.size;
  }

  /**
   * Delete a transcript file
   */
  deleteTranscript(conversationId: string): void {
    const transcriptPath = this.getTranscriptPath(conversationId);

    if (fs.existsSync(transcriptPath)) {
      fs.unlinkSync(transcriptPath);
    }
  }
}
