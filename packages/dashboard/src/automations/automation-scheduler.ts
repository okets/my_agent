/**
 * AutomationScheduler — Cron evaluation
 *
 * Polls every 60s, evaluates cron expressions for schedule-triggered automations,
 * and fires due automations via AutomationProcessor.
 */

import { CronExpressionParser } from "cron-parser";
import { resolveTimezone } from "../utils/timezone.js";
import type { AutomationManager } from "./automation-manager.js";
import type { AutomationProcessor } from "./automation-processor.js";
import type { AutomationJobService } from "./automation-job-service.js";

export interface AutomationSchedulerConfig {
  processor: AutomationProcessor;
  automationManager: AutomationManager;
  jobService: AutomationJobService;
  agentDir: string;
  pollIntervalMs?: number;
  /** Optional ConversationInitiator for stale job alerts */
  conversationInitiator?: {
    alert(
      prompt: string,
      options?: { triggerJobId?: string },
    ): Promise<boolean>;
    initiate(options?: { firstTurnPrompt?: string }): Promise<unknown>;
  } | null;
}

export class AutomationScheduler {
  private interval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private config: AutomationSchedulerConfig;

  constructor(config: AutomationSchedulerConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    this.isRunning = true;
    this.interval = setInterval(async () => {
      try {
        await this.checkDue();
      } catch (err) {
        console.error("[AutomationScheduler] checkDue failed:", err);
      }
    }, this.config.pollIntervalMs ?? 60_000);
    // Check immediately (errors don't prevent scheduler from running)
    try {
      await this.checkDue();
    } catch (err) {
      console.error("[AutomationScheduler] Initial checkDue failed:", err);
    }
    console.log(
      `[AutomationScheduler] Started, polling every ${(this.config.pollIntervalMs ?? 60_000) / 1000}s`,
    );
  }

  async stop(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.isRunning = false;
  }

  /**
   * Check for due automations and fire them.
   */
  async checkDue(): Promise<void> {
    if (!this.isRunning) return;

    let tz: string;
    try {
      tz = await resolveTimezone(this.config.agentDir);
    } catch {
      tz = "UTC";
    }
    const now = new Date();

    const automations = this.config.automationManager.list({
      status: "active",
    });

    for (const automation of automations) {
      const scheduleTriggers = automation.manifest.trigger.filter(
        (t) => t.type === "schedule",
      );
      for (const trigger of scheduleTriggers) {
        if (!trigger.cron) continue;
        const due = this.isCronDue(trigger.cron, automation, now, tz);
        if (due) {
          console.log(
            `[AutomationScheduler] Firing ${automation.id} cron="${trigger.cron}" tz=${tz} now=${now.toISOString()}`,
          );
          this.config.processor
            .fire(automation, { trigger: "schedule" })
            .catch((err) =>
              console.error(
                `[AutomationScheduler] Failed to fire ${automation.id}:`,
                err,
              ),
            );
        }
      }
    }
  }

  /**
   * Check if a cron expression is due for firing.
   * Due = the most recent cron tick is after the most recent job for this automation.
   */
  isCronDue(
    cron: string,
    automation: { id: string; manifest: { handler?: string } },
    now: Date,
    tz: string,
  ): boolean {
    try {
      // Add 1ms past the floored second to avoid cron-parser prev() boundary:
      // at the exact tick second, prev() returns the previous tick.
      // Floor to current second + 1ms avoids advancing past any minute boundary.
      const nudged = new Date(Math.floor(now.getTime() / 1000) * 1000 + 1);
      const interval = CronExpressionParser.parse(cron, {
        tz,
        currentDate: nudged,
      });
      const prev = interval.prev().toDate();

      // Check if last cron tick is after the most recent job for this automation
      const lastJob = this.config.jobService.listJobs({
        automationId: automation.id,
        limit: 1,
      })[0];

      // Also check by handler key — handles ID renames across migrations
      // (e.g. old "daily-summary" → new "debrief" both use handler "debrief-prep")
      let lastHandlerJob: { created: string } | undefined = lastJob;
      if (!lastJob && automation.manifest.handler) {
        const allRecent = this.config.jobService.listJobs({ limit: 20 });
        const handlerAutomations = this.config.automationManager
          .list()
          .filter((a) => a.manifest.handler === automation.manifest.handler)
          .map((a) => a.id);
        lastHandlerJob = allRecent.find((j) =>
          handlerAutomations.includes(j.automationId),
        );
      }

      if (!lastHandlerJob) {
        console.log(
          `[AutomationScheduler] ${automation.id}: no prior job, marking due (prev=${prev.toISOString()})`,
        );
        return true;
      }
      const lastDate = new Date(lastHandlerJob.created);
      const isDue = prev > lastDate;
      if (isDue) {
        console.log(
          `[AutomationScheduler] ${automation.id}: due — prev=${prev.toISOString()} last=${lastDate.toISOString()}`,
        );
      }
      return isDue;
    } catch {
      console.warn(
        `[AutomationScheduler] Invalid cron for ${automation.id}: ${cron}`,
      );
      return false;
    }
  }

  /**
   * Project future runs for active schedule automations.
   */
  async getNextRuns(
    count: number = 10,
  ): Promise<Array<{ automationId: string; name: string; nextRun: Date }>> {
    let tz: string;
    try {
      tz = await resolveTimezone(this.config.agentDir);
    } catch {
      tz = "UTC";
    }

    const automations = this.config.automationManager.list({
      status: "active",
    });
    const runs: Array<{
      automationId: string;
      name: string;
      nextRun: Date;
    }> = [];

    for (const automation of automations) {
      for (const trigger of automation.manifest.trigger) {
        if (trigger.type !== "schedule" || !trigger.cron) continue;
        try {
          const interval = CronExpressionParser.parse(trigger.cron, {
            tz,
            currentDate: new Date(),
          });
          runs.push({
            automationId: automation.id,
            name: automation.manifest.name,
            nextRun: interval.next().toDate(),
          });
        } catch {
          /* skip invalid */
        }
      }
    }

    return runs
      .sort((a, b) => a.nextRun.getTime() - b.nextRun.getTime())
      .slice(0, count);
  }

  /**
   * Check for stale jobs (stuck in "running" >30 min) and pending notifications.
   * Called alongside checkDue() on every scheduler tick.
   */
  async checkStaleJobs(): Promise<void> {
    const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
    const MAX_NOTIFICATION_ATTEMPTS = 3;
    const now = Date.now();

    const runningJobs = this.config.jobService.listJobs({ status: "running" });

    for (const job of runningJobs) {
      const age = now - new Date(job.created).getTime();
      if (age > STALE_THRESHOLD_MS) {
        console.warn(
          `[AutomationScheduler] Stale job detected: ${job.id} (running for ${Math.round(age / 60_000)} min)`,
        );
        this.config.jobService.updateJob(job.id, {
          status: "failed",
          completed: new Date().toISOString(),
          summary: `Timed out — stuck in running state for >${Math.round(STALE_THRESHOLD_MS / 60_000)} minutes`,
        });

        // Alert user
        try {
          await this.notifyFailure(
            job.automationId,
            job.id,
            "timed out while running",
          );
        } catch {
          this.config.jobService.updateJobContext(job.id, {
            ...(job.context as Record<string, unknown>),
            notificationPending: true,
            notificationAttempts: 1,
          });
        }
      }
    }

    // Retry pending notifications
    const allRecentJobs = this.config.jobService.listJobs({ limit: 50 });
    for (const job of allRecentJobs) {
      const ctx = job.context as Record<string, unknown> | undefined;
      if (!ctx?.notificationPending) continue;
      const attempts = (ctx.notificationAttempts as number) ?? 0;
      if (attempts >= MAX_NOTIFICATION_ATTEMPTS) {
        console.error(
          `[AutomationScheduler] Giving up on notification for job ${job.id} after ${attempts} attempts`,
        );
        this.config.jobService.updateJobContext(job.id, {
          ...ctx,
          notificationPending: false,
        });
        continue;
      }

      try {
        await this.notifyFailure(
          job.automationId,
          job.id,
          job.summary ?? "failed",
        );
        this.config.jobService.updateJobContext(job.id, {
          ...ctx,
          notificationPending: false,
        });
      } catch {
        this.config.jobService.updateJobContext(job.id, {
          ...ctx,
          notificationAttempts: attempts + 1,
        });
      }
    }
  }

  // Scheduled-job failures bypass the persistent notification queue and call
  // ci.alert()/ci.initiate() directly. Routing follows the M10-S0 presence
  // rule (last user turn within 15 min → that channel, else preferred), so
  // there is no source-channel input to thread through.
  private async notifyFailure(
    automationId: string,
    jobId: string,
    errorSummary: string,
  ): Promise<void> {
    const ci = this.config.conversationInitiator;
    if (!ci) return;

    const automation = this.config.automationManager.findById(automationId);
    const name = automation?.manifest.name ?? automationId;
    const prompt =
      `A working agent running "${name}" ${errorSummary}.\n\n` +
      `Job ID: ${jobId}\n\n` +
      `You are the conversation layer — let the user know briefly.`;
    const alerted = await ci.alert(prompt);
    if (!alerted) {
      await ci.initiate({ firstTurnPrompt: `[SYSTEM: ${prompt}]` });
    }
  }
}
