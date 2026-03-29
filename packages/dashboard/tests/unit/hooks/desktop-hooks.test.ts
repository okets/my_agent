import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createDesktopRateLimiter,
  createDesktopAuditLogger,
} from "../../../src/hooks/desktop-hooks.js";

describe("desktop-hooks", () => {
  describe("createDesktopRateLimiter", () => {
    it("allows invocations within the limit", () => {
      const limiter = createDesktopRateLimiter({ maxPerMinute: 5 });

      for (let i = 0; i < 5; i++) {
        const result = limiter.check();
        expect(result.allowed).toBe(true);
      }
    });

    it("blocks invocations that exceed the limit", () => {
      const limiter = createDesktopRateLimiter({ maxPerMinute: 3 });

      limiter.check();
      limiter.check();
      limiter.check();

      const result = limiter.check();
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason).toMatch(/rate limit exceeded/i);
    });

    it("resets after one minute (sliding window)", () => {
      vi.useFakeTimers();

      try {
        const limiter = createDesktopRateLimiter({ maxPerMinute: 2 });

        // Fill the limit at t=0
        limiter.check();
        limiter.check();

        // 4th check should be blocked
        expect(limiter.check().allowed).toBe(false);

        // Advance time by 61 seconds — all prior timestamps fall outside the window
        vi.advanceTimersByTime(61_000);

        // Now the window is clear — should be allowed again
        const result = limiter.check();
        expect(result.allowed).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("createDesktopAuditLogger", () => {
    it("calls the sink with the provided entry", () => {
      const sink = vi.fn();
      const logger = createDesktopAuditLogger(sink);

      const entry = {
        tool: "desktop_task",
        instruction: "Open Firefox",
        timestamp: "2026-03-29T12:00:00.000Z",
      };

      logger.log(entry);

      expect(sink).toHaveBeenCalledOnce();
      expect(sink).toHaveBeenCalledWith(expect.objectContaining({
        tool: "desktop_task",
        instruction: "Open Firefox",
      }));
    });

    it("includes a timestamp in the logged entry", () => {
      const entries: Array<{ tool: string; instruction?: string; timestamp: string }> = [];
      const logger = createDesktopAuditLogger((entry) => entries.push(entry));

      logger.log({
        tool: "desktop_screenshot",
        timestamp: new Date().toISOString(),
      });

      expect(entries.length).toBe(1);
      expect(entries[0].timestamp).toBeDefined();
      expect(typeof entries[0].timestamp).toBe("string");
      expect(entries[0].timestamp.length).toBeGreaterThan(0);
    });

    it("passes tool name through to sink", () => {
      const sink = vi.fn();
      const logger = createDesktopAuditLogger(sink);

      logger.log({ tool: "desktop_info", timestamp: new Date().toISOString() });

      expect(sink).toHaveBeenCalledWith(
        expect.objectContaining({ tool: "desktop_info" }),
      );
    });
  });
});
