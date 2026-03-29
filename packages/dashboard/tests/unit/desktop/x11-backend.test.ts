import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "child_process";

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

// Import after mocking
async function getBackend() {
  const mod = await import("../../../src/desktop/x11-backend.js");
  return mod.X11Backend;
}

const ALL_TOOLS = { hasXdotool: true, hasMaim: true, hasWmctrl: true };
const NO_TOOLS = { hasXdotool: false, hasMaim: false, hasWmctrl: false };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("X11Backend", () => {
  describe("capabilities()", () => {
    it("reports all capabilities when all tools available", async () => {
      const X11Backend = await getBackend();
      const backend = new X11Backend(ALL_TOOLS);
      const caps = backend.capabilities();

      expect(caps.screenshot).toBe(true);
      expect(caps.mouse).toBe(true);
      expect(caps.keyboard).toBe(true);
      expect(caps.windowManagement).toBe(true);
      expect(caps.accessibility).toBe(false);
    });

    it("reports limited capabilities when tools missing", async () => {
      const X11Backend = await getBackend();
      const backend = new X11Backend(NO_TOOLS);
      const caps = backend.capabilities();

      expect(caps.screenshot).toBe(false);
      expect(caps.mouse).toBe(false);
      expect(caps.keyboard).toBe(false);
      expect(caps.windowManagement).toBe(false);
    });
  });

  describe("click()", () => {
    it("calls xdotool mousemove then click with correct args", async () => {
      const X11Backend = await getBackend();
      const backend = new X11Backend(ALL_TOOLS);
      mockedExecFileSync.mockReturnValue(Buffer.from(""));

      await backend.click(100, 200);

      expect(mockedExecFileSync).toHaveBeenNthCalledWith(
        1,
        "xdotool",
        ["mousemove", "--sync", "100", "200"],
        expect.any(Object),
      );
      expect(mockedExecFileSync).toHaveBeenNthCalledWith(
        2,
        "xdotool",
        ["click", "1"],
        expect.any(Object),
      );
    });

    it("maps right button to button 3, middle to button 2", async () => {
      const X11Backend = await getBackend();
      const backend = new X11Backend(ALL_TOOLS);
      mockedExecFileSync.mockReturnValue(Buffer.from(""));

      await backend.click(10, 20, "right");
      expect(mockedExecFileSync).toHaveBeenCalledWith("xdotool", ["click", "3"], expect.any(Object));

      vi.clearAllMocks();
      await backend.click(10, 20, "middle");
      expect(mockedExecFileSync).toHaveBeenCalledWith("xdotool", ["click", "2"], expect.any(Object));
    });
  });

  describe("doubleClick()", () => {
    it("uses --repeat 2 --delay 50", async () => {
      const X11Backend = await getBackend();
      const backend = new X11Backend(ALL_TOOLS);
      mockedExecFileSync.mockReturnValue(Buffer.from(""));

      await backend.doubleClick(50, 60);

      expect(mockedExecFileSync).toHaveBeenNthCalledWith(
        2,
        "xdotool",
        ["click", "--repeat", "2", "--delay", "50", "1"],
        expect.any(Object),
      );
    });
  });

  describe("type()", () => {
    it("calls xdotool type with --delay 12", async () => {
      const X11Backend = await getBackend();
      const backend = new X11Backend(ALL_TOOLS);
      mockedExecFileSync.mockReturnValue(Buffer.from(""));

      await backend.type("hello world");

      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "xdotool",
        ["type", "--delay", "12", "hello world"],
        expect.any(Object),
      );
    });
  });

  describe("keyPress()", () => {
    it("calls xdotool key", async () => {
      const X11Backend = await getBackend();
      const backend = new X11Backend(ALL_TOOLS);
      mockedExecFileSync.mockReturnValue(Buffer.from(""));

      await backend.keyPress("ctrl+c");

      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "xdotool",
        ["key", "ctrl+c"],
        expect.any(Object),
      );
    });
  });

  describe("mouseMove()", () => {
    it("calls xdotool mousemove --sync", async () => {
      const X11Backend = await getBackend();
      const backend = new X11Backend(ALL_TOOLS);
      mockedExecFileSync.mockReturnValue(Buffer.from(""));

      await backend.mouseMove(300, 400);

      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "xdotool",
        ["mousemove", "--sync", "300", "400"],
        expect.any(Object),
      );
    });
  });

  describe("screenshot()", () => {
    it("calls maim with correct args for full screen", async () => {
      const X11Backend = await getBackend();
      const backend = new X11Backend(ALL_TOOLS);
      const fakeBuffer = Buffer.from("png-data");
      mockedExecFileSync.mockReturnValue(fakeBuffer);

      const result = await backend.screenshot();

      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "maim",
        ["--format", "png", "--hidecursor"],
        expect.objectContaining({ encoding: "buffer" }),
      );
      expect(result).toBe(fakeBuffer);
    });

    it("calls maim with --geometry for region", async () => {
      const X11Backend = await getBackend();
      const backend = new X11Backend(ALL_TOOLS);
      mockedExecFileSync.mockReturnValue(Buffer.from(""));

      await backend.screenshot({ region: { x: 10, y: 20, width: 300, height: 200 } });

      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "maim",
        ["--format", "png", "--hidecursor", "--geometry", "300x200+10+20"],
        expect.objectContaining({ encoding: "buffer" }),
      );
    });

    it("calls maim with --window for window capture", async () => {
      const X11Backend = await getBackend();
      const backend = new X11Backend(ALL_TOOLS);
      mockedExecFileSync.mockReturnValue(Buffer.from(""));

      await backend.screenshot({ windowId: "0x01600003" });

      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "maim",
        ["--format", "png", "--hidecursor", "--window", "0x01600003"],
        expect.objectContaining({ encoding: "buffer" }),
      );
    });
  });

  describe("focusWindow()", () => {
    it("calls windowactivate --sync and waits 100ms", async () => {
      const X11Backend = await getBackend();
      const backend = new X11Backend(ALL_TOOLS);
      mockedExecFileSync.mockReturnValue(Buffer.from(""));

      const start = Date.now();
      await backend.focusWindow("0x01600003");
      const elapsed = Date.now() - start;

      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "xdotool",
        ["windowactivate", "--sync", "0x01600003"],
        expect.any(Object),
      );
      expect(elapsed).toBeGreaterThanOrEqual(90);
    });
  });

  describe("listWindows()", () => {
    it("parses wmctrl output", async () => {
      const X11Backend = await getBackend();
      const backend = new X11Backend(ALL_TOOLS);

      mockedExecFileSync.mockReturnValue(
        "0x01600003  0 hostname Terminal\n0x03a00003  0 hostname Firefox\n",
      );

      const windows = await backend.listWindows();

      expect(windows).toHaveLength(2);
      expect(windows[0]).toMatchObject({ id: "0x01600003", title: "Terminal" });
      expect(windows[1]).toMatchObject({ id: "0x03a00003", title: "Firefox" });
    });
  });

  describe("displayInfo()", () => {
    it("parses xdpyinfo + xrandr output", async () => {
      const X11Backend = await getBackend();
      const backend = new X11Backend(ALL_TOOLS);

      mockedExecFileSync
        .mockReturnValueOnce(
          "screen #0:\n  dimensions:    1920x1080 pixels\n",
        )
        .mockReturnValueOnce(
          "eDP-1 connected primary 1920x1080+0+0 (normal left inverted right x axis y axis)\n",
        );

      const info = await backend.displayInfo();

      expect(info.width).toBe(1920);
      expect(info.height).toBe(1080);
      expect(info.monitors).toHaveLength(1);
      expect(info.monitors[0]).toMatchObject({
        name: "eDP-1",
        width: 1920,
        height: 1080,
        x: 0,
        y: 0,
        primary: true,
      });
    });
  });
});
