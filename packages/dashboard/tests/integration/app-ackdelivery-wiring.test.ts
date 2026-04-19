import { describe, it, expect, vi } from "vitest";
import { AckDelivery } from "@my-agent/core";
import type { AutomationNotifierLike } from "@my-agent/core";

describe("app.ts — AckDelivery notifier wiring [S3]", () => {
  it("AckDelivery with notifier: fixed-outcome fires notifier.notify", async () => {
    // This mirrors what app.ts boots: AckDelivery(transport, registry, automationNotifier)
    const notifyFn = vi.fn().mockResolvedValue(undefined);
    const notifier: AutomationNotifierLike = { notify: notifyFn };

    const transport = { send: vi.fn() } as any;
    const registry = { broadcastToConversation: vi.fn() } as any;

    const delivery = new AckDelivery(transport, registry, notifier);
    vi.spyOn(delivery, "writeAutomationRecovery").mockReturnValue("/tmp/run/CFR_RECOVERY.md");

    await delivery.deliver(
      {
        id: "cfr-1",
        capabilityType: "audio-to-text",
        symptom: "execution-error",
        detail: "test",
        detectedAt: new Date().toISOString(),
        triggeringInput: {
          origin: {
            kind: "automation",
            automationId: "auto-1",
            jobId: "job-1",
            runDir: "/tmp/run",
            notifyMode: "immediate",
          },
        },
      } as any,
      "fixed!",
      { kind: "terminal-fixed" },
    );

    expect(notifyFn).toHaveBeenCalledOnce();
    expect(notifyFn).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "fixed",
      automationId: "auto-1",
    }));
  });

  it("AckDelivery without notifier: no error thrown on fixed-outcome", async () => {
    const transport = { send: vi.fn() } as any;
    const registry = { broadcastToConversation: vi.fn() } as any;
    const delivery = new AckDelivery(transport, registry); // no notifier
    vi.spyOn(delivery, "writeAutomationRecovery").mockReturnValue("/tmp/run/CFR_RECOVERY.md");

    await expect(
      delivery.deliver(
        {
          id: "cfr-1",
          capabilityType: "audio-to-text",
          symptom: "execution-error",
          detail: "test",
          detectedAt: new Date().toISOString(),
          triggeringInput: {
            origin: {
              kind: "automation",
              automationId: "auto-1",
              jobId: "job-1",
              runDir: "/tmp/run",
              notifyMode: "immediate",
            },
          },
        } as any,
        "fixed!",
        { kind: "terminal-fixed" },
      )
    ).resolves.not.toThrow();
  });
});
