import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock createBrainQuery to avoid real API calls
const mockBrainQuery = vi.fn();
vi.mock("@my-agent/core", () => ({
  createBrainQuery: (...args: unknown[]) => mockBrainQuery(...args),
  loadModels: () => ({ haiku: "claude-haiku-4-5-20251001" }),
}));

import {
  extractTaskFromMessage,
  type AutomationHint,
} from "../../src/automations/automation-extractor.js";

/** Helper: make the mock return a specific JSON string */
function mockHaikuResponse(json: Record<string, unknown>): void {
  const text = JSON.stringify(json);
  mockBrainQuery.mockReturnValue(
    (async function* () {
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text }] },
      };
      yield { type: "result" };
    })(),
  );
}

const invoiceHints: AutomationHint[] = [
  {
    id: "invoice-processor",
    name: "Process Invoice",
    hints: "invoice, receipt, bill, payment",
    description: "Process incoming invoices and extract key data",
  },
];

describe("AutomationExtractor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("matches a message to an automation hint", async () => {
    mockHaikuResponse({
      shouldCreateTask: false,
      matchedAutomation: {
        automationId: "invoice-processor",
        confidence: 0.95,
        extractedContext: { vendor: "Acme Corp", amount: 150 },
      },
    });

    const result = await extractTaskFromMessage(
      "Here is my invoice from Acme Corp for $150",
      undefined,
      invoiceHints,
    );

    expect(result.shouldCreateTask).toBe(false);
    expect(result.matchedAutomation).toBeDefined();
    expect(result.matchedAutomation!.automationId).toBe("invoice-processor");
    expect(result.matchedAutomation!.confidence).toBe(0.95);
    expect(result.matchedAutomation!.extractedContext).toEqual({
      vendor: "Acme Corp",
      amount: 150,
    });
  });

  it("returns extractedContext with structured data", async () => {
    mockHaikuResponse({
      shouldCreateTask: false,
      matchedAutomation: {
        automationId: "invoice-processor",
        confidence: 0.9,
        extractedContext: {
          vendor: "CloudFlare",
          amount: 50,
          currency: "USD",
        },
      },
    });

    const result = await extractTaskFromMessage(
      "Process this CloudFlare bill: $50 USD",
      undefined,
      invoiceHints,
    );

    expect(result.matchedAutomation!.extractedContext).toEqual({
      vendor: "CloudFlare",
      amount: 50,
      currency: "USD",
    });
  });

  it("preserves existing task extraction when no automation matches", async () => {
    mockHaikuResponse({
      shouldCreateTask: true,
      task: {
        title: "Research Bangkok attractions",
        instructions: "Research Bangkok",
        work: [{ description: "Research" }],
        delivery: [{ channel: "dashboard" }],
        type: "immediate",
      },
    });

    const result = await extractTaskFromMessage(
      "Research Bangkok attractions",
      undefined,
      invoiceHints,
    );

    expect(result.shouldCreateTask).toBe(true);
    expect(result.task).toBeDefined();
    expect(result.matchedAutomation).toBeUndefined();
  });

  it("works without automation hints (backward compat)", async () => {
    mockHaikuResponse({
      shouldCreateTask: true,
      task: {
        title: "Send reminder",
        instructions: "Send a reminder",
        work: [],
        delivery: [{ channel: "whatsapp" }],
        type: "immediate",
      },
    });

    const result = await extractTaskFromMessage("Remind me to call mom");

    expect(result.shouldCreateTask).toBe(true);
    expect(result.task).toBeDefined();
  });

  it("passes automation hints to the system prompt", async () => {
    mockHaikuResponse({ shouldCreateTask: false });

    await extractTaskFromMessage("Hello", undefined, invoiceHints);

    // Verify that createBrainQuery was called with a system prompt containing the hint
    const callArgs = mockBrainQuery.mock.calls[0];
    const options = callArgs[1];
    expect(options.systemPrompt).toContain("ACTIVE AUTOMATIONS");
    expect(options.systemPrompt).toContain("invoice-processor");
    expect(options.systemPrompt).toContain("invoice, receipt, bill, payment");
  });

  it("does not include automation section in prompt when no hints provided", async () => {
    mockHaikuResponse({ shouldCreateTask: false });

    await extractTaskFromMessage("Hello");

    const callArgs = mockBrainQuery.mock.calls[0];
    const options = callArgs[1];
    expect(options.systemPrompt).not.toContain("ACTIVE AUTOMATIONS");
  });

  it("handles matchedAutomation with missing extractedContext gracefully", async () => {
    mockHaikuResponse({
      shouldCreateTask: false,
      matchedAutomation: {
        automationId: "invoice-processor",
        confidence: 0.8,
      },
    });

    const result = await extractTaskFromMessage(
      "Here is an invoice",
      undefined,
      invoiceHints,
    );

    expect(result.matchedAutomation!.extractedContext).toEqual({});
  });
});
