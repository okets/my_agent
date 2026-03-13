import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConversationManager } from "../src/conversations/manager.js";
import type { TranscriptTurn } from "../src/conversations/types.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function makeTurn(
  role: "user" | "assistant",
  turnNumber: number,
): TranscriptTurn {
  return {
    type: "turn",
    role,
    content: `${role} message`,
    timestamp: new Date().toISOString(),
    turnNumber,
  };
}

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

describe("Task 2: lastUserMessageAt tracking in appendTurn()", () => {
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

  it("updates lastUserMessageAt on user turn", async () => {
    const conv = await manager.create();
    expect(conv.lastUserMessageAt).toBeNull();

    const turn = makeTurn("user", 1);
    await manager.appendTurn(conv.id, turn);

    const updated = await manager.get(conv.id);
    expect(updated!.lastUserMessageAt).not.toBeNull();
    expect(updated!.lastUserMessageAt).toBeInstanceOf(Date);
    expect(updated!.lastUserMessageAt!.toISOString()).toBe(turn.timestamp);
  });

  it("does NOT update lastUserMessageAt on assistant turn", async () => {
    const conv = await manager.create();

    const assistantTurn = makeTurn("assistant", 1);
    await manager.appendTurn(conv.id, assistantTurn);

    const updated = await manager.get(conv.id);
    expect(updated!.lastUserMessageAt).toBeNull();
  });
});
