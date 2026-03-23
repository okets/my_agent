import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConversationDatabase } from "../src/conversations/db.js";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Spaces table in agent.db", () => {
  let db: ConversationDatabase;

  beforeEach(() => {
    const tempDir = mkdtempSync(join(tmpdir(), "spaces-db-"));
    db = new ConversationDatabase(tempDir);
  });

  afterEach(() => {
    db.close();
  });

  it("should create spaces table on initialization", () => {
    const tables = db
      .getDb()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='spaces'",
      )
      .all() as any[];
    expect(tables).toHaveLength(1);
  });

  it("should upsert and retrieve a space", () => {
    db.upsertSpace({
      name: "web-scraper",
      path: "/home/user/.my_agent/spaces/web-scraper",
      tags: ["tool", "scraper"],
      runtime: "uv",
      entry: "main.py",
      io: { input: { url: "string" }, output: { html: "string" } },
      maintenance: { on_failure: "fix" },
      description: "Scrapes web pages",
      indexedAt: "2026-03-23T10:00:00Z",
    });

    const space = db.getSpace("web-scraper");
    expect(space).not.toBeNull();
    expect(space!.name).toBe("web-scraper");
    expect(space!.path).toBe("/home/user/.my_agent/spaces/web-scraper");
    expect(space!.tags).toEqual(["tool", "scraper"]);
    expect(space!.runtime).toBe("uv");
    expect(space!.entry).toBe("main.py");
    expect(space!.io).toEqual({
      input: { url: "string" },
      output: { html: "string" },
    });
    expect(space!.maintenance).toEqual({ on_failure: "fix" });
    expect(space!.description).toBe("Scrapes web pages");
    expect(space!.indexedAt).toBe("2026-03-23T10:00:00Z");
  });

  it("should update existing space on upsert", () => {
    db.upsertSpace({
      name: "my-space",
      path: "/path/a",
      tags: ["v1"],
      indexedAt: "2026-03-23T10:00:00Z",
    });

    db.upsertSpace({
      name: "my-space",
      path: "/path/b",
      tags: ["v2"],
      description: "Updated",
      indexedAt: "2026-03-23T11:00:00Z",
    });

    const space = db.getSpace("my-space");
    expect(space!.path).toBe("/path/b");
    expect(space!.tags).toEqual(["v2"]);
    expect(space!.description).toBe("Updated");
    expect(space!.indexedAt).toBe("2026-03-23T11:00:00Z");
  });

  it("should list spaces with tag filter", () => {
    db.upsertSpace({
      name: "a",
      path: "/a",
      tags: ["tool", "scraper"],
      indexedAt: "2026-03-23T10:00:00Z",
    });
    db.upsertSpace({
      name: "b",
      path: "/b",
      tags: ["project"],
      indexedAt: "2026-03-23T10:00:00Z",
    });
    db.upsertSpace({
      name: "c",
      path: "/c",
      tags: ["tool", "api"],
      indexedAt: "2026-03-23T10:00:00Z",
    });

    const tools = db.listSpaces({ tag: "tool" });
    expect(tools).toHaveLength(2);
    expect(tools.map((s) => s.name).sort()).toEqual(["a", "c"]);
  });

  it("should list spaces with runtime filter", () => {
    db.upsertSpace({
      name: "a",
      path: "/a",
      runtime: "uv",
      indexedAt: "2026-03-23T10:00:00Z",
    });
    db.upsertSpace({
      name: "b",
      path: "/b",
      runtime: "node",
      indexedAt: "2026-03-23T10:00:00Z",
    });

    const uvSpaces = db.listSpaces({ runtime: "uv" });
    expect(uvSpaces).toHaveLength(1);
    expect(uvSpaces[0].name).toBe("a");
  });

  it("should search spaces by name/description", () => {
    db.upsertSpace({
      name: "web-scraper",
      path: "/a",
      description: "Scrapes web pages",
      indexedAt: "2026-03-23T10:00:00Z",
    });
    db.upsertSpace({
      name: "email-bot",
      path: "/b",
      description: "Sends emails",
      indexedAt: "2026-03-23T10:00:00Z",
    });

    const results = db.listSpaces({ search: "scraper" });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("web-scraper");

    const byDesc = db.listSpaces({ search: "email" });
    expect(byDesc).toHaveLength(1);
    expect(byDesc[0].name).toBe("email-bot");
  });

  it("should delete a space", () => {
    db.upsertSpace({
      name: "to-delete",
      path: "/del",
      indexedAt: "2026-03-23T10:00:00Z",
    });

    expect(db.getSpace("to-delete")).not.toBeNull();
    db.deleteSpace("to-delete");
    expect(db.getSpace("to-delete")).toBeNull();
  });

  it("should return null for non-existent space", () => {
    expect(db.getSpace("nope")).toBeNull();
  });

  it("should return empty array when no spaces match filter", () => {
    expect(db.listSpaces({ tag: "nonexistent" })).toEqual([]);
  });
});
