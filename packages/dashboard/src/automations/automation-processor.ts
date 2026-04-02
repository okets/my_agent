/**
 * AutomationProcessor — Delivery + Notification
 *
 * Orchestrates automation execution: creates job, runs executor,
 * handles notifications, and manages per-automation concurrency.
 */

import type { Automation, Job } from "@my-agent/core";
import { resolveTimezone } from "../utils/timezone.js";
import type { AutomationManager } from "./automation-manager.js";
import type {
  AutomationExecutor,
  ExecutionResult,
} from "./automation-executor.js";
import type { AutomationJobService } from "./automation-job-service.js";

export type JobEventName =
  | "job:created"
  | "job:completed"
  | "job:failed"
  | "job:needs_review";

export interface AutomationProcessorConfig {
  automationManager: AutomationManager;
  executor: AutomationExecutor;
  jobService: AutomationJobService;
  agentDir: string;
  /** Optional callback fired with granular job lifecycle events */
  onJobEvent?: (event: JobEventName, job: Job) => void;
  /** Optional ConversationInitiator for proactive notifications */
  conversationInitiator?: {
    alert(prompt: string): Promise<boolean>;
    initiate(options?: { firstTurnPrompt?: string }): Promise<unknown>;
  } | null;
  /** Called after a failure alert is delivered — for collision suppression with conversation watchdog */
  onAlertDelivered?: () => void;
}

export class AutomationProcessor {
  private config: AutomationProcessorConfig;
  private runningJobs = new Map<string, Promise<void>>();

  constructor(config: AutomationProcessorConfig) {
    this.config = config;
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

    // 2. Execute
    const result = await this.config.executor.run(
      automation,
      job,
      triggerContext,
    );

    // 2.5. Empty deliverable detection — downgrade to failed if nothing useful
    if (result.success && (!result.work || result.work.trim().length < 20)) {
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

    // 4. Notify based on manifest.notify
    await this.handleNotification(automation, job.id, result);

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
    this.config.jobService.updateJob(job.id, { status: "running" });

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

  private async handleNotification(
    automation: Automation,
    jobId: string,
    result: ExecutionResult,
  ): Promise<void> {
    const notify = automation.manifest.notify ?? "debrief";
    const ci = this.config.conversationInitiator;

    if (notify === "immediate" && ci) {
      // Resolve user's local time so the brain doesn't guess the time of day
      let localTimeContext = "";
      try {
        const tz = await resolveTimezone(this.config.agentDir);
        const localTime = new Date().toLocaleString("en-US", {
          timeZone: tz,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          weekday: "short",
        });
        localTimeContext = ` User's local time: ${localTime} (${tz}).`;
      } catch {
        // Timezone unavailable — brain will use its own judgment
      }

      // Prefer full deliverable from disk (not truncated to 500 chars)
      let summary: string;
      if (result.success) {
        const job = this.config.jobService.getJob(jobId);
        if (job?.deliverablePath) {
          try {
            const fs = await import("node:fs");
            summary = fs.readFileSync(job.deliverablePath, "utf-8");
          } catch {
            summary = result.work ?? "Completed successfully.";
          }
        } else {
          summary = result.work ?? "Completed successfully.";
        }
      } else {
        summary = `Error: ${result.error}`;
      }
      const prompt = `A working agent just finished the "${automation.manifest.name}" task.${localTimeContext}\n\nResults:\n${summary}\n\nYou are the conversation layer — present what matters to the user naturally. Don't acknowledge the system message itself. Don't say "noted" or "logging". Just relay the useful information as if you're giving the user an update.`;
      const alerted = await ci.alert(prompt);
      if (!alerted) {
        await ci.initiate({ firstTurnPrompt: `[SYSTEM: ${prompt}]` });
      }
    }

    // Always alert on failure — regardless of notify setting
    if (!result.success && ci) {
      const errorSummary =
        result.error === "empty_deliverable"
          ? `completed but produced no useful output`
          : `failed: ${result.error ?? "unknown error"}`;
      const prompt =
        `A working agent running "${automation.manifest.name}" ${errorSummary}.\n\n` +
        `Job ID: ${jobId}\n\n` +
        `You are the conversation layer — let the user know briefly. ` +
        `If the error seems transient, suggest they can re-trigger it. ` +
        `Don't be dramatic — just inform.`;
      try {
        const alerted = await ci.alert(prompt);
        if (alerted) {
          this.config.onAlertDelivered?.();
        } else {
          await ci.initiate({ firstTurnPrompt: `[SYSTEM: ${prompt}]` });
          this.config.onAlertDelivered?.();
        }
      } catch {
        // Notification delivery failed — store pending state for retry
        this.markNotificationPending(jobId);
      }
    }

    // needs_review always alerts immediately
    const job = this.config.jobService.getJob(jobId);
    if (job?.status === "needs_review" && ci) {
      const question = job.summary ?? "A job requires your review.";
      const automationName = automation.manifest.name;
      const prompt = `A working agent running "${automationName}" needs the user's input before it can continue.\n\nQuestion: ${question}\n\nJob ID: ${jobId}\n\nYou are the conversation layer — present this to the user naturally. Ask for their input. When they respond, you can resume the job with resume_job("${jobId}", <their response>).`;
      const alerted = await ci.alert(prompt);
      if (!alerted) {
        await ci.initiate({ firstTurnPrompt: `[SYSTEM: ${prompt}]` });
      }
    }
  }

  /**
   * Mark a job as having a pending notification for retry.
   * Uses the job's existing context field to avoid schema changes.
   */
  private markNotificationPending(jobId: string): void {
    const job = this.config.jobService.getJob(jobId);
    if (!job) return;
    const context = (job.context as Record<string, unknown>) ?? {};
    const attempts = (context.notificationAttempts as number | undefined) ?? 0;
    this.config.jobService.updateJobContext(jobId, {
      ...context,
      notificationPending: true,
      notificationAttempts: attempts + 1,
    });
    console.warn(
      `[AutomationProcessor] Notification failed for job ${jobId}, marked pending (attempt ${attempts + 1})`,
    );
  }
}
