/**
 * Tails the per-agent audit.jsonl to find the most recent tool-call timestamp
 * for a given SDK session. Any tool call counts as evidence the worker is alive,
 * even if it isn't touching todos.
 */

import fs from "node:fs";
import path from "node:path";

/** 64KB tail — ~600 lines, <1ms to read, covers a 15-min window under heavy concurrent traffic. */
const TAIL_BYTES = 64 * 1024;

/**
 * Read the most recent audit-log timestamp for the given session ID.
 *
 * @param agentDir Absolute path to the agent dir (contains logs/audit.jsonl)
 * @param sessionId The job's sdk_session_id
 * @returns Most recent timestamp as ms-since-epoch, or 0 if none found
 */
export function readLastAuditTimestamp(agentDir: string, sessionId: string): number {
  if (!sessionId) return 0;
  const logPath = path.join(agentDir, "logs", "audit.jsonl");

  let stat: fs.Stats;
  try {
    stat = fs.statSync(logPath);
  } catch {
    return 0;
  }

  const fd = fs.openSync(logPath, "r");
  try {
    const readBytes = Math.min(TAIL_BYTES, stat.size);
    const buf = Buffer.alloc(readBytes);
    fs.readSync(fd, buf, 0, readBytes, stat.size - readBytes);
    const text = buf.toString("utf-8");

    // Drop the first (likely partial) line if we did a mid-file read
    const lines = stat.size > readBytes ? text.split("\n").slice(1) : text.split("\n");

    let latest = 0;
    for (const line of lines) {
      if (!line) continue;
      let entry: { timestamp?: string; session?: string };
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.session !== sessionId) continue;
      if (!entry.timestamp) continue;
      const t = new Date(entry.timestamp).getTime();
      if (Number.isFinite(t) && t > latest) latest = t;
    }
    return latest;
  } finally {
    fs.closeSync(fd);
  }
}
