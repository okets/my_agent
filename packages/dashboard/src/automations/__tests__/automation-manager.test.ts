import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AutomationManager } from "../automation-manager.js";
import { ConversationDatabase } from "../../conversations/db.js";

let tmpDir: string;
let automationsDir: string;
let db: ConversationDatabase;
let manager: AutomationManager;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "automation-manager-test-"));
  automationsDir = path.join(tmpDir, "automations");
  db = new ConversationDatabase(tmpDir);
  manager = new AutomationManager(automationsDir, db);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("AutomationManager — health.stale_threshold_ms round-trip", () => {
  it("preserves health.stale_threshold_ms through a write/read round-trip", () => {
    const created = manager.create({
      name: "long-running research",
      instructions: "Do a thorough multi-site research task.",
      manifest: {
        trigger: [{ type: "manual" }],
        health: { stale_threshold_ms: 900_000 },
      },
    });

    expect(created.manifest.health).toEqual({ stale_threshold_ms: 900_000 });

    const reloaded = manager.read(created.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.manifest.health).toEqual({ stale_threshold_ms: 900_000 });
  });

  it("omits health from frontmatter when not set", () => {
    const created = manager.create({
      name: "simple task",
      instructions: "A simple automation.",
      manifest: {
        trigger: [{ type: "manual" }],
      },
    });

    expect(created.manifest.health).toBeUndefined();

    const reloaded = manager.read(created.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.manifest.health).toBeUndefined();
  });

  it("preserves health through an update round-trip", () => {
    const created = manager.create({
      name: "fetch job",
      instructions: "Fetch data from multiple sites.",
      manifest: {
        trigger: [{ type: "manual" }],
      },
    });

    const updated = manager.update(created.id, {
      health: { stale_threshold_ms: 1_800_000 },
    });
    expect(updated.manifest.health).toEqual({ stale_threshold_ms: 1_800_000 });

    const reloaded = manager.read(created.id);
    expect(reloaded!.manifest.health).toEqual({ stale_threshold_ms: 1_800_000 });
  });
});
