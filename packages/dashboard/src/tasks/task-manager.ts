/**
 * Task System — Task Manager
 *
 * High-level API for task management. Handles CRUD operations,
 * session ID generation, and database persistence.
 */

import { ulid } from "ulid";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type {
  Task,
  TaskStatus,
  CreateTaskInput,
  ListTasksFilter,
  WorkItem,
  DeliveryAction,
} from "@my-agent/core";

/**
 * TaskManager - CRUD operations for tasks
 */
export class TaskManager {
  private db: Database.Database;
  private agentDir: string;
  private logsDir: string;

  /**
   * Create a TaskManager
   *
   * @param db - The SQLite database instance (from ConversationDatabase.getDb())
   * @param agentDir - Path to .my_agent directory
   */
  constructor(db: Database.Database, agentDir: string) {
    this.db = db;
    this.agentDir = agentDir;
    this.logsDir = path.join(agentDir, "tasks", "logs");

    // Ensure logs directory exists
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * Generate a unique task ID
   */
  private generateTaskId(): string {
    return `task-${ulid()}`;
  }

  /**
   * Generate a unique session ID for Agent SDK continuity
   */
  private generateSessionId(): string {
    return `session-${ulid()}`;
  }

  /**
   * Get the log path for a task
   */
  private getLogPath(taskId: string): string {
    return path.join(this.logsDir, `${taskId}.jsonl`);
  }

  /**
   * Create a new task
   */
  create(input: CreateTaskInput): Task {
    const id = this.generateTaskId();
    const sessionId = this.generateSessionId();
    const logPath = this.getLogPath(id);
    const now = new Date();

    const task: Task = {
      id,
      type: input.type,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
      title: input.title,
      instructions: input.instructions,
      work: input.work,
      delivery: input.delivery,
      status: "pending",
      sessionId,
      recurrenceId: input.recurrenceId,
      occurrenceDate: input.occurrenceDate,
      scheduledFor: input.scheduledFor,
      created: now,
      createdBy: input.createdBy,
      logPath,
    };

    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        id, type, source_type, source_ref, title, instructions, work, delivery,
        status, session_id, recurrence_id, occurrence_date,
        scheduled_for, created_by, log_path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      task.id,
      task.type,
      task.sourceType,
      task.sourceRef ?? null,
      task.title,
      task.instructions,
      task.work ? JSON.stringify(task.work) : null,
      task.delivery ? JSON.stringify(task.delivery) : null,
      task.status,
      task.sessionId,
      task.recurrenceId ?? null,
      task.occurrenceDate ?? null,
      task.scheduledFor?.toISOString() ?? null,
      task.createdBy,
      task.logPath,
      task.created.toISOString(),
    );

    return task;
  }

  /**
   * Find a task by ID
   */
  findById(id: string): Task | null {
    const stmt = this.db.prepare("SELECT * FROM tasks WHERE id = ?");
    const row = stmt.get(id) as any;

    if (!row) {
      return null;
    }

    return this.rowToTask(row);
  }

  /**
   * Find tasks by recurrence ID
   *
   * Returns all instances of a recurring task, ordered by occurrence date.
   */
  findByRecurrence(recurrenceId: string): Task[] {
    const stmt = this.db.prepare(`
      SELECT * FROM tasks
      WHERE recurrence_id = ?
      ORDER BY occurrence_date DESC
    `);

    const rows = stmt.all(recurrenceId) as any[];
    return rows.map((row) => this.rowToTask(row));
  }

  /**
   * Find or create a task for a recurring event occurrence
   *
   * If a task already exists for this recurrence + occurrence, returns it.
   * Otherwise creates a new task that shares the recurrence's session ID.
   */
  findOrCreateForOccurrence(
    input: CreateTaskInput & { recurrenceId: string; occurrenceDate: string },
  ): { task: Task; created: boolean } {
    // Check if task already exists for this occurrence
    const existingStmt = this.db.prepare(`
      SELECT * FROM tasks
      WHERE recurrence_id = ? AND occurrence_date = ?
    `);
    const existing = existingStmt.get(
      input.recurrenceId,
      input.occurrenceDate,
    ) as any;

    if (existing) {
      return { task: this.rowToTask(existing), created: false };
    }

    // Check if there's a prior task in this recurrence to reuse session ID
    const priorStmt = this.db.prepare(`
      SELECT session_id FROM tasks
      WHERE recurrence_id = ?
      ORDER BY created_at ASC
      LIMIT 1
    `);
    const prior = priorStmt.get(input.recurrenceId) as
      | { session_id: string }
      | undefined;

    const id = this.generateTaskId();
    const sessionId = prior?.session_id ?? this.generateSessionId();
    const logPath = this.getLogPath(id);
    const now = new Date();

    const task: Task = {
      id,
      type: input.type,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
      title: input.title,
      instructions: input.instructions,
      work: input.work,
      delivery: input.delivery,
      status: "pending",
      sessionId,
      recurrenceId: input.recurrenceId,
      occurrenceDate: input.occurrenceDate,
      scheduledFor: input.scheduledFor,
      created: now,
      createdBy: input.createdBy,
      logPath,
    };

    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        id, type, source_type, source_ref, title, instructions, work, delivery,
        status, session_id, recurrence_id, occurrence_date,
        scheduled_for, created_by, log_path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      task.id,
      task.type,
      task.sourceType,
      task.sourceRef ?? null,
      task.title,
      task.instructions,
      task.work ? JSON.stringify(task.work) : null,
      task.delivery ? JSON.stringify(task.delivery) : null,
      task.status,
      task.sessionId,
      task.recurrenceId,
      task.occurrenceDate,
      task.scheduledFor?.toISOString() ?? null,
      task.createdBy,
      task.logPath,
      task.created.toISOString(),
    );

    return { task, created: true };
  }

  /**
   * Update a task
   */
  update(
    id: string,
    changes: Partial<
      Pick<
        Task,
        | "status"
        | "startedAt"
        | "completedAt"
        | "deletedAt"
        | "work"
        | "delivery"
        | "sourceRef"
      >
    >,
  ): void {
    const fields: string[] = [];
    const values: any[] = [];

    if (changes.status !== undefined) {
      fields.push("status = ?");
      values.push(changes.status);
    }

    if (changes.startedAt !== undefined) {
      fields.push("started_at = ?");
      values.push(changes.startedAt.toISOString());
    }

    if (changes.completedAt !== undefined) {
      fields.push("completed_at = ?");
      values.push(changes.completedAt.toISOString());
    }

    if (changes.deletedAt !== undefined) {
      fields.push("deleted_at = ?");
      values.push(changes.deletedAt.toISOString());
    }

    if (changes.work !== undefined) {
      fields.push("work = ?");
      values.push(JSON.stringify(changes.work));
    }

    if (changes.delivery !== undefined) {
      fields.push("delivery = ?");
      values.push(JSON.stringify(changes.delivery));
    }

    if (changes.sourceRef !== undefined) {
      fields.push("source_ref = ?");
      values.push(changes.sourceRef);
    }

    if (fields.length === 0) {
      return;
    }

    const sql = `UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`;
    values.push(id);

    const stmt = this.db.prepare(sql);
    stmt.run(...values);
  }

  /**
   * List tasks with optional filtering
   *
   * By default, excludes soft-deleted tasks. Set includeDeleted: true to include them.
   */
  list(filter?: ListTasksFilter): Task[] {
    let sql = "SELECT * FROM tasks";
    const conditions: string[] = [];
    const params: any[] = [];

    // Exclude deleted tasks by default
    if (!filter?.includeDeleted) {
      conditions.push("status != 'deleted'");
    }

    if (filter?.status) {
      if (Array.isArray(filter.status)) {
        conditions.push(
          `status IN (${filter.status.map(() => "?").join(", ")})`,
        );
        params.push(...filter.status);
      } else {
        conditions.push("status = ?");
        params.push(filter.status);
      }
    }

    if (filter?.type) {
      conditions.push("type = ?");
      params.push(filter.type);
    }

    if (filter?.sourceType) {
      conditions.push("source_type = ?");
      params.push(filter.sourceType);
    }

    if (filter?.recurrenceId) {
      conditions.push("recurrence_id = ?");
      params.push(filter.recurrenceId);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " ORDER BY created_at DESC";

    if (filter?.limit) {
      sql += " LIMIT ?";
      params.push(filter.limit);
    }

    if (filter?.offset) {
      sql += " OFFSET ?";
      params.push(filter.offset);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map((row) => this.rowToTask(row));
  }

  /**
   * Get pending tasks that are due
   */
  getPendingDueTasks(): Task[] {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      SELECT * FROM tasks
      WHERE status = 'pending'
        AND (scheduled_for IS NULL OR scheduled_for <= ?)
      ORDER BY scheduled_for ASC, created_at ASC
    `);

    const rows = stmt.all(now) as any[];
    return rows.map((row) => this.rowToTask(row));
  }

  /**
   * Soft-delete a task
   *
   * Sets status to 'deleted' and records deletedAt timestamp.
   * The task and its log file are preserved for audit trail.
   */
  delete(id: string): void {
    const now = new Date();

    this.update(id, {
      status: "deleted",
      deletedAt: now,
    });
  }

  /**
   * Convert a database row to a Task object
   */
  private rowToTask(row: any): Task {
    return {
      id: row.id,
      type: row.type,
      sourceType: row.source_type,
      sourceRef: row.source_ref ?? undefined,
      title: row.title,
      instructions: row.instructions,
      work: row.work ? (JSON.parse(row.work) as WorkItem[]) : undefined,
      delivery: row.delivery
        ? (JSON.parse(row.delivery) as DeliveryAction[])
        : undefined,
      status: row.status as TaskStatus,
      sessionId: row.session_id,
      recurrenceId: row.recurrence_id ?? undefined,
      occurrenceDate: row.occurrence_date ?? undefined,
      scheduledFor: row.scheduled_for ? new Date(row.scheduled_for) : undefined,
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      deletedAt: row.deleted_at ? new Date(row.deleted_at) : undefined,
      created: new Date(row.created_at),
      createdBy: row.created_by,
      logPath: row.log_path,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Task-Conversation Linking (M5-S5)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Link a task to a conversation
   *
   * Creates a soft reference in the junction table. Idempotent: if the link
   * already exists, this is a no-op.
   */
  linkTaskToConversation(taskId: string, conversationId: string): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO task_conversations (task_id, conversation_id, linked_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(taskId, conversationId, new Date().toISOString());
  }

  /**
   * Get all conversations linked to a task
   *
   * Returns conversation IDs, ordered by link time (most recent first).
   */
  getConversationsForTask(
    taskId: string,
  ): Array<{ conversationId: string; linkedAt: Date }> {
    const stmt = this.db.prepare(`
      SELECT conversation_id, linked_at
      FROM task_conversations
      WHERE task_id = ?
      ORDER BY linked_at DESC
    `);
    const rows = stmt.all(taskId) as Array<{
      conversation_id: string;
      linked_at: string;
    }>;
    return rows.map((row) => ({
      conversationId: row.conversation_id,
      linkedAt: new Date(row.linked_at),
    }));
  }

  /**
   * Get all tasks linked to a conversation
   *
   * Returns task IDs, ordered by link time (most recent first).
   */
  getTasksForConversation(
    conversationId: string,
  ): Array<{ taskId: string; linkedAt: Date }> {
    const stmt = this.db.prepare(`
      SELECT task_id, linked_at
      FROM task_conversations
      WHERE conversation_id = ?
      ORDER BY linked_at DESC
    `);
    const rows = stmt.all(conversationId) as Array<{
      task_id: string;
      linked_at: string;
    }>;
    return rows.map((row) => ({
      taskId: row.task_id,
      linkedAt: new Date(row.linked_at),
    }));
  }
}
