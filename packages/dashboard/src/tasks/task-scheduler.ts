/**
 * Task System — Task Scheduler
 *
 * Polls for scheduled tasks that are due and executes them.
 * Works alongside CalendarScheduler which handles CalDAV events.
 * This scheduler handles tasks created via the REST API with scheduledFor dates.
 */

import type { TaskManager } from "./task-manager.js";
import type { TaskProcessor } from "./task-processor.js";

export interface TaskSchedulerConfig {
  taskManager: TaskManager;
  processor: TaskProcessor;
  pollIntervalMs?: number;
}

/**
 * TaskScheduler — polls for and executes due scheduled tasks
 */
export class TaskScheduler {
  private taskManager: TaskManager;
  private processor: TaskProcessor;
  private pollIntervalMs: number;
  private interval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(config: TaskSchedulerConfig) {
    this.taskManager = config.taskManager;
    this.processor = config.processor;
    this.pollIntervalMs = config.pollIntervalMs ?? 30_000; // Default 30 seconds
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) {
      console.warn("[TaskScheduler] Already running");
      return;
    }

    this.isRunning = true;
    this.interval = setInterval(
      () => this.checkDueTasks(),
      this.pollIntervalMs,
    );
    console.log(
      `[TaskScheduler] Started, polling every ${this.pollIntervalMs / 1000}s`,
    );

    // Also check immediately on start
    this.checkDueTasks();
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log("[TaskScheduler] Stopped");
  }

  /**
   * Check for and execute due tasks
   */
  private async checkDueTasks(): Promise<void> {
    try {
      // getPendingDueTasks returns pending tasks where scheduledFor <= now
      // OR where scheduledFor is null (immediate tasks that weren't processed)
      const dueTasks = this.taskManager.getPendingDueTasks();

      // Filter to only scheduled tasks (immediate tasks are handled by TaskProcessor on creation)
      const scheduledTasks = dueTasks.filter((t) => t.type === "scheduled");

      if (scheduledTasks.length === 0) {
        return;
      }

      console.log(
        `[TaskScheduler] Found ${scheduledTasks.length} due scheduled task(s)`,
      );

      for (const task of scheduledTasks) {
        console.log(`[TaskScheduler] Executing due task: ${task.title}`);
        try {
          await this.processor.executeAndDeliver(task);
        } catch (err) {
          console.error(
            `[TaskScheduler] Failed to execute task ${task.id}:`,
            err,
          );
          // Task status should already be set to 'failed' by executor
        }
      }
    } catch (err) {
      console.error("[TaskScheduler] Error checking due tasks:", err);
    }
  }
}
