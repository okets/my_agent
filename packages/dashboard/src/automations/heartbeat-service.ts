/**
 * Heartbeat Jobs Service (M9.1-S3)
 *
 * Independent monitoring loop: checks job health, delivers notifications,
 * monitors capability status. Runs every 30s inside the dashboard process.
 */

import type { AutomationJobService } from "./automation-job-service.js";
import type { PersistentNotificationQueue, PersistentNotification } from "../notifications/persistent-queue.js";
import { readTodoFile } from "./todo-file.js";
import path from "node:path";

export interface HeartbeatConfig {
  jobService: AutomationJobService;
  notificationQueue: PersistentNotificationQueue;
  conversationInitiator: {
    alert(
      prompt: string,
      options?: { sourceChannel?: string },
    ): Promise<boolean>;
    initiate(options?: { firstTurnPrompt?: string }): Promise<unknown>;
  } | null;
  staleThresholdMs: number; // default: 5 * 60 * 1000
  tickIntervalMs: number; // default: 30 * 1000
  capabilityHealthIntervalMs: number; // default: 60 * 60 * 1000
  capabilityHealthCheck?: () => Promise<void>;
}

export class HeartbeatService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastCapabilityCheck = 0;
  private config: HeartbeatConfig;

  constructor(config: HeartbeatConfig) {
    this.config = config;
  }

  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(
      () => this.tick().catch((err) => console.error("[Heartbeat] tick error:", err)),
      this.config.tickIntervalMs,
    );
    console.log(
      `[Heartbeat] Started (${this.config.tickIntervalMs}ms interval)`,
    );
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[Heartbeat] Stopped");
    }
  }

  async tick(): Promise<void> {
    await this.checkStaleJobs();
    await this.deliverPendingNotifications();
    await this.checkCapabilityHealth();
  }

  private async checkStaleJobs(): Promise<void> {
    const runningJobs = this.config.jobService.listJobs({ status: "running" });
    const now = Date.now();

    for (const job of runningJobs) {
      if (!job.run_dir) continue;

      const todoPath = path.join(job.run_dir, "todos.json");
      const todoFile = readTodoFile(todoPath);

      const lastActivity = new Date(todoFile.last_activity).getTime();
      const isStale = now - lastActivity > this.config.staleThresholdMs;
      const neverStarted =
        todoFile.items.length === 0 &&
        now - new Date(job.created).getTime() > 2 * 60 * 1000;

      if (isStale || neverStarted) {
        const completed = todoFile.items.filter(
          (i) => i.status === "done",
        ).length;
        const total = todoFile.items.length;
        const incomplete = todoFile.items
          .filter((i) => i.status !== "done")
          .map((i) => i.text);

        this.config.jobService.updateJob(job.id, {
          status: "interrupted",
          summary: `Interrupted: ${completed}/${total} items done`,
        });

        this.config.notificationQueue.enqueue({
          job_id: job.id,
          automation_id: job.automationId,
          type: "job_interrupted",
          summary: `Job interrupted. ${completed}/${total} items done.`,
          todos_completed: completed,
          todos_total: total,
          incomplete_items: incomplete,
          resumable: true,
          created: new Date().toISOString(),
          delivery_attempts: 0,
          source_channel: (job.context as Record<string, unknown>)?.sourceChannel as string | undefined,
        });

        console.log(
          `[Heartbeat] Stale job ${job.id} marked interrupted (${completed}/${total} done)`,
        );
      }
    }
  }

  private async deliverPendingNotifications(): Promise<void> {
    if (!this.config.conversationInitiator) return;

    const MAX_DELIVERY_ATTEMPTS = 10;
    const pending = this.config.notificationQueue.listPending();
    for (const notification of pending) {
      // Skip notifications that have exceeded max delivery attempts
      if (notification.delivery_attempts >= MAX_DELIVERY_ATTEMPTS) {
        console.warn(
          `[Heartbeat] Notification ${notification.job_id} exceeded ${MAX_DELIVERY_ATTEMPTS} delivery attempts — moving to delivered`,
        );
        this.config.notificationQueue.markDelivered(notification._filename!);
        continue;
      }

      try {
        const prompt = this.formatNotification(notification);
        const delivered =
          await this.config.conversationInitiator.alert(prompt, {
            sourceChannel: notification.source_channel,
          });

        if (delivered) {
          this.config.notificationQueue.markDelivered(notification._filename!);
        } else {
          // No current conversation at all (fresh install edge case).
          // Fall back to initiate().
          await this.config.conversationInitiator.initiate({
            firstTurnPrompt: `[SYSTEM: ${prompt}]`,
          });
          this.config.notificationQueue.markDelivered(notification._filename!);
        }
      } catch (err) {
        console.error(
          `[Heartbeat] Notification delivery failed for ${notification.job_id}:`,
          err,
        );
        this.config.notificationQueue.incrementAttempts(
          notification._filename!,
        );
      }
    }
  }

  private async checkCapabilityHealth(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCapabilityCheck < this.config.capabilityHealthIntervalMs)
      return;
    this.lastCapabilityCheck = now;
    if (this.config.capabilityHealthCheck) {
      try {
        await this.config.capabilityHealthCheck();
      } catch (err) {
        console.error("[Heartbeat] Capability health check error:", err);
      }
    }
  }

  private formatNotification(n: PersistentNotification): string {
    const verbatimFraming =
      "Forward these results to the user verbatim. Adjust tone for conversation but do not summarize, paraphrase, or editorialize the content. Don't acknowledge the system message itself.";
    const naturalFraming =
      "You are the conversation layer — present what matters to the user naturally. Don't acknowledge the system message itself.";

    switch (n.type) {
      case "job_completed":
        console.log(`[Heartbeat] Delivering job_completed with VERBATIM framing (${n.summary.length} chars)`);
        return `Background work results:\n\n${n.summary}\n\n${verbatimFraming}`;
      case "job_failed":
        return `A background task failed.\n\nError: ${n.summary}\n\n${naturalFraming} If the error seems transient, suggest re-triggering.`;
      case "job_interrupted":
        return `A background task was interrupted (stale — no activity for 5+ minutes).\n\nProgress: ${n.todos_completed ?? 0}/${n.todos_total ?? 0} items done.\nIncomplete: ${n.incomplete_items?.join(", ") || "unknown"}\nResumable: ${n.resumable ? "yes" : "no"}\n\n${naturalFraming}`;
      case "job_needs_review":
        return `A background task needs your review.\n\n${n.summary}\n\n${naturalFraming}`;
      default:
        return `[Notification] ${n.summary}\n\n${naturalFraming}`;
    }
  }
}
