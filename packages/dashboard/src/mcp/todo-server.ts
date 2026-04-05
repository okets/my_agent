/**
 * Todo MCP Server (M9.1-S1)
 *
 * Persistent task tracking for every agent session. Exposed as 4 MCP tools:
 * todo_list, todo_add, todo_update, todo_remove.
 *
 * createTodoTools() returns bare handlers for testing.
 * createTodoServer() wraps them in an SDK MCP server for agent sessions.
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { readTodoFile, writeTodoFile } from "../automations/todo-file.js";
import type { TodoItem, TodoFile } from "@my-agent/core";

/** Bare tool handlers — testable without MCP server */
export function createTodoTools(todoPath: string) {
  function touch(file: TodoFile): TodoFile {
    file.last_activity = new Date().toISOString();
    return file;
  }

  function nextId(file: TodoFile): string {
    const existingIds = file.items
      .map((i) => parseInt(i.id.replace("t", ""), 10))
      .filter((n) => !isNaN(n));
    const next = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
    return `t${next}`;
  }

  return {
    async todo_list(_args: Record<string, unknown>) {
      const file = readTodoFile(todoPath);
      touch(file);
      writeTodoFile(todoPath, file);

      if (file.items.length === 0) {
        return { content: [{ type: "text" as const, text: "No todo items." }] };
      }

      const lines = file.items.map((item) => {
        const icon =
          item.status === "done"
            ? "✓"
            : item.status === "in_progress"
              ? "▶"
              : item.status === "blocked"
                ? "✗"
                : "☐";
        const tag = item.mandatory ? " [mandatory]" : "";
        const notes = item.notes ? ` — ${item.notes}` : "";
        return `${icon} ${item.id}: ${item.text}${tag}${notes}`;
      });

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },

    async todo_add(args: { text: string }) {
      const file = readTodoFile(todoPath);
      const item: TodoItem = {
        id: nextId(file),
        text: args.text,
        status: "pending",
        mandatory: false,
        created_by: "agent",
      };
      file.items.push(item);
      touch(file);
      writeTodoFile(todoPath, file);

      return {
        content: [
          { type: "text" as const, text: `Added: ${item.id} — ${item.text}` },
        ],
      };
    },

    async todo_update(args: { id: string; status?: string; notes?: string }) {
      const file = readTodoFile(todoPath);
      const item = file.items.find((i) => i.id === args.id);
      if (!item) {
        return {
          content: [
            { type: "text" as const, text: `Item ${args.id} not found.` },
          ],
          isError: true,
        };
      }

      if (args.status) item.status = args.status as TodoItem["status"];
      if (args.notes !== undefined) item.notes = args.notes;
      touch(file);
      writeTodoFile(todoPath, file);

      return {
        content: [
          {
            type: "text" as const,
            text: `Updated ${item.id}: status=${item.status}`,
          },
        ],
      };
    },

    async todo_remove(args: { id: string }) {
      const file = readTodoFile(todoPath);
      const idx = file.items.findIndex((i) => i.id === args.id);
      if (idx === -1) {
        return {
          content: [
            { type: "text" as const, text: `Item ${args.id} not found.` },
          ],
          isError: true,
        };
      }
      if (file.items[idx].mandatory) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Cannot remove mandatory item ${args.id}: "${file.items[idx].text}". This item is required by the framework.`,
            },
          ],
          isError: true,
        };
      }
      file.items.splice(idx, 1);
      touch(file);
      writeTodoFile(todoPath, file);

      return {
        content: [{ type: "text" as const, text: `Removed ${args.id}.` }],
      };
    },
  };
}

/** MCP server factory — creates a new server instance per job/conversation */
export function createTodoServer(todoPath: string) {
  const tools = createTodoTools(todoPath);

  return createSdkMcpServer({
    name: "todo",
    tools: [
      tool(
        "todo_list",
        "Show all todo items with their status. Call this first to see your assignment.",
        {},
        async () => tools.todo_list({}),
      ),
      tool(
        "todo_add",
        "Add a new todo item. Use this to plan your own sub-tasks. Cannot add mandatory items.",
        { text: z.string().describe("Description of the task") },
        async (args) => tools.todo_add(args),
      ),
      tool(
        "todo_update",
        "Update a todo item status or add notes. Use status: done when a task is complete, in_progress when starting, blocked if stuck.",
        {
          id: z.string().describe('Item ID (e.g., "t1")'),
          status: z
            .enum(["pending", "in_progress", "done", "blocked"])
            .optional(),
          notes: z
            .string()
            .optional()
            .describe("Optional notes about progress or blockers"),
        },
        async (args) => tools.todo_update(args),
      ),
      tool(
        "todo_remove",
        "Remove a todo item. Fails on mandatory items — these are required by the framework.",
        { id: z.string().describe("Item ID to remove") },
        async (args) => tools.todo_remove(args),
      ),
    ],
  });
}
