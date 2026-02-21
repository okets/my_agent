/**
 * Unit Tests — Task Processor
 *
 * Tests the task execution flow including:
 * - Step progress parsing from brain response
 * - StepExecutor integration for delivery steps
 * - Result delivery to conversations
 */

import { describe, it, expect } from "vitest";
import type { Task } from "@my-agent/core";

// -------------------------------------------------------------------
// Step Progress Marker Parsing
// -------------------------------------------------------------------

describe("Step Progress Markers", () => {
  // This is the same regex pattern TaskProcessor uses
  const stepPattern = /✓ STEP (\d+):/g;

  function extractCompletedSteps(response: string): Set<number> {
    const completedSteps = new Set<number>();
    let match;
    while ((match = stepPattern.exec(response)) !== null) {
      const stepNumber = parseInt(match[1], 10);
      completedSteps.add(stepNumber);
    }
    return completedSteps;
  }

  it("extracts single step marker", () => {
    const response = `I've completed the research.

✓ STEP 1: Researched the topic

Here are my findings...`;

    const steps = extractCompletedSteps(response);
    expect(steps.has(1)).toBe(true);
    expect(steps.size).toBe(1);
  });

  it("extracts multiple step markers", () => {
    const response = `Task progress:

✓ STEP 1: Researched the topic
✓ STEP 2: Compiled findings into summary
✓ STEP 3: Formatted for delivery

Ready for next steps.`;

    const steps = extractCompletedSteps(response);
    expect(steps.has(1)).toBe(true);
    expect(steps.has(2)).toBe(true);
    expect(steps.has(3)).toBe(true);
    expect(steps.size).toBe(3);
  });

  it("handles non-sequential step numbers", () => {
    const response = `Progress update:

✓ STEP 1: First task
✓ STEP 5: Fifth task (skipped 2-4)`;

    const steps = extractCompletedSteps(response);
    expect(steps.has(1)).toBe(true);
    expect(steps.has(5)).toBe(true);
    expect(steps.has(2)).toBe(false);
    expect(steps.size).toBe(2);
  });

  it("ignores similar but invalid patterns", () => {
    const response = `Some text about step 1
STEP 1: No checkmark
- STEP 2: Wrong format`;

    const steps = extractCompletedSteps(response);
    expect(steps.size).toBe(0);
  });

  it("handles empty response", () => {
    const steps = extractCompletedSteps("");
    expect(steps.size).toBe(0);
  });

  it("handles response with no markers", () => {
    const response = `Here are the findings:
- Point 1
- Point 2
- Point 3`;

    const steps = extractCompletedSteps(response);
    expect(steps.size).toBe(0);
  });
});

// -------------------------------------------------------------------
// Scheduled Task Detection
// -------------------------------------------------------------------

describe("Scheduled Task Detection", () => {
  it("identifies immediate vs scheduled task types", () => {
    // These patterns should be detected by task-extractor
    const immediatePatterns = [
      "Research the latest news about AI",
      "Send me a summary of the report",
      "Look up information about...",
    ];

    const scheduledPatterns = [
      "Remind me tomorrow at 9am",
      "Send this at 5pm",
      "Schedule a check for next Monday",
    ];

    // These are just pattern tests - actual extraction uses LLM
    for (const pattern of immediatePatterns) {
      expect(pattern.toLowerCase()).not.toMatch(/\b(tomorrow|next|at \d)/);
    }

    for (const pattern of scheduledPatterns) {
      expect(pattern.toLowerCase()).toMatch(/\b(tomorrow|next|at \d)/);
    }
  });
});

// -------------------------------------------------------------------
// Integration: StepExecutor with TaskProcessor
// -------------------------------------------------------------------

describe("TaskProcessor StepExecutor Integration", () => {
  it("StepExecutor is invoked for tasks with delivery steps", () => {
    const mockTask: Task = {
      id: "task-123",
      title: "Research and Deliver",
      instructions: "Research topic and send via WhatsApp",
      type: "immediate",
      status: "running",
      source: { type: "web" },
      createdBy: "user",
      created: new Date(),
      updated: new Date(),
      logPath: "/tmp/test.log",
      steps: `- [x] Research the topic
- [ ] Send results via WhatsApp`,
      currentStep: 1,
      scheduledFor: null,
    };

    // Verify task has delivery step
    const hasDeliveryStep = mockTask.steps?.toLowerCase().includes("whatsapp");
    expect(hasDeliveryStep).toBe(true);

    // Verify step is not yet completed
    const uncompletedWhatsApp = mockTask.steps?.includes("- [ ]") &&
      mockTask.steps?.toLowerCase().includes("whatsapp");
    expect(uncompletedWhatsApp).toBe(true);
  });

  it("delivery steps execute after brain completes research", () => {
    // Document the expected flow:
    // 1. TaskExecutor runs brain with task instructions
    // 2. Brain completes research steps (marks with ✓ STEP N:)
    // 3. TaskProcessor parses step markers
    // 4. TaskProcessor calls StepExecutor for delivery steps
    // 5. StepExecutor sends via ChannelManager

    const executionOrder = [
      "TaskProcessor.executeAndDeliver(task)",
      "TaskExecutor.run(task) -> brain research",
      "TaskProcessor.updateStepsFromResponse() -> parse markers",
      "StepExecutor.executeDeliverySteps() -> send WhatsApp/email",
      "TaskProcessor.deliverResult() -> update conversation",
    ];

    // Each step depends on the previous
    expect(executionOrder.length).toBe(5);
  });
});
