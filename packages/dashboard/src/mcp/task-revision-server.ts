import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { TaskManager } from "../tasks/task-manager.js";
import type { TaskProcessor } from "../tasks/task-processor.js";

export interface TaskRevisionServerDeps {
  taskManager: TaskManager;
  taskProcessor: TaskProcessor;
}

export function createTaskRevisionServer(deps: TaskRevisionServerDeps) {
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

  return createSdkMcpServer({
    name: "task-revision",
    tools: [reviseTaskTool],
  });
}
