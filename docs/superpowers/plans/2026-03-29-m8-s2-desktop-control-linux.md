# M8-S2: Desktop Control — Linux X11 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nina can see and interact with GUI applications on a Linux X11 desktop.

**Depends on:** M8-S1 (Visual Action Pipeline — VisualActionService, screenshot types, asset serving)

**Architecture:** DesktopBackend interface in `packages/core`, X11Backend + ComputerUseService + desktop MCP server in `packages/dashboard`. Environment detection at startup. Safety via hooks. Skill teaches Nina when/how to use desktop control.

**Tech Stack:** TypeScript, xdotool, maim, wmctrl, xdpyinfo, xrandr (CLI tools), `@nut-tree-fork/nut-js` (optional native bindings), `@anthropic-ai/sdk` (beta computer use API), vitest (testing)

**Design spec:** `docs/superpowers/specs/2026-03-29-m8-desktop-automation-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `packages/core/src/desktop/types.ts` | DesktopBackend, DesktopCapabilities, WindowInfo, DisplayInfo, DesktopEnvironment interfaces |
| `packages/core/src/desktop/index.ts` | Re-exports |
| `packages/dashboard/src/desktop/desktop-capability-detector.ts` | Probes env vars and CLI tools, builds DesktopEnvironment profile |
| `packages/dashboard/src/desktop/x11-backend.ts` | X11 implementation of DesktopBackend using xdotool + maim + wmctrl |
| `packages/dashboard/src/desktop/computer-use-service.ts` | Claude beta API bridge for native computer use loop |
| `packages/dashboard/src/mcp/desktop-server.ts` | MCP tools: desktop_task, desktop_screenshot, desktop_info |
| `packages/dashboard/src/hooks/desktop-hooks.ts` | PreToolUse safety hook: rate limiting, audit logging |
| `skills/desktop-control.md` | Brain-level skill: when/how to use desktop control |
| `packages/dashboard/tests/unit/desktop/desktop-capability-detector.test.ts` | Detector unit tests |
| `packages/dashboard/tests/unit/desktop/x11-backend.test.ts` | X11Backend unit tests |
| `packages/dashboard/tests/unit/desktop/computer-use-service.test.ts` | ComputerUseService unit tests |
| `packages/dashboard/tests/unit/mcp/desktop-server.test.ts` | Desktop MCP server tests |
| `packages/dashboard/tests/unit/hooks/desktop-hooks.test.ts` | Desktop hooks tests |

### Modified Files

| File | Change |
|------|--------|
| `packages/core/src/index.ts` | Re-export desktop types |
| `packages/dashboard/src/app.ts` | Detect desktop environment, create backend + service, register MCP server |
| `packages/dashboard/src/hatching/` | Add optional Desktop Control hatching step |

---

## Task 1: Desktop Types

**Files:**
- Create: `packages/core/src/desktop/types.ts`
- Create: `packages/core/src/desktop/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create the types file**

```typescript
// packages/core/src/desktop/types.ts

export interface DesktopCapabilities {
  screenshot: boolean;
  mouse: boolean;
  keyboard: boolean;
  windowManagement: boolean;
  accessibility: boolean;
}

export interface WindowInfo {
  id: string;
  title: string;
  appName: string;
  geometry: { x: number; y: number; width: number; height: number };
  focused: boolean;
}

export interface MonitorInfo {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  primary: boolean;
}

export interface DisplayInfo {
  width: number;
  height: number;
  scaleFactor: number;
  displayNumber?: number;
  monitors: MonitorInfo[];
}

export interface ScreenshotOptions {
  region?: { x: number; y: number; width: number; height: number };
  windowId?: string;
  format?: "png" | "jpeg";
  quality?: number;
}

export interface DesktopBackend {
  readonly platform: "x11" | "wayland" | "macos";

  capabilities(): DesktopCapabilities;

  screenshot(options?: ScreenshotOptions): Promise<Buffer>;
  click(
    x: number,
    y: number,
    button?: "left" | "right" | "middle",
  ): Promise<void>;
  doubleClick(x: number, y: number): Promise<void>;
  type(text: string): Promise<void>;
  keyPress(keys: string): Promise<void>;
  mouseMove(x: number, y: number): Promise<void>;
  mouseDrag(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ): Promise<void>;
  scroll(
    x: number,
    y: number,
    direction: "up" | "down" | "left" | "right",
    amount?: number,
  ): Promise<void>;

  listWindows(): Promise<WindowInfo[]>;
  activeWindow(): Promise<WindowInfo | null>;
  focusWindow(windowId: string): Promise<void>;
  windowScreenshot(windowId: string): Promise<Buffer>;

  displayInfo(): Promise<DisplayInfo>;
}

export interface DesktopEnvironment {
  displayServer: "x11" | "wayland" | "macos" | "none";
  hasDisplay: boolean;
  backend: "x11" | "wayland" | "macos" | null;
  tools: {
    nutJs: boolean;
    xdotool: boolean;
    maim: boolean;
    wmctrl: boolean;
    ydotool: boolean;
    kdotool: boolean;
    spectacle: boolean;
  };
  capabilities: DesktopCapabilities;
  setupNeeded: string[];
}
```

- [ ] **Step 2: Create the index re-export**

```typescript
// packages/core/src/desktop/index.ts
export * from "./types.js";
```

- [ ] **Step 3: Add to core barrel export**

In `packages/core/src/index.ts`, add:

```typescript
export * from "./desktop/index.js";
```

- [ ] **Step 4: Verify types compile**

Run: `cd packages/core && npx tsc --noEmit`
Expected: Clean, no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/desktop/ packages/core/src/index.ts
git commit -m "feat(core): add desktop backend types and DesktopEnvironment interface"
```

---

## Task 2: Desktop Capability Detector

**Files:**
- Create: `packages/dashboard/src/desktop/desktop-capability-detector.ts`
- Create: `packages/dashboard/tests/unit/desktop/desktop-capability-detector.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/dashboard/tests/unit/desktop/desktop-capability-detector.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { detectDesktopEnvironment } from "../../../src/desktop/desktop-capability-detector.js";

describe("detectDesktopEnvironment", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("detects X11 from XDG_SESSION_TYPE", async () => {
    process.env.XDG_SESSION_TYPE = "x11";
    process.env.DISPLAY = ":0";
    const env = await detectDesktopEnvironment();
    expect(env.displayServer).toBe("x11");
    expect(env.hasDisplay).toBe(true);
  });

  it("detects Wayland from XDG_SESSION_TYPE", async () => {
    process.env.XDG_SESSION_TYPE = "wayland";
    process.env.WAYLAND_DISPLAY = "wayland-0";
    delete process.env.DISPLAY;
    const env = await detectDesktopEnvironment();
    expect(env.displayServer).toBe("wayland");
    expect(env.hasDisplay).toBe(true);
  });

  it("falls back to DISPLAY env var when XDG_SESSION_TYPE is absent", async () => {
    delete process.env.XDG_SESSION_TYPE;
    process.env.DISPLAY = ":0";
    delete process.env.WAYLAND_DISPLAY;
    const env = await detectDesktopEnvironment();
    expect(env.displayServer).toBe("x11");
    expect(env.hasDisplay).toBe(true);
  });

  it("reports no display in headless environment", async () => {
    delete process.env.XDG_SESSION_TYPE;
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    const env = await detectDesktopEnvironment();
    expect(env.displayServer).toBe("none");
    expect(env.hasDisplay).toBe(false);
    expect(env.backend).toBeNull();
  });

  it("populates setupNeeded when tools are missing", async () => {
    process.env.XDG_SESSION_TYPE = "x11";
    process.env.DISPLAY = ":0";
    const env = await detectDesktopEnvironment();
    // In test environment, CLI tools are likely unavailable
    // The detector should list missing tools
    expect(Array.isArray(env.setupNeeded)).toBe(true);
  });

  it("sets backend to x11 when display server is x11 and tools are available", async () => {
    process.env.XDG_SESSION_TYPE = "x11";
    process.env.DISPLAY = ":0";
    const env = await detectDesktopEnvironment();
    // Backend is x11 if at least one input tool is available (xdotool or nut-js)
    if (env.tools.xdotool || env.tools.nutJs) {
      expect(env.backend).toBe("x11");
    } else {
      // No tools available — backend should be null even with display
      expect(env.backend).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/unit/desktop/desktop-capability-detector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the detector**

```typescript
// packages/dashboard/src/desktop/desktop-capability-detector.ts
import { execFileSync } from "child_process";
import type { DesktopEnvironment, DesktopCapabilities } from "@my-agent/core";

/**
 * Check if a CLI tool is available on PATH.
 */
function hasCommand(cmd: string): boolean {
  try {
    execFileSync("which", [cmd], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to load nut-js native bindings.
 */
async function hasNutJs(): Promise<boolean> {
  try {
    await import("@nut-tree-fork/nut-js");
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the desktop environment and available tools.
 * Runs at startup to determine what desktop capabilities are available.
 */
export async function detectDesktopEnvironment(): Promise<DesktopEnvironment> {
  const sessionType = process.env.XDG_SESSION_TYPE;
  const hasX11Display = !!process.env.DISPLAY;
  const hasWaylandDisplay = !!process.env.WAYLAND_DISPLAY;
  const isMac = process.platform === "darwin";

  // Determine display server
  let displayServer: DesktopEnvironment["displayServer"] = "none";
  let hasDisplay = false;

  if (isMac) {
    displayServer = "macos";
    hasDisplay = true;
  } else if (sessionType === "wayland" || (!sessionType && hasWaylandDisplay && !hasX11Display)) {
    displayServer = "wayland";
    hasDisplay = hasWaylandDisplay;
  } else if (sessionType === "x11" || hasX11Display) {
    displayServer = "x11";
    hasDisplay = hasX11Display;
  }

  // Probe CLI tools
  const tools = {
    nutJs: await hasNutJs(),
    xdotool: hasCommand("xdotool"),
    maim: hasCommand("maim"),
    wmctrl: hasCommand("wmctrl"),
    ydotool: hasCommand("ydotool"),
    kdotool: hasCommand("kdotool"),
    spectacle: hasCommand("spectacle"),
  };

  // Build capabilities
  const capabilities: DesktopCapabilities = {
    screenshot: false,
    mouse: false,
    keyboard: false,
    windowManagement: false,
    accessibility: false,
  };

  if (displayServer === "x11") {
    capabilities.screenshot = tools.nutJs || tools.maim;
    capabilities.mouse = tools.nutJs || tools.xdotool;
    capabilities.keyboard = tools.nutJs || tools.xdotool;
    capabilities.windowManagement = tools.wmctrl || tools.xdotool;
  } else if (displayServer === "wayland") {
    capabilities.screenshot = tools.spectacle || tools.nutJs;
    capabilities.mouse = tools.ydotool || tools.nutJs;
    capabilities.keyboard = tools.ydotool || tools.nutJs;
    capabilities.windowManagement = tools.kdotool;
  } else if (displayServer === "macos") {
    capabilities.screenshot = true; // screencapture always available
    capabilities.mouse = tools.nutJs;
    capabilities.keyboard = tools.nutJs;
    capabilities.windowManagement = true; // osascript always available
  }

  // Determine backend
  let backend: DesktopEnvironment["backend"] = null;
  if (hasDisplay) {
    if (displayServer === "x11" && (capabilities.mouse || capabilities.keyboard)) {
      backend = "x11";
    } else if (displayServer === "wayland" && (capabilities.mouse || capabilities.keyboard)) {
      backend = "wayland";
    } else if (displayServer === "macos") {
      backend = "macos";
    }
  }

  // Determine what's missing
  const setupNeeded: string[] = [];
  if (displayServer === "x11") {
    if (!tools.xdotool && !tools.nutJs) setupNeeded.push("xdotool (mouse/keyboard control)");
    if (!tools.maim && !tools.nutJs) setupNeeded.push("maim (screenshots)");
    if (!tools.wmctrl) setupNeeded.push("wmctrl (window management)");
  } else if (displayServer === "wayland") {
    if (!tools.ydotool) setupNeeded.push("ydotool (mouse/keyboard control)");
    if (!tools.spectacle) setupNeeded.push("spectacle (screenshots)");
    if (!tools.kdotool) setupNeeded.push("kdotool (window management)");
  }

  return {
    displayServer,
    hasDisplay,
    backend,
    tools,
    capabilities,
    setupNeeded,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/unit/desktop/desktop-capability-detector.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/desktop/desktop-capability-detector.ts packages/dashboard/tests/unit/desktop/desktop-capability-detector.test.ts
git commit -m "feat(dashboard): desktop capability detector — probes env vars and CLI tools"
```

---

## Task 3: Install System Dependencies

**Files:** None (system setup only)

**Note:** S1 uses CLI tools (xdotool, maim, wmctrl) as the primary backend for Linux X11. The `@nut-tree-fork/nut-js` package was considered but deferred — it's a community fork with uncertain maintenance, and CLI tools are battle-tested. The DesktopBackend abstraction allows adding nut-js as an alternative backend later without changing any consumers.

- [ ] **Step 1: Install xdotool and maim**

Run: `sudo apt install xdotool maim wmctrl`

- [ ] **Step 2: Verify tools are available**

Run: `which xdotool && which maim && which wmctrl`
Expected: All three paths printed. If any is missing, the X11Backend will report reduced capabilities — this is graceful degradation, not a failure.

- [ ] **Step 3: No commit needed** (system dependency, not in repo)

---

## Task 4: X11Backend

**Files:**
- Create: `packages/dashboard/src/desktop/x11-backend.ts`
- Create: `packages/dashboard/tests/unit/desktop/x11-backend.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/dashboard/tests/unit/desktop/x11-backend.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing the backend
vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from "child_process";
import { X11Backend } from "../../../src/desktop/x11-backend.js";

const mockExecFileSync = vi.mocked(execFileSync);

describe("X11Backend", () => {
  let backend: X11Backend;

  beforeEach(() => {
    vi.clearAllMocks();
    backend = new X11Backend({
      hasXdotool: true,
      hasMaim: true,
      hasWmctrl: true,
    });
  });

  describe("capabilities()", () => {
    it("reports all capabilities when all tools available", () => {
      const caps = backend.capabilities();
      expect(caps.screenshot).toBe(true);
      expect(caps.mouse).toBe(true);
      expect(caps.keyboard).toBe(true);
      expect(caps.windowManagement).toBe(true);
    });

    it("reports limited capabilities when tools missing", () => {
      const limited = new X11Backend({
        hasXdotool: false,
        hasMaim: false,
        hasWmctrl: false,
      });
      const caps = limited.capabilities();
      expect(caps.screenshot).toBe(false);
      expect(caps.mouse).toBe(false);
      expect(caps.keyboard).toBe(false);
    });
  });

  describe("click()", () => {
    it("calls xdotool mousemove then click", async () => {
      await backend.click(100, 200);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "xdotool",
        ["mousemove", "--sync", "100", "200"],
        expect.any(Object),
      );
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "xdotool",
        ["click", "1"],
        expect.any(Object),
      );
    });

    it("maps right button to button 3", async () => {
      await backend.click(0, 0, "right");
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "xdotool",
        ["click", "3"],
        expect.any(Object),
      );
    });

    it("maps middle button to button 2", async () => {
      await backend.click(0, 0, "middle");
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "xdotool",
        ["click", "2"],
        expect.any(Object),
      );
    });
  });

  describe("doubleClick()", () => {
    it("calls xdotool with --repeat 2 --delay 50", async () => {
      await backend.doubleClick(50, 75);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "xdotool",
        ["mousemove", "--sync", "50", "75"],
        expect.any(Object),
      );
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "xdotool",
        ["click", "--repeat", "2", "--delay", "50", "1"],
        expect.any(Object),
      );
    });
  });

  describe("type()", () => {
    it("calls xdotool type with delay", async () => {
      await backend.type("hello");
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "xdotool",
        ["type", "--delay", "12", "hello"],
        expect.any(Object),
      );
    });
  });

  describe("keyPress()", () => {
    it("calls xdotool key", async () => {
      await backend.keyPress("ctrl+s");
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "xdotool",
        ["key", "ctrl+s"],
        expect.any(Object),
      );
    });
  });

  describe("mouseMove()", () => {
    it("calls xdotool mousemove --sync", async () => {
      await backend.mouseMove(300, 400);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "xdotool",
        ["mousemove", "--sync", "300", "400"],
        expect.any(Object),
      );
    });
  });

  describe("screenshot()", () => {
    it("calls maim for full screen capture", async () => {
      mockExecFileSync.mockReturnValueOnce(Buffer.from("png-data"));
      const result = await backend.screenshot();
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "maim",
        ["--format", "png", "--hidecursor"],
        expect.objectContaining({ encoding: "buffer" }),
      );
      expect(result).toEqual(Buffer.from("png-data"));
    });

    it("calls maim with geometry for region capture", async () => {
      mockExecFileSync.mockReturnValueOnce(Buffer.from("png-data"));
      await backend.screenshot({
        region: { x: 10, y: 20, width: 300, height: 200 },
      });
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "maim",
        ["--format", "png", "--hidecursor", "--geometry", "300x200+10+20"],
        expect.objectContaining({ encoding: "buffer" }),
      );
    });

    it("calls maim with window id", async () => {
      mockExecFileSync.mockReturnValueOnce(Buffer.from("png-data"));
      await backend.screenshot({ windowId: "0x1234" });
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "maim",
        ["--format", "png", "--hidecursor", "--window", "0x1234"],
        expect.objectContaining({ encoding: "buffer" }),
      );
    });
  });

  describe("focusWindow()", () => {
    it("calls xdotool windowactivate and waits for settle", async () => {
      const start = Date.now();
      await backend.focusWindow("0x5678");
      const elapsed = Date.now() - start;

      expect(mockExecFileSync).toHaveBeenCalledWith(
        "xdotool",
        ["windowactivate", "--sync", "0x5678"],
        expect.any(Object),
      );
      // 100ms settle delay
      expect(elapsed).toBeGreaterThanOrEqual(90);
    });
  });

  describe("listWindows()", () => {
    it("parses wmctrl output", async () => {
      mockExecFileSync.mockReturnValueOnce(Buffer.from(
        "0x01600003  0 hostname Terminal\n" +
        "0x03a00003  0 hostname Firefox\n",
      ));
      // Mock xdotool getactivewindow for focused check
      mockExecFileSync.mockReturnValueOnce(Buffer.from("0x01600003\n"));
      // Mock xdotool getwindowgeometry for each window
      mockExecFileSync.mockReturnValueOnce(
        Buffer.from("Window 0x01600003\n  Position: 100,200 (screen: 0)\n  Geometry: 800x600\n"),
      );
      mockExecFileSync.mockReturnValueOnce(
        Buffer.from("Window 0x03a00003\n  Position: 0,0 (screen: 0)\n  Geometry: 1920x1080\n"),
      );

      const windows = await backend.listWindows();
      expect(windows).toHaveLength(2);
      expect(windows[0].id).toBe("0x01600003");
      expect(windows[0].title).toBe("Terminal");
      expect(windows[0].focused).toBe(true);
      expect(windows[1].title).toBe("Firefox");
      expect(windows[1].focused).toBe(false);
    });
  });

  describe("displayInfo()", () => {
    it("parses xdpyinfo and xrandr output", async () => {
      // Mock xdpyinfo
      mockExecFileSync.mockReturnValueOnce(Buffer.from(
        "screen #0:\n  dimensions:    1920x1080 pixels\n",
      ));
      // Mock xrandr
      mockExecFileSync.mockReturnValueOnce(Buffer.from(
        "eDP-1 connected primary 1920x1080+0+0 (normal left inverted right x axis y axis) 344mm x 194mm\n" +
        "   1920x1080     60.00*+\n",
      ));

      const info = await backend.displayInfo();
      expect(info.width).toBe(1920);
      expect(info.height).toBe(1080);
      expect(info.monitors).toHaveLength(1);
      expect(info.monitors[0].name).toBe("eDP-1");
      expect(info.monitors[0].primary).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/unit/desktop/x11-backend.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement X11Backend**

```typescript
// packages/dashboard/src/desktop/x11-backend.ts
import { execFileSync } from "child_process";
import type {
  DesktopBackend,
  DesktopCapabilities,
  WindowInfo,
  DisplayInfo,
  ScreenshotOptions,
} from "@my-agent/core";

const EXEC_OPTIONS = { timeout: 5000, stdio: "pipe" as const };

/** Map button names to X11 button numbers. */
const BUTTON_MAP: Record<string, string> = {
  left: "1",
  middle: "2",
  right: "3",
};

interface X11ToolAvailability {
  hasXdotool: boolean;
  hasMaim: boolean;
  hasWmctrl: boolean;
}

export class X11Backend implements DesktopBackend {
  readonly platform = "x11" as const;

  constructor(private readonly tools: X11ToolAvailability) {}

  capabilities(): DesktopCapabilities {
    return {
      screenshot: this.tools.hasMaim,
      mouse: this.tools.hasXdotool,
      keyboard: this.tools.hasXdotool,
      windowManagement: this.tools.hasWmctrl || this.tools.hasXdotool,
      accessibility: false, // AT-SPI2 detection deferred
    };
  }

  // --- Screenshots ---

  async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
    const args = ["--format", "png", "--hidecursor"];

    if (options?.region) {
      const { x, y, width, height } = options.region;
      args.push("--geometry", `${width}x${height}+${x}+${y}`);
    } else if (options?.windowId) {
      args.push("--window", options.windowId);
    }

    return execFileSync("maim", args, {
      ...EXEC_OPTIONS,
      encoding: "buffer",
    }) as unknown as Buffer;
  }

  async windowScreenshot(windowId: string): Promise<Buffer> {
    return this.screenshot({ windowId });
  }

  // --- Mouse ---

  async click(
    x: number,
    y: number,
    button: "left" | "right" | "middle" = "left",
  ): Promise<void> {
    execFileSync(
      "xdotool",
      ["mousemove", "--sync", String(x), String(y)],
      EXEC_OPTIONS,
    );
    execFileSync(
      "xdotool",
      ["click", BUTTON_MAP[button]],
      EXEC_OPTIONS,
    );
  }

  async doubleClick(x: number, y: number): Promise<void> {
    execFileSync(
      "xdotool",
      ["mousemove", "--sync", String(x), String(y)],
      EXEC_OPTIONS,
    );
    execFileSync(
      "xdotool",
      ["click", "--repeat", "2", "--delay", "50", "1"],
      EXEC_OPTIONS,
    );
  }

  async mouseMove(x: number, y: number): Promise<void> {
    execFileSync(
      "xdotool",
      ["mousemove", "--sync", String(x), String(y)],
      EXEC_OPTIONS,
    );
  }

  async mouseDrag(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ): Promise<void> {
    execFileSync(
      "xdotool",
      ["mousemove", "--sync", String(fromX), String(fromY)],
      EXEC_OPTIONS,
    );
    execFileSync(
      "xdotool",
      ["mousedown", "1"],
      EXEC_OPTIONS,
    );
    execFileSync(
      "xdotool",
      ["mousemove", "--sync", String(toX), String(toY)],
      EXEC_OPTIONS,
    );
    execFileSync(
      "xdotool",
      ["mouseup", "1"],
      EXEC_OPTIONS,
    );
  }

  async scroll(
    x: number,
    y: number,
    direction: "up" | "down" | "left" | "right",
    amount: number = 3,
  ): Promise<void> {
    execFileSync(
      "xdotool",
      ["mousemove", "--sync", String(x), String(y)],
      EXEC_OPTIONS,
    );

    // X11 scroll: button 4=up, 5=down, 6=left, 7=right
    const buttonMap: Record<string, string> = {
      up: "4",
      down: "5",
      left: "6",
      right: "7",
    };
    execFileSync(
      "xdotool",
      ["click", "--repeat", String(amount), buttonMap[direction]],
      EXEC_OPTIONS,
    );
  }

  // --- Keyboard ---

  async type(text: string): Promise<void> {
    execFileSync(
      "xdotool",
      ["type", "--delay", "12", text],
      EXEC_OPTIONS,
    );
  }

  async keyPress(keys: string): Promise<void> {
    execFileSync(
      "xdotool",
      ["key", keys],
      EXEC_OPTIONS,
    );
  }

  // --- Window Management ---

  async listWindows(): Promise<WindowInfo[]> {
    const wmctrlOutput = execFileSync(
      "wmctrl",
      ["-l"],
      { ...EXEC_OPTIONS, encoding: "utf-8" },
    ) as unknown as string;

    const activeIdRaw = execFileSync(
      "xdotool",
      ["getactivewindow"],
      { ...EXEC_OPTIONS, encoding: "utf-8" },
    ) as unknown as string;
    const activeId = `0x${parseInt(activeIdRaw.trim(), 10).toString(16).padStart(8, "0")}`;

    const windows: WindowInfo[] = [];
    for (const line of wmctrlOutput.trim().split("\n")) {
      if (!line.trim()) continue;
      // wmctrl -l format: 0x01600003  0 hostname Window Title
      const match = line.match(/^(0x[\da-f]+)\s+\S+\s+\S+\s+(.*)$/i);
      if (!match) continue;

      const id = match[1];
      const title = match[2].trim();

      let geometry = { x: 0, y: 0, width: 0, height: 0 };
      try {
        const geoOutput = execFileSync(
          "xdotool",
          ["getwindowgeometry", id],
          { ...EXEC_OPTIONS, encoding: "utf-8" },
        ) as unknown as string;

        const posMatch = geoOutput.match(/Position:\s+(\d+),(\d+)/);
        const sizeMatch = geoOutput.match(/Geometry:\s+(\d+)x(\d+)/);
        if (posMatch && sizeMatch) {
          geometry = {
            x: parseInt(posMatch[1], 10),
            y: parseInt(posMatch[2], 10),
            width: parseInt(sizeMatch[1], 10),
            height: parseInt(sizeMatch[2], 10),
          };
        }
      } catch {
        // Window may have closed between listing and querying
      }

      windows.push({
        id,
        title,
        appName: title.split(/\s[-–—]\s/).pop() || title,
        geometry,
        focused: id === activeId,
      });
    }

    return windows;
  }

  async activeWindow(): Promise<WindowInfo | null> {
    try {
      const windows = await this.listWindows();
      return windows.find((w) => w.focused) || null;
    } catch {
      return null;
    }
  }

  async focusWindow(windowId: string): Promise<void> {
    execFileSync(
      "xdotool",
      ["windowactivate", "--sync", windowId],
      EXEC_OPTIONS,
    );
    // Settle delay: wait for window manager to complete the focus change
    // Prevents race conditions where the next action targets the wrong window
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // --- Display Info ---

  async displayInfo(): Promise<DisplayInfo> {
    let width = 1920;
    let height = 1080;
    let displayNumber: number | undefined;

    try {
      const xdpyOutput = execFileSync(
        "xdpyinfo",
        [],
        { ...EXEC_OPTIONS, encoding: "utf-8" },
      ) as unknown as string;

      const dimMatch = xdpyOutput.match(/dimensions:\s+(\d+)x(\d+)\s+pixels/);
      if (dimMatch) {
        width = parseInt(dimMatch[1], 10);
        height = parseInt(dimMatch[2], 10);
      }

      const displayMatch = process.env.DISPLAY?.match(/:(\d+)/);
      if (displayMatch) {
        displayNumber = parseInt(displayMatch[1], 10);
      }
    } catch {
      // xdpyinfo not available — use defaults
    }

    const monitors = this.parseXrandr();

    return {
      width,
      height,
      scaleFactor: 1,
      displayNumber,
      monitors,
    };
  }

  private parseXrandr(): DisplayInfo["monitors"] {
    try {
      const output = execFileSync(
        "xrandr",
        ["--current"],
        { ...EXEC_OPTIONS, encoding: "utf-8" },
      ) as unknown as string;

      const monitors: DisplayInfo["monitors"] = [];
      // Match lines like: eDP-1 connected primary 1920x1080+0+0
      const regex = /^(\S+)\s+connected\s+(primary\s+)?(\d+)x(\d+)\+(\d+)\+(\d+)/gm;
      let match;
      while ((match = regex.exec(output)) !== null) {
        monitors.push({
          name: match[1],
          width: parseInt(match[3], 10),
          height: parseInt(match[4], 10),
          x: parseInt(match[5], 10),
          y: parseInt(match[6], 10),
          primary: !!match[2],
        });
      }
      return monitors;
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/unit/desktop/x11-backend.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/desktop/x11-backend.ts packages/dashboard/tests/unit/desktop/x11-backend.test.ts
git commit -m "feat(dashboard): X11Backend — xdotool + maim + wmctrl desktop control"
```

---

## Task 5: ComputerUseService

**Files:**
- Create: `packages/dashboard/src/desktop/computer-use-service.ts`
- Create: `packages/dashboard/tests/unit/desktop/computer-use-service.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/dashboard/tests/unit/desktop/computer-use-service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ComputerUseService } from "../../../src/desktop/computer-use-service.js";
import type { DesktopBackend, DesktopCapabilities, DisplayInfo, WindowInfo } from "@my-agent/core";

// Minimal mock backend
function createMockBackend(): DesktopBackend {
  return {
    platform: "x11",
    capabilities: () => ({
      screenshot: true,
      mouse: true,
      keyboard: true,
      windowManagement: true,
      accessibility: false,
    }),
    screenshot: vi.fn().mockResolvedValue(Buffer.alloc(100, 128)),
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
    windowScreenshot: vi.fn().mockResolvedValue(Buffer.alloc(100, 128)),
    displayInfo: vi.fn().mockResolvedValue({
      width: 1920,
      height: 1080,
      scaleFactor: 1,
      monitors: [{ name: "eDP-1", x: 0, y: 0, width: 1920, height: 1080, primary: true }],
    } satisfies DisplayInfo),
  };
}

// Minimal mock VisualActionService
function createMockVisualService() {
  return {
    store: vi.fn().mockImplementation(async (_img: Buffer, meta: any, tag?: string) => ({
      id: `ss-${Math.random().toString(36).slice(2)}`,
      filename: "test.png",
      path: "/tmp/test.png",
      timestamp: new Date().toISOString(),
      context: meta.context,
      tag: tag || "keep",
      width: meta.width,
      height: meta.height,
      sizeBytes: 100,
    })),
    list: vi.fn().mockReturnValue([]),
    url: vi.fn().mockReturnValue("/api/assets/test.png"),
    updateTag: vi.fn(),
  };
}

describe("ComputerUseService", () => {
  let backend: DesktopBackend;
  let visualService: ReturnType<typeof createMockVisualService>;
  let service: ComputerUseService;

  beforeEach(() => {
    backend = createMockBackend();
    visualService = createMockVisualService();
  });

  it("constructs with backend, visual service, and API key", () => {
    service = new ComputerUseService(backend, visualService as any, "test-api-key");
    expect(service).toBeDefined();
  });

  describe("coordinate scaling", () => {
    it("scales down screenshots exceeding 1568px long edge", () => {
      // A 1920x1080 display: long edge is 1920
      // Scale factor = 1568 / 1920 = 0.8167
      const scale = ComputerUseService.computeScaleFactor(1920, 1080);
      expect(scale).toBeCloseTo(1568 / 1920, 3);
      expect(scale).toBeLessThan(1);
    });

    it("scales down screenshots exceeding 1.15MP", () => {
      // A 1600x900 display = 1.44MP > 1.15MP
      // longEdge factor = 1568/1600 = 0.98
      // megapixel factor = sqrt(1_150_000 / (1600*900)) = sqrt(0.799) = 0.894
      // Use the smaller factor
      const scale = ComputerUseService.computeScaleFactor(1600, 900);
      const expectedByMp = Math.sqrt(1_150_000 / (1600 * 900));
      const expectedByEdge = 1568 / 1600;
      expect(scale).toBeCloseTo(Math.min(expectedByEdge, expectedByMp), 3);
    });

    it("returns 1.0 for small displays", () => {
      const scale = ComputerUseService.computeScaleFactor(1024, 768);
      expect(scale).toBe(1);
    });

    it("scales API coordinates back to screen space", () => {
      const scaleFactor = 0.8;
      const screenX = ComputerUseService.toScreenCoord(100, scaleFactor);
      expect(screenX).toBe(125); // 100 / 0.8
    });
  });

  describe("maxActions limit", () => {
    it("rejects if maxActions is 0", async () => {
      service = new ComputerUseService(backend, visualService as any, "test-api-key");
      const result = await service.execute({
        instruction: "do something",
        context: { type: "job", id: "job-1", automationId: "auto-1" },
        maxActions: 0,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/maxActions/i);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/unit/desktop/computer-use-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ComputerUseService**

```typescript
// packages/dashboard/src/desktop/computer-use-service.ts
import Anthropic from "@anthropic-ai/sdk";
import type { DesktopBackend } from "@my-agent/core";
import type { VisualActionService } from "../visual/visual-action-service.js";
import type { AssetContext, ScreenshotTag } from "@my-agent/core";
import { computeDiffRatio } from "../visual/screenshot-tagger.js";

export interface ComputerUseTask {
  instruction: string;
  context: AssetContext;
  model?: string;
  maxActions?: number;
  timeoutMs?: number;
  requireApproval?: boolean;
}

export interface ComputerUseResult {
  success: boolean;
  summary: string;
  screenshots: Array<{
    id: string;
    filename: string;
    path: string;
    tag: ScreenshotTag;
  }>;
  actionsPerformed: number;
  error?: string;
}

const DEFAULT_MAX_ACTIONS = 50;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_LONG_EDGE = 1568;
const MAX_MEGAPIXELS = 1_150_000;

export class ComputerUseService {
  private client: Anthropic;
  private running = false; // Mutex — max 1 concurrent desktop task

  constructor(
    private readonly backend: DesktopBackend,
    private readonly visualService: VisualActionService,
    apiKey: string,
    private readonly defaultModel: string = "claude-sonnet-4-20250514",
  ) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Compute the scale factor to fit a display within API constraints.
   * Max 1568px on longest edge, max ~1.15 megapixels.
   */
  static computeScaleFactor(width: number, height: number): number {
    const longEdge = Math.max(width, height);
    const edgeFactor = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1;
    const pixels = width * height;
    const mpFactor =
      pixels > MAX_MEGAPIXELS ? Math.sqrt(MAX_MEGAPIXELS / pixels) : 1;
    return Math.min(1, edgeFactor, mpFactor);
  }

  /**
   * Convert an API-space coordinate back to screen space.
   */
  static toScreenCoord(apiCoord: number, scaleFactor: number): number {
    return Math.round(apiCoord / scaleFactor);
  }

  /**
   * Execute a computer use task: screenshot -> action -> screenshot loop
   * using Claude's native computer_20251124 tool type.
   */
  async execute(task: ComputerUseTask): Promise<ComputerUseResult> {
    const maxActions = task.maxActions ?? DEFAULT_MAX_ACTIONS;
    const timeoutMs = task.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const model = task.model ?? this.defaultModel;

    if (maxActions <= 0) {
      return {
        success: false,
        summary: "",
        screenshots: [],
        actionsPerformed: 0,
        error: "maxActions must be greater than 0",
      };
    }

    // Mutex — only one desktop task at a time to prevent conflicting mouse/keyboard
    if (this.running) {
      return {
        success: false,
        summary: "",
        screenshots: [],
        actionsPerformed: 0,
        error: "Desktop is busy — another task is in progress. Try again in a minute or two.",
      };
    }
    this.running = true;

    const deadline = Date.now() + timeoutMs;
    const screenshots: ComputerUseResult["screenshots"] = [];
    let actionsPerformed = 0;
    let previousImageBuf: Buffer | null = null;

    // Get display info for coordinate scaling
    const display = await this.backend.displayInfo();
    const scaleFactor = ComputerUseService.computeScaleFactor(
      display.width,
      display.height,
    );
    const scaledWidth = Math.round(display.width * scaleFactor);
    const scaledHeight = Math.round(display.height * scaleFactor);

    // Take initial screenshot
    let screenshotBuf = await this.backend.screenshot();
    const initialSs = await this.visualService.store(screenshotBuf, {
      context: task.context,
      description: "Initial screenshot — before task",
      width: display.width,
      height: display.height,
    });
    screenshots.push({
      id: initialSs.id,
      filename: initialSs.filename,
      path: initialSs.path,
      tag: "keep",
    });
    previousImageBuf = screenshotBuf;

    // System prompt instructs model to tag screenshots
    const systemPrompt = `You are controlling a desktop computer to complete the user's task. After each action, you will receive a screenshot. For each tool_use response, include a "screenshot_tag" field: "keep" if the screenshot represents meaningful progress (new page loaded, target found, task milestone), or "skip" if it is an intermediate step (clicked menu, scrolled, waited for load). This helps manage screenshot storage efficiently.`;

    // Build initial messages
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: task.instruction,
          },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: screenshotBuf.toString("base64"),
            },
          },
        ],
      },
    ];

    // Computer use loop
    try {
      while (actionsPerformed < maxActions && Date.now() < deadline) {
        const response = await this.client.beta.messages.create({
          model,
          max_tokens: 4096,
          system: systemPrompt,
          tools: [
            {
              type: "computer_20251124",
              name: "computer",
              display_width_px: scaledWidth,
              display_height_px: scaledHeight,
            },
          ],
          messages,
          betas: ["computer-use-2025-11-24"],
        });

        // Check for stop condition
        if (response.stop_reason === "end_turn") {
          // Extract summary from text blocks
          const textBlocks = response.content.filter(
            (b): b is Anthropic.TextBlock => b.type === "text",
          );
          const summary = textBlocks.map((b) => b.text).join("\n");
          return {
            success: true,
            summary,
            screenshots,
            actionsPerformed,
          };
        }

        // Process tool use blocks
        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
        );

        if (toolUseBlocks.length === 0) {
          // No more actions — model is done
          const textBlocks = response.content.filter(
            (b): b is Anthropic.TextBlock => b.type === "text",
          );
          return {
            success: true,
            summary: textBlocks.map((b) => b.text).join("\n"),
            screenshots,
            actionsPerformed,
          };
        }

        // Execute each action
        for (const toolUse of toolUseBlocks) {
          const input = toolUse.input as Record<string, any>;
          await this.executeAction(input, scaleFactor);
          actionsPerformed++;

          // Take screenshot after action
          screenshotBuf = await this.backend.screenshot();

          // Determine tag: agent tagging is primary, pixel diff is fallback
          // The system prompt instructs the model to include "screenshot_tag": "keep" or "skip"
          // in its tool_use input when it has an opinion on screenshot importance
          let tag: ScreenshotTag = "keep"; // Default for first screenshot
          const agentTag = input.screenshot_tag as string | undefined;
          if (agentTag === "keep" || agentTag === "skip") {
            tag = agentTag; // Agent tagged — use directly
          } else if (previousImageBuf) {
            // Agent didn't tag — fall back to pixel diff
            const diffRatio = computeDiffRatio(screenshotBuf, previousImageBuf);
            tag = diffRatio >= 0.15 ? "keep" : "skip";
          }

          const ss = await this.visualService.store(screenshotBuf, {
            context: task.context,
            description: `After action: ${input.action}`,
            width: display.width,
            height: display.height,
          }, tag);
          screenshots.push({
            id: ss.id,
            filename: ss.filename,
            path: ss.path,
            tag,
          });
          previousImageBuf = screenshotBuf;

          // Build tool result with new screenshot
          messages.push({
            role: "assistant",
            content: response.content,
          });
          messages.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: "image/png",
                      data: screenshotBuf.toString("base64"),
                    },
                  },
                ],
              } as any,
            ],
          });
        }
      }

      // Hit limits
      const reason =
        actionsPerformed >= maxActions
          ? `Reached max actions limit (${maxActions})`
          : `Reached timeout (${timeoutMs}ms)`;
      return {
        success: false,
        summary: reason,
        screenshots,
        actionsPerformed,
        error: reason,
      };
    } catch (error) {
      return {
        success: false,
        summary: "",
        screenshots,
        actionsPerformed,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.running = false;
    }
  }

  /**
   * Execute a single computer use action via the backend.
   */
  private async executeAction(
    input: Record<string, any>,
    scaleFactor: number,
  ): Promise<void> {
    const action = input.action as string;
    const toScreen = (coord: number) =>
      ComputerUseService.toScreenCoord(coord, scaleFactor);

    switch (action) {
      case "click":
      case "left_click":
        await this.backend.click(
          toScreen(input.coordinate[0]),
          toScreen(input.coordinate[1]),
          "left",
        );
        break;
      case "right_click":
        await this.backend.click(
          toScreen(input.coordinate[0]),
          toScreen(input.coordinate[1]),
          "right",
        );
        break;
      case "middle_click":
        await this.backend.click(
          toScreen(input.coordinate[0]),
          toScreen(input.coordinate[1]),
          "middle",
        );
        break;
      case "double_click":
        await this.backend.doubleClick(
          toScreen(input.coordinate[0]),
          toScreen(input.coordinate[1]),
        );
        break;
      case "type":
        await this.backend.type(input.text);
        break;
      case "key":
        await this.backend.keyPress(input.text);
        break;
      case "mouse_move":
        await this.backend.mouseMove(
          toScreen(input.coordinate[0]),
          toScreen(input.coordinate[1]),
        );
        break;
      case "drag":
        await this.backend.mouseDrag(
          toScreen(input.start_coordinate[0]),
          toScreen(input.start_coordinate[1]),
          toScreen(input.coordinate[0]),
          toScreen(input.coordinate[1]),
        );
        break;
      case "scroll":
        await this.backend.scroll(
          toScreen(input.coordinate[0]),
          toScreen(input.coordinate[1]),
          input.direction,
          input.amount ?? 3,
        );
        break;
      case "screenshot":
        // Model requested a screenshot — already handled by the loop
        break;
      case "wait":
        await new Promise((resolve) =>
          setTimeout(resolve, (input.duration ?? 1) * 1000),
        );
        break;
      default:
        // Unknown action — log and skip
        console.warn(`[ComputerUseService] Unknown action: ${action}`);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/unit/desktop/computer-use-service.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/desktop/computer-use-service.ts packages/dashboard/tests/unit/desktop/computer-use-service.test.ts
git commit -m "feat(dashboard): ComputerUseService — Claude beta API bridge for native computer use"
```

---

## Task 6: Desktop MCP Server

**Files:**
- Create: `packages/dashboard/src/mcp/desktop-server.ts`
- Create: `packages/dashboard/tests/unit/mcp/desktop-server.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/dashboard/tests/unit/mcp/desktop-server.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDesktopMcpServer } from "../../../src/mcp/desktop-server.js";
import type { DesktopBackend, DisplayInfo } from "@my-agent/core";

function createMockBackend(): DesktopBackend {
  return {
    platform: "x11",
    capabilities: () => ({
      screenshot: true,
      mouse: true,
      keyboard: true,
      windowManagement: true,
      accessibility: false,
    }),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("png-data")),
    click: vi.fn().mockResolvedValue(undefined),
    doubleClick: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    keyPress: vi.fn().mockResolvedValue(undefined),
    mouseMove: vi.fn().mockResolvedValue(undefined),
    mouseDrag: vi.fn().mockResolvedValue(undefined),
    scroll: vi.fn().mockResolvedValue(undefined),
    listWindows: vi.fn().mockResolvedValue([
      {
        id: "0x01",
        title: "Terminal",
        appName: "Terminal",
        geometry: { x: 0, y: 0, width: 800, height: 600 },
        focused: true,
      },
    ]),
    activeWindow: vi.fn().mockResolvedValue(null),
    focusWindow: vi.fn().mockResolvedValue(undefined),
    windowScreenshot: vi.fn().mockResolvedValue(Buffer.from("png-data")),
    displayInfo: vi.fn().mockResolvedValue({
      width: 1920,
      height: 1080,
      scaleFactor: 1,
      monitors: [{ name: "eDP-1", x: 0, y: 0, width: 1920, height: 1080, primary: true }],
    } satisfies DisplayInfo),
  };
}

describe("createDesktopMcpServer", () => {
  it("creates a server with three tools", () => {
    const server = createDesktopMcpServer(createMockBackend(), null);
    expect(server).toBeDefined();
    expect(server.tools).toHaveLength(3);

    const names = server.tools.map((t: any) => t.name);
    expect(names).toContain("desktop_task");
    expect(names).toContain("desktop_screenshot");
    expect(names).toContain("desktop_info");
  });

  it("desktop_info returns capabilities when queried", async () => {
    const backend = createMockBackend();
    const server = createDesktopMcpServer(backend, null);
    const infoTool = server.tools.find((t: any) => t.name === "desktop_info");

    const result = await infoTool!.handler({ query: "capabilities" });
    expect(result).toBeDefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.screenshot).toBe(true);
    expect(parsed.mouse).toBe(true);
  });

  it("desktop_info returns windows list", async () => {
    const backend = createMockBackend();
    const server = createDesktopMcpServer(backend, null);
    const infoTool = server.tools.find((t: any) => t.name === "desktop_info");

    const result = await infoTool!.handler({ query: "windows" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe("Terminal");
  });

  it("desktop_info returns display info", async () => {
    const backend = createMockBackend();
    const server = createDesktopMcpServer(backend, null);
    const infoTool = server.tools.find((t: any) => t.name === "desktop_info");

    const result = await infoTool!.handler({ query: "display" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.width).toBe(1920);
    expect(parsed.height).toBe(1080);
  });

  it("desktop_screenshot returns image content block", async () => {
    const backend = createMockBackend();
    const server = createDesktopMcpServer(backend, null);
    const ssTool = server.tools.find((t: any) => t.name === "desktop_screenshot");

    const result = await ssTool!.handler({});
    expect(result.content[0].type).toBe("image");
    expect(result.content[0].data).toBe(Buffer.from("png-data").toString("base64"));
  });

  it("desktop_task returns error when no ComputerUseService", async () => {
    const server = createDesktopMcpServer(createMockBackend(), null);
    const taskTool = server.tools.find((t: any) => t.name === "desktop_task");

    const result = await taskTool!.handler({ instruction: "open chrome" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not available/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/unit/mcp/desktop-server.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the desktop MCP server**

```typescript
// packages/dashboard/src/mcp/desktop-server.ts
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { DesktopBackend } from "@my-agent/core";
import type { ComputerUseService } from "../desktop/computer-use-service.js";
import type { VisualActionService } from "../visual/visual-action-service.js";

/**
 * Create the desktop MCP server with three tools:
 * - desktop_task: delegates to ComputerUseService
 * - desktop_screenshot: takes screenshot, stores via VAS, returns image
 * - desktop_info: returns windows/display/capabilities as JSON
 *
 * Available to both Conversation Nina and Working Nina.
 */
export function createDesktopMcpServer(
  backend: DesktopBackend,
  computerUseService: ComputerUseService | null,
  visualService?: VisualActionService,
) {
  const tools = [
    {
      name: "desktop_task",
      description:
        "Perform a task on the desktop GUI. Uses Claude's trained computer use to see " +
        "the screen and interact with applications. Best for: navigating apps, filling forms, " +
        "clicking buttons, reading on-screen content. Describe WHAT you want done, not individual clicks.",
      schema: z.object({
        instruction: z.string().describe("What to do on the desktop"),
        maxActions: z.number().optional().describe("Max actions limit (default: 50)"),
      }),
      handler: async (input: { instruction: string; maxActions?: number }) => {
        if (!computerUseService) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Desktop task execution is not available. The ComputerUseService requires an Anthropic API key to be configured.",
              },
            ],
          };
        }

        try {
          // Context is passed through from the calling agent's active conversation or job
          // The MCP tool receives this via the extra parameter from the SDK
          const context = input._context ?? { type: "conversation", id: "active" };
          const result = await computerUseService.execute({
            instruction: input.instruction,
            context,
            maxActions: input.maxActions,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: result.success,
                  summary: result.summary,
                  actionsPerformed: result.actionsPerformed,
                  screenshotCount: result.screenshots.length,
                  error: result.error,
                }),
              },
            ],
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Desktop task failed: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      },
    },
    {
      name: "desktop_screenshot",
      description:
        "Take a screenshot of the desktop, a specific window, or a screen region. Returns the image for analysis.",
      schema: z.object({
        target: z
          .enum(["screen", "window", "region"])
          .optional()
          .describe("What to capture (default: screen)"),
        windowId: z.string().optional().describe("Window ID (from desktop_info)"),
        region: z
          .object({
            x: z.number(),
            y: z.number(),
            width: z.number(),
            height: z.number(),
          })
          .optional()
          .describe("Screen region to capture"),
      }),
      handler: async (input: {
        target?: string;
        windowId?: string;
        region?: { x: number; y: number; width: number; height: number };
      }) => {
        try {
          let buf: Buffer;

          if (input.target === "window" && input.windowId) {
            buf = await backend.windowScreenshot(input.windowId);
          } else if (input.target === "region" && input.region) {
            buf = await backend.screenshot({ region: input.region });
          } else {
            buf = await backend.screenshot();
          }

          // Store via VisualActionService if available (for audit trail + dashboard rendering)
          if (visualService) {
            const display = await backend.displayInfo();
            await visualService.store(buf, {
              context: input._context ?? { type: "conversation", id: "active" },
              description: input.description ?? "Manual desktop screenshot",
              width: display.width,
              height: display.height,
            });
          }

          return {
            content: [
              {
                type: "image",
                data: buf.toString("base64"),
                mimeType: "image/png",
              },
            ],
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Screenshot failed: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      },
    },
    {
      name: "desktop_info",
      description:
        "Get information about the desktop environment: open windows, display info, or available capabilities.",
      schema: z.object({
        query: z
          .enum(["windows", "display", "capabilities"])
          .describe("What information to return"),
      }),
      handler: async (input: { query: "windows" | "display" | "capabilities" }) => {
        try {
          let data: any;

          switch (input.query) {
            case "windows":
              data = await backend.listWindows();
              break;
            case "display":
              data = await backend.displayInfo();
              break;
            case "capabilities":
              data = backend.capabilities();
              break;
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(data, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Desktop info query failed: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      },
    },
  ];

  return createSdkMcpServer({
    name: "desktop-tools",
    tools,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/unit/mcp/desktop-server.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/mcp/desktop-server.ts packages/dashboard/tests/unit/mcp/desktop-server.test.ts
git commit -m "feat(dashboard): desktop MCP server — desktop_task, desktop_screenshot, desktop_info tools"
```

---

## Task 7: Safety Hook

**Files:**
- Create: `packages/dashboard/src/hooks/desktop-hooks.ts`
- Create: `packages/dashboard/tests/unit/hooks/desktop-hooks.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/dashboard/tests/unit/hooks/desktop-hooks.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createDesktopRateLimiter,
  createDesktopAuditLogger,
} from "../../../src/hooks/desktop-hooks.js";

describe("desktop-hooks", () => {
  describe("createDesktopRateLimiter", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("allows requests within rate limit", () => {
      const limiter = createDesktopRateLimiter({ maxPerMinute: 10 });
      const result = limiter.check();
      expect(result.allowed).toBe(true);
    });

    it("blocks requests exceeding rate limit", () => {
      const limiter = createDesktopRateLimiter({ maxPerMinute: 2 });
      limiter.check(); // 1
      limiter.check(); // 2
      const result = limiter.check(); // 3 — blocked
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/rate limit/i);
    });

    it("resets after one minute", () => {
      const limiter = createDesktopRateLimiter({ maxPerMinute: 1 });
      limiter.check(); // 1 — allowed
      const blocked = limiter.check(); // 2 — blocked
      expect(blocked.allowed).toBe(false);

      vi.advanceTimersByTime(60_000);
      const afterReset = limiter.check(); // window reset — allowed
      expect(afterReset.allowed).toBe(true);
    });
  });

  describe("createDesktopAuditLogger", () => {
    it("logs desktop tool invocations", () => {
      const entries: any[] = [];
      const logger = createDesktopAuditLogger((entry) => entries.push(entry));

      logger.log({
        tool: "desktop_task",
        instruction: "open chrome",
        timestamp: new Date().toISOString(),
      });

      expect(entries).toHaveLength(1);
      expect(entries[0].tool).toBe("desktop_task");
      expect(entries[0].instruction).toBe("open chrome");
    });

    it("includes timestamp in log entries", () => {
      const entries: any[] = [];
      const logger = createDesktopAuditLogger((entry) => entries.push(entry));

      logger.log({
        tool: "desktop_screenshot",
        timestamp: "2026-03-29T12:00:00Z",
      });

      expect(entries[0].timestamp).toBe("2026-03-29T12:00:00Z");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/unit/hooks/desktop-hooks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hooks**

```typescript
// packages/dashboard/src/hooks/desktop-hooks.ts

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
}

interface RateLimiterOptions {
  maxPerMinute: number;
}

interface RateLimiter {
  check(): RateLimitResult;
}

/**
 * Create a rate limiter for desktop tool invocations.
 * Sliding window: tracks invocations in the last 60 seconds.
 */
export function createDesktopRateLimiter(
  options: RateLimiterOptions,
): RateLimiter {
  const timestamps: number[] = [];

  return {
    check(): RateLimitResult {
      const now = Date.now();
      const windowStart = now - 60_000;

      // Remove timestamps outside the window
      while (timestamps.length > 0 && timestamps[0] <= windowStart) {
        timestamps.shift();
      }

      if (timestamps.length >= options.maxPerMinute) {
        return {
          allowed: false,
          reason: `Desktop tool rate limit exceeded (${options.maxPerMinute}/minute). Try again shortly.`,
        };
      }

      timestamps.push(now);
      return { allowed: true };
    },
  };
}

export interface AuditLogEntry {
  tool: string;
  instruction?: string;
  timestamp: string;
  [key: string]: any;
}

interface AuditLogger {
  log(entry: AuditLogEntry): void;
}

/**
 * Create an audit logger for desktop tool invocations.
 * Calls the provided sink function with each entry — the sink
 * can write to JSONL, append to a file, or publish via events.
 */
export function createDesktopAuditLogger(
  sink: (entry: AuditLogEntry) => void,
): AuditLogger {
  return {
    log(entry: AuditLogEntry): void {
      sink(entry);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/unit/hooks/desktop-hooks.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/hooks/desktop-hooks.ts packages/dashboard/tests/unit/hooks/desktop-hooks.test.ts
git commit -m "feat(dashboard): desktop safety hooks — rate limiter + audit logger"
```

---

## Task 8: Desktop Control Skill

**Files:**
- Create: `skills/desktop-control.md`

- [ ] **Step 1: Create the skill file**

```markdown
---
name: desktop-control
description: See and interact with GUI applications on the desktop using Claude's trained computer use.
level: brain
tools:
  - desktop_task
  - desktop_screenshot
  - desktop_info
---

# Desktop Control

You can see and interact with the desktop GUI using the desktop tools.

## When to use

- The user asks you to interact with a GUI application
- A task requires an app that has no CLI or API
- You need to visually verify something on screen

## When NOT to use

- The task can be done via Bash (prefer CLI — it's faster and more reliable)
- The task can be done via Playwright (prefer protocol-level browser control)
- You're unsure which app to use (ask the user first)

## Tools

- **desktop_info** — see what windows are open and what's available. Use first to orient.
- **desktop_screenshot** — see the current screen state without performing any action.
- **desktop_task** — perform a multi-step GUI task. Describe the goal ("open Chrome, go to analytics.google.com, screenshot the traffic chart"), not individual clicks. The computer use loop handles the details.

## Permission rules

- If the user asked you to do it → you have permission. Proceed.
- If YOU decide you need a desktop app → state which app and why, then wait for approval.
- Never interact with: password managers, banking apps, system settings (unless explicitly asked).
- When in doubt, take a screenshot first and describe what you see — let the user decide.

## Tips

- Start with `desktop_info` query "windows" to see what's already open.
- For browser tasks, prefer Playwright. Use desktop_task only for native GUI apps.
- Keep `maxActions` low for simple tasks (5-10) to avoid runaway loops.
- If a task is failing, stop and describe what you see rather than retrying blindly.
```

- [ ] **Step 2: Verify the file has valid frontmatter**

Run: `cd /home/nina/my_agent && node -e "const fs = require('fs'); const content = fs.readFileSync('skills/desktop-control.md', 'utf-8'); const match = content.match(/^---\\n([\\s\\S]*?)\\n---/); console.log(match ? 'Valid frontmatter' : 'MISSING frontmatter');"`
Expected: "Valid frontmatter"

- [ ] **Step 3: Commit**

```bash
git add skills/desktop-control.md
git commit -m "feat(skills): add desktop-control brain skill — when/how to use desktop tools"
```

---

## Task 9: Wire into App

**Files:**
- Modify: `packages/dashboard/src/app.ts`

- [ ] **Step 1: Read current app.ts to find the right insertion points**

Read `packages/dashboard/src/app.ts` — identify where MCP servers are registered and where startup logging happens.

- [ ] **Step 2: Add desktop imports at top of app.ts**

Add to the imports section:

```typescript
import { detectDesktopEnvironment } from "./desktop/desktop-capability-detector.js";
import { X11Backend } from "./desktop/x11-backend.js";
import { ComputerUseService } from "./desktop/computer-use-service.js";
import { createDesktopMcpServer } from "./mcp/desktop-server.js";
```

- [ ] **Step 3: Add desktop initialization in the startup section**

After existing MCP server registrations, add:

```typescript
// Desktop control — detect environment and create backend
const desktopEnv = await detectDesktopEnvironment();
let desktopBackend: DesktopBackend | null = null;
let computerUseService: ComputerUseService | null = null;

if (desktopEnv.backend === "x11") {
  desktopBackend = new X11Backend({
    hasXdotool: desktopEnv.tools.xdotool,
    hasMaim: desktopEnv.tools.maim,
    hasWmctrl: desktopEnv.tools.wmctrl,
  });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    computerUseService = new ComputerUseService(
      desktopBackend,
      visualActionService, // From S1
      apiKey,
    );
  }

  const desktopServer = createDesktopMcpServer(desktopBackend, computerUseService, visualActionService);
  // Register via addMcpServer (same pattern as existing MCP servers)
  addMcpServer("desktop-tools", desktopServer);

  // Wire safety hooks as SDK PreToolUse hooks
  // The rate limiter and audit logger apply to all desktop_* tool calls
  import { createDesktopRateLimiter, createDesktopAuditLogger } from "./hooks/desktop-hooks.js";
  const rateLimiter = createDesktopRateLimiter({ maxPerMinute: 10 });
  const auditLogger = createDesktopAuditLogger((entry) => {
    console.log(`[desktop-audit] ${entry.tool}: ${entry.instruction ?? "n/a"}`);
  });

  // Register as PreToolUse hook on desktop_* tools
  // Follow the existing hooks pattern — add to the Options.hooks configuration
  const desktopHook = {
    matcher: { toolName: /^desktop_/ },
    callback: async (input: any) => {
      const check = rateLimiter.check();
      if (!check.allowed) {
        return { decision: "block", message: check.reason };
      }
      auditLogger.log({
        tool: input.tool_name,
        instruction: input.tool_input?.instruction,
        timestamp: new Date().toISOString(),
      });
      return { decision: "allow" };
    },
  };
  // Add to the existing hooks array (follow the pattern in packages/dashboard/src/hooks/)
}

// Log desktop status at startup
if (desktopEnv.hasDisplay) {
  console.log(`[Desktop] Backend: ${desktopEnv.backend ?? "none"} | Tools: xdotool=${desktopEnv.tools.xdotool}, maim=${desktopEnv.tools.maim}, wmctrl=${desktopEnv.tools.wmctrl}`);
  if (desktopEnv.setupNeeded.length > 0) {
    console.log(`[Desktop] Missing: ${desktopEnv.setupNeeded.join(", ")}`);
  }
  if (!computerUseService) {
    console.log("[Desktop] ComputerUseService unavailable — set ANTHROPIC_API_KEY for desktop_task");
  }
} else {
  console.log("[Desktop] No display detected — desktop control disabled");
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean (may need to adjust import paths based on actual app.ts structure).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/app.ts
git commit -m "feat(dashboard): wire desktop control into app startup — detect, create backend, register MCP"
```

---

## Task 10: Settings UI

**Files:**
- Modify: `packages/dashboard/public/index.html` (or settings partial)
- Modify: `packages/dashboard/src/routes/` (add debug endpoint)

- [ ] **Step 1: Add the debug endpoint**

Add a new route in the appropriate routes file (or create `packages/dashboard/src/routes/desktop-routes.ts`):

```typescript
// packages/dashboard/src/routes/desktop-routes.ts
import type { FastifyInstance } from "fastify";
import type { DesktopEnvironment } from "@my-agent/core";

export function registerDesktopRoutes(
  fastify: FastifyInstance,
  getDesktopEnv: () => DesktopEnvironment,
): void {
  fastify.get("/api/debug/desktop-status", async () => {
    return getDesktopEnv();
  });
}
```

- [ ] **Step 2: Add desktop status section to settings UI**

In the settings panel HTML, add after the existing sections:

```html
<!-- Desktop Control -->
<div class="settings-section" x-data="{ desktopStatus: null }" x-init="
  fetch('/api/debug/desktop-status')
    .then(r => r.json())
    .then(data => desktopStatus = data)
    .catch(() => desktopStatus = null)
">
  <h3 class="settings-heading">Desktop Control</h3>

  <template x-if="desktopStatus === null">
    <p class="text-sm text-gray-400">Loading...</p>
  </template>

  <template x-if="desktopStatus && !desktopStatus.hasDisplay">
    <div class="flex items-center gap-2">
      <span class="w-2 h-2 rounded-full bg-gray-500"></span>
      <span class="text-sm text-gray-400">Not Available — no display detected</span>
    </div>
  </template>

  <template x-if="desktopStatus && desktopStatus.hasDisplay">
    <div class="space-y-3">
      <!-- Status indicator -->
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full"
              :class="desktopStatus.backend ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'"></span>
        <span class="text-sm" x-text="desktopStatus.backend
          ? 'Enabled (' + desktopStatus.backend.toUpperCase() + ')'
          : 'Display detected, backend unavailable'"></span>
      </div>

      <!-- Capabilities grid -->
      <div class="grid grid-cols-2 gap-1 text-xs">
        <template x-for="[key, val] in Object.entries(desktopStatus.capabilities)" :key="key">
          <div class="flex items-center gap-1">
            <span x-text="val ? '✓' : '✗'" :class="val ? 'text-green-400' : 'text-red-400'"></span>
            <span class="capitalize" x-text="key"></span>
          </div>
        </template>
      </div>

      <!-- Setup instructions -->
      <template x-if="desktopStatus.setupNeeded.length > 0">
        <div class="text-xs text-gray-400 mt-2">
          <p class="font-medium text-yellow-400 mb-1">Missing tools:</p>
          <ul class="list-disc list-inside space-y-0.5">
            <template x-for="item in desktopStatus.setupNeeded" :key="item">
              <li x-text="item"></li>
            </template>
          </ul>
          <p class="mt-1 text-gray-500">Install: <code class="text-xs">sudo apt install xdotool maim wmctrl</code></p>
        </div>
      </template>
    </div>
  </template>
</div>
```

- [ ] **Step 3: Register the desktop routes in server.ts**

Add to server.ts where routes are registered:

```typescript
import { registerDesktopRoutes } from "./routes/desktop-routes.js";
// ... in server setup:
registerDesktopRoutes(fastify, () => desktopEnv);
```

- [ ] **Step 4: Verify the endpoint works**

Run: `systemctl --user restart nina-dashboard.service && sleep 2 && curl -s http://localhost:4321/api/debug/desktop-status | head -c 200`
Expected: JSON response with desktop environment status.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/routes/desktop-routes.ts packages/dashboard/public/ packages/dashboard/src/server.ts
git commit -m "feat(dashboard): desktop control settings UI + /api/debug/desktop-status endpoint"
```

---

## Task 11: Hatching Integration

**Files:**
- Modify: `packages/dashboard/src/hatching/` (find the hatching steps definition)

- [ ] **Step 1: Read the hatching system to understand how steps are defined**

Read the hatching directory to find where HatchingSteps are registered. Look for the `HatchingStep` interface and how existing steps (API key, personality) are wired.

- [ ] **Step 2: Add optional Desktop Control hatching step**

Create a new hatching step that:
- Only shows if a display is detected (`desktopEnv.hasDisplay`)
- Shows detected capabilities and missing tools
- Offers install commands for the detected platform:
  - Ubuntu/Debian: `sudo apt install xdotool maim wmctrl`
  - Fedora: `sudo dnf install xdotool maim wmctrl`
- User can skip (desktop control stays disabled, everything else works)
- If user installs and re-runs detection, update capabilities

Follow the existing `HatchingStep` pattern — the step should be non-blocking and skippable.

- [ ] **Step 3: Test the hatching step manually**

Run the hatching wizard in the dashboard and verify the desktop step appears (if display detected) or is skipped (if no display).

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/hatching/
git commit -m "feat(dashboard): desktop control hatching step — guided setup for desktop tools"
```

---

## Task 12: Full Test Suite Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full dashboard test suite**

Run: `cd packages/dashboard && npx vitest run`
Expected: All tests pass, no regressions.

- [ ] **Step 2: Run TypeScript check**

Run: `cd packages/dashboard && npx tsc --noEmit && cd ../core && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 3: Verify dashboard starts**

Run: `systemctl --user restart nina-dashboard.service && sleep 2 && systemctl --user status nina-dashboard.service`
Expected: Active (running).

---

## Success Criteria

- [ ] DesktopBackend interface defined in core, re-exported
- [ ] Desktop environment detected at startup (X11/Wayland/macOS/none)
- [ ] X11Backend implements all DesktopBackend methods via xdotool + maim + wmctrl
- [ ] ComputerUseService bridges Claude beta API for native computer use loop
- [ ] Agent tagging (keep/skip) is primary screenshot tagging method, pixel diff is fallback
- [ ] Coordinate scaling handles displays larger than API limits (1568px / 1.15MP)
- [ ] Concurrent task mutex prevents conflicting desktop interactions
- [ ] Desktop MCP server uses createSdkMcpServer() pattern, exposes 3 tools to both agents
- [ ] desktop_screenshot stores via VisualActionService (not just returns raw buffer)
- [ ] Safety hooks wired as SDK PreToolUse hooks, enforce rate limiting and audit logging
- [ ] Desktop control skill teaches Nina when/how to use desktop tools
- [ ] Hatching step guides new users through desktop tool installation
- [ ] App.ts wires everything together with graceful degradation
- [ ] Settings UI shows desktop capabilities and setup instructions
- [ ] All tests pass, TypeScript compiles clean, dashboard starts
