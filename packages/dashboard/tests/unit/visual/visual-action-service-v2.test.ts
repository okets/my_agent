import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { VisualActionService } from "../../../src/visual/visual-action-service.js";
import type { Screenshot, ScreenshotMetadata } from "@my-agent/core";

describe("VisualActionService (v2 — centralized)", () => {
  let agentDir: string;
  let vas: VisualActionService;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "vas-v2-"));
    vas = new VisualActionService(agentDir);
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  // ── store ──

  describe("store", () => {
    it("stores a PNG file and returns Screenshot metadata", () => {
      const image = Buffer.from("fake-png");
      const metadata: ScreenshotMetadata = {
        description: "test screenshot",
        width: 1920,
        height: 1080,
        source: "desktop",
      };

      const ss = vas.store(image, metadata);

      expect(ss.id).toMatch(/^ss-/);
      expect(ss.filename).toBe(`${ss.id}.png`);
      expect(ss.path).toBe(join(agentDir, "screenshots", ss.filename));
      expect(existsSync(ss.path)).toBe(true);
      expect(ss.width).toBe(1920);
      expect(ss.height).toBe(1080);
      expect(ss.source).toBe("desktop");
      expect(ss.description).toBe("test screenshot");
      expect(ss.sizeBytes).toBe(image.byteLength);
      expect(ss.refs).toEqual([]);
    });

    it("appends to index.jsonl", () => {
      const image = Buffer.from("data");
      vas.store(image, { width: 100, height: 100, source: "desktop" });
      vas.store(image, { width: 100, height: 100, source: "playwright" });

      const indexPath = join(agentDir, "screenshots", "index.jsonl");
      const lines = readFileSync(indexPath, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(2);

      const first = JSON.parse(lines[0]);
      expect(first.source).toBe("desktop");
      const second = JSON.parse(lines[1]);
      expect(second.source).toBe("playwright");
    });

    it("fires onScreenshot listeners", () => {
      const received: Screenshot[] = [];
      vas.onScreenshot((ss) => received.push(ss));

      vas.store(Buffer.from("x"), { width: 10, height: 10, source: "upload" });

      expect(received).toHaveLength(1);
      expect(received[0].source).toBe("upload");
    });
  });

  // ── get ──

  describe("get", () => {
    it("returns a screenshot by ID", () => {
      const ss = vas.store(Buffer.from("data"), {
        width: 100,
        height: 100,
        source: "desktop",
      });

      const found = vas.get(ss.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(ss.id);
    });

    it("returns null for unknown ID", () => {
      expect(vas.get("ss-nonexistent")).toBeNull();
    });
  });

  // ── addRef / removeRefs ──

  describe("refs", () => {
    it("addRef adds a ref to a screenshot", () => {
      const ss = vas.store(Buffer.from("data"), {
        width: 100,
        height: 100,
        source: "desktop",
      });
      expect(ss.refs).toEqual([]);

      vas.addRef(ss.id, "conv/abc");

      const updated = vas.get(ss.id);
      expect(updated!.refs).toEqual(["conv/abc"]);
    });

    it("addRef does not duplicate refs", () => {
      const ss = vas.store(Buffer.from("data"), {
        width: 100,
        height: 100,
        source: "desktop",
      });

      vas.addRef(ss.id, "conv/abc");
      vas.addRef(ss.id, "conv/abc");

      expect(vas.get(ss.id)!.refs).toEqual(["conv/abc"]);
    });

    it("addRefs batch adds multiple refs in one read-write", () => {
      const ss1 = vas.store(Buffer.from("a"), {
        width: 100,
        height: 100,
        source: "desktop",
      });
      const ss2 = vas.store(Buffer.from("b"), {
        width: 100,
        height: 100,
        source: "desktop",
      });

      vas.addRefs([
        { id: ss1.id, ref: "conv/abc" },
        { id: ss1.id, ref: "conv/def" },
        { id: ss2.id, ref: "conv/abc" },
      ]);

      expect(vas.get(ss1.id)!.refs).toEqual(["conv/abc", "conv/def"]);
      expect(vas.get(ss2.id)!.refs).toEqual(["conv/abc"]);
    });

    it("addRefs deduplicates", () => {
      const ss = vas.store(Buffer.from("data"), {
        width: 100,
        height: 100,
        source: "desktop",
      });
      vas.addRef(ss.id, "conv/abc");

      vas.addRefs([
        { id: ss.id, ref: "conv/abc" },
        { id: ss.id, ref: "conv/def" },
      ]);

      expect(vas.get(ss.id)!.refs).toEqual(["conv/abc", "conv/def"]);
    });

    it("removeRefs removes all refs matching a prefix", () => {
      const ss1 = vas.store(Buffer.from("a"), {
        width: 100,
        height: 100,
        source: "desktop",
      });
      const ss2 = vas.store(Buffer.from("b"), {
        width: 100,
        height: 100,
        source: "desktop",
      });

      vas.addRef(ss1.id, "job/auto-1/job-1");
      vas.addRef(ss1.id, "conv/main");
      vas.addRef(ss2.id, "job/auto-1/job-2");

      // Delete all refs for automation auto-1
      vas.removeRefs("job/auto-1");

      expect(vas.get(ss1.id)!.refs).toEqual(["conv/main"]);
      expect(vas.get(ss2.id)!.refs).toEqual([]);
    });
  });

  // ── listByRef ──

  describe("listByRef", () => {
    it("returns screenshots with refs matching a prefix", () => {
      const ss1 = vas.store(Buffer.from("a"), {
        width: 100,
        height: 100,
        source: "desktop",
      });
      const ss2 = vas.store(Buffer.from("b"), {
        width: 100,
        height: 100,
        source: "playwright",
      });

      vas.addRef(ss1.id, "conv/main");
      vas.addRef(ss2.id, "job/auto-1/job-1");

      const convScreenshots = vas.listByRef("conv/");
      expect(convScreenshots).toHaveLength(1);
      expect(convScreenshots[0].id).toBe(ss1.id);

      const jobScreenshots = vas.listByRef("job/auto-1");
      expect(jobScreenshots).toHaveLength(1);
      expect(jobScreenshots[0].id).toBe(ss2.id);
    });
  });

  // ── listUnreferenced ──

  describe("listUnreferenced", () => {
    it("returns screenshots with empty refs", () => {
      vas.store(Buffer.from("a"), {
        width: 100,
        height: 100,
        source: "desktop",
      });
      const ss2 = vas.store(Buffer.from("b"), {
        width: 100,
        height: 100,
        source: "desktop",
      });
      vas.addRef(ss2.id, "conv/x");

      const unreferenced = vas.listUnreferenced();
      expect(unreferenced).toHaveLength(1);
      expect(unreferenced[0].refs).toEqual([]);
    });
  });

  // ── url ──

  describe("url", () => {
    it("returns the serving URL for a screenshot", () => {
      const ss = vas.store(Buffer.from("data"), {
        width: 100,
        height: 100,
        source: "desktop",
      });

      expect(vas.url(ss)).toBe(`/api/assets/screenshots/${ss.filename}`);
    });
  });

  // ── delete ──

  describe("delete", () => {
    it("deletes the file and removes from index", () => {
      const ss = vas.store(Buffer.from("data"), {
        width: 100,
        height: 100,
        source: "desktop",
      });

      expect(existsSync(ss.path)).toBe(true);

      vas.delete(ss.id);

      expect(existsSync(ss.path)).toBe(false);
      expect(vas.get(ss.id)).toBeNull();
    });
  });

  // ── cleanup ──

  describe("cleanup", () => {
    it("deletes unreferenced screenshots older than maxAge", () => {
      const ss = vas.store(Buffer.from("old"), {
        width: 100,
        height: 100,
        source: "desktop",
      });

      // Manually backdate the timestamp in the index
      const indexPath = join(agentDir, "screenshots", "index.jsonl");
      const content = readFileSync(indexPath, "utf-8");
      const oldTimestamp = new Date(
        Date.now() - 8 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const backdated = content.replace(ss.timestamp, oldTimestamp);
      writeFileSync(indexPath, backdated);

      // Reload index after manual edit
      vas = new VisualActionService(agentDir);

      const deleted = vas.cleanup(7 * 24 * 60 * 60 * 1000);
      expect(deleted).toBe(1);
      expect(existsSync(ss.path)).toBe(false);
    });

    it("does not delete referenced screenshots regardless of age", () => {
      const ss = vas.store(Buffer.from("referenced"), {
        width: 100,
        height: 100,
        source: "desktop",
      });
      vas.addRef(ss.id, "conv/main");

      // Backdate
      const indexPath = join(agentDir, "screenshots", "index.jsonl");
      const content = readFileSync(indexPath, "utf-8");
      const oldTimestamp = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const backdated = content.replace(ss.timestamp, oldTimestamp);
      writeFileSync(indexPath, backdated);
      vas = new VisualActionService(agentDir);

      const deleted = vas.cleanup(7 * 24 * 60 * 60 * 1000);
      expect(deleted).toBe(0);
      expect(existsSync(ss.path)).toBe(true);
    });

    it("defaults to 7-day maxAge", () => {
      const ss = vas.store(Buffer.from("recent"), {
        width: 100,
        height: 100,
        source: "desktop",
      });

      // Recent screenshot should not be deleted
      const deleted = vas.cleanup();
      expect(deleted).toBe(0);
      expect(existsSync(ss.path)).toBe(true);
    });
  });
});
