/**
 * Automation MCP Tools Server
 *
 * Exposes create_automation, fire_automation, list_automations, resume_job,
 * check_job_status, dismiss_job, and disable_automation tools for the brain
 * to manage automations during conversation.
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import path from "node:path";
import type { Job } from "@my-agent/core";
import type { AutomationManager } from "../automations/automation-manager.js";
import type { AutomationProcessor } from "../automations/automation-processor.js";
import type { AutomationJobService } from "../automations/automation-job-service.js";
import { readTodoFile } from "../automations/todo-file.js";

export interface AutomationServerDeps {
  automationManager: AutomationManager;
  processor: AutomationProcessor;
  jobService: AutomationJobService;
  /** Optional: notify UI of state changes (jobs, automations) */
  onStateChanged?: () => void;
  /** Optional: executor for direct resume with session ID */
  executor?: {
    resume(
      job: any,
      userInput: string,
      sessionId: string | null,
    ): Promise<{
      success: boolean;
      status: string;
      summary?: string;
      error?: string;
    }>;
  };
}

function formatJobTodoProgress(job: Job): string {
  if (!job.run_dir) return "";
  const todoFile = readTodoFile(path.join(job.run_dir, "todos.json"));
  if (todoFile.items.length === 0) return "";

  const completed = todoFile.items.filter((i) => i.status === "done");
  const inProgress = todoFile.items.filter((i) => i.status === "in_progress");
  const pending = todoFile.items.filter((i) => i.status === "pending");
  const blocked = todoFile.items.filter((i) => i.status === "blocked");

  const parts: string[] = [
    `\n  Progress: ${completed.length}/${todoFile.items.length} items done`,
  ];
  if (inProgress.length > 0) {
    parts.push(
      `  In progress: ${inProgress.map((i) => i.text).join(", ")}`,
    );
  }
  if (pending.length > 0) {
    parts.push(`  Pending: ${pending.map((i) => i.text).join(", ")}`);
  }
  if (blocked.length > 0) {
    parts.push(`  Blocked: ${blocked.map((i) => i.text).join(", ")}`);
  }
  return parts.join("\n");
}

export function createAutomationServer(deps: AutomationServerDeps) {
  const createAutomationTool = tool(
    "create_automation",
    "Delegate work to a working agent. Use for ANY task beyond a single-question WebSearch: research, comparisons, analysis, file creation, multi-step work, scheduled tasks, recurring jobs. The worker handles execution with a tracked paper trail while you manage the conversation. Examples: 'Research best headphones under $300', 'Compare Thai restaurants in Chiang Mai', 'Check memory usage and report back'.",
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
      target_path: z
        .string()
        .optional()
        .describe(
          "Path to the artifact folder this job creates or modifies (e.g., .my_agent/capabilities/stt-deepgram). When set, the framework writes a paper trail entry to DECISIONS.md at this path after job completion.",
        ),
      // IMPORTANT: todos is required in the Zod schema (MCP tool contract) but
      // optional in the TypeScript AutomationManifest interface. This is intentional:
      // - Zod gates Conversation Nina's tool calls — she must always decompose tasks
      // - AutomationManifest stays optional because disk-based automations, handlers,
      //   scheduler, fire_automation, and resume_job all bypass Zod and may have no todos
      // Do NOT make todos required in AutomationManifest — it would break disk automations.
      todos: z
        .array(z.object({ text: z.string() }))
        .min(1)
        .describe(
          "Task breakdown for the working agent. REQUIRED — every task needs at least one todo, even simple ones (e.g., [{text: 'Check the weather in Bangkok'}]). Each item becomes a mandatory checklist item the worker must complete. Break the user's request into concrete steps.",
        ),
      job_type: z
        .enum(["capability_build", "capability_modify", "generic", "research"])
        .optional()
        .describe(
          "Job type — triggers template-based mandatory items for known types like capability builds",
        ),
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
            target_path: args.target_path,
            todos: args.todos,
            job_type: args.job_type,
          },
        });

        // Notify UI of new automation (updates automations store for progress bar matching)
        deps.onStateChanged?.();

        // Auto-fire one-shot manual automations — no separate fire_automation call needed
        const isOnceManual = args.once &&
          args.trigger.every(t => t.type === 'manual');

        if (isOnceManual) {
          deps.processor
            .fire(automation, { sourceChannel: "dashboard" })
            .catch((err) =>
              console.error(
                `[automation-server] auto-fire failed for ${automation.id}:`,
                err,
              ),
            );

          return {
            content: [
              {
                type: "text" as const,
                text: `Automation "${automation.manifest.name}" created and fired (ID: ${automation.id}). A working agent is executing it now.`,
              },
            ],
          };
        }

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
      automationId: z.string().describe("Automation ID (filename without .md)"),
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
        // Tag source as 'dashboard' — the brain's MCP tools always run in a
        // dashboard session. This prevents job notifications from bleeding
        // to WhatsApp when the active conversation has channel history.
        const contextWithSource = {
          ...args.context,
          sourceChannel: "dashboard",
        };

        // Fire is async — don't await, let it run in the background
        deps.processor
          .fire(automation, contextWithSource)
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
      search: z.string().optional().describe("Search term for name matching"),
    },
    async (args) => {
      const filter: { status?: string; excludeSystem?: boolean } =
        args.status && args.status !== "all"
          ? { status: args.status, excludeSystem: true }
          : { excludeSystem: true };
      const automations = deps.automationManager.list(filter);

      if (automations.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No automations found." }],
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
        const triggers = a.manifest.trigger.map((t) => t.type).join(", ");
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
    "Resume a needs_review or interrupted job. For needs_review: pass the user's response. For interrupted: the worker resumes with todo context showing completed/remaining items. The worker's SDK session will be restored when possible.",
    {
      jobId: z.string().describe("Job ID to resume"),
      userResponse: z
        .string()
        .optional()
        .describe(
          "The user's answer (required for needs_review, optional for interrupted)",
        ),
      force: z
        .boolean()
        .optional()
        .describe(
          "Accept job as-is despite incomplete mandatory items (user override for validator bugs)",
        ),
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

      if (job.status !== "needs_review" && job.status !== "interrupted") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Job "${args.jobId}" is ${job.status}, not in needs_review or interrupted state`,
            },
          ],
          isError: true,
        };
      }

      // Force-complete: accept job as-is despite incomplete mandatory items
      if (args.force) {
        deps.jobService.updateJob(args.jobId, {
          status: "completed",
          completed: new Date().toISOString(),
          summary: "Force-completed by user (incomplete mandatory items accepted)",
        });
        deps.onStateChanged?.();
        return {
          content: [
            {
              type: "text" as const,
              text: `Job "${args.jobId}" force-completed. Incomplete mandatory items accepted.`,
            },
          ],
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

      // Build resume prompt — todo-aware for interrupted jobs
      let resumePrompt = args.userResponse ?? "";
      if (job.status === "interrupted" && job.run_dir) {
        const todoFile = readTodoFile(path.join(job.run_dir, "todos.json"));
        const done = todoFile.items
          .filter((i) => i.status === "done")
          .map((i) => i.text);
        const remaining = todoFile.items
          .filter((i) => i.status !== "done")
          .map((i) => i.text);

        resumePrompt =
          `You were interrupted. Your todo list shows ${done.length} items completed:\n${done.map((t) => `\u2713 ${t}`).join("\n")}\n\nRemaining:\n${remaining.map((t) => `\u2610 ${t}`).join("\n")}\n\nContinue from where you left off. Call todo_list to see your full assignment.` +
          (args.userResponse ? `\n\nUser message: ${args.userResponse}` : "");
      }

      // Resume with SDK session if executor.resume() is available
      if (deps.executor?.resume) {
        const sessionId = job.sdk_session_id ?? null;
        deps.executor
          .resume(job, resumePrompt, sessionId)
          .catch((err) =>
            console.error(
              `[automation-server] resume failed for ${args.jobId}:`,
              err,
            ),
          );
      } else {
        // Fallback to processor.resume (no SDK session restoration)
        deps.processor
          .resume(automation, job, resumePrompt)
          .catch((err) =>
            console.error(
              `[automation-server] resume failed for ${args.jobId}:`,
              err,
            ),
          );
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Job "${args.jobId}" resumed. The worker will continue${job.sdk_session_id ? " with prior context" : ""}.`,
          },
        ],
      };
    },
  );

  const checkJobStatusTool = tool(
    "check_job_status",
    "Check status of running and recent jobs. Use when the user asks about a task in progress, or to check if a fired automation has completed. Returns running, pending, and recently completed/failed jobs.",
    {
      automationId: z
        .string()
        .optional()
        .describe("Filter by automation ID (omit for all automations)"),
      includeCompleted: z
        .boolean()
        .optional()
        .describe("Include recently completed/failed jobs (default: true)"),
      limit: z
        .number()
        .optional()
        .describe("Max completed jobs to return (default: 5)"),
    },
    async (args) => {
      const completedLimit = args.limit ?? 5;
      const includeCompleted = args.includeCompleted ?? true;

      // Fetch running and pending jobs
      const baseFilter = args.automationId
        ? { automationId: args.automationId }
        : {};
      const runningJobs = deps.jobService.listJobs({
        ...baseFilter,
        status: "running",
      });
      const pendingJobs = deps.jobService.listJobs({
        ...baseFilter,
        status: "pending",
      });
      const interruptedJobs = deps.jobService.listJobs({
        ...baseFilter,
        status: "interrupted",
      });
      const reviewJobs = deps.jobService.listJobs({
        ...baseFilter,
        status: "needs_review",
      });

      const sections: string[] = [];

      // Active jobs (including interrupted — they need attention)
      const activeJobs = [...runningJobs, ...pendingJobs, ...interruptedJobs];
      if (activeJobs.length > 0) {
        const lines = activeJobs.map((job) => {
          const automation = deps.automationManager.findById(job.automationId);
          const name = automation?.manifest.name ?? job.automationId;
          const todoProgress = formatJobTodoProgress(job);
          return `- **${name}** (${job.id}) — ${job.status}, started ${job.created}${todoProgress}`;
        });
        sections.push(
          `**Active jobs (${activeJobs.length}):**\n${lines.join("\n")}`,
        );
      } else {
        sections.push("**No active jobs.**");
      }

      // Needs review
      if (reviewJobs.length > 0) {
        const lines = reviewJobs.map((job) => {
          const automation = deps.automationManager.findById(job.automationId);
          const name = automation?.manifest.name ?? job.automationId;
          const todoProgress = formatJobTodoProgress(job);
          return `- **${name}** (${job.id}) — needs review: ${job.summary ?? "no details"}${todoProgress}`;
        });
        sections.push(
          `**Awaiting review (${reviewJobs.length}):**\n${lines.join("\n")}`,
        );
      }

      // Recently completed/failed
      if (includeCompleted) {
        const completedJobs = deps.jobService.listJobs({
          ...baseFilter,
          status: "completed",
          limit: completedLimit,
        });
        const failedJobs = deps.jobService.listJobs({
          ...baseFilter,
          status: "failed",
          limit: completedLimit,
        });
        const recentJobs = [...completedJobs, ...failedJobs]
          .sort(
            (a, b) =>
              new Date(b.completed ?? b.created).getTime() -
              new Date(a.completed ?? a.created).getTime(),
          )
          .slice(0, completedLimit);

        if (recentJobs.length > 0) {
          const lines = recentJobs.map((job) => {
            const automation = deps.automationManager.findById(
              job.automationId,
            );
            const name = automation?.manifest.name ?? job.automationId;
            const summary = job.summary
              ? ` — ${job.summary.slice(0, 200)}`
              : "";
            return `- **${name}** (${job.id}) — ${job.status}${summary}`;
          });
          sections.push(
            `**Recent jobs (${recentJobs.length}):**\n${lines.join("\n")}`,
          );
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: sections.join("\n\n"),
          },
        ],
      };
    },
  );

  const dismissJobTool = tool(
    "dismiss_job",
    "Dismiss a stale, stuck, or unwanted job. Use when a job is in needs_review, interrupted, or failed status and should no longer appear in active views. Keeps the record for audit trail but marks it as dismissed.",
    {
      jobId: z.string().describe("The job ID to dismiss"),
      reason: z
        .string()
        .optional()
        .describe("Why the job is being dismissed (stored in summary)"),
    },
    async (args) => {
      const job = deps.jobService.getJob(args.jobId);
      if (!job) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Job "${args.jobId}" not found.`,
            },
          ],
          isError: true,
        };
      }

      if (job.status === "running" || job.status === "pending") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Cannot dismiss job "${args.jobId}" — it's currently ${job.status}. Wait for it to finish or let it time out.`,
            },
          ],
          isError: true,
        };
      }

      if (job.status === "dismissed") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Job "${args.jobId}" is already dismissed.`,
            },
          ],
        };
      }

      const summary = args.reason
        ? `Dismissed: ${args.reason}`
        : `Dismissed (was ${job.status})`;

      try {
        deps.jobService.updateJob(args.jobId, {
          status: "dismissed" as Job["status"],
          summary,
        });
      } catch {
        // Orphaned DB entry (JSONL missing) — delete from DB directly
        deps.jobService.deleteFromIndex(args.jobId);
      }
      deps.onStateChanged?.();

      return {
        content: [
          {
            type: "text" as const,
            text: `Job "${args.jobId}" dismissed.${args.reason ? ` Reason: ${args.reason}` : ""}`,
          },
        ],
      };
    },
  );

  const disableAutomationTool = tool(
    "disable_automation",
    "Disable a recurring automation. Use when the user says 'stop X', 'pause X', 'turn off X', or 'I don't need X anymore'. The automation stays on disk but won't fire on schedule.",
    {
      automationId: z.string().describe("Automation ID (filename without .md)"),
    },
    async (args) => {
      const automation = deps.automationManager.findById(args.automationId);
      if (!automation) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Automation "${args.automationId}" not found.`,
            },
          ],
          isError: true,
        };
      }

      if (automation.manifest.status === "disabled") {
        return {
          content: [
            {
              type: "text" as const,
              text: `"${automation.manifest.name}" is already disabled.`,
            },
          ],
        };
      }

      try {
        deps.automationManager.disable(args.automationId);
        deps.onStateChanged?.();
        return {
          content: [
            {
              type: "text" as const,
              text: `"${automation.manifest.name}" disabled. It won't fire on schedule anymore.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Cannot disable: ${err instanceof Error ? err.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return createSdkMcpServer({
    name: "automation-tools",
    tools: [
      createAutomationTool,
      fireAutomationTool,
      listAutomationsTool,
      resumeJobTool,
      checkJobStatusTool,
      dismissJobTool,
      disableAutomationTool,
    ],
  });
}
