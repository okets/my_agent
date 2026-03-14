import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/conversations/properties.js", () => ({
  readProperties: vi.fn(),
}));

vi.mock("@my-agent/core", () => ({
  loadPreferences: vi.fn(),
}));

import { resolveTimezone } from "../../src/utils/timezone.js";
import { readProperties } from "../../src/conversations/properties.js";
import { loadPreferences } from "@my-agent/core";

describe("resolveTimezone", () => {
  const agentDir = "/tmp/test-agent";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns timezone from properties when available", async () => {
    (readProperties as any).mockResolvedValue({
      timezone: { value: "Asia/Bangkok (UTC+7)" },
    });
    expect(await resolveTimezone(agentDir)).toBe("Asia/Bangkok");
  });

  it("falls back to preferences when properties unavailable", async () => {
    (readProperties as any).mockResolvedValue({});
    (loadPreferences as any).mockReturnValue({ timezone: "Europe/London" });
    expect(await resolveTimezone(agentDir)).toBe("Europe/London");
  });

  it("falls back to UTC when nothing configured", async () => {
    (readProperties as any).mockResolvedValue({});
    (loadPreferences as any).mockReturnValue({});
    expect(await resolveTimezone(agentDir)).toBe("UTC");
  });

  it("strips parenthetical from properties timezone", async () => {
    (readProperties as any).mockResolvedValue({
      timezone: { value: "America/New_York (Eastern Time)" },
    });
    expect(await resolveTimezone(agentDir)).toBe("America/New_York");
  });
});
