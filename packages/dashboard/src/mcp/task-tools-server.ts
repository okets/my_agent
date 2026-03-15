import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { TaskManager } from "../tasks/task-manager.js";
import type { TaskProcessor } from "../tasks/task-processor.js";
import { updateProperty } from "../conversations/properties.js";

export interface TaskToolsServerDeps {
  taskManager: TaskManager;
  taskProcessor: TaskProcessor;
  agentDir: string;
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

  return createSdkMcpServer({
    name: "task-tools",
    tools: [reviseTaskTool, createTaskTool, updatePropertyTool],
  });
}
