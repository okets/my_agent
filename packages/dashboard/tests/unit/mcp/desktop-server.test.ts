import { describe, it, expect, vi } from "vitest";
import {
  createDesktopServer,
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
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("desktop-server", () => {
  // ── Null deps ───────────────────────────────────────────────────────────

  describe("null deps", () => {
    it("handleDesktopInfo with null backend + capabilities returns helpful JSON (not error)", async () => {
      const deps = makeDeps();
      const result = await handleDesktopInfo(deps, { query: "capabilities" });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as any).text);
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

  // ── Happy paths (with mocks) ───────────────────────────────────────────

  describe("happy paths", () => {
    it("handleDesktopInfo with mock backend + capabilities returns JSON with platform", async () => {
      const backend = makeBackend();
      const deps = makeDeps({ backend });
      const result = await handleDesktopInfo(deps, { query: "capabilities" });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as any).text);
      expect(parsed.platform).toBe("x11");
      expect(parsed.capabilities.screenshot).toBe(true);
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

  // ── Server creation ─────────────────────────────────────────────────────

  describe("server creation", () => {
    it("createDesktopServer returns defined server with all deps", () => {
      const backend = makeBackend();
      const server = createDesktopServer({
        backend,
        rateLimiter: { check: () => ({ allowed: true }) },
        auditLogger: { log: vi.fn() },
        isEnabled: () => true,
      });
      expect(server).toBeDefined();
    });

    it("createDesktopServer returns defined server with null deps", () => {
      const server = createDesktopServer({ backend: null });
      expect(server).toBeDefined();
    });
  });
});
