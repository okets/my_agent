export type ScreenshotSource = "desktop" | "playwright" | "upload" | "web" | "generated";

export interface ScreenshotMetadata {
  description?: string;
  width: number;
  height: number;
  source: ScreenshotSource;
}

export interface Screenshot {
  id: string;
  filename: string;
  path: string;
  timestamp: string;
  width: number;
  height: number;
  sizeBytes: number;
  source: ScreenshotSource;
  description?: string;
  refs: string[];
}
