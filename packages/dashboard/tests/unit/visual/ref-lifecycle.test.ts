import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { VisualActionService } from "../../../src/visual/visual-action-service.js";

describe("Screenshot ref lifecycle", () => {
  let agentDir: string;
  let vas: VisualActionService;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "ref-lifecycle-"));
    vas = new VisualActionService(agentDir);
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("automation deletion: screenshots become unreferenced and expire", () => {
    // 1. Create screenshots referenced by a job
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
    vas.addRef(ss2.id, "job/auto-1/job-2");

    // 2. Delete the automation — removes all job/auto-1 refs
    vas.removeRefs("job/auto-1");

    expect(vas.get(ss1.id)!.refs).toEqual([]);
    expect(vas.get(ss2.id)!.refs).toEqual([]);

    // 3. Screenshots still exist (within 7-day window)
    expect(existsSync(ss1.path)).toBe(true);
    expect(existsSync(ss2.path)).toBe(true);

    // 4. Backdate and cleanup — now they expire
    const indexPath = join(agentDir, "screenshots", "index.jsonl");
    let content = readFileSync(indexPath, "utf-8");
    const oldTimestamp = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    ).toISOString();
    content = content.replace(
      new RegExp(ss1.timestamp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      oldTimestamp,
    );
    content = content.replace(
      new RegExp(ss2.timestamp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      oldTimestamp,
    );
    writeFileSync(indexPath, content);
    vas = new VisualActionService(agentDir);

    const deleted = vas.cleanup();
    expect(deleted).toBe(2);
    expect(existsSync(ss1.path)).toBe(false);
    expect(existsSync(ss2.path)).toBe(false);
  });

  it("one-off automation: create, screenshot, delete, cleanup", () => {
    // 1. Screenshot from a one-off automation
    const ss = vas.store(Buffer.from("oneoff"), {
      description: "One-off task screenshot",
      width: 1920,
      height: 1080,
      source: "desktop",
    });
    vas.addRef(ss.id, "job/oneoff-auto/job-1");

    // 2. Automation deleted
    vas.removeRefs("job/oneoff-auto");

    // 3. Now unreferenced
    expect(vas.listUnreferenced()).toHaveLength(1);

    // 4. Cleanup with 0ms maxAge (immediate)
    const deleted = vas.cleanup(0);
    expect(deleted).toBe(1);
    expect(vas.get(ss.id)).toBeNull();
  });

  it("cross-ref: screenshot survives if referenced by another context", () => {
    // Screenshot referenced by both a conversation and a job
    const ss = vas.store(Buffer.from("shared"), {
      width: 100,
      height: 100,
      source: "desktop",
    });
    vas.addRef(ss.id, "conv/main");
    vas.addRef(ss.id, "job/auto-1/job-1");

    // Delete the automation refs
    vas.removeRefs("job/auto-1");

    // Still referenced by conversation
    expect(vas.get(ss.id)!.refs).toEqual(["conv/main"]);

    // Cleanup should NOT delete it
    const deleted = vas.cleanup(0);
    expect(deleted).toBe(0);
    expect(existsSync(ss.path)).toBe(true);

    // Now delete conversation ref too
    vas.removeRefs("conv/main");
    expect(vas.get(ss.id)!.refs).toEqual([]);

    // Now it should be cleaned up
    const deleted2 = vas.cleanup(0);
    expect(deleted2).toBe(1);
    expect(existsSync(ss.path)).toBe(false);
  });
});
