#!/usr/bin/env npx tsx
/**
 * Reset Test Data — Clears all conversations, tasks, and calendar entries
 *
 * Usage: npx tsx tests/reset-test-data.ts
 *
 * Clears:
 * - All conversations (metadata + FTS index)
 * - All transcript files
 * - All tasks (including soft-deleted)
 * - All task log files
 * - Task-conversation links
 * - All calendar entries (Radicale .ics files)
 */

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { findAgentDir } from "@my-agent/core";

async function main() {
  const agentDir = findAgentDir();
  if (!agentDir) {
    console.error("❌ Could not find .my_agent directory");
    process.exit(1);
  }

  console.log(`🗑️  Resetting test data in ${agentDir}\n`);

  const dbPath = path.join(agentDir, "conversations", "agent.db");

  if (!fs.existsSync(dbPath)) {
    console.log("⚠️  No database found — nothing to clear");
    process.exit(0);
  }

  const db = new Database(dbPath);

  // Clear conversations
  const convCount = db
    .prepare("SELECT COUNT(*) as count FROM conversations")
    .get() as { count: number };
  db.exec("DELETE FROM turns_fts");
  db.exec("DELETE FROM conversations");
  console.log(`✓ Deleted ${convCount.count} conversations`);

  // Clear transcript files
  const transcriptsDir = path.join(agentDir, "conversations", "transcripts");
  if (fs.existsSync(transcriptsDir)) {
    const files = fs.readdirSync(transcriptsDir);
    for (const file of files) {
      fs.unlinkSync(path.join(transcriptsDir, file));
    }
    console.log(`✓ Deleted ${files.length} transcript files`);
  }

  // Clear tasks
  const taskCount = db.prepare("SELECT COUNT(*) as count FROM tasks").get() as {
    count: number;
  };
  db.exec("DELETE FROM task_conversations");
  db.exec("DELETE FROM tasks");
  console.log(`✓ Deleted ${taskCount.count} tasks`);

  // Clear task log files
  const logsDir = path.join(agentDir, "tasks", "logs");
  if (fs.existsSync(logsDir)) {
    const files = fs.readdirSync(logsDir);
    for (const file of files) {
      fs.unlinkSync(path.join(logsDir, file));
    }
    console.log(`✓ Deleted ${files.length} task log files`);
  }

  db.close();

  // Clear calendar entries (Radicale .ics files) from user calendar only
  // System calendar contains real scheduled tasks — don't wipe
  const userCalendarDir = path.join(
    agentDir,
    "calendar",
    "data",
    "collection-root",
    "agent",
    "user",
  );
  if (fs.existsSync(userCalendarDir)) {
    let icsCount = 0;
    const entries = fs.readdirSync(userCalendarDir);

    for (const entry of entries) {
      const entryPath = path.join(userCalendarDir, entry);
      if (entry.endsWith(".ics")) {
        fs.unlinkSync(entryPath);
        icsCount++;
      }
    }

    // Clear the Radicale cache
    const cacheDir = path.join(userCalendarDir, ".Radicale.cache");
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true });
    }
    console.log(`✓ Deleted ${icsCount} calendar entries (user calendar)`);
  }

  console.log("\n✅ Test data cleared");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
