import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to import after setting up mocks, but for static methods we can import directly
// since ComputerUseService doesn't have side effects at import time.

import { ComputerUseService } from "../../../src/desktop/computer-use-service.js";
import type { DesktopBackend } from "@my-agent/core";
import type { VisualActionService } from "../../../src/visual/visual-action-service.js";
import type Anthropic from "@anthropic-ai/sdk";

function createMockBackend(): DesktopBackend {
  return {
    platform: "x11",
    capabilities: vi.fn().mockReturnValue({
      screenshot: true,
      mouse: true,
      keyboard: true,
      windowManagement: true,
      accessibility: false,
    }),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
    click: vi.fn().mockResolvedValue(undefined),
    doubleClick: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    keyPress: vi.fn().mockResolvedValue(undefined),
    mouseMove: vi.fn().mockResolvedValue(undefined),
    mouseDrag: vi.fn().mockResolvedValue(undefined),
    scroll: vi.fn().mockResolvedValue(undefined),
    listWindows: vi.fn().mockResolvedValue([]),
    activeWindow: vi.fn().mockResolvedValue(null),
    focusWindow: vi.fn().mockResolvedValue(undefined),
    windowScreenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
    displayInfo: vi.fn().mockResolvedValue({
      width: 1920,
      height: 1080,
      scaleFactor: 1,
      displayNumber: 0,
      monitors: [],
    }),
  };
}

function createMockVas(): VisualActionService {
  let counter = 0;
  return {
    store: vi.fn().mockImplementation((_buf, _meta, tag) => {
      counter++;
      return {
        id: `ss-${counter}`,
        filename: `ss-${counter}.png`,
        path: `/tmp/ss-${counter}.png`,
        timestamp: new Date().toISOString(),
        context: { type: "conversation", id: "test" },
        tag: tag ?? "keep",
        width: 1920,
        height: 1080,
        sizeBytes: 100,
      };
    }),
    list: vi.fn().mockReturnValue([]),
    url: vi.fn().mockReturnValue("/api/assets/test"),
    onScreenshot: vi.fn(),
    updateTag: vi.fn(),
    cleanup: vi.fn().mockReturnValue(0),
  } as unknown as VisualActionService;
}

function createMockClient(): Anthropic {
  return {
    beta: {
      messages: {
        create: vi.fn(),
      },
    },
  } as unknown as Anthropic;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ComputerUseService", () => {
  describe("constructor", () => {
    it("constructs without error", () => {
      const client = createMockClient();
      const backend = createMockBackend();
      const vas = createMockVas();

      const service = new ComputerUseService(client, backend, vas);
      expect(service).toBeInstanceOf(ComputerUseService);
    });
  });

  describe("computeScaleFactor()", () => {
    it("returns < 1 for 1920x1080 (exceeds megapixel limit)", () => {
      const factor = ComputerUseService.computeScaleFactor(1920, 1080);
      expect(factor).toBeLessThan(1);
    });

    it("returns 1 for 1024x768 (within all limits)", () => {
      const factor = ComputerUseService.computeScaleFactor(1024, 768);
      expect(factor).toBe(1);
    });

    it("uses edge factor when long edge exceeds 1568", () => {
      // 2560x1440: long edge = 2560, edge factor = 1568/2560 ≈ 0.6125
      // pixels = 3686400, mp factor = sqrt(1150000/3686400) ≈ 0.5585
      // min(1, 0.6125, 0.5585) = 0.5585
      const factor = ComputerUseService.computeScaleFactor(2560, 1440);
      const expectedMp = Math.sqrt(1_150_000 / (2560 * 1440));
      expect(factor).toBeCloseTo(expectedMp, 4);
    });

    it("uses min of edge and megapixel factors", () => {
      // 1920x1080: edge = 1920 > 1568 → edgeFactor = 1568/1920 ≈ 0.8167
      // pixels = 2073600 > 1150000 → mpFactor = sqrt(1150000/2073600) ≈ 0.7448
      // min = 0.7448 (megapixel wins)
      const factor = ComputerUseService.computeScaleFactor(1920, 1080);
      const edgeFactor = 1568 / 1920;
      const mpFactor = Math.sqrt(1_150_000 / (1920 * 1080));
      expect(factor).toBeCloseTo(Math.min(edgeFactor, mpFactor), 4);
    });

    it("returns 1 for small displays", () => {
      const factor = ComputerUseService.computeScaleFactor(800, 600);
      expect(factor).toBe(1);
    });
  });

  describe("toScreenCoord()", () => {
    it("scales API coordinate back to screen coordinate", () => {
      // 100 / 0.8 = 125
      expect(ComputerUseService.toScreenCoord(100, 0.8)).toBe(125);
    });

    it("rounds to nearest integer", () => {
      // 100 / 0.7 ≈ 142.857 → 143
      expect(ComputerUseService.toScreenCoord(100, 0.7)).toBe(143);
    });

    it("returns same value when scale factor is 1", () => {
      expect(ComputerUseService.toScreenCoord(500, 1)).toBe(500);
    });
  });

  describe("run()", () => {
    it("returns failure when maxActions is 0", async () => {
      const client = createMockClient();
      const backend = createMockBackend();
      const vas = createMockVas();
      const service = new ComputerUseService(client, backend, vas);

      const result = await service.run({
        instruction: "do something",
        context: { type: "conversation", id: "test" },
        maxActions: 0,
      });

      expect(result.success).toBe(false);
      expect(result.actionsPerformed).toBe(0);
      expect(result.error).toContain("maxActions");
    });

    it("rejects when already running (mutex)", async () => {
      const client = createMockClient();
      const backend = createMockBackend();
      const vas = createMockVas();
      const service = new ComputerUseService(client, backend, vas);

      // Make the API call hang so the first run stays active
      const neverResolve = new Promise<never>(() => {});
      (client.beta.messages.create as ReturnType<typeof vi.fn>).mockReturnValue(neverResolve);

      // Start first run (will hang on API call)
      const firstRun = service.run({
        instruction: "task 1",
        context: { type: "conversation", id: "test1" },
      });

      // Give the first run time to start and set running = true
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second run should be rejected immediately
      const secondResult = await service.run({
        instruction: "task 2",
        context: { type: "conversation", id: "test2" },
      });

      expect(secondResult.success).toBe(false);
      expect(secondResult.error).toContain("already running");

      // Clean up: the first run is still pending, but we don't need to await it
    });
  });
});
