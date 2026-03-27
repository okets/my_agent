/**
 * On-Demand Debrief MCP Tool
 *
 * Exposes request_debrief for the brain to call when the user asks
 * "what's on my plate?" or similar. Returns cached debrief if already
 * run today, otherwise triggers a fresh debrief-context job.
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";

export interface DebriefSchedulerLike {
  hasRunToday(jobName: string): boolean;
  getDebriefOutput(): string | null;
  handleDebriefPrep(): Promise<string>;
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
        "Run or retrieve today's debrief — use when the user asks about their day, tasks, or schedule",
        {},
        async () => {
          const result = await handler();
          return {
            type: "text" as const,
            text: JSON.stringify({ debrief: result }),
          };
        },
      ),
    ],
  });
}
