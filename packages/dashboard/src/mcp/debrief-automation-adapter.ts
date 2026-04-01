/**
 * Debrief Automation Adapter
 *
 * Bridges the DebriefSchedulerLike interface (used by debrief MCP server)
 * to the automation system. Uses debrief-reporter handler which collects
 * worker results + notebook context.
 *
 * M7-S8: Updated to use debrief-reporter (collector) instead of debrief-context.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DebriefSchedulerLike } from "./debrief-server.js";
import type { AutomationJobService } from "../automations/automation-job-service.js";
import type { ConversationDatabase } from "../conversations/db.js";
import { getHandler } from "../scheduler/jobs/handler-registry.js";

/**
 * Create a DebriefSchedulerLike backed by the automation job service.
 *
 * @param getJobService - Lazy getter (scheduler may not be initialized yet)
 * @param agentDir - Agent directory for running debrief handler
 * @param getDb - Lazy getter for database (needed by reporter for worker queries)
 */
export function createDebriefAutomationAdapter(
  getJobService: () => AutomationJobService | null,
  agentDir: string,
  getDb?: () => ConversationDatabase | null,
): DebriefSchedulerLike {
  return {
    agentDir,

    hasRunToday(jobName: string): boolean {
      if (jobName !== "debrief-context") return false;
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
      // Read the assembled digest from disk (written by debrief-reporter handler)
      const briefPath = join(
        agentDir,
        "notebook",
        "operations",
        "debrief-digest.md",
      );
      if (existsSync(briefPath)) {
        try {
          return readFileSync(briefPath, "utf-8");
        } catch {
          // Fall through to DB lookup
        }
      }

      // Fall back to current-state.md (notebook context only)
      const statePath = join(
        agentDir,
        "notebook",
        "operations",
        "current-state.md",
      );
      if (existsSync(statePath)) {
        try {
          return readFileSync(statePath, "utf-8");
        } catch {
          // Fall through
        }
      }

      return null;
    },

    async handleDebriefPrep(): Promise<string> {
      // Use debrief-reporter if available (collects worker results)
      const reporter = getHandler("debrief-reporter");
      if (reporter) {
        const jobService = getJobService();
        const jobId = jobService
          ? `debrief-ondemand-${Date.now()}`
          : "debrief-ondemand";

        const db = getDb?.() ?? undefined;
        const result = await reporter({
          agentDir,
          jobId,
          db,
        });
        return result.work;
      }

      // Fall back to debrief-context (no worker collection)
      const handler = getHandler("debrief-context");
      if (!handler) {
        return "Debrief handler not registered.";
      }

      const jobService = getJobService();
      const jobId = jobService
        ? `debrief-ondemand-${Date.now()}`
        : "debrief-ondemand";

      const result = await handler({
        agentDir,
        jobId,
      });

      return result.work;
    },
  };
}
