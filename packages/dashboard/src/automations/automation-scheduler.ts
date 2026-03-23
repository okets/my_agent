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
    this.interval = setInterval(
      () => this.checkDue(),
      this.config.pollIntervalMs ?? 60_000,
    );
    // Check immediately
    await this.checkDue();
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
        if (this.isCronDue(trigger.cron, automation.id, now, tz)) {
          // Fire-and-forget: processor handles concurrency
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
    automationId: string,
    now: Date,
    tz: string,
  ): boolean {
    try {
      const interval = CronExpressionParser.parse(cron, {
        tz,
        currentDate: now,
      });
      const prev = interval.prev().toDate();
      // Check if last cron tick is after the most recent job for this automation
      const lastJob = this.config.jobService.listJobs({
        automationId,
        limit: 1,
      })[0];
      if (!lastJob) return true; // Never ran
      return prev > new Date(lastJob.created);
    } catch {
      console.warn(
        `[AutomationScheduler] Invalid cron for ${automationId}: ${cron}`,
      );
      return false;
    }
  }

  /**
   * Project future runs for active schedule automations.
   */
  getNextRuns(
    count: number = 10,
  ): Array<{ automationId: string; name: string; nextRun: Date }> {
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
}
