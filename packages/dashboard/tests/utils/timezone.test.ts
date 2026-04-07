import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@my-agent/core", () => ({
  loadPreferences: vi.fn(),
}));

import { resolveTimezone } from "../../src/utils/timezone.js";
import { loadPreferences } from "@my-agent/core";

describe("resolveTimezone", () => {
  const agentDir = "/tmp/test-agent";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns timezone from config preferences", async () => {
    (loadPreferences as any).mockReturnValue({ timezone: "Asia/Bangkok" });
    expect(await resolveTimezone(agentDir)).toBe("Asia/Bangkok");
  });

  it("falls back to UTC when no timezone configured", async () => {
    (loadPreferences as any).mockReturnValue({});
    expect(await resolveTimezone(agentDir)).toBe("UTC");
  });

  it("falls back to UTC when loadPreferences throws", async () => {
    (loadPreferences as any).mockImplementation(() => {
      throw new Error("no config");
    });
    expect(await resolveTimezone(agentDir)).toBe("UTC");
  });
});
