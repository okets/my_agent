import { describe, it, expect, vi } from "vitest";
import {
  createDesktopServer,
  handleDesktopTask,
  handleDesktopScreenshot,
  handleDesktopInfo,
} from "../../../src/mcp/desktop-server.js";
import type { DesktopBackend, DesktopCapabilities, DisplayInfo, WindowInfo } from "@my-agent/core";
import type { DesktopServerDeps } from "../../../src/mcp/desktop-server.js";

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeBackend(overrides: Partial<DesktopBackend> = {}): DesktopBackend {
  const capabilities: DesktopCapabilities = {
    screenshot: true,
    mouse: true,
    keyboard: true,
    windowManagement: true,
    accessibility: false,
  };

  const displayInfo: DisplayInfo = {
    width: 1920,
    height: 1080,
    scaleFactor: 1,
    displayNumber: 0,
    monitors: [
      { name: "HDMI-1", x: 0, y: 0, width: 1920, height: 1080, primary: true },
    ],
  };

  const windows: WindowInfo[] = [
    {
      id: "win-1",
      title: "Terminal",
      appName: "gnome-terminal",
      geometry: { x: 0, y: 0, width: 800, height: 600 },
      focused: true,
    },
  ];

  return {
    platform: "x11",
    capabilities: () => capabilities,
    screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
    click: vi.fn().mockResolvedValue(undefined),
    doubleClick: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    keyPress: vi.fn().mockResolvedValue(undefined),
    mouseMove: vi.fn().mockResolvedValue(undefined),
    mouseDrag: vi.fn().mockResolvedValue(undefined),
    scroll: vi.fn().mockResolvedValue(undefined),
    listWindows: vi.fn().mockResolvedValue(windows),
    activeWindow: vi.fn().mockResolvedValue(windows[0]),
    focusWindow: vi.fn().mockResolvedValue(undefined),
    windowScreenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
    displayInfo: vi.fn().mockResolvedValue(displayInfo),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<DesktopServerDeps> = {}): DesktopServerDeps {
  return {
    backend: null,
    computerUse: null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("desktop-server", () => {
  // ── isEnabled gate ──────────────────────────────────────────────────────────

  describe("isEnabled gate", () => {
    it("handleDesktopTask returns error when isEnabled returns false", async () => {
      const deps = makeDeps({ isEnabled: () => false });
      const result = await handleDesktopTask(deps, { instruction: "open browser" });
      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain("Desktop control is disabled");
    });

    it("handleDesktopScreenshot returns error when isEnabled returns false", async () => {
      const deps = makeDeps({ isEnabled: () => false });
      const result = await handleDesktopScreenshot(deps, {});
      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain("Desktop control is disabled");
    });

    it("handleDesktopTask proceeds when isEnabled returns true (hits null computerUse)", async () => {
      const deps = makeDeps({ isEnabled: () => true });
      const result = await handleDesktopTask(deps, { instruction: "open browser" });
      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain("No ComputerUseService was configured");
    });

    it("handleDesktopTask proceeds when isEnabled is not provided (default open)", async () => {
      const deps = makeDeps();
      const result = await handleDesktopTask(deps, { instruction: "open browser" });
      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain("No ComputerUseService was configured");
    });
  });

  // ── Rate limiter ────────────────────────────────────────────────────────────

  describe("rate limiter", () => {
    it("blocks desktop_task when rate limit exceeded", async () => {
      const deps = makeDeps({
        rateLimiter: { check: () => ({ allowed: false, reason: "Too many requests — slow down" }) },
      });
      const result = await handleDesktopTask(deps, { instruction: "click" });
      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain("Too many requests");
    });

    it("uses default message when reason is absent", async () => {
      const deps = makeDeps({
        rateLimiter: { check: () => ({ allowed: false }) },
      });
      const result = await handleDesktopTask(deps, { instruction: "click" });
      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toBe("Rate limit exceeded");
    });

    it("allows desktop_task when rate limiter passes", async () => {
      const deps = makeDeps({
        rateLimiter: { check: () => ({ allowed: true }) },
      });
      const result = await handleDesktopTask(deps, { instruction: "click" });
      // Should proceed past rate limiter and hit null computerUse
      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain("No ComputerUseService was configured");
    });
  });

  // ── Audit logger ────────────────────────────────────────────────────────────

  describe("audit logger", () => {
    it("calls audit logger with correct tool name and instruction", async () => {
      const log = vi.fn();
      const deps = makeDeps({ auditLogger: { log } });
      await handleDesktopTask(deps, { instruction: "open settings" });
      expect(log).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: "desktop_task",
          instruction: "open settings",
          timestamp: expect.any(String),
        }),
      );
    });
  });

  // ── Null deps ───────────────────────────────────────────────────────────────

  describe("null deps", () => {
    it("handleDesktopTask with null computerUse returns error", async () => {
      const deps = makeDeps();
      const result = await handleDesktopTask(deps, { instruction: "click" });
      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain("No ComputerUseService was configured");
    });

    it("handleDesktopScreenshot with null backend returns error", async () => {
      const deps = makeDeps();
      const result = await handleDesktopScreenshot(deps, {});
      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain("No display detected");
    });

    it("handleDesktopInfo with null backend + capabilities returns helpful JSON (not error)", async () => {
      const deps = makeDeps();
      const result = await handleDesktopInfo(deps, { query: "capabilities" });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as any).text);
      expect(parsed.computerUseAvailable).toBe(false);
      expect(parsed.available).toBe(false);
      expect(parsed.reason).toContain("No desktop backend configured");
    });

    it("handleDesktopInfo with null backend + windows returns error", async () => {
      const deps = makeDeps();
      const result = await handleDesktopInfo(deps, { query: "windows" });
      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain("No display detected");
    });

    it("handleDesktopInfo with null backend + display returns error", async () => {
      const deps = makeDeps();
      const result = await handleDesktopInfo(deps, { query: "display" });
      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain("No display detected");
    });
  });

  // ── Happy paths (with mocks) ───────────────────────────────────────────────

  describe("happy paths", () => {
    it("handleDesktopScreenshot with mock backend returns image content block", async () => {
      const backend = makeBackend();
      const deps = makeDeps({ backend });
      const result = await handleDesktopScreenshot(deps, {});
      expect(result.isError).toBeUndefined();
      expect(result.content[0]).toMatchObject({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: expect.any(String),
        },
      });
      // Verify the base64 decodes to our fake PNG
      const data = (result.content[0] as any).source.data;
      expect(Buffer.from(data, "base64").toString()).toBe("fake-png");
    });

    it("handleDesktopInfo with mock backend + capabilities returns JSON with platform", async () => {
      const backend = makeBackend();
      const deps = makeDeps({ backend, computerUse: null });
      const result = await handleDesktopInfo(deps, { query: "capabilities" });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as any).text);
      expect(parsed.platform).toBe("x11");
      expect(parsed.capabilities.screenshot).toBe(true);
      expect(parsed.computerUseAvailable).toBe(false);
    });

    it("handleDesktopInfo with mock backend + windows returns JSON array", async () => {
      const backend = makeBackend();
      const deps = makeDeps({ backend });
      const result = await handleDesktopInfo(deps, { query: "windows" });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as any).text);
      expect(Array.isArray(parsed.windows)).toBe(true);
      expect(parsed.windows.length).toBe(1);
      expect(parsed.windows[0].title).toBe("Terminal");
    });
  });

  // ── Server creation ─────────────────────────────────────────────────────────

  describe("server creation", () => {
    it("createDesktopServer returns defined server with all deps", () => {
      const backend = makeBackend();
      const server = createDesktopServer({
        backend,
        computerUse: null,
        rateLimiter: { check: () => ({ allowed: true }) },
        auditLogger: { log: vi.fn() },
        isEnabled: () => true,
      });
      expect(server).toBeDefined();
    });

    it("createDesktopServer returns defined server with null deps", () => {
      const server = createDesktopServer({ backend: null, computerUse: null });
      expect(server).toBeDefined();
    });
  });
});
