import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

// Save/restore process.env around each test
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
  // Clear relevant env vars
  delete process.env["XDG_SESSION_TYPE"];
  delete process.env["DISPLAY"];
  delete process.env["WAYLAND_DISPLAY"];
});

afterEach(() => {
  // Restore original env
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
  vi.clearAllMocks();
});

// Import after mocking
async function getDetector() {
  const mod = await import("../../../src/desktop/desktop-capability-detector.js");
  return mod.detectDesktopEnvironment;
}

describe("detectDesktopEnvironment", () => {
  it("detects X11 from XDG_SESSION_TYPE + DISPLAY", async () => {
    process.env["XDG_SESSION_TYPE"] = "x11";
    process.env["DISPLAY"] = ":0";
    // All tools available
    mockedExecFileSync.mockReturnValue(Buffer.from(""));

    const detect = await getDetector();
    const env = detect();

    expect(env.displayServer).toBe("x11");
    expect(env.hasDisplay).toBe(true);
  });

  it("detects Wayland from XDG_SESSION_TYPE + WAYLAND_DISPLAY", async () => {
    process.env["XDG_SESSION_TYPE"] = "wayland";
    process.env["WAYLAND_DISPLAY"] = "wayland-0";
    // All tools available
    mockedExecFileSync.mockReturnValue(Buffer.from(""));

    const detect = await getDetector();
    const env = detect();

    expect(env.displayServer).toBe("wayland");
    expect(env.hasDisplay).toBe(true);
  });

  it("falls back to DISPLAY when XDG_SESSION_TYPE is absent", async () => {
    // No XDG_SESSION_TYPE, but DISPLAY is set
    process.env["DISPLAY"] = ":1";
    mockedExecFileSync.mockReturnValue(Buffer.from(""));

    const detect = await getDetector();
    const env = detect();

    expect(env.displayServer).toBe("x11");
    expect(env.hasDisplay).toBe(true);
  });

  it("reports no display in headless environment", async () => {
    // No display env vars at all
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });

    const detect = await getDetector();
    const env = detect();

    expect(env.displayServer).toBe("none");
    expect(env.hasDisplay).toBe(false);
    expect(env.backend).toBeNull();
    expect(env.capabilities.screenshot).toBe(false);
    expect(env.capabilities.mouse).toBe(false);
  });

  it("populates setupNeeded when tools are missing", async () => {
    process.env["XDG_SESSION_TYPE"] = "x11";
    process.env["DISPLAY"] = ":0";
    // All tool checks fail
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });

    const detect = await getDetector();
    const env = detect();

    expect(env.setupNeeded.length).toBeGreaterThan(0);
    // Should mention xdotool, maim, wmctrl
    expect(env.setupNeeded.some((s) => s.includes("xdotool"))).toBe(true);
    expect(env.setupNeeded.some((s) => s.includes("maim"))).toBe(true);
    expect(env.setupNeeded.some((s) => s.includes("wmctrl"))).toBe(true);
  });

  it("sets backend to x11 when display and tools are available", async () => {
    process.env["XDG_SESSION_TYPE"] = "x11";
    process.env["DISPLAY"] = ":0";
    // All tools available
    mockedExecFileSync.mockReturnValue(Buffer.from(""));

    const detect = await getDetector();
    const env = detect();

    expect(env.backend).toBe("x11");
    expect(env.tools.xdotool).toBe(true);
    expect(env.tools.maim).toBe(true);
    expect(env.tools.wmctrl).toBe(true);
    expect(env.capabilities.screenshot).toBe(true);
    expect(env.capabilities.mouse).toBe(true);
    expect(env.capabilities.keyboard).toBe(true);
    expect(env.capabilities.windowManagement).toBe(true);
    expect(env.setupNeeded).toHaveLength(0);
  });
});
