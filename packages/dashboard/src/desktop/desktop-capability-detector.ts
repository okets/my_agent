import { execFileSync } from "node:child_process";
import type { DesktopEnvironment, DesktopCapabilities } from "@my-agent/core";

function hasCommand(cmd: string): boolean {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function detectDesktopEnvironment(): DesktopEnvironment {
  const platform = process.platform;
  const xdgSessionType = process.env["XDG_SESSION_TYPE"]?.toLowerCase();
  const display = process.env["DISPLAY"];
  const waylandDisplay = process.env["WAYLAND_DISPLAY"];

  // Probe available tools
  const tools = {
    nutJs: false, // nut-js is a Node module, not a CLI tool — treated as absent
    xdotool: hasCommand("xdotool"),
    maim: hasCommand("maim"),
    wmctrl: hasCommand("wmctrl"),
    ydotool: hasCommand("ydotool"),
    kdotool: hasCommand("kdotool"),
    spectacle: hasCommand("spectacle"),
  };

  // Determine display server
  let displayServer: DesktopEnvironment["displayServer"] = "none";

  if (platform === "darwin") {
    displayServer = "macos";
  } else if (xdgSessionType === "wayland" || (!xdgSessionType && !!waylandDisplay)) {
    displayServer = "wayland";
  } else if (xdgSessionType === "x11" || (!xdgSessionType && !!display)) {
    displayServer = "x11";
  }

  const hasDisplay = displayServer !== "none";

  // Determine backend
  let backend: DesktopEnvironment["backend"] = null;
  if (displayServer === "macos") {
    backend = "macos";
  } else if (displayServer === "x11" && (tools.xdotool || tools.maim || tools.wmctrl)) {
    backend = "x11";
  } else if (displayServer === "wayland" && (tools.ydotool || tools.kdotool || tools.spectacle)) {
    backend = "wayland";
  }

  // Build capabilities based on backend and available tools
  const capabilities: DesktopCapabilities = buildCapabilities(backend, tools);

  // Build setupNeeded list
  const setupNeeded: string[] = buildSetupNeeded(displayServer, tools);

  return {
    displayServer,
    hasDisplay,
    backend,
    tools,
    capabilities,
    setupNeeded,
  };
}

function buildCapabilities(
  backend: DesktopEnvironment["backend"],
  tools: DesktopEnvironment["tools"],
): DesktopCapabilities {
  if (backend === "macos") {
    return {
      screenshot: true,
      mouse: true,
      keyboard: true,
      windowManagement: true,
      accessibility: true,
    };
  }

  if (backend === "x11") {
    return {
      screenshot: tools.maim,
      mouse: tools.xdotool,
      keyboard: tools.xdotool,
      windowManagement: tools.wmctrl,
      accessibility: false,
    };
  }

  if (backend === "wayland") {
    return {
      screenshot: tools.spectacle,
      mouse: tools.ydotool || tools.kdotool,
      keyboard: tools.ydotool || tools.kdotool,
      windowManagement: false,
      accessibility: false,
    };
  }

  return {
    screenshot: false,
    mouse: false,
    keyboard: false,
    windowManagement: false,
    accessibility: false,
  };
}

function buildSetupNeeded(
  displayServer: DesktopEnvironment["displayServer"],
  tools: DesktopEnvironment["tools"],
): string[] {
  const needed: string[] = [];

  if (displayServer === "none") {
    needed.push("No display server detected. Set DISPLAY or WAYLAND_DISPLAY.");
    return needed;
  }

  if (displayServer === "x11") {
    if (!tools.xdotool) needed.push("xdotool (mouse/keyboard control): sudo apt install xdotool");
    if (!tools.maim) needed.push("maim (screenshots): sudo apt install maim");
    if (!tools.wmctrl) needed.push("wmctrl (window management): sudo apt install wmctrl");
  }

  if (displayServer === "wayland") {
    if (!tools.ydotool && !tools.kdotool) {
      needed.push("ydotool (mouse/keyboard control): sudo apt install ydotool");
    }
    if (!tools.spectacle) {
      needed.push("spectacle (screenshots): sudo apt install kde-spectacle");
    }
  }

  return needed;
}
