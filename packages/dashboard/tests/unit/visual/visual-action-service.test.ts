import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { VisualActionService } from "../../../src/visual/visual-action-service.js";
import type { AssetContext } from "@my-agent/core";

// Minimal 1×1 PNG buffer (67 bytes)
const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
    "0000000a49444154789c6260000000020001e221bc330000000049454e44ae426082",
  "hex",
);

describe("VisualActionService", () => {
  let agentDir: string;
  let service: VisualActionService;
  let jobContext: AssetContext;
  let convContext: AssetContext;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "visual-service-"));
    service = new VisualActionService(agentDir);

    jobContext = {
      type: "job",
      id: "job-abc",
      automationId: "auto-xyz",
    };

    convContext = {
      type: "conversation",
      id: "conv-123",
    };
  });

  // ── store() ──────────────────────────────────────────────────────────────────

  it("store() saves screenshot and returns correct metadata", () => {
    const ss = service.store(TINY_PNG, {
      context: jobContext,
      description: "home screen",
      width: 1920,
      height: 1080,
    });

    expect(ss.id).toMatch(/^ss-/);
    expect(ss.context).toEqual(jobContext);
    expect(ss.description).toBe("home screen");
    expect(ss.width).toBe(1920);
    expect(ss.height).toBe(1080);
    expect(ss.sizeBytes).toBe(TINY_PNG.byteLength);
    expect(ss.tag).toBe("keep");
    expect(ss.filename).toBe(`${ss.id}.png`);
    expect(ss.timestamp).toBeTruthy();
  });

  it("store() tag defaults to 'keep'", () => {
    const ss = service.store(TINY_PNG, { context: jobContext, width: 800, height: 600 });
    expect(ss.tag).toBe("keep");
  });

  it("store() accepts explicit tag 'skip'", () => {
    const ss = service.store(TINY_PNG, { context: jobContext, width: 800, height: 600 }, "skip");
    expect(ss.tag).toBe("skip");
  });

  it("store() writes PNG file to disk", () => {
    const ss = service.store(TINY_PNG, { context: jobContext, width: 1, height: 1 });
    expect(existsSync(ss.path)).toBe(true);
  });

  it("store() uses job screenshot directory for job context", () => {
    const ss = service.store(TINY_PNG, { context: jobContext, width: 1, height: 1 });
    const expectedDir = join(
      agentDir,
      "automations",
      ".runs",
      "auto-xyz",
      "job-abc",
      "screenshots",
    );
    expect(ss.path).toBe(join(expectedDir, ss.filename));
  });

  it("store() uses conversations directory for conversation context", () => {
    const ss = service.store(TINY_PNG, { context: convContext, width: 1, height: 1 });
    const expectedDir = join(agentDir, "conversations", "conv-123", "screenshots");
    expect(ss.path).toBe(join(expectedDir, ss.filename));
    expect(existsSync(ss.path)).toBe(true);
  });

  // ── list() ───────────────────────────────────────────────────────────────────

  it("list() returns stored screenshots in order", () => {
    const ss1 = service.store(TINY_PNG, { context: jobContext, width: 1, height: 1 });
    const ss2 = service.store(TINY_PNG, { context: jobContext, width: 2, height: 2 });
    const ss3 = service.store(TINY_PNG, { context: jobContext, width: 3, height: 3 });

    const results = service.list(jobContext);
    expect(results).toHaveLength(3);
    expect(results[0].id).toBe(ss1.id);
    expect(results[1].id).toBe(ss2.id);
    expect(results[2].id).toBe(ss3.id);
  });

  it("list() returns empty array for unknown context", () => {
    const unknown: AssetContext = { type: "conversation", id: "nonexistent" };
    expect(service.list(unknown)).toEqual([]);
  });

  it("list() returns empty array when no screenshots stored yet", () => {
    expect(service.list(jobContext)).toEqual([]);
  });

  // ── url() ────────────────────────────────────────────────────────────────────

  it("url() generates correct job asset URL", () => {
    const ss = service.store(TINY_PNG, { context: jobContext, width: 1, height: 1 });
    const assetUrl = service.url(ss);
    expect(assetUrl).toBe(
      `/api/assets/job/auto-xyz/job-abc/screenshots/${ss.filename}`,
    );
  });

  it("url() generates correct conversation asset URL", () => {
    const ss = service.store(TINY_PNG, { context: convContext, width: 1, height: 1 });
    const assetUrl = service.url(ss);
    expect(assetUrl).toBe(`/api/assets/conversation/conv-123/screenshots/${ss.filename}`);
  });

  // ── updateTag() ──────────────────────────────────────────────────────────────

  it("updateTag() updates the tag in the JSONL index", () => {
    const ss = service.store(TINY_PNG, { context: jobContext, width: 1, height: 1 });
    expect(ss.tag).toBe("keep");

    service.updateTag(jobContext, ss.id, "skip");

    const results = service.list(jobContext);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(ss.id);
    expect(results[0].tag).toBe("skip");
  });

  it("updateTag() only modifies the targeted screenshot", () => {
    const ss1 = service.store(TINY_PNG, { context: jobContext, width: 1, height: 1 });
    const ss2 = service.store(TINY_PNG, { context: jobContext, width: 1, height: 1 });

    service.updateTag(jobContext, ss1.id, "skip");

    const results = service.list(jobContext);
    expect(results.find((s) => s.id === ss1.id)!.tag).toBe("skip");
    expect(results.find((s) => s.id === ss2.id)!.tag).toBe("keep");
  });

  it("updateTag() throws when index does not exist", () => {
    expect(() => {
      service.updateTag(jobContext, "ss-nonexistent", "skip");
    }).toThrow();
  });

  describe("onScreenshot callback", () => {
    it("fires callback when screenshot is stored", async () => {
      const received: any[] = [];
      service.onScreenshot((ss) => received.push(ss));

      const context = { type: "job" as const, id: "job-1", automationId: "auto-1" };
      await service.store(Buffer.from("data"), { context, width: 100, height: 100 });

      expect(received).toHaveLength(1);
      expect(received[0].width).toBe(100);
    });
  });

  describe("cleanup()", () => {
    it("deletes skip-tagged screenshots older than retention period", async () => {
      const context = { type: "job" as const, id: "job-1", automationId: "auto-1" };
      const img = Buffer.from("data");

      const kept = await service.store(img, { context, description: "kept", width: 100, height: 100 });
      const skipped = await service.store(img, { context, description: "skipped", width: 100, height: 100 }, "skip");

      // 0ms retention = delete all skip immediately
      const deleted = service.cleanup(context, 0);
      expect(deleted).toBe(1);

      // Kept screenshot still exists
      expect(existsSync(kept.path)).toBe(true);
      // Skipped screenshot is gone
      expect(existsSync(skipped.path)).toBe(false);

      // Index only has the kept entry
      const remaining = service.list(context);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].tag).toBe("keep");
    });

    it("does not delete skip-tagged screenshots within retention period", async () => {
      const context = { type: "job" as const, id: "job-1", automationId: "auto-1" };
      const skipped = await service.store(Buffer.from("data"), { context, width: 100, height: 100 }, "skip");

      // 1 hour retention — screenshot was just created
      const deleted = service.cleanup(context, 60 * 60 * 1000);
      expect(deleted).toBe(0);
      expect(existsSync(skipped.path)).toBe(true);
    });

    it("never deletes screenshots with error/escalation descriptions", async () => {
      const context = { type: "job" as const, id: "job-1", automationId: "auto-1" };
      const errorSs = await service.store(
        Buffer.from("data"),
        { context, description: "Error during: click submit", width: 100, height: 100 },
        "skip",
      );

      // 0ms retention — would delete normal skip screenshots
      const deleted = service.cleanup(context, 0);
      expect(deleted).toBe(0);
      expect(existsSync(errorSs.path)).toBe(true);
    });
  });
});
