import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConversationManager } from "../src/conversations/manager.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("Task 1: last_user_message_at column exists", () => {
  let manager: ConversationManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-initiator-"));
    fs.mkdirSync(path.join(tmpDir, "conversations"), { recursive: true });
    manager = new ConversationManager(tmpDir);
  });

  afterEach(() => {
    manager.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("conversations table has last_user_message_at column", () => {
    const db = manager.getDb();
    const columns = db
      .prepare("PRAGMA table_info(conversations)")
      .all() as Array<{ name: string }>;
    const hasColumn = columns.some((c) => c.name === "last_user_message_at");
    expect(hasColumn).toBe(true);
  });
});
