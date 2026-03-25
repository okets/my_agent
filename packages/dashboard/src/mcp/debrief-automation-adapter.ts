/**
 * Debrief Automation Adapter
 *
 * Bridges the DebriefSchedulerLike interface (used by debrief MCP server)
 * to the automation system. Replaces WorkLoopScheduler as the debrief provider.
 */

import type { DebriefSchedulerLike } from "./debrief-server.js";
import type { AutomationJobService } from "../automations/automation-job-service.js";
import { getHandler } from "../scheduler/jobs/handler-registry.js";

/**
 * Create a DebriefSchedulerLike backed by the automation job service.
 *
 * @param getJobService - Lazy getter (scheduler may not be initialized yet)
 * @param agentDir - Agent directory for running debrief handler
 */
export function createDebriefAutomationAdapter(
  getJobService: () => AutomationJobService | null,
  agentDir: string,
): DebriefSchedulerLike {
  return {
    hasRunToday(jobName: string): boolean {
      if (jobName !== "debrief-prep") return false;
      const jobService = getJobService();
      if (!jobService) return false;

      const today = new Date().toISOString().split("T")[0];
      const jobs = jobService.listJobs({
        automationId: "debrief",
        status: "completed",
        since: today,
        limit: 1,
      });
      return jobs.length > 0;
    },

    getDebriefOutput(): string | null {
      const jobService = getJobService();
      if (!jobService) return null;

      const today = new Date().toISOString().split("T")[0];
      const jobs = jobService.listJobs({
        automationId: "debrief",
        status: "completed",
        since: today,
        limit: 1,
      });
      return jobs.length > 0 ? (jobs[0].summary ?? null) : null;
    },

    async handleDebriefPrep(): Promise<string> {
      const handler = getHandler("debrief-prep");
      if (!handler) {
        return "Debrief handler not registered.";
      }

      const jobService = getJobService();
      const jobId = jobService
        ? `debrief-ondemand-${Date.now()}`
        : "debrief-ondemand";

      const result = await handler({
        agentDir,
        db: null as any, // handler doesn't use db directly
        jobId,
      });

      return result.work;
    },
  };
}
