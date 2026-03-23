/**
 * Automation MCP Tools Server
 *
 * Exposes create_automation, fire_automation, list_automations, and resume_job
 * tools for the brain to manage automations during conversation.
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AutomationManager } from "../automations/automation-manager.js";
import type { AutomationProcessor } from "../automations/automation-processor.js";
import type { AutomationJobService } from "../automations/automation-job-service.js";

export interface AutomationServerDeps {
  automationManager: AutomationManager;
  processor: AutomationProcessor;
  jobService: AutomationJobService;
}

export function createAutomationServer(deps: AutomationServerDeps) {
  const createAutomationTool = tool(
    "create_automation",
    "Create a new automation (standing instruction). Use when the user wants recurring work, file watching, or a substantial one-off task. The automation manifest is saved to disk and indexed.",
    {
      name: z.string().describe("Human-readable name"),
      instructions: z
        .string()
        .describe(
          "What to do when triggered -- full context, the worker cannot see this conversation",
        ),
      trigger: z
        .array(
          z.object({
            type: z.enum(["schedule", "channel", "watch", "manual"]),
            cron: z
              .string()
              .optional()
              .describe("Cron expression for schedule triggers"),
            hint: z
              .string()
              .optional()
              .describe("Comma-separated keywords for channel matching"),
            path: z.string().optional().describe("Watch path"),
            space: z
              .string()
              .optional()
              .describe("Space name for watch triggers"),
          }),
        )
        .describe("When to fire this automation"),
      spaces: z.array(z.string()).optional().describe("Referenced space names"),
      model: z
        .string()
        .optional()
        .describe("Model override (haiku/sonnet/opus)"),
      notify: z.enum(["immediate", "debrief", "none"]).optional(),
      autonomy: z.enum(["full", "cautious", "review"]).optional(),
      once: z
        .boolean()
        .optional()
        .describe("true = fire once and auto-disable"),
      delivery: z
        .array(
          z.object({
            channel: z.enum(["whatsapp", "email", "dashboard"]),
            content: z.string().optional(),
          }),
        )
        .optional(),
    },
    async (args) => {
      try {
        const automation = deps.automationManager.create({
          name: args.name,
          instructions: args.instructions,
          manifest: {
            trigger: args.trigger,
            spaces: args.spaces,
            model: args.model,
            notify: args.notify,
            autonomy: args.autonomy,
            once: args.once,
            delivery: args.delivery?.map((d) => ({
              ...d,
              status: "pending" as const,
            })),
          },
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Automation "${automation.manifest.name}" created (ID: ${automation.id}). ${
                automation.manifest.trigger.some((t) => t.type === "schedule")
                  ? "Scheduler will pick it up on the next poll."
                  : "Use fire_automation to run it manually."
              }`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to create automation: ${err instanceof Error ? err.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  const fireAutomationTool = tool(
    "fire_automation",
    "Trigger an automation immediately. Use when the user says 'run X now' or after creating a once:true automation.",
    {
      automationId: z
        .string()
        .describe("Automation ID (filename without .md)"),
      context: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Trigger context/payload"),
    },
    async (args) => {
      const automation = deps.automationManager.findById(args.automationId);
      if (!automation) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Automation "${args.automationId}" not found`,
            },
          ],
          isError: true,
        };
      }

      try {
        // Fire is async — don't await, let it run in the background
        deps.processor
          .fire(automation, args.context)
          .catch((err) =>
            console.error(
              `[automation-server] fire failed for ${args.automationId}:`,
              err,
            ),
          );

        return {
          content: [
            {
              type: "text" as const,
              text: `Automation "${automation.manifest.name}" fired. A working agent is executing it now.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to fire automation: ${err instanceof Error ? err.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  const listAutomationsTool = tool(
    "list_automations",
    "List active automations with optional filtering. Use to discover available automations before firing or to answer 'what automations do I have?'",
    {
      status: z.enum(["active", "disabled", "all"]).optional(),
      search: z
        .string()
        .optional()
        .describe("Search term for name matching"),
    },
    async (args) => {
      const filter =
        args.status && args.status !== "all"
          ? { status: args.status }
          : undefined;
      const automations = deps.automationManager.list(filter);

      if (automations.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "No automations found." },
          ],
        };
      }

      // Optional search filter
      let filtered = automations;
      if (args.search) {
        const term = args.search.toLowerCase();
        filtered = automations.filter((a) =>
          a.manifest.name.toLowerCase().includes(term),
        );
      }

      if (filtered.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No automations matching "${args.search}".`,
            },
          ],
        };
      }

      const lines = filtered.map((a) => {
        const triggers = a.manifest.trigger
          .map((t) => t.type)
          .join(", ");
        return `- **${a.manifest.name}** (${a.id}) — ${a.manifest.status}, triggers: ${triggers}`;
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `${filtered.length} automation(s):\n${lines.join("\n")}`,
          },
        ],
      };
    },
  );

  const resumeJobTool = tool(
    "resume_job",
    "Resume a needs_review job with the user's response. The worker's SDK session will be restored with the user's input.",
    {
      jobId: z.string().describe("Job ID to resume"),
      userResponse: z
        .string()
        .describe("The user's answer to the review question"),
    },
    async (args) => {
      const job = deps.jobService.getJob(args.jobId);
      if (!job) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Job "${args.jobId}" not found`,
            },
          ],
          isError: true,
        };
      }

      if (job.status !== "needs_review") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Job "${args.jobId}" is ${job.status}, not in needs_review state`,
            },
          ],
          isError: true,
        };
      }

      const automation = deps.automationManager.findById(job.automationId);
      if (!automation) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Automation "${job.automationId}" not found for job ${args.jobId}`,
            },
          ],
          isError: true,
        };
      }

      // Resume the existing job with user response (no new job created)
      deps.processor
        .resume(automation, job, args.userResponse)
        .catch((err) =>
          console.error(
            `[automation-server] resume failed for ${args.jobId}:`,
            err,
          ),
        );

      return {
        content: [
          {
            type: "text" as const,
            text: `Job "${args.jobId}" resumed with your response. The worker will continue.`,
          },
        ],
      };
    },
  );

  return createSdkMcpServer({
    name: "automation-tools",
    tools: [
      createAutomationTool,
      fireAutomationTool,
      listAutomationsTool,
      resumeJobTool,
    ],
  });
}
