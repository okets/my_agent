/**
 * AutomationProcessor — Delivery + Notification
 *
 * Orchestrates automation execution: creates job, runs executor,
 * handles notifications, and manages per-automation concurrency.
 */

import type { Automation, Job } from "@my-agent/core";
import type { AutomationManager } from "./automation-manager.js";
import type {
  AutomationExecutor,
  ExecutionResult,
} from "./automation-executor.js";
import type { AutomationJobService } from "./automation-job-service.js";
import type { PersistentNotificationQueue } from "../notifications/persistent-queue.js";
import { readTodoFile } from "./todo-file.js";
import { resolveJobSummaryAsync } from "./summary-resolver.js";
import { queryModel } from "../scheduler/query-model.js";
import path from "node:path";

export type JobEventName =
  | "job:created"
  | "job:started"
  | "job:progress"
  | "job:completed"
  | "job:failed"
  | "job:needs_review"
  | "job:interrupted";

export interface AutomationProcessorConfig {
  automationManager: AutomationManager;
  executor: AutomationExecutor;
  jobService: AutomationJobService;
  agentDir: string;
  /** Optional callback fired with granular job lifecycle events */
  onJobEvent?: (event: JobEventName, job: Job) => void;
  /** Optional ConversationInitiator for proactive notifications */
  conversationInitiator?: {
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
  /** Called after a failure alert is delivered — for collision suppression with conversation watchdog */
  onAlertDelivered?: () => void;
  /** Persistent notification queue — heartbeat handles delivery */
  notificationQueue?: PersistentNotificationQueue;
  /** Heartbeat reference for fast-path drain on job:completed (M9.4-S5 B2). */
  heartbeat?: { drainNow(): Promise<void> };
}

export class AutomationProcessor {
  private config: AutomationProcessorConfig;
  private runningJobs = new Map<string, Promise<void>>();

  constructor(config: AutomationProcessorConfig) {
    this.config = config;
  }

  /**
   * Wire the heartbeat reference post-construction (M9.4-S5 B2).
   * Required because Heartbeat is constructed after Processor in app.ts.
   * Must be called before the first job completes, otherwise drain falls
   * back to the next 30s tick.
   */
  setHeartbeat(hb: { drainNow(): Promise<void> }): void {
    this.config.heartbeat = hb;
  }

  /**
   * Fire an automation with per-automation concurrency control.
   * Skips if the automation is already running.
   */
  async fire(
    automation: Automation,
    context?: Record<string, unknown>,
  ): Promise<void> {
    const existing = this.runningJobs.get(automation.id);
    if (existing) {
      console.warn(
        `[AutomationProcessor] Skipping ${automation.id} -- already running`,
      );
      return;
    }

    const promise = this.executeAndDeliver(automation, context).finally(() => {
      this.runningJobs.delete(automation.id);
    });
    this.runningJobs.set(automation.id, promise);
    await promise;
  }

  /**
   * Execute an automation and handle delivery + notification.
   */
  async executeAndDeliver(
    automation: Automation,
    triggerContext?: Record<string, unknown>,
  ): Promise<void> {
    // 1. Create job
    const job = this.config.jobService.createJob(automation.id, triggerContext);
    this.config.onJobEvent?.("job:created", job);

    // 1.5. Mark as running
    const startedJob = this.config.jobService.updateJob(job.id, {
      status: "running",
    });
    this.config.onJobEvent?.("job:started", startedJob);

    // 2. Execute
    const result = await this.config.executor.run(
      automation,
      job,
      triggerContext,
    );

    // 2.5. Empty deliverable detection — downgrade to failed if nothing useful.
    // M9.4-S4.3 Item E: heuristic reads on-disk truth (result.deliverable),
    // not the response stream (result.work, which fu1's anti-narration directive
    // correctly silences). Handlers (manifest.handler set) are authoritative —
    // they don't go through the worker-deliverable contract, so skip the heuristic.
    // Surfaced by 2026-05-02 incident with update-relocation-roadmap worker.
    const isHandlerBased = !!automation.manifest.handler;
    if (
      !isHandlerBased &&
      result.success &&
      (!result.deliverable || result.deliverable.trim().length < 20)
    ) {
      console.warn(
        `[AutomationProcessor] Empty deliverable for "${automation.manifest.name}" (job ${job.id})`,
      );
      this.config.jobService.updateJob(job.id, {
        status: "failed",
        summary: "Completed with empty deliverable — no useful output produced",
      });
      result.success = false;
      result.error = "empty_deliverable";
    }

    // 3. Emit granular completion event
    const updatedJob = this.config.jobService.getJob(job.id);
    if (updatedJob) {
      const eventName: JobEventName =
        updatedJob.status === "needs_review"
          ? "job:needs_review"
          : updatedJob.status === "failed"
            ? "job:failed"
            : "job:completed";
      this.config.onJobEvent?.(eventName, updatedJob);
    }

    // 4. Notify based on manifest.notify (skip if user-stopped — stop route handles notification)
    if (result.error !== "Stopped by user") {
      await this.handleNotification(automation, job.id, result);
    }

    // 5. If once: true, disable automation after success
    if (automation.manifest.once && result.success) {
      this.config.automationManager.disable(automation.id);
    }
  }

  /**
   * Resume a needs_review job with the user's response.
   * Re-uses the existing job (no new job created).
   */
  async resume(
    automation: Automation,
    job: Job,
    userResponse: string,
  ): Promise<void> {
    // Update job status to running
    const startedJob = this.config.jobService.updateJob(job.id, {
      status: "running",
    });
    this.config.onJobEvent?.("job:started", startedJob);

    // Execute with user response in context
    const triggerContext = {
      ...(job.context ?? {}),
      resumedFrom: job.id,
      userResponse,
    };
    const result = await this.config.executor.run(
      automation,
      job,
      triggerContext,
    );

    // Emit granular event for resumed job
    const resumedJob = this.config.jobService.getJob(job.id);
    if (resumedJob) {
      const eventName: JobEventName =
        resumedJob.status === "needs_review"
          ? "job:needs_review"
          : resumedJob.status === "failed"
            ? "job:failed"
            : "job:completed";
      this.config.onJobEvent?.(eventName, resumedJob);
    }

    // Handle notification
    await this.handleNotification(automation, job.id, result);
  }

  /**
   * Check if an automation is currently running.
   */
  isRunning(automationId: string): boolean {
    return this.runningJobs.has(automationId);
  }

  /**
   * Write notification to persistent queue. Heartbeat service handles delivery.
   * Falls back to direct ci.alert() if no queue is configured (backward compat).
   */
  private async handleNotification(
    automation: Automation,
    jobId: string,
    result: ExecutionResult,
  ): Promise<void> {
    const notify = automation.manifest.notify ?? "debrief";
    const job = this.config.jobService.getJob(jobId);
    if (!job) return;

    // Build todo progress from disk
    let todosCompleted = 0;
    let todosTotal = 0;
    let incompleteItems: string[] = [];
    if (job.run_dir) {
      try {
        const todoFile = readTodoFile(
          path.join(job.run_dir, "todos.json"),
        );
        todosTotal = todoFile.items.length;
        todosCompleted = todoFile.items.filter((i) => i.status === "done").length;
        incompleteItems = todoFile.items
          .filter((i) => i.status !== "done")
          .map((i) => i.text);
      } catch {
        // No todo file — legacy job
      }
    }

    // Determine notification type
    const type = job.status === "needs_review"
      ? ("job_needs_review" as const)
      : result.success
        ? ("job_completed" as const)
        : ("job_failed" as const);

    // Skip queue for debrief notifications (bundled later)
    if (notify === "debrief" && type === "job_completed") return;
    // Skip queue for none
    if (notify === "none" && type === "job_completed") return;

    const summary =
      type === "job_needs_review"
        ? (job.summary ?? "A job requires your review.")
        : type === "job_failed"
          ? `Failed: ${result.error ?? "unknown error"}`
          : await resolveJobSummaryAsync(job.run_dir, result.work ?? "Completed successfully.", queryModel);

    // Write to persistent queue — heartbeat handles delivery
    if (this.config.notificationQueue) {
      this.config.notificationQueue.enqueue({
        job_id: jobId,
        automation_id: job.automationId,
        type,
        summary: `[${automation.manifest.name}] ${summary}`,
        todos_completed: todosCompleted,
        todos_total: todosTotal,
        incomplete_items: incompleteItems.length > 0 ? incompleteItems : undefined,
        resumable: job.status === "needs_review",
        run_dir: job.run_dir,
        created: new Date().toISOString(),
        delivery_attempts: 0,
      });
      // M9.4-S5 B2: fire-and-forget fast-path drain. Failures are non-fatal
      // — next 30s heartbeat tick retries.
      this.config.heartbeat?.drainNow().catch((err) => {
        console.warn(`[AutomationProcessor] drainNow failed for ${jobId}:`, err);
      });

      this.config.onAlertDelivered?.();
      return;
    }

    // Fallback: direct ci.alert() (no persistent queue configured)
    const ci = this.config.conversationInitiator;
    if (!ci) return;

    const prompt = `[${type}] ${automation.manifest.name}: ${summary}`;
    try {
      const result = await ci.alert(prompt);
      if (result.status === "delivered") {
        this.config.onAlertDelivered?.();
      } else if (result.status === "no_conversation") {
        const init = await ci.initiate({ firstTurnPrompt: prompt });
        if (init.delivery.status === "delivered") {
          this.config.onAlertDelivered?.();
        } else {
          const reason =
            "reason" in init.delivery ? init.delivery.reason : init.delivery.status;
          console.warn(
            `[AutomationProcessor] Alert for job ${jobId} initiate-fallback deferred: ${reason}`,
          );
        }
      } else {
        // transport_failed / skipped_busy / send_failed — no queue configured
        // in this fallback path, so there's nothing to retry against. Log and move on.
        const reason = "reason" in result ? result.reason : result.status;
        console.warn(
          `[AutomationProcessor] Alert for job ${jobId} deferred: ${reason}`,
        );
      }
    } catch {
      console.warn(
        `[AutomationProcessor] Notification delivery failed for job ${jobId}`,
      );
    }
  }
}
