/**
 * Heartbeat Jobs Service (M9.1-S3)
 *
 * Independent monitoring loop: checks job health, delivers notifications,
 * monitors capability status. Runs every 30s inside the dashboard process.
 */

import type { AutomationJobService } from "./automation-job-service.js";
import type { PersistentNotificationQueue, PersistentNotification } from "../notifications/persistent-queue.js";
import type { ConnectionRegistry } from "../ws/connection-registry.js";
import { readTodoFile } from "./todo-file.js";
import { readLastAuditTimestamp } from "./audit-liveness.js";
import fs from "node:fs";
import path from "node:path";

/** Minimum age before a job_interrupted notification is delivered.
 *  Gives the executor time to finish + write "completed" before we alert. 60s = 2 heartbeat ticks. */
const INTERRUPTED_MIN_AGE_MS = 60 * 1000;

/** Files written by the executor at job start/completion.
 *  Skipped in readRunDirMtime to avoid false "fresh" readings that mask stale workers.
 *  Only files written by the worker mid-run (scratch files, logs, data files) are valid liveness signals. */
const EXECUTOR_FILES = new Set([
  "todos.json",      // Primary signal — content-based via last_activity
  "deliverable.md",  // Written at job completion by executor
  "CLAUDE.md",       // Written at job start by executor
  "task.md",         // Written at job start by executor
]);

/** Recursive mtime of the run dir — fallback signal for subagent file writes.
 *  Bounded to depth 4 to avoid pathological traversal. Best-effort, returns 0 on any error. */
function readRunDirMtime(runDir: string | undefined, maxDepth = 4): number {
  if (!runDir) return 0;
  try {
    let latest = 0;
    const stack: Array<{ dir: string; depth: number }> = [{ dir: runDir, depth: 0 }];
    while (stack.length > 0) {
      const { dir, depth } = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        // Skip executor-written artifacts — these are written at job start/completion
        // and would give a false "fresh" reading, masking a genuinely stale worker.
        // Only files written by the worker mid-run (scratch files, logs, data files)
        // are valid liveness signals.
        if (EXECUTOR_FILES.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        try {
          const stat = fs.statSync(full);
          if (stat.mtimeMs > latest) latest = stat.mtimeMs;
          if (entry.isDirectory() && depth < maxDepth) {
            stack.push({ dir: full, depth: depth + 1 });
          }
        } catch {
          // skip unreadable entries
        }
      }
    }
    return latest;
  } catch {
    return 0;
  }
}

export interface HeartbeatConfig {
  jobService: AutomationJobService;
  notificationQueue: PersistentNotificationQueue;
  conversationInitiator: {
    alert(
      prompt: string,
      options?: { triggerJobId?: string },
    ): Promise<
      | { status: "delivered" }
      | { status: "no_conversation" }
      | { status: "transport_failed"; reason: string }
      | { status: "skipped_busy" }
      | { status: "send_failed"; reason: string }
    >;
    initiate(options?: {
      firstTurnPrompt?: string;
      channel?: string;
    }): Promise<{
      conversation: unknown;
      delivery:
        | { status: "delivered" }
        | { status: "no_conversation" }
        | { status: "transport_failed"; reason: string }
        | { status: "skipped_busy" }
        | { status: "send_failed"; reason: string };
    }>;
  } | null;
  staleThresholdMs: number; // default: 5 * 60 * 1000
  tickIntervalMs: number; // default: 30 * 1000
  capabilityHealthIntervalMs: number; // default: 60 * 60 * 1000
  /** Override the minimum age a job_interrupted notification must reach before delivery.
   *  Defaults to INTERRUPTED_MIN_AGE_MS (60 s). Set to 0 in tests that check single-tick delivery. */
  interruptedMinAgeMs?: number;
  capabilityHealthCheck?: () => Promise<void>;
  /** WS broadcast (M9.4-S5 B7). Optional — heartbeat tolerates absence in tests. */
  registry?: ConnectionRegistry;
  /** Agent directory — used to read logs/audit.jsonl for per-session liveness.
   *  When undefined, the audit-log signal is skipped and only todos.json activity is used. */
  agentDir?: string;
  /** Optional per-automation threshold resolver. Returns null/undefined to use the global default.
   *  Source: AutomationManifest.health.stale_threshold_ms */
  resolveStaleThresholdMs?: (automationId: string) => number | null | undefined;
}

export class HeartbeatService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastCapabilityCheck = 0;
  private config: HeartbeatConfig;
  private draining = false;
  public falsePositivesDropped = 0;

  constructor(config: HeartbeatConfig) {
    this.config = config;
  }

  /**
   * Trigger an immediate drain of pending notifications.
   * Reentrancy-guarded — concurrent callers no-op. (M9.4-S5 B1)
   */
  async drainNow(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      await this.deliverPendingNotifications();
    } catch (err) {
      console.warn("[Heartbeat] drainNow error:", err);
    } finally {
      this.draining = false;
    }
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
    if (!this.draining) {
      this.draining = true;
      try {
        await this.deliverPendingNotifications();
      } finally {
        this.draining = false;
      }
    }
    await this.checkCapabilityHealth();
  }

  private async checkStaleJobs(): Promise<void> {
    const runningJobs = this.config.jobService.listJobs({ status: "running" });
    const now = Date.now();

    for (const job of runningJobs) {
      if (!job.run_dir) continue;

      const todoPath = path.join(job.run_dir, "todos.json");
      const todoFile = readTodoFile(todoPath);

      const todoTime = new Date(todoFile.last_activity).getTime();
      const auditTime =
        this.config.agentDir && job.sdk_session_id
          ? readLastAuditTimestamp(this.config.agentDir, job.sdk_session_id)
          : 0;
      let lastActivity = Math.max(todoTime, auditTime);

      const threshold =
        this.config.resolveStaleThresholdMs?.(job.automationId) ??
        this.config.staleThresholdMs;

      // Layer 2 (lazy): only walk run-dir if BOTH todo and audit signals are stale.
      // Catches subagent-delegation gaps where worker session is silent in audit log
      // but files are still being written.
      if (now - lastActivity > threshold) {
        const runDirTime = readRunDirMtime(job.run_dir);
        lastActivity = Math.max(lastActivity, runDirTime);
      }

      const isStale = now - lastActivity > threshold;
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

    // Stage 1 (M9.4-S5 B7): upfront batch — broadcast handoff_pending for every
    // queued notification *before* any await, so all sibling cards refresh
    // their safety nets before serial alert delivery begins.
    if (this.config.registry) {
      for (const n of pending) {
        this.config.registry.broadcastToAll({
          type: "handoff_pending",
          jobId: n.job_id,
        });
      }
    }

    for (const notification of pending) {
      // Skip notifications that have exceeded max delivery attempts
      if (notification.delivery_attempts >= MAX_DELIVERY_ATTEMPTS) {
        console.warn(
          `[Heartbeat] Notification ${notification.job_id} exceeded ${MAX_DELIVERY_ATTEMPTS} delivery attempts — moving to delivered`,
        );
        this.config.notificationQueue.markDelivered(notification._filename!);
        continue;
      }

      // M9.1-S9: For job_interrupted, two guards before delivery:
      // (a) minimum-age gate — give the executor time to finish.
      // (b) recheck — if status changed away from "interrupted", drop.
      if (notification.type === "job_interrupted") {
        const ageMs = Date.now() - new Date(notification.created).getTime();
        const minAge = this.config.interruptedMinAgeMs ?? INTERRUPTED_MIN_AGE_MS;
        if (ageMs < minAge) {
          // Too fresh — leave in pending/ for the next tick.
          continue;
        }

        const fresh = this.config.jobService.getJob(notification.job_id);
        if (fresh && fresh.status !== "interrupted") {
          this.falsePositivesDropped++;
          console.log(
            `[Heartbeat] Discarding stale job_interrupted for ${notification.job_id} — job is now "${fresh.status}" (drops=${this.falsePositivesDropped})`,
          );
          this.config.notificationQueue.markDelivered(notification._filename!);
          continue;
        }
      }

      // Stage 2 (M9.4-S5 B7): per-iteration refresh — refresh the active
      // notification's clock right before its alert blocks.
      if (this.config.registry) {
        this.config.registry.broadcastToAll({
          type: "handoff_pending",
          jobId: notification.job_id,
        });
      }

      try {
        const prompt = this.formatNotification(notification);
        const result = await this.config.conversationInitiator.alert(prompt, {
          triggerJobId: notification.job_id, // M9.4-S5 B3
        });

        if (result.status === "delivered") {
          this.config.notificationQueue.markDelivered(notification._filename!);
        } else if (result.status === "no_conversation") {
          // Fresh install edge case — no conversation exists yet. Fall back
          // to initiate() and observe its delivery outcome. Per FU-7, never
          // mark delivered if initiate() itself couldn't stream a response
          // (same never-lie invariant as the alert path above).
          const init = await this.config.conversationInitiator.initiate({
            firstTurnPrompt: prompt,
          });
          if (init.delivery.status === "delivered") {
            this.config.notificationQueue.markDelivered(notification._filename!);
          } else {
            const reason =
              "reason" in init.delivery
                ? init.delivery.reason
                : init.delivery.status;
            console.warn(
              `[Heartbeat] Notification ${notification.job_id} initiate-fallback deferred: ${reason}`,
            );
            this.config.notificationQueue.incrementAttempts(
              notification._filename!,
            );
          }
        } else if (result.status === "skipped_busy" || result.status === "send_failed") {
          const reason =
            result.status === "skipped_busy"
              ? "session busy"
              : `send failed: ${result.reason}`;
          console.warn(
            `[Heartbeat] Notification ${notification.job_id} deferred: ${reason}`,
          );
          this.config.notificationQueue.incrementAttempts(
            notification._filename!,
          );
        } else {
          // transport_failed — keep the notification pending so the next tick
          // (or drainNow) retries. MAX_DELIVERY_ATTEMPTS handles eventual
          // give-up. Do NOT markDelivered; do NOT initiate().
          console.warn(
            `[Heartbeat] Notification ${notification.job_id} deferred: ${result.reason}`,
          );
          this.config.notificationQueue.incrementAttempts(
            notification._filename!,
          );
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
    const naturalFraming =
      "You are the conversation layer — present what matters to the user naturally. Don't acknowledge the system message itself.";

    switch (n.type) {
      case "job_completed": {
        // M9.4-S4.2: action-request framing. Past-Nina scheduled this
        // delivery; present-Nina is being asked to render and present it
        // now. Reference the artifact by file path; render in voice; do
        // not silently drop sections.
        const artifact = n.run_dir
          ? `\n\nDeliverable: ${n.run_dir}/deliverable.md\n\nRead the deliverable, render its contents in your voice, and present it to the user now. Editorial freedom inside each section — pick what matters, structure it, voice it — but do not silently drop sections from the deliverable.`
          : `\n\nThe deliverable summary is:\n\n${n.summary}\n\nRender it in your voice and present it to the user now.`;
        console.log(
          `[Heartbeat] Delivering job_completed as action request (${n.summary.length} chars summary, run_dir=${n.run_dir ? "yes" : "no"})`,
        );
        return `It's time to deliver the results from a scheduled background task you (past-you) set up.${artifact}`;
      }
      case "job_failed":
        return `A background task failed.\n\nError: ${n.summary}\n\n${naturalFraming} If the error seems transient, suggest re-triggering.`;
      case "job_interrupted":
        return `A background task was interrupted (stale — no recent tool activity detected).\n\nProgress: ${n.todos_completed ?? 0}/${n.todos_total ?? 0} items done.\nIncomplete: ${n.incomplete_items?.join(", ") || "unknown"}\nResumable: ${n.resumable ? "yes" : "no"}\n\n${naturalFraming}`;
      case "job_needs_review":
        return `A background task needs your review.\n\n${n.summary}\n\n${naturalFraming}`;
      case "infra_alert":
        // Caller supplies the full user-facing prompt in `summary`. Passed
        // through verbatim so the queue path preserves the original wording.
        return n.summary;
      default:
        return `[Notification] ${n.summary}\n\n${naturalFraming}`;
    }
  }
}
