/**
 * Unit Tests — Step Executor
 *
 * Tests the deterministic step execution system:
 * - parseSteps() markdown parsing
 * - isDeliveryStep() detection
 * - StepExecutor delivery execution
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseSteps,
  isDeliveryStep,
  StepExecutor,
} from "../src/tasks/step-executor.js";
import type { Task } from "@my-agent/core";
import type { ChannelManager } from "../src/channels/index.js";

// -------------------------------------------------------------------
// 1. parseSteps — Markdown Checkbox Parsing
// -------------------------------------------------------------------

describe("parseSteps", () => {
  it("parses unchecked steps", () => {
    const steps = `- [ ] Research topic
- [ ] Compile findings
- [ ] Send via WhatsApp`;

    const parsed = parseSteps(steps);

    expect(parsed.length).toBe(3);
    expect(parsed[0]).toEqual({
      number: 1,
      description: "Research topic",
      completed: false,
    });
    expect(parsed[1]).toEqual({
      number: 2,
      description: "Compile findings",
      completed: false,
    });
    expect(parsed[2]).toEqual({
      number: 3,
      description: "Send via WhatsApp",
      completed: false,
    });
  });

  it("parses checked steps", () => {
    const steps = `- [x] Research topic
- [X] Compile findings
- [ ] Send via WhatsApp`;

    const parsed = parseSteps(steps);

    expect(parsed.length).toBe(3);
    expect(parsed[0].completed).toBe(true);
    expect(parsed[1].completed).toBe(true); // uppercase X
    expect(parsed[2].completed).toBe(false);
  });

  it("handles mixed content with non-step lines", () => {
    const steps = `## Task Steps

- [ ] First step
Some explanation text
- [ ] Second step

Another paragraph`;

    const parsed = parseSteps(steps);

    expect(parsed.length).toBe(2);
    expect(parsed[0].description).toBe("First step");
    expect(parsed[1].description).toBe("Second step");
  });

  it("handles empty input", () => {
    const parsed = parseSteps("");
    expect(parsed).toEqual([]);
  });

  it("handles no valid steps", () => {
    const parsed = parseSteps("Just some text\nNo steps here");
    expect(parsed).toEqual([]);
  });

  it("preserves step descriptions with special characters", () => {
    const steps = `- [ ] Send email to user@example.com
- [ ] Deploy to https://example.com
- [ ] Run "npm test" command`;

    const parsed = parseSteps(steps);

    expect(parsed[0].description).toBe("Send email to user@example.com");
    expect(parsed[1].description).toBe("Deploy to https://example.com");
    expect(parsed[2].description).toBe('Run "npm test" command');
  });
});

// -------------------------------------------------------------------
// 2. isDeliveryStep — Delivery Detection
// -------------------------------------------------------------------

describe("isDeliveryStep", () => {
  describe("WhatsApp detection", () => {
    it("detects explicit WhatsApp mention", () => {
      const result = isDeliveryStep("Send results via WhatsApp");
      expect(result.isDelivery).toBe(true);
      expect(result.channel).toBe("whatsapp");
    });

    it("detects WhatsApp case-insensitively", () => {
      const result = isDeliveryStep("WHATSAPP the findings to Hanan");
      expect(result.isDelivery).toBe(true);
      expect(result.channel).toBe("whatsapp");
    });

    it("detects 'send message' pattern", () => {
      const result = isDeliveryStep("Send message to owner");
      expect(result.isDelivery).toBe(true);
      expect(result.channel).toBe("whatsapp");
    });

    it("extracts recipient from 'to X' pattern", () => {
      const result = isDeliveryStep("Send via WhatsApp to Hanan");
      expect(result.isDelivery).toBe(true);
      expect(result.recipient).toBe("Hanan");
    });
  });

  describe("Email detection", () => {
    it("detects email mention", () => {
      const result = isDeliveryStep("Email the report to the team");
      expect(result.isDelivery).toBe(true);
      expect(result.channel).toBe("email");
    });

    it("detects mail mention", () => {
      const result = isDeliveryStep("Mail the summary");
      expect(result.isDelivery).toBe(true);
      expect(result.channel).toBe("email");
    });
  });

  describe("Non-delivery steps", () => {
    it("returns false for research steps", () => {
      const result = isDeliveryStep("Research the topic thoroughly");
      expect(result.isDelivery).toBe(false);
      expect(result.channel).toBeUndefined();
    });

    it("returns false for compile steps", () => {
      const result = isDeliveryStep("Compile findings into summary");
      expect(result.isDelivery).toBe(false);
    });

    it("returns false for generic actions", () => {
      const result = isDeliveryStep("Update the database");
      expect(result.isDelivery).toBe(false);
    });
  });
});

// -------------------------------------------------------------------
// 3. StepExecutor — Delivery Execution
// -------------------------------------------------------------------

describe("StepExecutor", () => {
  function mockTask(overrides: Partial<Task> = {}): Task {
    return {
      id: "task-123",
      title: "Test Task",
      instructions: "Do something",
      type: "immediate",
      status: "running",
      source: { type: "web" },
      createdBy: "user",
      created: new Date(),
      updated: new Date(),
      logPath: "/tmp/test.log",
      steps: null,
      currentStep: null,
      scheduledFor: null,
      ...overrides,
    };
  }

  describe("executeDeliverySteps", () => {
    it("returns empty results when task has no steps", async () => {
      const executor = new StepExecutor(null);
      const task = mockTask({ steps: null });

      const result = await executor.executeDeliverySteps(task, "Some content");

      expect(result.allSucceeded).toBe(true);
      expect(result.results).toEqual([]);
    });

    it("skips completed steps", async () => {
      const executor = new StepExecutor(null);
      const task = mockTask({
        steps: `- [x] Research topic
- [x] Send via WhatsApp`,
      });

      const result = await executor.executeDeliverySteps(task, "Content");

      expect(result.results).toEqual([]);
    });

    it("skips non-delivery steps", async () => {
      const executor = new StepExecutor(null);
      const task = mockTask({
        steps: `- [ ] Research topic
- [ ] Compile findings`,
      });

      const result = await executor.executeDeliverySteps(task, "Content");

      expect(result.results).toEqual([]);
    });

    it("returns error when channelManager is null", async () => {
      const executor = new StepExecutor(null);
      const task = mockTask({
        steps: `- [ ] Send via WhatsApp`,
      });

      const result = await executor.executeDeliverySteps(task, "Content");

      expect(result.allSucceeded).toBe(false);
      expect(result.results.length).toBe(1);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toContain("Channel manager not available");
    });

    it("returns error when no WhatsApp channel configured", async () => {
      const mockChannelManager = {
        getChannelInfos: () => [],
        getChannelConfig: () => undefined,
        send: vi.fn(),
      } as unknown as ChannelManager;

      const executor = new StepExecutor(mockChannelManager);
      const task = mockTask({
        steps: `- [ ] Send via WhatsApp`,
      });

      const result = await executor.executeDeliverySteps(task, "Content");

      expect(result.allSucceeded).toBe(false);
      expect(result.results[0].error).toContain("No WhatsApp channel configured");
    });

    it("returns error when no owner configured", async () => {
      const mockChannelManager = {
        getChannelInfos: () => [{ id: "test-wa", plugin: "baileys" }],
        getChannelConfig: () => ({ ownerIdentities: [] }),
        send: vi.fn(),
      } as unknown as ChannelManager;

      const executor = new StepExecutor(mockChannelManager);
      const task = mockTask({
        steps: `- [ ] Send via WhatsApp`,
      });

      const result = await executor.executeDeliverySteps(task, "Content");

      expect(result.allSucceeded).toBe(false);
      expect(result.results[0].error).toContain("No owner configured");
    });

    it("sends WhatsApp message successfully", async () => {
      const sendMock = vi.fn().mockResolvedValue(undefined);
      const mockChannelManager = {
        getChannelInfos: () => [{ id: "ninas_whatsapp", plugin: "baileys" }],
        getChannelConfig: () => ({
          ownerIdentities: ["owner@s.whatsapp.net"],
        }),
        send: sendMock,
      } as unknown as ChannelManager;

      const executor = new StepExecutor(mockChannelManager);
      const task = mockTask({
        title: "Research Report",
        steps: `- [x] Research topic
- [ ] Send via WhatsApp`,
      });

      const result = await executor.executeDeliverySteps(
        task,
        "Here are the findings...",
      );

      expect(result.allSucceeded).toBe(true);
      expect(result.results.length).toBe(1);
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].stepNumber).toBe(2);

      expect(sendMock).toHaveBeenCalledOnce();
      expect(sendMock).toHaveBeenCalledWith(
        "ninas_whatsapp",
        "owner@s.whatsapp.net",
        expect.objectContaining({
          content: expect.stringContaining("Research Report"),
        }),
      );
    });

    it("handles send failure gracefully", async () => {
      const sendMock = vi.fn().mockRejectedValue(new Error("Network error"));
      const mockChannelManager = {
        getChannelInfos: () => [{ id: "test-wa", plugin: "baileys" }],
        getChannelConfig: () => ({
          ownerIdentities: ["owner@s.whatsapp.net"],
        }),
        send: sendMock,
      } as unknown as ChannelManager;

      const executor = new StepExecutor(mockChannelManager);
      const task = mockTask({
        steps: `- [ ] Send via WhatsApp`,
      });

      const result = await executor.executeDeliverySteps(task, "Content");

      expect(result.allSucceeded).toBe(false);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toBe("Network error");
    });

    it("processes multiple delivery steps", async () => {
      const sendMock = vi.fn().mockResolvedValue(undefined);
      const mockChannelManager = {
        getChannelInfos: () => [{ id: "test-wa", plugin: "baileys" }],
        getChannelConfig: () => ({
          ownerIdentities: ["owner@s.whatsapp.net"],
        }),
        send: sendMock,
      } as unknown as ChannelManager;

      const executor = new StepExecutor(mockChannelManager);
      const task = mockTask({
        steps: `- [ ] Send WhatsApp message
- [ ] Send another message via whatsapp`,
      });

      const result = await executor.executeDeliverySteps(task, "Content");

      expect(result.allSucceeded).toBe(true);
      expect(result.results.length).toBe(2);
      expect(sendMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("email delivery", () => {
    it("returns not implemented error for email", async () => {
      const mockChannelManager = {
        getChannelInfos: () => [],
        getChannelConfig: () => undefined,
        send: vi.fn(),
      } as unknown as ChannelManager;

      const executor = new StepExecutor(mockChannelManager);
      const task = mockTask({
        steps: `- [ ] Email the report`,
      });

      const result = await executor.executeDeliverySteps(task, "Content");

      expect(result.allSucceeded).toBe(false);
      expect(result.results[0].error).toContain("Email delivery not yet implemented");
    });
  });
});
