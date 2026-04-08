import { describe, it, expect } from "vitest";

/**
 * Tests the auto-fire guard logic from automation-server.ts.
 *
 * The guard: `args.once && args.trigger.every(t => t.type === 'manual')`
 * determines whether a newly created automation fires immediately.
 *
 * Only once:true + all-manual-triggers should auto-fire.
 */

interface Trigger {
  type: "manual" | "schedule" | "watch" | "channel";
  cron?: string;
}

function shouldAutoFire(once: boolean | undefined, triggers: Trigger[]): boolean {
  return !!once && triggers.every((t) => t.type === "manual");
}

describe("auto-fire guard logic", () => {
  it("fires when once:true and all triggers are manual", () => {
    expect(shouldAutoFire(true, [{ type: "manual" }])).toBe(true);
  });

  it("fires when once:true and multiple manual triggers", () => {
    expect(shouldAutoFire(true, [{ type: "manual" }, { type: "manual" }])).toBe(true);
  });

  it("does NOT fire when trigger includes schedule", () => {
    expect(
      shouldAutoFire(true, [{ type: "schedule", cron: "*/5 * * * *" }]),
    ).toBe(false);
  });

  it("does NOT fire when trigger mixes manual and schedule", () => {
    expect(
      shouldAutoFire(true, [
        { type: "manual" },
        { type: "schedule", cron: "0 8 * * *" },
      ]),
    ).toBe(false);
  });

  it("does NOT fire when once is false", () => {
    expect(shouldAutoFire(false, [{ type: "manual" }])).toBe(false);
  });

  it("does NOT fire when once is undefined", () => {
    expect(shouldAutoFire(undefined, [{ type: "manual" }])).toBe(false);
  });

  it("does NOT fire for watch triggers", () => {
    expect(shouldAutoFire(true, [{ type: "watch" }])).toBe(false);
  });

  it("does NOT fire for channel triggers", () => {
    expect(shouldAutoFire(true, [{ type: "channel" }])).toBe(false);
  });
});
