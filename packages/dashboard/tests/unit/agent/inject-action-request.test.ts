import { describe, it, expect, vi } from "vitest";
import { SessionManager } from "../../../src/agent/session-manager.js";

describe("SessionManager.injectActionRequest() — M9.4-S4.2 Task 3", () => {
  it("calls streamMessage with the bare prompt — no [SYSTEM:] wrap", async () => {
    const sm = Object.create(SessionManager.prototype) as SessionManager;
    const streamSpy = vi.fn(async function* () {
      yield { type: "text_delta" as const, text: "ok" };
    });
    (sm as any).streamMessage = streamSpy;

    const events: unknown[] = [];
    for await (const e of (sm as any).injectActionRequest("deliver brief now")) {
      events.push(e);
    }

    expect(streamSpy).toHaveBeenCalledTimes(1);
    expect(streamSpy.mock.calls[0][0]).toBe("deliver brief now");
    expect(streamSpy.mock.calls[0][0]).not.toMatch(/^\[SYSTEM:/);
    expect(events).toEqual([{ type: "text_delta", text: "ok" }]);
  });

  it("differs from injectSystemTurn — injectSystemTurn keeps [SYSTEM:] wrap", async () => {
    const sm = Object.create(SessionManager.prototype) as SessionManager;
    const streamSpy = vi.fn(async function* () {
      yield { type: "done" as const };
    });
    (sm as any).streamMessage = streamSpy;

    for await (const _ of (sm as any).injectSystemTurn("alert content")) {
      void _;
    }

    expect(streamSpy.mock.calls[0][0]).toBe("[SYSTEM: alert content]");
  });

  it("forwards every event from streamMessage in order", async () => {
    const sm = Object.create(SessionManager.prototype) as SessionManager;
    const events = [
      { type: "session_init" as const, sessionId: "s1" },
      { type: "text_delta" as const, text: "Hello" },
      { type: "text_delta" as const, text: " world" },
      { type: "done" as const },
    ];
    (sm as any).streamMessage = vi.fn(async function* () {
      for (const e of events) yield e;
    });

    const collected: unknown[] = [];
    for await (const e of (sm as any).injectActionRequest("present brief")) {
      collected.push(e);
    }

    expect(collected).toEqual(events);
  });
});
