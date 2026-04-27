import { describe, it, expect } from "vitest";
import { sendActionRequest } from "../../../src/chat/send-action-request.js";
import type { ChatEvent } from "../../../src/chat/types.js";

// Minimal App mock — mirrors send-system-message.test.ts but tracks which
// inject* method the chat path called, to verify routing.
function createMockApp(options?: {
  isStreaming?: boolean;
  response?: string;
  sessionId?: string;
}) {
  const response = options?.response ?? "Brain response";
  const appendedTurns: Array<{ id: string; turn: any }> = [];
  const emittedEvents: Array<{ event: string; args: any[] }> = [];
  let storedSdkSessionId: string | null = null;
  let lastInjectionKind: "system" | "action_request" | null = null;
  let lastInjectedPrompt: string | null = null;

  const mockSessionManager = {
    isStreaming: () => options?.isStreaming ?? false,
    async *injectSystemTurn(prompt: string) {
      lastInjectionKind = "system";
      lastInjectedPrompt = prompt;
      yield { type: "text_delta" as const, text: response };
    },
    async *injectActionRequest(prompt: string) {
      lastInjectionKind = "action_request";
      lastInjectedPrompt = prompt;
      yield { type: "text_delta" as const, text: response };
    },
    getSessionId: () => options?.sessionId ?? "sdk-123",
  };

  return {
    app: {
      conversationManager: {
        getConversationDb: () => ({
          getSdkSessionId: (_id: string) => null,
          updateSdkSessionId: (_id: string, sid: string | null) => {
            storedSdkSessionId = sid;
          },
        }),
        appendTurn: async (id: string, turn: any) => {
          appendedTurns.push({ id, turn });
        },
      },
      sessionRegistry: {
        getOrCreate: async () => mockSessionManager,
      },
      emit: (event: string, ...args: any[]) => {
        emittedEvents.push({ event, args });
      },
    } as any,
    appendedTurns,
    emittedEvents,
    getStoredSdkSessionId: () => storedSdkSessionId,
    getInjectionKind: () => lastInjectionKind,
    getInjectedPrompt: () => lastInjectedPrompt,
  };
}

async function collectEvents(
  gen: AsyncGenerator<ChatEvent>,
): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe("sendActionRequest()", () => {
  it("routes through injectActionRequest (NOT injectSystemTurn)", async () => {
    const { app, getInjectionKind } = createMockApp();
    await collectEvents(sendActionRequest(app, "conv-1", "deliver brief", 1));
    expect(getInjectionKind()).toBe("action_request");
  });

  it("does NOT pre-wrap the prompt in [SYSTEM:]", async () => {
    const { app, getInjectedPrompt } = createMockApp();
    await collectEvents(
      sendActionRequest(app, "conv-1", "Brief delivery time. Deliverable: …", 1),
    );
    const prompt = getInjectedPrompt();
    expect(prompt).not.toBeNull();
    expect(prompt).not.toMatch(/^\[SYSTEM:/);
    expect(prompt).toBe("Brief delivery time. Deliverable: …");
  });

  it("streams brain response and yields ChatEvents", async () => {
    const { app } = createMockApp({ response: "Hello from brain" });
    const events = await collectEvents(
      sendActionRequest(app, "conv-1", "test prompt", 3),
    );
    expect(events[0].type).toBe("start");
    expect(events[1]).toEqual({ type: "text_delta", text: "Hello from brain" });
    expect(events[2].type).toBe("done");
  });

  it("saves assistant turn with correct turnNumber and channel", async () => {
    const { app, appendedTurns } = createMockApp({ response: "Response" });
    await collectEvents(
      sendActionRequest(app, "conv-1", "prompt", 5, { channel: "whatsapp" }),
    );
    expect(appendedTurns).toHaveLength(1);
    expect(appendedTurns[0].id).toBe("conv-1");
    expect(appendedTurns[0].turn.role).toBe("assistant");
    expect(appendedTurns[0].turn.content).toBe("Response");
    expect(appendedTurns[0].turn.turnNumber).toBe(5);
    expect(appendedTurns[0].turn.channel).toBe("whatsapp");
  });

  it("does not save turn when brain returns empty response", async () => {
    const { app, appendedTurns } = createMockApp({ response: "" });
    await collectEvents(sendActionRequest(app, "conv-1", "prompt", 1));
    expect(appendedTurns).toHaveLength(0);
  });

  it("persists SDK session ID", async () => {
    const { app, getStoredSdkSessionId } = createMockApp({
      sessionId: "sdk-456",
    });
    await collectEvents(sendActionRequest(app, "conv-1", "prompt", 1));
    expect(getStoredSdkSessionId()).toBe("sdk-456");
  });

  it("emits chat:start, chat:text_delta, and chat:done App events", async () => {
    const { app, emittedEvents } = createMockApp();
    await collectEvents(sendActionRequest(app, "conv-1", "prompt", 1));
    expect(emittedEvents).toHaveLength(3);
    expect(emittedEvents[0].event).toBe("chat:start");
    expect(emittedEvents[1].event).toBe("chat:text_delta");
    expect(emittedEvents[2].event).toBe("chat:done");
  });

  it("yields { type: 'start', triggerJobId } when option passed", async () => {
    const { app } = createMockApp();
    const events = await collectEvents(
      sendActionRequest(app, "conv-1", "prompt", 1, { triggerJobId: "job-abc" }),
    );
    expect(events[0]).toMatchObject({ type: "start", triggerJobId: "job-abc" });
  });

  it("skips when session is busy streaming", async () => {
    const { app, appendedTurns, emittedEvents } = createMockApp({
      isStreaming: true,
    });
    const events = await collectEvents(
      sendActionRequest(app, "conv-1", "prompt", 1),
    );
    expect(events).toHaveLength(0);
    expect(appendedTurns).toHaveLength(0);
    expect(emittedEvents).toHaveLength(0);
  });
});
