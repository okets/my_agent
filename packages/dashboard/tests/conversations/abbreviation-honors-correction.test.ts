/**
 * M9.6-S5 — Abbreviation queue honors `turn_corrected` events.
 *
 * When the CFR orchestrator retroactively corrects a user turn (e.g. an STT
 * failure recovered after the user's original "[Voice note — audio attached,
 * pending transcription]" placeholder was written), the abbreviation queue
 * must use the corrected content when summarizing, NOT the original
 * placeholder. Otherwise the user's actual question is lost from memory.
 *
 * The SDK boundary (`createBrainQuery`) is mocked — this test verifies the
 * transcript-text assembly, not the Haiku call itself. We capture the prompt
 * passed to `createBrainQuery` and assert it contains the corrected content.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock the SDK boundary BEFORE importing modules that use it.
vi.mock("@my-agent/core", async () => {
  const actual =
    await vi.importActual<typeof import("@my-agent/core")>("@my-agent/core");
  return {
    ...actual,
    createBrainQuery: vi.fn(),
    loadModels: vi.fn(() => ({
      haiku: "claude-haiku-4-5-20251001",
      sonnet: "claude-sonnet-4-6",
      opus: "claude-opus-4-6",
    })),
  };
});

// Fact extraction is out of scope for this test — stub it.
vi.mock("../../src/conversations/knowledge-extractor.js", () => ({
  extractClassifiedFacts: vi.fn(async () => []),
  routeFacts: vi.fn(() => ({ staging: [], dailyLog: [], properties: [] })),
}));

import { createBrainQuery } from "@my-agent/core";
import { AbbreviationQueue } from "../../src/conversations/abbreviation.js";
import { ConversationManager } from "../../src/conversations/manager.js";
import type {
  TranscriptTurn,
  TurnCorrectedEvent,
} from "../../src/conversations/types.js";

/**
 * Build an async iterator that mimics the SDK's query stream for the
 * abbreviation prompt — emits a single assistant message then a result.
 */
function mockHaikuStream(abbreviation: string): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      let step = 0;
      return {
        async next() {
          if (step === 0) {
            step++;
            return {
              value: {
                type: "assistant",
                message: {
                  content: [{ type: "text", text: abbreviation }],
                },
              },
              done: false,
            };
          }
          if (step === 1) {
            step++;
            return {
              value: { type: "result", result: abbreviation },
              done: false,
            };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
}

describe("AbbreviationQueue honors turn_corrected events (M9.6-S5)", () => {
  let tmpDir: string;
  let manager: ConversationManager;
  let queue: AbbreviationQueue;
  let capturedPrompt: string | null;

  const PLACEHOLDER = "[Voice note — audio attached, pending transcription]";
  const REAL_CONTENT = "can you understand voice messages now";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abbrev-correction-"));
    fs.mkdirSync(path.join(tmpDir, "conversations"), { recursive: true });

    capturedPrompt = null;
    vi.mocked(createBrainQuery).mockImplementation((prompt: string) => {
      // The AbbreviationQueue also triggers NamingService which calls
      // createBrainQuery for a titling prompt. We only care about the
      // abbreviation prompt — identify it by its header text.
      if (
        prompt.includes("Abbreviate this conversation") &&
        capturedPrompt === null
      ) {
        capturedPrompt = prompt;
      }
      return mockHaikuStream(
        '{"title": "Test Conversation", "topics": ["test"]}',
      ) as ReturnType<typeof createBrainQuery>;
    });

    manager = new ConversationManager(tmpDir);
    queue = new AbbreviationQueue(manager, "test-api-key", tmpDir);
  });

  afterEach(() => {
    manager.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("substitutes correctedContent for user turns that were later corrected", async () => {
    const conv = await manager.create();

    // User turn written with placeholder (STT failed at ingest time).
    const userTurn: TranscriptTurn = {
      type: "turn",
      role: "user",
      content: PLACEHOLDER,
      timestamp: new Date(Date.now() - 60_000).toISOString(),
      turnNumber: 1,
    };
    await manager.appendTurn(conv.id, userTurn);

    // Assistant turn — whatever it replied with is fine; we care about the
    // USER turn being substituted.
    const assistantTurn: TranscriptTurn = {
      type: "turn",
      role: "assistant",
      content: "I saw your voice note but couldn't transcribe it.",
      timestamp: new Date(Date.now() - 55_000).toISOString(),
      turnNumber: 1,
    };
    await manager.appendTurn(conv.id, assistantTurn);

    // CFR orchestrator retroactively corrects the user turn.
    const correction: TurnCorrectedEvent = {
      type: "turn_corrected",
      turnNumber: 1,
      correctedContent: REAL_CONTENT,
      correctedBy: "cfr-orchestrator",
      cfrFailureId: "cfr-test-001",
      timestamp: new Date().toISOString(),
    };
    await manager.appendEvent(conv.id, correction);

    // Run abbreviation synchronously.
    queue.enqueue(conv.id);
    // Drain so we wait for the single in-flight task.
    await queue.drain();

    expect(capturedPrompt).not.toBeNull();
    expect(capturedPrompt).toContain(REAL_CONTENT);
    expect(capturedPrompt).not.toContain(PLACEHOLDER);
  });

  it("leaves user turns without a corresponding turn_corrected event unchanged", async () => {
    const conv = await manager.create();

    const userTurn: TranscriptTurn = {
      type: "turn",
      role: "user",
      content: "plain user text",
      timestamp: new Date(Date.now() - 60_000).toISOString(),
      turnNumber: 1,
    };
    await manager.appendTurn(conv.id, userTurn);

    const assistantTurn: TranscriptTurn = {
      type: "turn",
      role: "assistant",
      content: "plain assistant reply",
      timestamp: new Date(Date.now() - 55_000).toISOString(),
      turnNumber: 1,
    };
    await manager.appendTurn(conv.id, assistantTurn);

    // No turn_corrected event this time.

    queue.enqueue(conv.id);
    await queue.drain();

    expect(capturedPrompt).not.toBeNull();
    expect(capturedPrompt).toContain("plain user text");
    expect(capturedPrompt).toContain("plain assistant reply");
  });
});
