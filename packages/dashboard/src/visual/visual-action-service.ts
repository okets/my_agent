/**
 * VisualActionService — centralized screenshot storage with ref-based lifecycle.
 *
 * All screenshots land in a single folder: {agentDir}/screenshots/
 * One index.jsonl file is the source of truth.
 * Producers store without context. Refs are added later when screenshots
 * become visible in conversations/jobs. Unreferenced screenshots expire
 * after 7 days.
 *
 * Refactored in M8-S3.5 from per-context storage to centralized.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Screenshot, ScreenshotMetadata } from "@my-agent/core";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export class VisualActionService {
  private listeners: Array<(screenshot: Screenshot) => void> = [];
  private readonly screenshotDir: string;
  private readonly indexPath: string;

  constructor(private agentDir: string) {
    this.screenshotDir = path.join(agentDir, "screenshots");
    this.indexPath = path.join(this.screenshotDir, "index.jsonl");
  }

  onScreenshot(callback: (screenshot: Screenshot) => void): () => void {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /**
   * Store a screenshot PNG buffer to disk, append to JSONL index, return Screenshot.
   * No context needed — screenshot starts with empty refs.
   */
  store(image: Buffer, metadata: ScreenshotMetadata): Screenshot {
    const id = `ss-${randomUUID()}`;
    const filename = `${id}.png`;

    fs.mkdirSync(this.screenshotDir, { recursive: true });

    const filePath = path.join(this.screenshotDir, filename);
    fs.writeFileSync(filePath, image);

    const screenshot: Screenshot = {
      id,
      filename,
      path: filePath,
      timestamp: new Date().toISOString(),
      width: metadata.width,
      height: metadata.height,
      sizeBytes: image.byteLength,
      source: metadata.source,
      description: metadata.description,
      refs: [],
    };

    this.appendToIndex(screenshot);

    for (const listener of this.listeners) {
      listener(screenshot);
    }

    return screenshot;
  }

  /**
   * Add a ref to a screenshot (e.g. "conv/abc", "job/auto-1/job-5").
   * No-op if the ref already exists or the screenshot is not found.
   */
  addRef(screenshotId: string, ref: string): void {
    this.addRefs([{ id: screenshotId, ref }]);
  }

  /**
   * Batch add refs — reads and writes the index once regardless of count.
   */
  addRefs(entries: Array<{ id: string; ref: string }>): void {
    if (entries.length === 0) return;

    const index = this.readIndex();
    const refMap = new Map<string, Set<string>>();
    for (const { id, ref } of entries) {
      if (!refMap.has(id)) refMap.set(id, new Set());
      refMap.get(id)!.add(ref);
    }

    let anyChanged = false;
    const updated = index.map((entry) => {
      const newRefs = refMap.get(entry.id);
      if (!newRefs) return entry;

      const merged = [...entry.refs];
      let entryChanged = false;
      for (const ref of newRefs) {
        if (!merged.includes(ref)) {
          merged.push(ref);
          entryChanged = true;
        }
      }
      if (entryChanged) {
        anyChanged = true;
        return { ...entry, refs: merged };
      }
      return entry;
    });

    if (anyChanged) {
      this.writeIndex(updated);
    }
  }

  /**
   * Remove all refs matching a prefix from all screenshots.
   * E.g. removeRefs("job/auto-1") removes "job/auto-1/job-1", "job/auto-1/job-2", etc.
   */
  removeRefs(refPrefix: string): void {
    const entries = this.readIndex();
    let changed = false;

    const updated = entries.map((entry) => {
      const filteredRefs = entry.refs.filter(
        (r) => !r.startsWith(refPrefix),
      );
      if (filteredRefs.length !== entry.refs.length) {
        changed = true;
        return { ...entry, refs: filteredRefs };
      }
      return entry;
    });

    if (changed) {
      this.writeIndex(updated);
    }
  }

  /**
   * Get a screenshot by ID. Returns null if not found.
   */
  get(id: string): Screenshot | null {
    const entries = this.readIndex();
    return entries.find((e) => e.id === id) ?? null;
  }

  /**
   * List screenshots with refs matching a prefix.
   */
  listByRef(refPrefix: string): Screenshot[] {
    return this.readIndex().filter((e) =>
      e.refs.some((r) => r.startsWith(refPrefix)),
    );
  }

  /**
   * List unreferenced screenshots (refs.length === 0).
   */
  listUnreferenced(): Screenshot[] {
    return this.readIndex().filter((e) => e.refs.length === 0);
  }

  /**
   * Get the serving URL for a screenshot.
   */
  url(screenshot: Screenshot): string {
    return `/api/assets/screenshots/${screenshot.filename}`;
  }

  /**
   * Delete a screenshot file + remove from index.
   */
  delete(id: string): void {
    const entries = this.readIndex();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;

    try {
      fs.unlinkSync(entry.path);
    } catch {
      // File may already be gone
    }

    this.writeIndex(entries.filter((e) => e.id !== id));
  }

  /**
   * Run cleanup — delete unreferenced screenshots older than maxAge.
   * Returns the number of files deleted.
   */
  cleanup(maxAgeMs: number = SEVEN_DAYS_MS): number {
    const entries = this.readIndex();
    const now = Date.now();
    let deleted = 0;
    const kept: Screenshot[] = [];

    for (const entry of entries) {
      const age = now - new Date(entry.timestamp).getTime();
      if (entry.refs.length === 0 && age >= maxAgeMs) {
        try {
          fs.unlinkSync(entry.path);
        } catch {
          // File may already be gone
        }
        deleted++;
      } else {
        kept.push(entry);
      }
    }

    if (deleted > 0) {
      this.writeIndex(kept);
    }

    return deleted;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private readIndex(): Screenshot[] {
    if (!fs.existsSync(this.indexPath)) {
      return [];
    }

    const content = fs.readFileSync(this.indexPath, "utf-8").trim();
    if (!content) return [];

    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Screenshot);
  }

  private writeIndex(entries: Screenshot[]): void {
    fs.mkdirSync(this.screenshotDir, { recursive: true });

    if (entries.length === 0) {
      try {
        fs.unlinkSync(this.indexPath);
      } catch {
        // noop
      }
      return;
    }

    fs.writeFileSync(
      this.indexPath,
      entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf-8",
    );
  }

  private appendToIndex(screenshot: Screenshot): void {
    fs.mkdirSync(this.screenshotDir, { recursive: true });
    fs.appendFileSync(
      this.indexPath,
      JSON.stringify(screenshot) + "\n",
    );
  }
}
