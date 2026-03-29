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
  click(x: number, y: number, button?: "left" | "right" | "middle"): Promise<void>;
  doubleClick(x: number, y: number): Promise<void>;
  type(text: string): Promise<void>;
  keyPress(keys: string): Promise<void>;
  mouseMove(x: number, y: number): Promise<void>;
  mouseDrag(fromX: number, fromY: number, toX: number, toY: number): Promise<void>;
  scroll(x: number, y: number, direction: "up" | "down" | "left" | "right", amount?: number): Promise<void>;
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
