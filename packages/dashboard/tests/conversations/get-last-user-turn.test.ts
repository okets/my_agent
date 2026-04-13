import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConversationManager } from "../../src/conversations/manager.js";
import type { TranscriptTurn } from "../../src/conversations/types.js";

function turn(
  role: "user" | "assistant",
  turnNumber: number,
  options?: { channel?: string; ageMinutes?: number },
): TranscriptTurn {
  const timestamp = new Date(
    Date.now() - (options?.ageMinutes ?? 0) * 60 * 1000,
  ).toISOString();
  return {
    type: "turn",
    role,
    content: `${role} ${turnNumber}`,
    timestamp,
    turnNumber,
    channel: options?.channel,
  };
}

describe("ConversationManager.getLastUserTurn() (M10-S0)", () => {
  let manager: ConversationManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "last-user-turn-"));
    fs.mkdirSync(path.join(tmpDir, "conversations"), { recursive: true });
    manager = new ConversationManager(tmpDir);
  });

  afterEach(() => {
    manager.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null for a conversation with no turns", async () => {
    const conv = await manager.create();
    expect(await manager.getLastUserTurn(conv.id)).toBeNull();
  });

  it("returns null when only assistant turns exist", async () => {
    const conv = await manager.create();
    await manager.appendTurn(conv.id, turn("assistant", 1));
    expect(await manager.getLastUserTurn(conv.id)).toBeNull();
  });

  it("ignores trailing assistant turn and returns earlier user turn", async () => {
    const conv = await manager.create();
    await manager.appendTurn(
      conv.id,
      turn("user", 1, { channel: "whatsapp", ageMinutes: 5 }),
    );
    await manager.appendTurn(conv.id, turn("assistant", 1));
    const result = await manager.getLastUserTurn(conv.id);
    expect(result).not.toBeNull();
    expect(result!.channel).toBe("whatsapp");
  });

  it("returns the literal latest user turn across channels", async () => {
    const conv = await manager.create();
    await manager.appendTurn(
      conv.id,
      turn("user", 1, { channel: "whatsapp", ageMinutes: 30 }),
    );
    await manager.appendTurn(conv.id, turn("assistant", 1));
    await manager.appendTurn(conv.id, turn("user", 2, { ageMinutes: 1 })); // web
    const result = await manager.getLastUserTurn(conv.id);
    expect(result!.channel).toBeUndefined(); // web turn = no channel
    const ageMs = Date.now() - new Date(result!.timestamp).getTime();
    expect(ageMs).toBeLessThan(2 * 60 * 1000);
  });

  it("returns undefined channel for web turns (no channel field)", async () => {
    const conv = await manager.create();
    await manager.appendTurn(conv.id, turn("user", 1));
    const result = await manager.getLastUserTurn(conv.id);
    expect(result).not.toBeNull();
    expect(result!.channel).toBeUndefined();
  });

  it("returns whatsapp channel for whatsapp turns", async () => {
    const conv = await manager.create();
    await manager.appendTurn(
      conv.id,
      turn("user", 1, { channel: "whatsapp" }),
    );
    const result = await manager.getLastUserTurn(conv.id);
    expect(result!.channel).toBe("whatsapp");
  });

  it("returns null for an unknown conversation id", async () => {
    expect(await manager.getLastUserTurn("conv-does-not-exist")).toBeNull();
  });
});
