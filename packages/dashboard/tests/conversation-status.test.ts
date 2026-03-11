import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConversationManager } from "../src/conversations/manager.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("Conversation status model", () => {
  let manager: ConversationManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-status-"));
    fs.mkdirSync(path.join(tmpDir, "conversations"), { recursive: true });
    manager = new ConversationManager(tmpDir);
  });

  afterEach(() => {
    manager.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("new conversation is created as current", async () => {
    const conv = await manager.create();
    expect(conv.status).toBe("current");
  });

  it("only one conversation can be current at a time", async () => {
    const convA = await manager.create();
    expect(convA.status).toBe("current");

    const convB = await manager.create();
    expect(convB.status).toBe("current");

    // Conv A should now be inactive
    const reloadedA = await manager.get(convA.id);
    expect(reloadedA!.status).toBe("inactive");
  });

  it("makeCurrent swaps status", async () => {
    const convA = await manager.create();
    const convB = await manager.create();

    // B is current, A is inactive
    expect((await manager.get(convB.id))!.status).toBe("current");
    expect((await manager.get(convA.id))!.status).toBe("inactive");

    // Resume A
    await manager.makeCurrent(convA.id);

    expect((await manager.get(convA.id))!.status).toBe("current");
    expect((await manager.get(convB.id))!.status).toBe("inactive");
  });

  it("getCurrent returns the current conversation", async () => {
    await manager.create();
    const convB = await manager.create();

    const current = await manager.getCurrent();
    expect(current).not.toBeNull();
    expect(current!.id).toBe(convB.id);
  });

  it("getCurrent returns null when no conversations exist", async () => {
    const current = await manager.getCurrent();
    expect(current).toBeNull();
  });
});
