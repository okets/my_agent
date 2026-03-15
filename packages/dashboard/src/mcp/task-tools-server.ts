import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { TaskManager } from "../tasks/task-manager.js";
import type { TaskProcessor } from "../tasks/task-processor.js";
import type { TaskSearchService } from "../tasks/task-search-service.js";
import { updateProperty } from "../conversations/properties.js";

export interface TaskToolsServerDeps {
  taskManager: TaskManager;
  taskProcessor: TaskProcessor;
  agentDir: string;
  taskSearchService?: TaskSearchService;
}

export function createTaskToolsServer(deps: TaskToolsServerDeps) {
  const reviseTaskTool = tool(
    "revise_task",
    "Re-open a completed task with revision instructions. The same working agent session will be resumed with the new instructions. Use when the user wants corrections or changes to task results.",
    {
      taskId: z.string().describe("The task ID to revise"),
      instructions: z
        .string()
        .describe("What needs to be changed or corrected"),
    },
    async (args) => {
      const task = deps.taskManager.findById(args.taskId);
      if (!task) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Task ${args.taskId} not found`,
            },
          ],
          isError: true,
        };
      }

      if (task.status !== "completed" && task.status !== "needs_review") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Task ${args.taskId} is ${task.status}, not revisable`,
            },
          ],
          isError: true,
        };
      }

      // Update task: set back to pending with revision instructions appended
      const revisedInstructions = `${task.instructions}\n\n## Revision Request\n\n${args.instructions}\n\nReview your previous status-report.md for context on what was done. Apply the requested changes and update the status report.`;

      deps.taskManager.update(task.id, {
        status: "pending",
        instructions: revisedInstructions,
        completedAt: undefined,
      });

      // Trigger re-execution
      const updatedTask = deps.taskManager.findById(task.id);
      if (updatedTask) {
        deps.taskProcessor.onTaskCreated(updatedTask);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Task "${task.title}" queued for revision. The working agent will resume with your corrections.`,
          },
        ],
      };
    },
  );

  const createTaskTool = tool(
    "create_task",
    "Create a background task for a working agent. Use when the user requests research, comparison, scripting, browser automation, or any multi-step work. Include ALL context in instructions — the working agent cannot see this conversation.",
    {
      title: z.string().describe("Short descriptive title"),
      instructions: z
        .string()
        .describe(
          "Self-contained instructions with full context — the working agent cannot see this conversation",
        ),
      work: z
        .array(z.object({ description: z.string() }))
        .optional()
        .describe("Work items to complete"),
      type: z
        .enum(["immediate", "scheduled"])
        .describe("immediate = now, scheduled = later"),
      conversationId: z
        .string()
        .describe(
          "Conversation ID from [Session Context] in your system prompt",
        ),
      scheduledFor: z
        .string()
        .optional()
        .describe("ISO datetime in UTC for scheduled tasks"),
      notifyOnCompletion: z
        .enum(["immediate", "debrief", "none"])
        .optional()
        .describe("How to notify when complete (default: immediate)"),
      model: z
        .string()
        .optional()
        .describe("Override model (e.g. 'claude-opus-4-6')"),
    },
    async (args) => {
      try {
        const task = deps.taskManager.create({
          type: args.type,
          sourceType: "conversation",
          title: args.title,
          instructions: args.instructions,
          work: args.work?.map((w) => ({
            ...w,
            status: "pending" as const,
          })),
          notifyOnCompletion: args.notifyOnCompletion ?? "immediate",
          model: args.model,
          scheduledFor: args.scheduledFor
            ? new Date(args.scheduledFor)
            : undefined,
          createdBy: "agent",
        });

        deps.taskManager.linkTaskToConversation(task.id, args.conversationId);

        if (args.type === "immediate") {
          deps.taskProcessor.onTaskCreated(task);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Task created: "${task.title}" (ID: ${task.id}). ${args.type === "immediate" ? "Executing now — I'll let you know when it's done." : `Scheduled for ${args.scheduledFor}.`}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to create task: ${err instanceof Error ? err.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  const updatePropertyTool = tool(
    "update_property",
    "Update a dynamic property (location, timezone, availability). Call immediately when the user shares changes to these. Properties feed into task scheduling and working agent context.",
    {
      key: z
        .string()
        .describe("Property key: location, timezone, or availability"),
      value: z.string().describe("The new value"),
      confidence: z
        .enum(["high", "medium", "low"])
        .describe("How confident you are"),
      source: z
        .string()
        .default("conversation")
        .describe("How you learned this"),
    },
    async (args) => {
      try {
        await updateProperty(deps.agentDir, args.key, {
          value: args.value,
          confidence: args.confidence,
          source: args.source,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Updated ${args.key} to "${args.value}"`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to update property: ${err instanceof Error ? err.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  const searchTasksTool = tool(
    "search_tasks",
    "Search past tasks by meaning. Use when the user refers to a previous task ('that flights research', 'the co-working comparison'). Returns matching tasks with IDs for use with revise_task.",
    {
      query: z.string().describe("Natural language search query"),
      status: z
        .enum(["completed", "failed", "all"])
        .optional()
        .describe("Filter by status (default: completed)"),
      limit: z.number().optional().describe("Max results (default: 5)"),
    },
    async (args) => {
      if (!deps.taskSearchService) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Task search is not available yet.",
            },
          ],
          isError: true,
        };
      }

      try {
        const results = await deps.taskSearchService.search(args.query, {
          status: args.status ?? "completed",
          limit: args.limit ?? 5,
        });

        if (results.length === 0) {
          return {
            content: [
              { type: "text" as const, text: "No matching tasks found." },
            ],
          };
        }

        const formatted = results
          .map(
            (r) =>
              `- "${r.title}" (ID: ${r.id}) — ${r.status}, ${r.completedAt ?? r.created}`,
          )
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${results.length} task(s):\n${formatted}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Search failed: ${err instanceof Error ? err.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return createSdkMcpServer({
    name: "task-tools",
    tools: [
      reviseTaskTool,
      createTaskTool,
      updatePropertyTool,
      searchTasksTool,
    ],
  });
}
