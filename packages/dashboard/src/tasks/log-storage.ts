/**
 * Task System — Execution Log Storage
 *
 * Manages JSONL execution logs for tasks. Reuses the same TranscriptLine
 * format as conversations for consistency and potential code reuse.
 */

import fs from "node:fs";
import path from "node:path";
import type { TranscriptLine, TranscriptTurn } from "../conversations/types.js";
import type { GetLogOptions } from "@my-agent/core";

/**
 * Execution log metadata header
 */
export interface TaskLogMeta {
  type: "meta";
  taskId: string;
  sessionId: string;
  title: string;
  created: string;
}

/**
 * Manages JSONL execution logs for tasks
 */
export class TaskLogStorage {
  private logsDir: string;

  constructor(agentDir: string) {
    this.logsDir = path.join(agentDir, "tasks", "logs");
    this.ensureLogsDir();
  }

  /**
   * Ensure the logs directory exists
   */
  private ensureLogsDir(): void {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * Get the log file path for a task
   */
  getLogPath(taskId: string): string {
    return path.join(this.logsDir, `${taskId}.jsonl`);
  }

  /**
   * Create a new execution log file with metadata header
   */
  createLog(taskId: string, sessionId: string, title: string): void {
    const logPath = this.getLogPath(taskId);

    const meta: TaskLogMeta = {
      type: "meta",
      taskId,
      sessionId,
      title,
      created: new Date().toISOString(),
    };

    const metaLine = JSON.stringify(meta) + "\n";
    fs.writeFileSync(logPath, metaLine, "utf-8");
  }

  /**
   * Append a turn to the execution log
   */
  appendTurn(taskId: string, turn: TranscriptTurn): void {
    const logPath = this.getLogPath(taskId);
    const turnLine = JSON.stringify(turn) + "\n";

    try {
      fs.appendFileSync(logPath, turnLine, "utf-8");
    } catch (error) {
      // Retry once on failure
      try {
        fs.appendFileSync(logPath, turnLine, "utf-8");
      } catch (retryError) {
        console.error(`Failed to append turn to task ${taskId}:`, retryError);
        throw retryError;
      }
    }
  }

  /**
   * Append an event to the execution log
   */
  appendEvent(taskId: string, event: TranscriptLine): void {
    const logPath = this.getLogPath(taskId);
    const eventLine = JSON.stringify(event) + "\n";

    try {
      fs.appendFileSync(logPath, eventLine, "utf-8");
    } catch (error) {
      console.error(`Failed to append event to task ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Read all turns from an execution log
   */
  readTurns(taskId: string): TranscriptTurn[] {
    const logPath = this.getLogPath(taskId);

    if (!fs.existsSync(logPath)) {
      return [];
    }

    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());

    const turns: TranscriptTurn[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "turn") {
          turns.push(parsed as TranscriptTurn);
        }
      } catch {
        // Skip malformed lines
        continue;
      }
    }

    return turns;
  }

  /**
   * Read turns with pagination options
   */
  getTurns(taskId: string, options?: GetLogOptions): TranscriptTurn[] {
    const allTurns = this.readTurns(taskId);

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
   * Read the most recent N turns from an execution log
   */
  getRecentTurns(taskId: string, limit: number): TranscriptTurn[] {
    const logPath = this.getLogPath(taskId);

    if (!fs.existsSync(logPath)) {
      return [];
    }

    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());

    const turns: TranscriptTurn[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "turn") {
          turns.push(parsed as TranscriptTurn);
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
   * Read the full log including all line types
   */
  readFullLog(taskId: string): TranscriptLine[] {
    const logPath = this.getLogPath(taskId);

    if (!fs.existsSync(logPath)) {
      return [];
    }

    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());

    const log: TranscriptLine[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        log.push(parsed);
      } catch {
        // Skip malformed lines
        continue;
      }
    }

    return log;
  }

  /**
   * Check if a log exists
   */
  exists(taskId: string): boolean {
    const logPath = this.getLogPath(taskId);
    return fs.existsSync(logPath);
  }

  /**
   * Get the turn count from a log
   */
  getTurnCount(taskId: string): number {
    const turns = this.readTurns(taskId);
    // Count unique turn numbers
    const turnNumbers = new Set(turns.map((t) => t.turnNumber));
    return turnNumbers.size;
  }

  /**
   * Delete a log file
   */
  deleteLog(taskId: string): void {
    const logPath = this.getLogPath(taskId);

    if (fs.existsSync(logPath)) {
      fs.unlinkSync(logPath);
    }
  }

  /**
   * Get log file size in bytes
   */
  getLogSize(taskId: string): number {
    const logPath = this.getLogPath(taskId);

    if (!fs.existsSync(logPath)) {
      return 0;
    }

    const stats = fs.statSync(logPath);
    return stats.size;
  }
}
