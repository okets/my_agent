import { execFileSync } from "node:child_process";
import type {
  DesktopBackend,
  DesktopCapabilities,
  WindowInfo,
  DisplayInfo,
  ScreenshotOptions,
} from "@my-agent/core";

export interface X11ToolAvailability {
  hasXdotool: boolean;
  hasMaim: boolean;
  hasWmctrl: boolean;
}

const EXEC_OPTIONS = { timeout: 5000, stdio: "pipe" as const };

const BUTTON_MAP: Record<"left" | "right" | "middle", string> = {
  left: "1",
  middle: "2",
  right: "3",
};

const SCROLL_MAP: Record<"up" | "down" | "left" | "right", string> = {
  up: "4",
  down: "5",
  left: "6",
  right: "7",
};

export class X11Backend implements DesktopBackend {
  readonly platform = "x11" as const;
  private readonly caps: DesktopCapabilities;

  constructor(private readonly tools: X11ToolAvailability) {
    this.caps = {
      screenshot: tools.hasMaim,
      mouse: tools.hasXdotool,
      keyboard: tools.hasXdotool,
      windowManagement: tools.hasWmctrl,
      accessibility: false,
    };
  }

  capabilities(): DesktopCapabilities {
    return { ...this.caps };
  }

  private requireCapability(cap: keyof DesktopCapabilities): void {
    if (!this.caps[cap]) {
      throw new Error(`Desktop "${cap}" not available. Missing tools.`);
    }
  }

  async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
    this.requireCapability("screenshot");

    const args = ["--format", "png", "--hidecursor"];

    if (options?.windowId) {
      args.push("--window", options.windowId);
    } else if (options?.region) {
      const { x, y, width, height } = options.region;
      args.push("--geometry", `${width}x${height}+${x}+${y}`);
    }

    return execFileSync("maim", args, { ...EXEC_OPTIONS, encoding: "buffer" });
  }

  async click(
    x: number,
    y: number,
    button: "left" | "right" | "middle" = "left",
  ): Promise<void> {
    this.requireCapability("mouse");
    execFileSync(
      "xdotool",
      ["mousemove", "--sync", String(x), String(y)],
      EXEC_OPTIONS,
    );
    execFileSync("xdotool", ["click", BUTTON_MAP[button]], EXEC_OPTIONS);
  }

  async doubleClick(x: number, y: number): Promise<void> {
    this.requireCapability("mouse");
    execFileSync(
      "xdotool",
      ["mousemove", "--sync", String(x), String(y)],
      EXEC_OPTIONS,
    );
    execFileSync(
      "xdotool",
      ["click", "--repeat", "2", "--delay", "50", BUTTON_MAP.left],
      EXEC_OPTIONS,
    );
  }

  async type(text: string): Promise<void> {
    this.requireCapability("keyboard");
    execFileSync("xdotool", ["type", "--delay", "12", text], EXEC_OPTIONS);
  }

  async keyPress(keys: string): Promise<void> {
    this.requireCapability("keyboard");
    execFileSync("xdotool", ["key", keys], EXEC_OPTIONS);
  }

  async mouseMove(x: number, y: number): Promise<void> {
    this.requireCapability("mouse");
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
    this.requireCapability("mouse");
    execFileSync(
      "xdotool",
      ["mousemove", "--sync", String(fromX), String(fromY)],
      EXEC_OPTIONS,
    );
    execFileSync("xdotool", ["mousedown", BUTTON_MAP.left], EXEC_OPTIONS);
    execFileSync(
      "xdotool",
      ["mousemove", "--sync", String(toX), String(toY)],
      EXEC_OPTIONS,
    );
    execFileSync("xdotool", ["mouseup", BUTTON_MAP.left], EXEC_OPTIONS);
  }

  async scroll(
    x: number,
    y: number,
    direction: "up" | "down" | "left" | "right",
    amount = 3,
  ): Promise<void> {
    this.requireCapability("mouse");
    execFileSync(
      "xdotool",
      ["mousemove", "--sync", String(x), String(y)],
      EXEC_OPTIONS,
    );
    for (let i = 0; i < amount; i++) {
      execFileSync("xdotool", ["click", SCROLL_MAP[direction]], EXEC_OPTIONS);
    }
  }

  async listWindows(): Promise<WindowInfo[]> {
    this.requireCapability("windowManagement");

    try {
      const output = execFileSync("wmctrl", ["-l"], {
        ...EXEC_OPTIONS,
        encoding: "utf8",
      });
      return parseWmctrlOutput(output);
    } catch {
      // Fallback to xdotool if wmctrl fails
      if (this.tools.hasXdotool) {
        const output = execFileSync("xdotool", ["search", "--name", ""], {
          ...EXEC_OPTIONS,
          encoding: "utf8",
        });
        return output
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((id) => ({
            id: id.trim(),
            title: "",
            appName: "",
            geometry: { x: 0, y: 0, width: 0, height: 0 },
            focused: false,
          }));
      }
      return [];
    }
  }

  async activeWindow(): Promise<WindowInfo | null> {
    this.requireCapability("windowManagement");

    try {
      const idRaw = execFileSync("xdotool", ["getactivewindow"], {
        ...EXEC_OPTIONS,
        encoding: "utf8",
      }).trim();
      const titleRaw = execFileSync("xdotool", ["getwindowname", idRaw], {
        ...EXEC_OPTIONS,
        encoding: "utf8",
      }).trim();
      return {
        id: idRaw,
        title: titleRaw,
        appName: "",
        geometry: { x: 0, y: 0, width: 0, height: 0 },
        focused: true,
      };
    } catch {
      return null;
    }
  }

  async focusWindow(windowId: string): Promise<void> {
    this.requireCapability("windowManagement");
    execFileSync(
      "xdotool",
      ["windowactivate", "--sync", windowId],
      EXEC_OPTIONS,
    );
    // 100ms settle delay for window to take focus
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  async windowScreenshot(windowId: string): Promise<Buffer> {
    this.requireCapability("screenshot");
    return execFileSync(
      "maim",
      ["--format", "png", "--hidecursor", "--window", windowId],
      {
        ...EXEC_OPTIONS,
        encoding: "buffer",
      },
    );
  }

  async displayInfo(): Promise<DisplayInfo> {
    let width = 0;
    let height = 0;

    try {
      const xdpyinfo = execFileSync("xdpyinfo", [], {
        ...EXEC_OPTIONS,
        encoding: "utf8",
      });
      const dimMatch = xdpyinfo.match(/dimensions:\s+(\d+)x(\d+)\s+pixels/);
      if (dimMatch) {
        width = parseInt(dimMatch[1], 10);
        height = parseInt(dimMatch[2], 10);
      }
    } catch {
      // xdpyinfo not available, use defaults
    }

    const monitors = [];
    try {
      const xrandr = execFileSync("xrandr", ["--query"], {
        ...EXEC_OPTIONS,
        encoding: "utf8",
      });
      const lines = xrandr.split("\n");
      for (const line of lines) {
        // Match lines like: "eDP-1 connected primary 1920x1080+0+0 ..."
        const m = line.match(
          /^(\S+)\s+connected(?:\s+primary)?\s+(\d+)x(\d+)\+(\d+)\+(\d+)/,
        );
        if (m) {
          const isPrimary = line.includes(" primary ");
          monitors.push({
            name: m[1],
            width: parseInt(m[2], 10),
            height: parseInt(m[3], 10),
            x: parseInt(m[4], 10),
            y: parseInt(m[5], 10),
            primary: isPrimary,
          });
        }
      }
    } catch {
      // xrandr not available
    }

    return {
      width,
      height,
      scaleFactor: 1,
      displayNumber: 0,
      monitors,
    };
  }
}

function parseWmctrlOutput(output: string): WindowInfo[] {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      // wmctrl -l format: <id>  <desktop>  <hostname>  <title>
      const parts = line.split(/\s+/);
      const id = parts[0] ?? "";
      // hostname is parts[2], title is the rest
      const title = parts.slice(3).join(" ");
      return {
        id,
        title,
        appName: "",
        geometry: { x: 0, y: 0, width: 0, height: 0 },
        focused: false,
      };
    });
}
