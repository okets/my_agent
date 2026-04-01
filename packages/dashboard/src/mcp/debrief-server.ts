/**
 * On-Demand Debrief MCP Tools
 *
 * Exposes request_debrief for the brain to call when the user asks
 * "what's on my plate?" or similar. Returns cached digest if already
 * run today, otherwise triggers a fresh debrief-context job.
 *
 * Also exposes read_full_report for follow-up questions — returns
 * the full unabridged worker reports from debrief-full.md.
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface DebriefSchedulerLike {
  hasRunToday(jobName: string): boolean;
  getDebriefOutput(): string | null;
  handleDebriefPrep(): Promise<string>;
  agentDir: string;
}

export function createDebriefHandler(scheduler: DebriefSchedulerLike) {
  return async (): Promise<string> => {
    if (scheduler.hasRunToday("debrief-context")) {
      const cached = scheduler.getDebriefOutput();
      if (cached) return cached;
    }
    return scheduler.handleDebriefPrep();
  };
}

export function createDebriefMcpServer(scheduler: DebriefSchedulerLike) {
  const handler = createDebriefHandler(scheduler);
  return createSdkMcpServer({
    name: "debrief",
    tools: [
      tool(
        "request_debrief",
        "Run or retrieve today's debrief digest — use when the user asks about their day, tasks, or schedule",
        {},
        async () => {
          const result = await handler();
          return {
            type: "text" as const,
            text: JSON.stringify({ debrief: result }),
          };
        },
      ),
      tool(
        "read_full_report",
        "Read the full unabridged worker reports from today's debrief — use when the user asks for more details on news, AQI, events, or project status",
        {},
        async () => {
          const fullPath = join(
            scheduler.agentDir,
            "notebook",
            "operations",
            "debrief-full.md",
          );
          if (existsSync(fullPath)) {
            const content = readFileSync(fullPath, "utf-8");
            return {
              type: "text" as const,
              text: content,
            };
          }
          // Fall back to running a fresh debrief
          const result = await handler();
          return {
            type: "text" as const,
            text: JSON.stringify({
              debrief: result,
              note: "Full report not available, showing digest.",
            }),
          };
        },
      ),
    ],
  });
}
