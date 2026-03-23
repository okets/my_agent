/**
 * AutomationProcessor — Delivery + Notification
 *
 * Orchestrates automation execution: creates job, runs executor,
 * handles notifications, and manages per-automation concurrency.
 */

import type { Automation, Job } from "@my-agent/core";
import type { AutomationManager } from "./automation-manager.js";
import type { AutomationExecutor, ExecutionResult } from "./automation-executor.js";
import type { AutomationJobService } from "./automation-job-service.js";

export interface AutomationProcessorConfig {
  automationManager: AutomationManager;
  executor: AutomationExecutor;
  jobService: AutomationJobService;
  /** Optional callback fired after any job mutation (for state publishing) */
  onJobMutated?: () => void;
  /** Optional ConversationInitiator for proactive notifications */
  conversationInitiator?: {
    alert(prompt: string): Promise<boolean>;
    initiate(options?: { firstTurnPrompt?: string }): Promise<unknown>;
  } | null;
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
    const job = this.config.jobService.createJob(
      automation.id,
      triggerContext,
    );

    // 2. Execute
    const result = await this.config.executor.run(
      automation,
      job,
      triggerContext,
    );

    // 3. Notify based on manifest.notify
    await this.handleNotification(automation, job.id, result);

    // 4. If once: true, disable automation after success
    if (automation.manifest.once && result.success) {
      this.config.automationManager.disable(automation.id);
    }

    // 5. Emit state change
    this.config.onJobMutated?.();
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

    // Handle notification
    await this.handleNotification(automation, job.id, result);

    // Emit state change
    this.config.onJobMutated?.();
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
      const prompt = result.success
        ? `Automation "${automation.manifest.name}" completed. Job ${jobId}. Summary: ${result.work?.slice(0, 500)}.`
        : `Automation "${automation.manifest.name}" failed. Error: ${result.error}`;
      const alerted = await ci.alert(prompt);
      if (!alerted) {
        await ci.initiate({ firstTurnPrompt: `[SYSTEM: ${prompt}]` });
      }
    }

    // needs_review always alerts immediately
    const job = this.config.jobService.getJob(jobId);
    if (job?.status === "needs_review" && ci) {
      const prompt = `Automation "${automation.manifest.name}" needs your review. Job ${jobId}. Question: ${job.summary}. Use resume_job to respond.`;
      const alerted = await ci.alert(prompt);
      if (!alerted) {
        await ci.initiate({ firstTurnPrompt: `[SYSTEM: ${prompt}]` });
      }
    }
  }
}
