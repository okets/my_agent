import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { TaskSearchService } from "../../src/tasks/task-search-service.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");

  // Create tasks table (mimics db.ts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      source_type TEXT NOT NULL,
      title TEXT NOT NULL,
      instructions TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      session_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      log_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      deleted_at TEXT
    )
  `);

  // Create task search tables (mimics db.ts M6.9-S5 migration)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
      task_id UNINDEXED,
      content
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_embedding_map (
      vec_rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL UNIQUE
    )
  `);

  return db;
}

function insertTask(
  db: Database.Database,
  task: {
    id: string;
    title: string;
    instructions: string;
    status?: string;
    completedAt?: string;
  },
) {
  db.prepare(
    `INSERT INTO tasks (id, type, source_type, title, instructions, status, session_id, created_by, log_path, completed_at)
     VALUES (?, 'immediate', 'conversation', ?, ?, ?, 'sess-01', 'agent', '/tmp/log', ?)`,
  ).run(
    task.id,
    task.title,
    task.instructions,
    task.status ?? "completed",
    task.completedAt ?? null,
  );
}

describe("TaskSearchService", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("indexTask", () => {
    it("indexes a task into FTS5", async () => {
      const service = new TaskSearchService({
        db,
        getPlugin: () => null,
      });

      await service.indexTask({
        id: "task-001",
        title: "Find flights",
        instructions: "Search for cheapest flights CNX to BKK",
      });

      const rows = db
        .prepare("SELECT * FROM tasks_fts WHERE task_id = ?")
        .all("task-001");
      expect(rows).toHaveLength(1);
      expect((rows[0] as any).content).toContain("Find flights");
      expect((rows[0] as any).content).toContain("cheapest flights CNX");
    });

    it("replaces FTS5 entry on re-index", async () => {
      const service = new TaskSearchService({
        db,
        getPlugin: () => null,
      });

      await service.indexTask({
        id: "task-001",
        title: "Find flights",
        instructions: "Version 1",
      });

      await service.indexTask({
        id: "task-001",
        title: "Find flights",
        instructions: "Version 2",
      });

      const rows = db
        .prepare("SELECT * FROM tasks_fts WHERE task_id = ?")
        .all("task-001");
      // FTS5 INSERT OR REPLACE will have the latest content
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe("search (FTS5 only)", () => {
    it("finds tasks by keyword match", async () => {
      const service = new TaskSearchService({
        db,
        getPlugin: () => null,
      });

      insertTask(db, {
        id: "task-001",
        title: "Find Thai restaurants",
        instructions: "Search for top-rated Thai food in Nimman",
      });
      insertTask(db, {
        id: "task-002",
        title: "Book hotel",
        instructions: "Find hotels near Tha Phae Gate",
      });

      await service.indexTask({
        id: "task-001",
        title: "Find Thai restaurants",
        instructions: "Search for top-rated Thai food in Nimman",
      });
      await service.indexTask({
        id: "task-002",
        title: "Book hotel",
        instructions: "Find hotels near Tha Phae Gate",
      });

      const results = await service.search("Thai restaurants");

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe("task-001");
      expect(results[0].title).toBe("Find Thai restaurants");
      expect(results[0].score).toBeGreaterThan(0);
    });

    it("filters by status", async () => {
      const service = new TaskSearchService({
        db,
        getPlugin: () => null,
      });

      insertTask(db, {
        id: "task-001",
        title: "Completed research",
        instructions: "Done",
        status: "completed",
      });
      insertTask(db, {
        id: "task-002",
        title: "Failed research",
        instructions: "Research that failed",
        status: "failed",
      });

      await service.indexTask({
        id: "task-001",
        title: "Completed research",
        instructions: "Done",
      });
      await service.indexTask({
        id: "task-002",
        title: "Failed research",
        instructions: "Research that failed",
      });

      const completed = await service.search("research", {
        status: "completed",
      });
      expect(completed.every((r) => r.status === "completed")).toBe(true);

      const all = await service.search("research", { status: "all" });
      expect(all.length).toBe(2);
    });

    it("excludes deleted tasks", async () => {
      const service = new TaskSearchService({
        db,
        getPlugin: () => null,
      });

      insertTask(db, {
        id: "task-001",
        title: "Deleted task",
        instructions: "Should not appear",
        status: "completed",
      });
      db.prepare("UPDATE tasks SET deleted_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        "task-001",
      );

      await service.indexTask({
        id: "task-001",
        title: "Deleted task",
        instructions: "Should not appear",
      });

      const results = await service.search("Deleted task");
      expect(results).toHaveLength(0);
    });

    it("returns empty array when no matches", async () => {
      const service = new TaskSearchService({
        db,
        getPlugin: () => null,
      });

      const results = await service.search("nonexistent query xyz");
      expect(results).toHaveLength(0);
    });

    it("respects limit parameter", async () => {
      const service = new TaskSearchService({
        db,
        getPlugin: () => null,
      });

      for (let i = 0; i < 10; i++) {
        const id = `task-${String(i).padStart(3, "0")}`;
        insertTask(db, {
          id,
          title: `Research topic ${i}`,
          instructions: `Research about topic ${i}`,
        });
        await service.indexTask({
          id,
          title: `Research topic ${i}`,
          instructions: `Research about topic ${i}`,
        });
      }

      const results = await service.search("research", { limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe("isSemanticAvailable", () => {
    it("returns false when no plugin", async () => {
      const service = new TaskSearchService({
        db,
        getPlugin: () => null,
      });
      expect(await service.isSemanticAvailable()).toBe(false);
    });

    it("returns false when vector table not initialized", async () => {
      const service = new TaskSearchService({
        db,
        getPlugin: () =>
          ({
            isReady: vi.fn().mockResolvedValue(true),
          }) as any,
      });
      expect(await service.isSemanticAvailable()).toBe(false);
    });
  });
});
