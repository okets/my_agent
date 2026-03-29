/**
 * VisualActionService — screenshot storage, indexing, and URL generation
 *
 * Screenshots are stored to disk as PNGs with a JSONL index per context.
 * The JSONL file is the source of truth; the filesystem is the asset store.
 *
 * Storage paths:
 *   Job:          {agentDir}/automations/.runs/{automationId}/{jobId}/screenshots/{uuid}.png
 *   Conversation: {agentDir}/conversations/{conversationId}/screenshots/{uuid}.png
 *
 * URL patterns:
 *   Job:          /api/assets/job/{automationId}/{jobId}/screenshots/{filename}
 *   Conversation: /api/assets/conversation/{conversationId}/screenshots/{filename}
 */

import fs, { unlinkSync, writeFileSync } from "node:fs";
import path, { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Screenshot, ScreenshotMetadata, ScreenshotTag, AssetContext } from "@my-agent/core";

export class VisualActionService {
  private listeners: Array<(screenshot: Screenshot) => void> = [];

  constructor(private agentDir: string) {}

  onScreenshot(callback: (screenshot: Screenshot) => void): void {
    this.listeners.push(callback);
  }

  /**
   * Store a screenshot PNG buffer to disk, append to JSONL index, return Screenshot metadata.
   */
  store(
    image: Buffer,
    metadata: ScreenshotMetadata,
    tag: ScreenshotTag = "keep",
  ): Screenshot {
    const id = `ss-${randomUUID()}`;
    const filename = `${id}.png`;
    const dir = this.screenshotDir(metadata.context);

    fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, image);

    const screenshot: Screenshot = {
      id,
      filename,
      path: filePath,
      timestamp: new Date().toISOString(),
      context: metadata.context,
      tag,
      description: metadata.description,
      width: metadata.width,
      height: metadata.height,
      sizeBytes: image.byteLength,
    };

    this.appendToIndex(dir, screenshot);

    for (const listener of this.listeners) {
      listener(screenshot);
    }

    return screenshot;
  }

  /**
   * Read all screenshots for a given context from the JSONL index.
   */
  list(context: AssetContext): Screenshot[] {
    const dir = this.screenshotDir(context);
    const indexPath = path.join(dir, "index.jsonl");

    if (!fs.existsSync(indexPath)) {
      return [];
    }

    const content = fs.readFileSync(indexPath, "utf-8").trim();
    if (!content) return [];

    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Screenshot);
  }

  /**
   * Generate a serving URL for a screenshot.
   */
  url(screenshot: Screenshot): string {
    const ctx = screenshot.context;
    if (ctx.type === "job") {
      return `/api/assets/job/${ctx.automationId}/${ctx.id}/screenshots/${screenshot.filename}`;
    }
    return `/api/assets/conversation/${ctx.id}/screenshots/${screenshot.filename}`;
  }

  /**
   * Update the tag of a screenshot by rewriting its JSONL entry.
   */
  updateTag(context: AssetContext, screenshotId: string, tag: ScreenshotTag): void {
    const dir = this.screenshotDir(context);
    const indexPath = path.join(dir, "index.jsonl");

    if (!fs.existsSync(indexPath)) {
      throw new Error(`Screenshot index not found for context: ${JSON.stringify(context)}`);
    }

    const content = fs.readFileSync(indexPath, "utf-8").trim();
    if (!content) return;

    const lines = content.split("\n").filter((line) => line.trim());
    const updated = lines.map((line) => {
      const entry = JSON.parse(line) as Screenshot;
      if (entry.id === screenshotId) {
        return JSON.stringify({ ...entry, tag });
      }
      return line;
    });

    fs.writeFileSync(indexPath, updated.join("\n") + "\n");
  }

  /**
   * Delete skip-tagged screenshots older than retentionMs, unless their description
   * matches error/escalation patterns. Rewrites the JSONL index to reflect deletions.
   * Returns the number of files deleted.
   */
  cleanup(context: AssetContext, retentionMs: number): number {
    const dir = this.screenshotDir(context);
    const screenshots = this.list(context);
    const now = Date.now();
    let deleted = 0;
    const protectedDescriptions = /error|escalat/i;

    const kept: Screenshot[] = [];
    for (const ss of screenshots) {
      const age = now - new Date(ss.timestamp).getTime();
      const isProtected = ss.description && protectedDescriptions.test(ss.description);
      if (ss.tag === "skip" && age >= retentionMs && !isProtected) {
        try {
          unlinkSync(ss.path);
          deleted++;
        } catch {
          deleted++;
        }
      } else {
        kept.push(ss);
      }
    }

    // Rewrite the index
    const indexPath = join(dir, "index.jsonl");
    if (kept.length === 0) {
      try { unlinkSync(indexPath); } catch { /* noop */ }
    } else {
      writeFileSync(indexPath, kept.map((s) => JSON.stringify(s)).join("\n") + "\n", "utf-8");
    }

    return deleted;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private screenshotDir(context: AssetContext): string {
    if (context.type === "job") {
      return path.join(
        this.agentDir,
        "automations",
        ".runs",
        context.automationId!,
        context.id,
        "screenshots",
      );
    }
    return path.join(this.agentDir, "conversations", context.id, "screenshots");
  }

  private appendToIndex(dir: string, screenshot: Screenshot): void {
    const indexPath = path.join(dir, "index.jsonl");
    fs.appendFileSync(indexPath, JSON.stringify(screenshot) + "\n");
  }
}
