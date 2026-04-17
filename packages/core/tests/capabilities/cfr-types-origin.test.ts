/**
 * S9 acceptance test — TriggeringOrigin discriminated union.
 *
 * Verifies:
 *   1. conversationOrigin() factory produces the correct shape.
 *   2. Narrowing via `origin.kind` gives TypeScript-level exhaustiveness
 *      (enforced by the `never` check helper below).
 *   3. TriggeringInput only exposes `origin` + optional `artifact` + optional
 *      `userUtterance` — the old flat fields (channel, conversationId,
 *      turnNumber) do NOT exist on the type.
 *   4. All three variant shapes are structurally correct.
 */

import { describe, it, expect } from "vitest";
import type { TriggeringInput, TriggeringOrigin, ChannelContext } from "../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";

function assertNever(_x: never): never {
  throw new Error("assertNever reached — exhaustiveness check failed");
}

describe("TriggeringOrigin — type landing (S9)", () => {
  it("conversationOrigin() factory produces correct shape", () => {
    const channel: ChannelContext = {
      transportId: "whatsapp",
      channelId: "ch-1",
      sender: "+10000000001",
      replyTo: "msg-0",
    };
    const origin = conversationOrigin(channel, "conv-A", 3);

    expect(origin.kind).toBe("conversation");
    if (origin.kind !== "conversation") throw new Error("unreachable");
    expect(origin.channel.transportId).toBe("whatsapp");
    expect(origin.conversationId).toBe("conv-A");
    expect(origin.turnNumber).toBe(3);
  });

  it("TriggeringInput accepts origin + artifact, rejects old flat fields", () => {
    const input: TriggeringInput = {
      origin: conversationOrigin(
        { transportId: "dashboard", channelId: "dashboard", sender: "user" },
        "conv-B",
        1,
      ),
      artifact: {
        type: "audio",
        rawMediaPath: "/tmp/test.ogg",
        mimeType: "audio/ogg",
      },
    };

    expect(input.origin.kind).toBe("conversation");
    expect(input.artifact?.type).toBe("audio");

    // Old flat fields must not exist on TriggeringInput — TypeScript-level check.
    // @ts-expect-error — channel is no longer a direct field on TriggeringInput
    const _channel = input.channel;
    // @ts-expect-error — conversationId is no longer a direct field on TriggeringInput
    const _convId = input.conversationId;
    // @ts-expect-error — turnNumber is no longer a direct field on TriggeringInput
    const _turn = input.turnNumber;
    void _channel; void _convId; void _turn;
  });

  it("switch narrows all three variants without TS error", () => {
    const origins: TriggeringOrigin[] = [
      { kind: "conversation", channel: { transportId: "t", channelId: "c", sender: "s" }, conversationId: "conv-A", turnNumber: 1 },
      { kind: "automation", automationId: "aut-1", jobId: "job-1", runDir: "/tmp/run", notifyMode: "debrief" },
      { kind: "system", component: "scheduler" },
    ];

    for (const origin of origins) {
      switch (origin.kind) {
        case "conversation":
          expect(origin.conversationId).toBeDefined();
          expect(origin.turnNumber).toBeGreaterThanOrEqual(0);
          break;
        case "automation":
          expect(origin.automationId).toBeDefined();
          expect(["immediate", "debrief", "none"]).toContain(origin.notifyMode);
          break;
        case "system":
          expect(origin.component).toBeDefined();
          break;
        default:
          assertNever(origin); // TypeScript exhaustiveness — compile-time check
      }
    }
  });

  it("automation origin has the expected fields", () => {
    const origin: TriggeringOrigin = {
      kind: "automation",
      automationId: "aut-abc",
      jobId: "job-xyz",
      runDir: "/tmp/jobs/job-xyz",
      notifyMode: "immediate",
    };
    if (origin.kind !== "automation") throw new Error("unreachable");
    expect(origin.automationId).toBe("aut-abc");
    expect(origin.runDir).toBe("/tmp/jobs/job-xyz");
    expect(origin.notifyMode).toBe("immediate");
  });

  it("system origin has the expected fields", () => {
    const origin: TriggeringOrigin = { kind: "system", component: "health-check" };
    if (origin.kind !== "system") throw new Error("unreachable");
    expect(origin.component).toBe("health-check");
  });
});
