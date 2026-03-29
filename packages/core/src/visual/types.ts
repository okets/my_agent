export type ScreenshotTag = "keep" | "skip";

export interface AssetContext {
  type: "job" | "conversation";
  id: string;
  automationId?: string; // For job context
}

export interface CaptureOptions {
  source: "desktop" | "window" | "region";
  windowId?: string;
  region?: { x: number; y: number; width: number; height: number };
  context: AssetContext;
  description?: string;
}

export interface ScreenshotMetadata {
  context: AssetContext;
  description?: string;
  width: number;
  height: number;
}

export interface Screenshot {
  id: string;
  filename: string;
  path: string;
  timestamp: string;
  context: AssetContext;
  tag: ScreenshotTag;
  description?: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface ScreenshotIndex {
  /** Append a screenshot entry to the JSONL index */
  append(screenshot: Screenshot): void;
  /** Read all entries from the JSONL index */
  readAll(): Screenshot[];
  /** Update the tag of a screenshot by ID */
  updateTag(id: string, tag: ScreenshotTag): void;
}
