import { describe, it, expect, vi } from "vitest";
import { AckDelivery } from "@my-agent/core";
import type { AutomationNotifierLike } from "@my-agent/core";
import type { CapabilityFailure } from "@my-agent/core";

function makeAutomationFailure(notifyMode: "immediate" | "debrief" | "none" = "immediate"): CapabilityFailure {
  return {
    id: "cfr-auto-1",
    capabilityType: "audio-to-text",
    symptom: "execution-error",
    detail: "test",
    detectedAt: new Date().toISOString(),
    triggeringInput: {
      origin: {
        kind: "automation",
        automationId: "auto-1",
        jobId: "job-1",
        runDir: "/tmp/cfr-test-run",
        notifyMode,
      },
    },
  } as unknown as CapabilityFailure;
}

function makeTransportManager() {
  return { send: vi.fn() } as any;
}

function makeConnectionRegistry() {
  return { broadcastToConversation: vi.fn() } as any;
}

describe("AckDelivery — automation-origin notifier", () => {
  it("fixed-outcome with notifyMode=immediate calls notifier with outcome=fixed", async () => {
    const notifier: AutomationNotifierLike = { notify: vi.fn().mockResolvedValue(undefined) };
    const delivery = new AckDelivery(makeTransportManager(), makeConnectionRegistry(), notifier);
    vi.spyOn(delivery, "writeAutomationRecovery").mockReturnValue("/tmp/cfr-test-run/CFR_RECOVERY.md");

    await delivery.deliver(makeAutomationFailure("immediate"), "voice transcription is fixed", {
      kind: "terminal-fixed",
    });

    expect(delivery.writeAutomationRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "fixed" }),
    );
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "fixed" }),
    );
  });

  it("surrendered-outcome with notifyMode=immediate calls notifier with outcome=surrendered", async () => {
    const notifier: AutomationNotifierLike = { notify: vi.fn().mockResolvedValue(undefined) };
    const delivery = new AckDelivery(makeTransportManager(), makeConnectionRegistry(), notifier);
    vi.spyOn(delivery, "writeAutomationRecovery").mockReturnValue("/tmp/cfr-test-run/CFR_RECOVERY.md");

    await delivery.deliver(makeAutomationFailure("immediate"), "couldn't fix it", {
      kind: "surrender",
    });

    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "surrendered" }),
    );
  });

  it("missing notifier degrades gracefully — no exception thrown", async () => {
    const delivery = new AckDelivery(makeTransportManager(), makeConnectionRegistry());
    vi.spyOn(delivery, "writeAutomationRecovery").mockReturnValue("/tmp/cfr-test-run/CFR_RECOVERY.md");

    await expect(
      delivery.deliver(makeAutomationFailure("immediate"), "couldn't fix it", { kind: "terminal-fixed" }),
    ).resolves.not.toThrow();
  });

  it("notifyMode=debrief does NOT call notifier at terminal time", async () => {
    const notifier: AutomationNotifierLike = { notify: vi.fn().mockResolvedValue(undefined) };
    const delivery = new AckDelivery(makeTransportManager(), makeConnectionRegistry(), notifier);
    vi.spyOn(delivery, "writeAutomationRecovery").mockReturnValue("/tmp/cfr-test-run/CFR_RECOVERY.md");

    await delivery.deliver(makeAutomationFailure("debrief"), "text", { kind: "terminal-fixed" });

    expect(notifier.notify).not.toHaveBeenCalled();
  });
});
