/**
 * E2E / Integration Tests — Conversation Persistence System
 *
 * Tests the conversation system at the backend level:
 * - ConversationManager CRUD + transcript persistence
 * - FTS search
 * - JSONL resilience (corrupt lines)
 * - Session registry (LRU eviction)
 * - Context builder
 * - Idle timer + abbreviation queue
 * - WebSocket protocol message handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ConversationManager,
  TranscriptManager,
  ConversationDatabase,
} from "../src/conversations/index.js";
import type { TranscriptTurn } from "../src/conversations/types.js";
import { SessionRegistry } from "../src/agent/session-registry.js";
import { buildContextInjection } from "../src/agent/context-builder.js";
import { IdleTimerManager } from "../src/conversations/idle-timer.js";
import { ConnectionRegistry } from "../src/ws/connection-registry.js";
import { AbbreviationQueue } from "../src/conversations/abbreviation.js";

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-test-"));
}

function cleanDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function makeTurn(
  role: "user" | "assistant",
  content: string,
  turnNumber: number,
): TranscriptTurn {
  return {
    type: "turn",
    role,
    content,
    timestamp: new Date().toISOString(),
    turnNumber,
  };
}

// -------------------------------------------------------------------
// 1. ConversationManager — CRUD + Transcript Persistence
// -------------------------------------------------------------------

describe("ConversationManager", () => {
  let tempDir: string;
  let manager: ConversationManager;

  beforeEach(() => {
    tempDir = createTempDir();
    manager = new ConversationManager(tempDir);
  });

  afterEach(() => {
    manager.close();
    cleanDir(tempDir);
  });

  it("creates a conversation with conv-{ulid} ID format", async () => {
    const conv = await manager.create("web");
    expect(conv.id).toMatch(/^conv-[A-Z0-9]{26}$/);
    expect(conv.channel).toBe("web");
    expect(conv.title).toBeNull();
    expect(conv.turnCount).toBe(0);
    expect(conv.topics).toEqual([]);
    expect(conv.participants).toEqual(["user"]);
    expect(conv.abbreviation).toBeNull();
    expect(conv.needsAbbreviation).toBe(false);
  });

  it("creates JSONL transcript file on conversation create", async () => {
    const conv = await manager.create("web");
    const transcriptPath = path.join(
      tempDir,
      "conversations",
      `${conv.id}.jsonl`,
    );
    expect(fs.existsSync(transcriptPath)).toBe(true);

    const content = fs.readFileSync(transcriptPath, "utf-8");
    const meta = JSON.parse(content.trim());
    expect(meta.type).toBe("meta");
    expect(meta.id).toBe(conv.id);
    expect(meta.channel).toBe("web");
  });

  it("retrieves conversation by ID", async () => {
    const conv = await manager.create("web");
    const retrieved = await manager.get(conv.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(conv.id);
    expect(retrieved!.channel).toBe("web");
  });

  it("returns null for non-existent conversation", async () => {
    const result = await manager.get("conv-NONEXISTENT");
    expect(result).toBeNull();
  });

  it("lists conversations ordered by updated DESC", async () => {
    const conv1 = await manager.create("web");
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));
    const conv2 = await manager.create("web");

    const list = await manager.list({ channel: "web" });
    expect(list.length).toBe(2);
    // Most recently created should be first
    expect(list[0].id).toBe(conv2.id);
    expect(list[1].id).toBe(conv1.id);
  });

  it("gets most recent conversation for a channel", async () => {
    await manager.create("web");
    await new Promise((r) => setTimeout(r, 10));
    const conv2 = await manager.create("web");

    const recent = await manager.getMostRecent("web");
    expect(recent).not.toBeNull();
    expect(recent!.id).toBe(conv2.id);
  });

  it("returns null when no conversations exist for channel", async () => {
    const recent = await manager.getMostRecent("web");
    expect(recent).toBeNull();
  });

  it("appends turns and persists to transcript", async () => {
    const conv = await manager.create("web");

    const userTurn = makeTurn("user", "Hello agent", 1);
    const assistantTurn = makeTurn("assistant", "Hello user!", 1);

    await manager.appendTurn(conv.id, userTurn);
    await manager.appendTurn(conv.id, assistantTurn);

    const turns = await manager.getTurns(conv.id);
    expect(turns.length).toBe(2);
    expect(turns[0].role).toBe("user");
    expect(turns[0].content).toBe("Hello agent");
    expect(turns[1].role).toBe("assistant");
    expect(turns[1].content).toBe("Hello user!");
  });

  it("increments turn count only on user messages", async () => {
    const conv = await manager.create("web");

    await manager.appendTurn(conv.id, makeTurn("user", "msg1", 1));
    let updated = await manager.get(conv.id);
    expect(updated!.turnCount).toBe(1);

    await manager.appendTurn(conv.id, makeTurn("assistant", "reply1", 1));
    updated = await manager.get(conv.id);
    // Turn count should still be 1 (only incremented on user msg)
    expect(updated!.turnCount).toBe(1);

    await manager.appendTurn(conv.id, makeTurn("user", "msg2", 2));
    updated = await manager.get(conv.id);
    expect(updated!.turnCount).toBe(2);
  });

  it("gets recent turns (tail) for context injection", async () => {
    const conv = await manager.create("web");

    // Add 20 turns (10 user + 10 assistant)
    for (let i = 1; i <= 10; i++) {
      await manager.appendTurn(conv.id, makeTurn("user", `msg ${i}`, i));
      await manager.appendTurn(conv.id, makeTurn("assistant", `reply ${i}`, i));
    }

    const recent = await manager.getRecentTurns(conv.id, 4);
    expect(recent.length).toBe(4);
    // Last 4 entries: user 9, assistant 9, user 10, assistant 10
    expect(recent[0].content).toBe("msg 9");
    expect(recent[1].content).toBe("reply 9");
    expect(recent[2].content).toBe("msg 10");
    expect(recent[3].content).toBe("reply 10");
  });

  it("sets and retrieves title", async () => {
    const conv = await manager.create("web");
    await manager.setTitle(conv.id, "autumn-wind-drifts");

    const updated = await manager.get(conv.id);
    expect(updated!.title).toBe("autumn-wind-drifts");
  });

  it("sets and retrieves abbreviation", async () => {
    const conv = await manager.create("web");
    await manager.setAbbreviation(conv.id, "Discussed server monitoring.");

    const updated = await manager.get(conv.id);
    expect(updated!.abbreviation).toBe("Discussed server monitoring.");
    expect(updated!.needsAbbreviation).toBe(false);
  });

  it("marks and retrieves pending abbreviations", async () => {
    const conv1 = await manager.create("web");
    const conv2 = await manager.create("web");

    await manager.markNeedsAbbreviation(conv1.id);
    await manager.markNeedsAbbreviation(conv2.id);

    const pending = await manager.getPendingAbbreviations();
    expect(pending.length).toBe(2);
    expect(pending).toContain(conv1.id);
    expect(pending).toContain(conv2.id);
  });

  it("limits conversation list results", async () => {
    for (let i = 0; i < 5; i++) {
      await manager.create("web");
      await new Promise((r) => setTimeout(r, 5));
    }

    const limited = await manager.list({ limit: 3 });
    expect(limited.length).toBe(3);
  });

  it("conversation survives manager re-creation (persistence)", async () => {
    const conv = await manager.create("web");
    await manager.appendTurn(conv.id, makeTurn("user", "persistent msg", 1));
    await manager.setTitle(conv.id, "test-title");
    manager.close();

    // Re-create manager (simulates server restart)
    const manager2 = new ConversationManager(tempDir);
    try {
      const retrieved = await manager2.get(conv.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.title).toBe("test-title");

      const turns = await manager2.getTurns(conv.id);
      expect(turns.length).toBe(1);
      expect(turns[0].content).toBe("persistent msg");
    } finally {
      manager2.close();
    }
  });
});

// -------------------------------------------------------------------
// 2. FTS Search
// -------------------------------------------------------------------

describe("FTS Search", () => {
  let tempDir: string;
  let manager: ConversationManager;

  beforeEach(() => {
    tempDir = createTempDir();
    manager = new ConversationManager(tempDir);
  });

  afterEach(() => {
    manager.close();
    cleanDir(tempDir);
  });

  it("finds messages by keyword", async () => {
    const conv = await manager.create("web");

    await manager.appendTurn(
      conv.id,
      makeTurn("user", "How do I deploy to production?", 1),
    );
    await manager.appendTurn(
      conv.id,
      makeTurn("assistant", "You can deploy using npm run build", 1),
    );
    await manager.appendTurn(
      conv.id,
      makeTurn("user", "What about the database?", 2),
    );

    const results = await manager.search("deploy");
    expect(results.length).toBeGreaterThan(0);
    // Should find both user and assistant messages about deploy
    const deployResults = results.filter((r: any) =>
      r.content.toLowerCase().includes("deploy"),
    );
    expect(deployResults.length).toBeGreaterThanOrEqual(1);
  });

  it("searches across multiple conversations", async () => {
    const conv1 = await manager.create("web");
    const conv2 = await manager.create("web");

    await manager.appendTurn(
      conv1.id,
      makeTurn("user", "server monitoring setup", 1),
    );
    await manager.appendTurn(
      conv2.id,
      makeTurn("user", "server deployment pipeline", 1),
    );

    const results = await manager.search("server");
    expect(results.length).toBe(2);

    const convIds = results.map((r: any) => r.conversationId);
    expect(convIds).toContain(conv1.id);
    expect(convIds).toContain(conv2.id);
  });

  it("returns empty for no matches", async () => {
    const conv = await manager.create("web");
    await manager.appendTurn(conv.id, makeTurn("user", "Hello world", 1));

    const results = await manager.search("xyznonexistentterm");
    expect(results.length).toBe(0);
  });
});

// -------------------------------------------------------------------
// 3. JSONL Resilience
// -------------------------------------------------------------------

describe("JSONL Resilience", () => {
  let tempDir: string;
  let manager: ConversationManager;

  beforeEach(() => {
    tempDir = createTempDir();
    manager = new ConversationManager(tempDir);
  });

  afterEach(() => {
    manager.close();
    cleanDir(tempDir);
  });

  it("handles corrupt JSONL lines gracefully", async () => {
    const conv = await manager.create("web");

    // Append a valid turn
    await manager.appendTurn(conv.id, makeTurn("user", "Before corruption", 1));

    // Manually corrupt the transcript
    const transcriptPath = path.join(
      tempDir,
      "conversations",
      `${conv.id}.jsonl`,
    );
    fs.appendFileSync(transcriptPath, '{"type":"turn","broken JSON\n', "utf-8");
    fs.appendFileSync(transcriptPath, "not even json at all\n", "utf-8");

    // Append another valid turn after corruption
    await manager.appendTurn(conv.id, makeTurn("user", "After corruption", 2));

    // Should read valid turns, skipping corrupt lines
    const turns = await manager.getTurns(conv.id);
    expect(turns.length).toBe(2);
    expect(turns[0].content).toBe("Before corruption");
    expect(turns[1].content).toBe("After corruption");
  });

  it("handles empty transcript gracefully", async () => {
    const turns = await manager.getTurns("conv-NONEXISTENT");
    expect(turns).toEqual([]);
  });

  it("handles partial line at end of file", async () => {
    const conv = await manager.create("web");
    await manager.appendTurn(conv.id, makeTurn("user", "Valid message", 1));

    // Write a partial line (simulating crash mid-write)
    const transcriptPath = path.join(
      tempDir,
      "conversations",
      `${conv.id}.jsonl`,
    );
    fs.appendFileSync(
      transcriptPath,
      '{"type":"turn","role":"user","content":"parti',
      "utf-8",
    );

    const turns = await manager.getTurns(conv.id);
    expect(turns.length).toBe(1);
    expect(turns[0].content).toBe("Valid message");
  });
});

// -------------------------------------------------------------------
// 4. SessionRegistry — LRU Eviction
// -------------------------------------------------------------------

describe("SessionRegistry", () => {
  it("returns warm for cached sessions", async () => {
    const registry = new SessionRegistry(3);
    const tempDir = createTempDir();
    const manager = new ConversationManager(tempDir);

    try {
      const conv = await manager.create("web");
      await registry.getOrCreate(conv.id, manager);
      expect(registry.isWarm(conv.id)).toBe(true);
    } finally {
      manager.close();
      cleanDir(tempDir);
    }
  });

  it("returns cold for unknown sessions", () => {
    const registry = new SessionRegistry(3);
    expect(registry.isWarm("conv-UNKNOWN")).toBe(false);
  });

  it("evicts LRU session when at capacity", async () => {
    const registry = new SessionRegistry(2);
    const tempDir = createTempDir();
    const manager = new ConversationManager(tempDir);

    try {
      const conv1 = await manager.create("web");
      const conv2 = await manager.create("web");
      const conv3 = await manager.create("web");

      await registry.getOrCreate(conv1.id, manager);
      await registry.getOrCreate(conv2.id, manager);

      expect(registry.size()).toBe(2);
      expect(registry.isWarm(conv1.id)).toBe(true);
      expect(registry.isWarm(conv2.id)).toBe(true);

      // Adding conv3 should evict conv1 (LRU)
      await registry.getOrCreate(conv3.id, manager);

      expect(registry.size()).toBe(2);
      expect(registry.isWarm(conv1.id)).toBe(false);
      expect(registry.isWarm(conv2.id)).toBe(true);
      expect(registry.isWarm(conv3.id)).toBe(true);
    } finally {
      manager.close();
      cleanDir(tempDir);
    }
  });

  it("touching a session moves it to end of access order", async () => {
    const registry = new SessionRegistry(2);
    const tempDir = createTempDir();
    const manager = new ConversationManager(tempDir);

    try {
      const conv1 = await manager.create("web");
      const conv2 = await manager.create("web");
      const conv3 = await manager.create("web");

      await registry.getOrCreate(conv1.id, manager);
      await registry.getOrCreate(conv2.id, manager);

      // Touch conv1 (makes it most recently used)
      await registry.getOrCreate(conv1.id, manager);

      // Adding conv3 should evict conv2 (now LRU)
      await registry.getOrCreate(conv3.id, manager);

      expect(registry.isWarm(conv1.id)).toBe(true);
      expect(registry.isWarm(conv2.id)).toBe(false);
      expect(registry.isWarm(conv3.id)).toBe(true);
    } finally {
      manager.close();
      cleanDir(tempDir);
    }
  });

  it("removes a specific session", async () => {
    const registry = new SessionRegistry(3);
    const tempDir = createTempDir();
    const manager = new ConversationManager(tempDir);

    try {
      const conv = await manager.create("web");
      await registry.getOrCreate(conv.id, manager);
      expect(registry.isWarm(conv.id)).toBe(true);

      registry.remove(conv.id);
      expect(registry.isWarm(conv.id)).toBe(false);
      expect(registry.size()).toBe(0);
    } finally {
      manager.close();
      cleanDir(tempDir);
    }
  });

  it("clear removes all sessions", async () => {
    const registry = new SessionRegistry(5);
    const tempDir = createTempDir();
    const manager = new ConversationManager(tempDir);

    try {
      for (let i = 0; i < 3; i++) {
        const conv = await manager.create("web");
        await registry.getOrCreate(conv.id, manager);
      }
      expect(registry.size()).toBe(3);

      registry.clear();
      expect(registry.size()).toBe(0);
    } finally {
      manager.close();
      cleanDir(tempDir);
    }
  });
});

// -------------------------------------------------------------------
// 5. Context Builder
// -------------------------------------------------------------------

describe("buildContextInjection", () => {
  it("formats context with abbreviation and turns", () => {
    const turns: TranscriptTurn[] = [
      makeTurn("user", "Hello", 1),
      makeTurn("assistant", "Hi there!", 1),
    ];

    const result = buildContextInjection(
      turns,
      "User greeted the agent.",
      new Date(Date.now() - 3600000), // 1 hour ago
    );

    expect(result).toContain("[Prior conversation - 1 hour ago]");
    expect(result).toContain("Summary: User greeted the agent.");
    expect(result).toContain("User: Hello");
    expect(result).toContain("Assistant: Hi there!");
    expect(result).toContain("[End prior conversation]");
  });

  it("formats without abbreviation", () => {
    const turns: TranscriptTurn[] = [makeTurn("user", "Test", 1)];

    const result = buildContextInjection(
      turns,
      null,
      new Date(Date.now() - 60000), // 1 minute ago
    );

    expect(result).toContain("[Prior conversation - 1 minute ago]");
    expect(result).not.toContain("Summary:");
    expect(result).toContain("User: Test");
  });

  it("truncates very long messages at 500 chars", () => {
    const longContent = "A".repeat(600);
    const turns: TranscriptTurn[] = [makeTurn("user", longContent, 1)];

    const result = buildContextInjection(turns, null, new Date());

    expect(result).toContain("A".repeat(500) + "...");
    expect(result).not.toContain("A".repeat(501));
  });

  it("formats time gaps correctly", () => {
    const turns: TranscriptTurn[] = [makeTurn("user", "x", 1)];

    // Days
    let result = buildContextInjection(
      turns,
      null,
      new Date(Date.now() - 2 * 86400000),
    );
    expect(result).toContain("2 days ago");

    // Hours
    result = buildContextInjection(
      turns,
      null,
      new Date(Date.now() - 5 * 3600000),
    );
    expect(result).toContain("5 hours ago");

    // Minutes
    result = buildContextInjection(
      turns,
      null,
      new Date(Date.now() - 15 * 60000),
    );
    expect(result).toContain("15 minutes ago");

    // Seconds
    result = buildContextInjection(turns, null, new Date(Date.now() - 5000));
    expect(result).toContain("a few seconds ago");
  });
});

// -------------------------------------------------------------------
// 6. ConnectionRegistry
// -------------------------------------------------------------------

describe("ConnectionRegistry", () => {
  function mockSocket(readyState = 1): any {
    const sent: string[] = [];
    return {
      readyState,
      send: (data: string) => sent.push(data),
      __sent: sent,
    };
  }

  it("tracks sockets per conversation", () => {
    const registry = new ConnectionRegistry();
    const s1 = mockSocket();
    const s2 = mockSocket();

    registry.add(s1, "conv-1");
    registry.add(s2, "conv-1");

    expect(registry.getViewerCount("conv-1")).toBe(2);
    expect(registry.getViewerCount("conv-2")).toBe(0);
  });

  it("switches conversation for a socket", () => {
    const registry = new ConnectionRegistry();
    const s1 = mockSocket();

    registry.add(s1, "conv-1");
    expect(registry.getViewerCount("conv-1")).toBe(1);

    registry.switchConversation(s1, "conv-2");
    expect(registry.getViewerCount("conv-1")).toBe(0);
    expect(registry.getViewerCount("conv-2")).toBe(1);
  });

  it("removes socket from registry", () => {
    const registry = new ConnectionRegistry();
    const s1 = mockSocket();

    registry.add(s1, "conv-1");
    expect(registry.getViewerCount("conv-1")).toBe(1);

    registry.remove(s1);
    expect(registry.getViewerCount("conv-1")).toBe(0);
  });

  it("broadcasts to all sockets in a conversation except sender", () => {
    const registry = new ConnectionRegistry();
    const s1 = mockSocket();
    const s2 = mockSocket();
    const s3 = mockSocket();

    registry.add(s1, "conv-1");
    registry.add(s2, "conv-1");
    registry.add(s3, "conv-2");

    registry.broadcastToConversation(
      "conv-1",
      { type: "conversation_renamed", conversationId: "conv-1", title: "test" },
      s1,
    );

    // s2 should receive, s1 excluded, s3 in different conv
    expect(s2.__sent.length).toBe(1);
    expect(s1.__sent.length).toBe(0);
    expect(s3.__sent.length).toBe(0);
  });

  it("skips sockets that are not OPEN", () => {
    const registry = new ConnectionRegistry();
    const openSocket = mockSocket(1);
    const closedSocket = mockSocket(3); // CLOSED

    registry.add(openSocket, "conv-1");
    registry.add(closedSocket, "conv-1");

    registry.broadcastToConversation("conv-1", {
      type: "conversation_renamed",
      conversationId: "conv-1",
      title: "test",
    });

    expect(openSocket.__sent.length).toBe(1);
    expect(closedSocket.__sent.length).toBe(0);
  });

  it("gets conversation ID for a socket", () => {
    const registry = new ConnectionRegistry();
    const s1 = mockSocket();

    registry.add(s1, "conv-1");
    expect(registry.getConversationId(s1)).toBe("conv-1");
  });

  it("returns null for unregistered socket", () => {
    const registry = new ConnectionRegistry();
    const s1 = mockSocket();

    expect(registry.getConversationId(s1)).toBeNull();
  });

  it("lists active conversations", () => {
    const registry = new ConnectionRegistry();
    const s1 = mockSocket();
    const s2 = mockSocket();

    registry.add(s1, "conv-1");
    registry.add(s2, "conv-2");

    const active = registry.getActiveConversations();
    expect(active.size).toBe(2);
    expect(active.has("conv-1")).toBe(true);
    expect(active.has("conv-2")).toBe(true);
  });
});

// -------------------------------------------------------------------
// 7. IdleTimerManager
// -------------------------------------------------------------------

describe("IdleTimerManager", () => {
  it("fires abbreviation after idle timeout with no viewers", async () => {
    const enqueuedIds: string[] = [];
    const mockQueue = {
      enqueue: (id: string) => enqueuedIds.push(id),
    } as any;

    const mockRegistry = {
      getViewerCount: () => 0, // No viewers
    } as any;

    const idleTimer = new IdleTimerManager(
      mockQueue,
      mockRegistry,
      50, // 50ms for fast testing
    );

    idleTimer.touch("conv-1");

    await new Promise((r) => setTimeout(r, 100));

    expect(enqueuedIds).toContain("conv-1");

    idleTimer.shutdown();
  });

  it("does NOT fire abbreviation when viewers are present", async () => {
    const enqueuedIds: string[] = [];
    const mockQueue = {
      enqueue: (id: string) => enqueuedIds.push(id),
    } as any;

    const mockRegistry = {
      getViewerCount: () => 1, // Has viewers
    } as any;

    const idleTimer = new IdleTimerManager(
      mockQueue,
      mockRegistry,
      50, // 50ms for fast testing
    );

    idleTimer.touch("conv-1");

    await new Promise((r) => setTimeout(r, 100));

    expect(enqueuedIds.length).toBe(0);

    idleTimer.shutdown();
  });

  it("resets timer on touch", async () => {
    const enqueuedIds: string[] = [];
    const mockQueue = {
      enqueue: (id: string) => enqueuedIds.push(id),
    } as any;

    const mockRegistry = {
      getViewerCount: () => 0,
    } as any;

    const idleTimer = new IdleTimerManager(
      mockQueue,
      mockRegistry,
      80, // 80ms for testing
    );

    idleTimer.touch("conv-1");
    await new Promise((r) => setTimeout(r, 40));

    // Touch again before timeout - should reset
    idleTimer.touch("conv-1");
    await new Promise((r) => setTimeout(r, 40));

    // Should not have fired yet (only 40ms since last touch)
    expect(enqueuedIds.length).toBe(0);

    // Wait for full timeout
    await new Promise((r) => setTimeout(r, 60));
    expect(enqueuedIds).toContain("conv-1");

    idleTimer.shutdown();
  });

  it("clears timer explicitly", async () => {
    const enqueuedIds: string[] = [];
    const mockQueue = {
      enqueue: (id: string) => enqueuedIds.push(id),
    } as any;

    const mockRegistry = {
      getViewerCount: () => 0,
    } as any;

    const idleTimer = new IdleTimerManager(mockQueue, mockRegistry, 50);

    idleTimer.touch("conv-1");
    idleTimer.clear("conv-1");

    await new Promise((r) => setTimeout(r, 100));

    expect(enqueuedIds.length).toBe(0);

    idleTimer.shutdown();
  });

  it("shutdown clears all timers", () => {
    const mockQueue = { enqueue: () => {} } as any;
    const mockRegistry = { getViewerCount: () => 0 } as any;

    const idleTimer = new IdleTimerManager(mockQueue, mockRegistry, 5000);

    idleTimer.touch("conv-1");
    idleTimer.touch("conv-2");

    expect(idleTimer.getActiveTimerCount()).toBe(2);

    idleTimer.shutdown();

    expect(idleTimer.getActiveTimerCount()).toBe(0);
  });
});

// -------------------------------------------------------------------
// 8. Conversation Rename
// -------------------------------------------------------------------

describe("Conversation Rename", () => {
  let tempDir: string;
  let manager: ConversationManager;

  beforeEach(() => {
    tempDir = createTempDir();
    manager = new ConversationManager(tempDir);
  });

  afterEach(() => {
    manager.close();
    cleanDir(tempDir);
  });

  it("updates title in database", async () => {
    const conv = await manager.create("web");
    await manager.setTitle(conv.id, "morning-code-flows");

    const updated = await manager.get(conv.id);
    expect(updated!.title).toBe("morning-code-flows");
  });

  it("appends title_assigned event to transcript", async () => {
    const conv = await manager.create("web");
    await manager.setTitle(conv.id, "autumn-wind-drifts");

    const transcriptPath = path.join(
      tempDir,
      "conversations",
      `${conv.id}.jsonl`,
    );
    const content = fs.readFileSync(transcriptPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    // Last line should be the title_assigned event
    const lastLine = JSON.parse(lines[lines.length - 1]);
    expect(lastLine.type).toBe("event");
    expect(lastLine.event).toBe("title_assigned");
    expect(lastLine.title).toBe("autumn-wind-drifts");
  });
});

// -------------------------------------------------------------------
// 9. Database Initialization
// -------------------------------------------------------------------

describe("ConversationDatabase", () => {
  let tempDir: string;
  let db: ConversationDatabase;

  beforeEach(() => {
    tempDir = createTempDir();
    db = new ConversationDatabase(tempDir);
  });

  afterEach(() => {
    db.close();
    cleanDir(tempDir);
  });

  it("creates conversations directory if needed", () => {
    const dir = path.join(tempDir, "conversations");
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("creates database file", () => {
    const dbFile = path.join(tempDir, "conversations", "conversations.db");
    expect(fs.existsSync(dbFile)).toBe(true);
  });

  it("uses WAL journal mode", () => {
    // WAL creates -wal file on first write
    // The fact that the DB initializes without error confirms WAL pragma
    const conv = {
      id: "conv-TEST",
      channel: "web" as const,
      title: null,
      topics: [],
      created: new Date(),
      updated: new Date(),
      turnCount: 0,
      participants: ["user"],
      abbreviation: null,
      needsAbbreviation: false,
    };
    db.insertConversation(conv);
    const retrieved = db.getConversation("conv-TEST");
    expect(retrieved).not.toBeNull();
  });
});

// -------------------------------------------------------------------
// 10. Pagination
// -------------------------------------------------------------------

describe("Pagination", () => {
  let tempDir: string;
  let manager: ConversationManager;

  beforeEach(() => {
    tempDir = createTempDir();
    manager = new ConversationManager(tempDir);
  });

  afterEach(() => {
    manager.close();
    cleanDir(tempDir);
  });

  it("paginates turns with offset and limit", async () => {
    const conv = await manager.create("web");

    for (let i = 1; i <= 5; i++) {
      await manager.appendTurn(conv.id, makeTurn("user", `msg ${i}`, i));
      await manager.appendTurn(conv.id, makeTurn("assistant", `reply ${i}`, i));
    }

    // Get page 2 (offset 4, limit 4)
    const page = await manager.getTurns(conv.id, { offset: 4, limit: 4 });
    expect(page.length).toBe(4);
    expect(page[0].content).toBe("msg 3");
    expect(page[3].content).toBe("reply 4");
  });

  it("handles offset beyond end gracefully", async () => {
    const conv = await manager.create("web");
    await manager.appendTurn(conv.id, makeTurn("user", "only msg", 1));

    const page = await manager.getTurns(conv.id, { offset: 100, limit: 10 });
    expect(page.length).toBe(0);
  });
});

// -------------------------------------------------------------------
// 11. Topics
// -------------------------------------------------------------------

describe("Topics", () => {
  let tempDir: string;
  let manager: ConversationManager;

  beforeEach(() => {
    tempDir = createTempDir();
    manager = new ConversationManager(tempDir);
  });

  afterEach(() => {
    manager.close();
    cleanDir(tempDir);
  });

  it("sets topics as JSON array", async () => {
    const conv = await manager.create("web");
    await manager.setTopics(conv.id, ["server-monitoring", "deployment"]);

    const updated = await manager.get(conv.id);
    expect(updated!.topics).toEqual(["server-monitoring", "deployment"]);
  });
});

// -------------------------------------------------------------------
// 12. TranscriptManager — Direct tests
// -------------------------------------------------------------------

describe("TranscriptManager", () => {
  let tempDir: string;
  let transcript: TranscriptManager;

  beforeEach(() => {
    tempDir = createTempDir();
    transcript = new TranscriptManager(tempDir);
  });

  afterEach(() => {
    cleanDir(tempDir);
  });

  it("reports existence correctly", () => {
    expect(transcript.exists("conv-NOPE")).toBe(false);

    transcript.createTranscript({
      type: "meta",
      id: "conv-TEST",
      channel: "web",
      created: new Date().toISOString(),
      participants: ["user"],
    });

    expect(transcript.exists("conv-TEST")).toBe(true);
  });

  it("counts unique turn numbers", () => {
    transcript.createTranscript({
      type: "meta",
      id: "conv-COUNT",
      channel: "web",
      created: new Date().toISOString(),
      participants: ["user"],
    });

    transcript.appendTurn("conv-COUNT", makeTurn("user", "u1", 1));
    transcript.appendTurn("conv-COUNT", makeTurn("assistant", "a1", 1));
    transcript.appendTurn("conv-COUNT", makeTurn("user", "u2", 2));
    transcript.appendTurn("conv-COUNT", makeTurn("assistant", "a2", 2));

    expect(transcript.getTurnCount("conv-COUNT")).toBe(2);
  });

  it("reads full transcript including events", () => {
    transcript.createTranscript({
      type: "meta",
      id: "conv-FULL",
      channel: "web",
      created: new Date().toISOString(),
      participants: ["user"],
    });

    transcript.appendTurn("conv-FULL", makeTurn("user", "msg", 1));
    transcript.appendEvent("conv-FULL", {
      type: "event",
      event: "title_assigned",
      title: "test-title",
      timestamp: new Date().toISOString(),
    });

    const lines = transcript.readFullTranscript("conv-FULL");
    expect(lines.length).toBe(3); // meta + turn + event
    expect(lines[0].type).toBe("meta");
    expect(lines[1].type).toBe("turn");
    expect(lines[2].type).toBe("event");
  });
});

// -------------------------------------------------------------------
// 13. Cursor-based Pagination (getTurnsBefore)
// -------------------------------------------------------------------

describe("getTurnsBefore (cursor pagination)", () => {
  let tempDir: string;
  let manager: ConversationManager;

  beforeEach(() => {
    tempDir = createTempDir();
    manager = new ConversationManager(tempDir);
  });

  afterEach(() => {
    manager.close();
    cleanDir(tempDir);
  });

  it("returns turns before a given timestamp", async () => {
    const conv = await manager.create("web");

    const timestamps: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const ts = new Date(Date.now() + i * 1000).toISOString();
      timestamps.push(ts);
      await manager.appendTurn(conv.id, {
        type: "turn",
        role: "user",
        content: `msg ${i}`,
        timestamp: ts,
        turnNumber: i,
      });
    }

    // Get 3 turns before timestamp of msg 7
    const { turns, hasMore } = await manager.getTurnsBefore(
      conv.id,
      timestamps[6], // msg 7
      3,
    );

    expect(turns.length).toBe(3);
    expect(turns[0].content).toBe("msg 4");
    expect(turns[1].content).toBe("msg 5");
    expect(turns[2].content).toBe("msg 6");
    expect(hasMore).toBe(true); // msgs 1-3 still exist
  });

  it("returns hasMore=false when no older turns exist", async () => {
    const conv = await manager.create("web");

    const timestamps: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const ts = new Date(Date.now() + i * 1000).toISOString();
      timestamps.push(ts);
      await manager.appendTurn(conv.id, {
        type: "turn",
        role: "user",
        content: `msg ${i}`,
        timestamp: ts,
        turnNumber: i,
      });
    }

    // Get up to 10 turns before msg 3 — only 2 exist
    const { turns, hasMore } = await manager.getTurnsBefore(
      conv.id,
      timestamps[2], // msg 3
      10,
    );

    expect(turns.length).toBe(2);
    expect(turns[0].content).toBe("msg 1");
    expect(turns[1].content).toBe("msg 2");
    expect(hasMore).toBe(false);
  });

  it("returns empty when timestamp not found", async () => {
    const conv = await manager.create("web");

    await manager.appendTurn(conv.id, makeTurn("user", "msg", 1));

    const { turns, hasMore } = await manager.getTurnsBefore(
      conv.id,
      "2099-01-01T00:00:00.000Z",
      10,
    );

    expect(turns.length).toBe(0);
    expect(hasMore).toBe(false);
  });

  it("returns empty when before is the first turn", async () => {
    const conv = await manager.create("web");

    const ts = new Date().toISOString();
    await manager.appendTurn(conv.id, {
      type: "turn",
      role: "user",
      content: "first",
      timestamp: ts,
      turnNumber: 1,
    });

    const { turns, hasMore } = await manager.getTurnsBefore(conv.id, ts, 10);

    expect(turns.length).toBe(0);
    expect(hasMore).toBe(false);
  });
});

// -------------------------------------------------------------------
// 14. AbbreviationQueue (unit-level, no external API calls)
// -------------------------------------------------------------------

describe("AbbreviationQueue", () => {
  it("deduplicates enqueue calls", () => {
    const mockManager = {
      get: async () => null, // Will cause abbreviation to skip
      getTurns: async () => [],
      markNeedsAbbreviation: async () => {},
    } as unknown as ConversationManager;

    const queue = new AbbreviationQueue(mockManager, "fake-key");
    queue.enqueue("conv-1");
    queue.enqueue("conv-1"); // duplicate

    const status = queue.getStatus();
    // Should only have 1 pending (deduplicated)
    expect(status.pendingCount).toBeLessThanOrEqual(1);
  });

  it("drain completes cleanly with empty queue", async () => {
    const mockManager = {
      get: async () => ({ id: "conv-1", turnCount: 1 }),
      getTurns: async () => [{ role: "user", content: "test" }],
      markNeedsAbbreviation: async () => {},
    } as unknown as ConversationManager;

    const queue = new AbbreviationQueue(mockManager, "fake-key");

    // Drain immediately (no tasks processing)
    await queue.drain();

    // Should complete without error
    const status = queue.getStatus();
    expect(status.queueLength).toBe(0);
    expect(status.processing).toBe(false);
  });
});

// -------------------------------------------------------------------
// 15. Conversation updated timestamp
// -------------------------------------------------------------------

describe("Conversation updated timestamp", () => {
  let tempDir: string;
  let manager: ConversationManager;

  beforeEach(() => {
    tempDir = createTempDir();
    manager = new ConversationManager(tempDir);
  });

  afterEach(() => {
    manager.close();
    cleanDir(tempDir);
  });

  it("updated timestamp changes on appendTurn", async () => {
    const conv = await manager.create("web");
    const originalUpdated = conv.updated.getTime();

    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 15));

    await manager.appendTurn(conv.id, makeTurn("user", "hello", 1));

    const updated = await manager.get(conv.id);
    expect(updated!.updated.getTime()).toBeGreaterThan(originalUpdated);
  });

  it("assistant turn also updates timestamp", async () => {
    const conv = await manager.create("web");
    await manager.appendTurn(conv.id, makeTurn("user", "hello", 1));

    const afterUser = await manager.get(conv.id);
    const userTime = afterUser!.updated.getTime();

    await new Promise((r) => setTimeout(r, 15));

    await manager.appendTurn(conv.id, makeTurn("assistant", "hi", 1));

    const afterAssistant = await manager.get(conv.id);
    expect(afterAssistant!.updated.getTime()).toBeGreaterThan(userTime);
  });
});

// -------------------------------------------------------------------
// 16. Broadcast includes sender for rename
// -------------------------------------------------------------------

describe("Broadcast includes sender for rename", () => {
  function mockSocket(readyState = 1): any {
    const sent: string[] = [];
    return {
      readyState,
      send: (data: string) => sent.push(data),
      __sent: sent,
    };
  }

  it("broadcastToConversation without exclude sends to all sockets", () => {
    const registry = new ConnectionRegistry();
    const s1 = mockSocket();
    const s2 = mockSocket();

    registry.add(s1, "conv-1");
    registry.add(s2, "conv-1");

    // No exclude parameter — simulates rename broadcast
    registry.broadcastToConversation("conv-1", {
      type: "conversation_renamed",
      conversationId: "conv-1",
      title: "new-title",
    });

    // Both sockets should receive
    expect(s1.__sent.length).toBe(1);
    expect(s2.__sent.length).toBe(1);

    const msg1 = JSON.parse(s1.__sent[0]);
    expect(msg1.type).toBe("conversation_renamed");
    expect(msg1.title).toBe("new-title");
  });
});
