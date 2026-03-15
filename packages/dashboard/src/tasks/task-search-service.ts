/**
 * Task Search Service (M6.9-S5)
 *
 * Hybrid FTS5 + vector search for finding tasks by meaning.
 * Mirrors the ConversationSearchService pattern with RRF merging.
 */

import type Database from "better-sqlite3";
import type { EmbeddingsPlugin } from "@my-agent/core";
import * as sqliteVec from "sqlite-vec";

const RRF_K = 60; // Standard RRF constant (same as memory + conversation search)

export interface TaskSearchResult {
  id: string;
  title: string;
  status: string;
  created: string;
  completedAt?: string;
  score: number;
}

export interface TaskSearchServiceOptions {
  db: Database.Database;
  getPlugin: () => EmbeddingsPlugin | null;
}

export class TaskSearchService {
  private db: Database.Database;
  private getPlugin: () => EmbeddingsPlugin | null;
  private vecInitialized = false;
  private vecDimensions: number | null = null;

  constructor(options: TaskSearchServiceOptions) {
    this.db = options.db;
    this.getPlugin = options.getPlugin;

    // Load sqlite-vec extension (idempotent)
    sqliteVec.load(this.db);

    this.detectExistingDimensions();
  }

  private detectExistingDimensions(): void {
    try {
      const row = this.db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks_vec'",
        )
        .get() as { sql: string } | undefined;

      if (row?.sql) {
        const match = row.sql.match(/FLOAT\[(\d+)\]/);
        if (match) {
          this.vecDimensions = parseInt(match[1], 10);
          this.vecInitialized = true;
        }
      }
    } catch {
      // Table doesn't exist yet
    }
  }

  /**
   * Initialize vector table with given dimensions.
   * Drops and recreates if dimensions changed.
   */
  initVectorTable(dimensions: number): void {
    if (this.vecDimensions !== null && this.vecDimensions !== dimensions) {
      this.db.exec("DROP TABLE IF EXISTS tasks_vec");
      this.db.exec("DELETE FROM task_embedding_map");
    }

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS tasks_vec USING vec0(
        embedding FLOAT[${dimensions}]
      )
    `);
    this.vecDimensions = dimensions;
    this.vecInitialized = true;
  }

  isVectorReady(): boolean {
    return this.vecInitialized;
  }

  /**
   * Index a task for search. Fire-and-forget safe.
   */
  async indexTask(task: {
    id: string;
    title: string;
    instructions: string;
  }): Promise<void> {
    const content = `${task.title} ${task.instructions}`;

    // FTS5 indexing (synchronous, always available)
    try {
      this.db
        .prepare(
          "INSERT OR REPLACE INTO tasks_fts (task_id, content) VALUES (?, ?)",
        )
        .run(task.id, content);
    } catch (err) {
      console.warn(
        `[TaskSearch] FTS5 indexing failed for ${task.id}:`,
        err instanceof Error ? err.message : String(err),
      );
    }

    // Vector indexing (async, best-effort)
    const plugin = this.getPlugin();
    if (!plugin || !this.vecInitialized) return;

    try {
      const isReady = await plugin.isReady();
      if (!isReady) return;

      const embedding = await plugin.embed(content);

      const upsertMap = this.db.prepare(`
        INSERT INTO task_embedding_map (task_id)
        VALUES (?)
        ON CONFLICT(task_id) DO UPDATE SET task_id = excluded.task_id
        RETURNING vec_rowid
      `);

      const deleteVec = this.db.prepare(
        "DELETE FROM tasks_vec WHERE rowid = ?",
      );
      const insertVec = this.db.prepare(
        "INSERT INTO tasks_vec (rowid, embedding) VALUES (?, ?)",
      );

      this.db.transaction(() => {
        const row = upsertMap.get(task.id) as { vec_rowid: number };
        deleteVec.run(BigInt(row.vec_rowid));
        insertVec.run(BigInt(row.vec_rowid), JSON.stringify(embedding));
      })();
    } catch (err) {
      // Never block task creation on embedding failure
      console.warn(
        `[TaskSearch] Vector indexing failed for ${task.id}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Hybrid search: FTS5 keyword + vector semantic with RRF merge.
   * Falls back to FTS5-only if embeddings unavailable.
   */
  async search(
    query: string,
    options?: { status?: string; limit?: number },
  ): Promise<TaskSearchResult[]> {
    const limit = options?.limit ?? 5;
    const statusFilter = options?.status ?? "completed";
    const fetchLimit = limit * 3; // Overfetch for filtering

    const scores = new Map<string, number>();
    const resultData = new Map<
      string,
      { id: string; title: string; status: string; created: string; completedAt?: string }
    >();

    // FTS5 keyword search
    try {
      const ftsResults = this.db
        .prepare(
          `
          SELECT f.task_id, f.content, t.title, t.status, t.created_at, t.completed_at
          FROM tasks_fts f
          JOIN tasks t ON t.id = f.task_id
          WHERE tasks_fts MATCH ?
            AND t.deleted_at IS NULL
            ${statusFilter !== "all" ? "AND t.status = ?" : ""}
          ORDER BY rank
          LIMIT ?
        `,
        )
        .all(
          ...(statusFilter !== "all"
            ? [query, statusFilter, fetchLimit]
            : [query, fetchLimit]),
        ) as Array<{
          task_id: string;
          title: string;
          status: string;
          created_at: string;
          completed_at: string | null;
        }>;

      for (let i = 0; i < ftsResults.length; i++) {
        const r = ftsResults[i];
        const rrfScore = 1 / (RRF_K + i + 1);
        scores.set(r.task_id, (scores.get(r.task_id) ?? 0) + rrfScore);
        if (!resultData.has(r.task_id)) {
          resultData.set(r.task_id, {
            id: r.task_id,
            title: r.title,
            status: r.status,
            created: r.created_at,
            completedAt: r.completed_at ?? undefined,
          });
        }
      }
    } catch (err) {
      console.warn(
        "[TaskSearch] FTS5 search failed:",
        err instanceof Error ? err.message : String(err),
      );
    }

    // Vector search (if available)
    const plugin = this.getPlugin();
    if (plugin && this.vecInitialized) {
      try {
        const isReady = await plugin.isReady();
        if (isReady) {
          const queryEmbedding = await plugin.embed(query);
          const vecResults = this.db
            .prepare(
              `
              SELECT m.task_id, v.distance,
                     t.title, t.status, t.created_at, t.completed_at
              FROM tasks_vec v
              JOIN task_embedding_map m ON m.vec_rowid = v.rowid
              JOIN tasks t ON t.id = m.task_id
              WHERE v.embedding MATCH ? AND v.k = ?
                AND t.deleted_at IS NULL
                ${statusFilter !== "all" ? "AND t.status = ?" : ""}
              ORDER BY v.distance
            `,
            )
            .all(
              ...(statusFilter !== "all"
                ? [JSON.stringify(queryEmbedding), fetchLimit, statusFilter]
                : [JSON.stringify(queryEmbedding), fetchLimit]),
            ) as Array<{
              task_id: string;
              distance: number;
              title: string;
              status: string;
              created_at: string;
              completed_at: string | null;
            }>;

          for (let i = 0; i < vecResults.length; i++) {
            const r = vecResults[i];
            const rrfScore = 1 / (RRF_K + i + 1);
            scores.set(r.task_id, (scores.get(r.task_id) ?? 0) + rrfScore);
            if (!resultData.has(r.task_id)) {
              resultData.set(r.task_id, {
                id: r.task_id,
                title: r.title,
                status: r.status,
                created: r.created_at,
                completedAt: r.completed_at ?? undefined,
              });
            }
          }
        }
      } catch (err) {
        console.warn(
          "[TaskSearch] Vector search failed, using FTS5 only:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // Sort by RRF score descending, take top `limit`
    const sorted = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    return sorted.map(([taskId, score]) => {
      const data = resultData.get(taskId)!;
      return { ...data, score };
    });
  }

  /**
   * Check if semantic search is available.
   */
  async isSemanticAvailable(): Promise<boolean> {
    const plugin = this.getPlugin();
    if (!plugin || !this.vecInitialized) return false;
    try {
      return await plugin.isReady();
    } catch {
      return false;
    }
  }
}
