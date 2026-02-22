/**
 * Task API Routes (M5-S5)
 *
 * REST endpoints for task management. Only write operations (POST, PATCH, DELETE)
 * create task-conversation links when conversationId is provided.
 */

import { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import type { Task, CreateTaskInput, ListTasksFilter } from "@my-agent/core";

/**
 * Allowed statuses for PATCH updates.
 * 'deleted' is excluded — use DELETE endpoint for soft delete.
 */
const PATCHABLE_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "paused",
  "needs_review",
];

/**
 * Convert task to API response format.
 * Note: logPath is intentionally excluded to avoid exposing filesystem paths.
 */
function toResponse(task: Task) {
  return {
    id: task.id,
    type: task.type,
    sourceType: task.sourceType,
    sourceRef: task.sourceRef,
    title: task.title,
    instructions: task.instructions,
    work: task.work,
    delivery: task.delivery,
    status: task.status,
    sessionId: task.sessionId,
    recurrenceId: task.recurrenceId,
    occurrenceDate: task.occurrenceDate,
    scheduledFor: task.scheduledFor?.toISOString(),
    startedAt: task.startedAt?.toISOString(),
    completedAt: task.completedAt?.toISOString(),
    deletedAt: task.deletedAt?.toISOString(),
    created: task.created.toISOString(),
    createdBy: task.createdBy,
  };
}

export async function registerTaskRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // ═══════════════════════════════════════════════════════════════════════════
  // Read Operations (no linking)
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/tasks - List tasks with optional filters
  fastify.get<{
    Querystring: {
      status?: string;
      type?: string;
      sourceType?: string;
      recurrenceId?: string;
      includeDeleted?: string;
      limit?: string;
      offset?: string;
    };
  }>("/api/tasks", async (request, reply) => {
    const taskManager = fastify.taskManager;
    if (!taskManager) {
      return reply.code(503).send({ error: "Task manager not ready" });
    }

    const {
      status,
      type,
      sourceType,
      recurrenceId,
      includeDeleted,
      limit,
      offset,
    } = request.query;

    const filter: ListTasksFilter = {};

    if (status) {
      // Support comma-separated statuses
      const statuses = status.split(",");
      filter.status =
        statuses.length === 1 ? (statuses[0] as any) : (statuses as any);
    }

    if (type) {
      filter.type = type as any;
    }

    if (sourceType) {
      filter.sourceType = sourceType as any;
    }

    if (recurrenceId) {
      filter.recurrenceId = recurrenceId;
    }

    if (includeDeleted === "true") {
      filter.includeDeleted = true;
    }

    if (limit) {
      filter.limit = parseInt(limit, 10);
    }

    if (offset) {
      filter.offset = parseInt(offset, 10);
    }

    const tasks = taskManager.list(filter);
    return { tasks: tasks.map(toResponse) };
  });

  // GET /api/tasks/:id - Get single task
  fastify.get<{ Params: { id: string } }>(
    "/api/tasks/:id",
    async (request, reply) => {
      const taskManager = fastify.taskManager;
      if (!taskManager) {
        return reply.code(503).send({ error: "Task manager not ready" });
      }

      const task = taskManager.findById(request.params.id);
      if (!task) {
        return reply.code(404).send({ error: "Task not found" });
      }

      return toResponse(task);
    },
  );

  // GET /api/tasks/:id/conversations - Get conversations linked to a task
  fastify.get<{ Params: { id: string } }>(
    "/api/tasks/:id/conversations",
    async (request, reply) => {
      const taskManager = fastify.taskManager;
      if (!taskManager) {
        return reply.code(503).send({ error: "Task manager not ready" });
      }

      const task = taskManager.findById(request.params.id);
      if (!task) {
        return reply.code(404).send({ error: "Task not found" });
      }

      const links = taskManager.getConversationsForTask(request.params.id);
      const conversationManager = fastify.conversationManager;

      // Enrich with conversation details
      const conversations = await Promise.all(
        links.map(async (link) => {
          let title = link.conversationId;
          if (conversationManager) {
            const conv = await conversationManager.get(link.conversationId);
            if (conv) {
              title =
                conv.title || `Conversation ${link.conversationId.slice(-8)}`;
            }
          }
          return {
            conversationId: link.conversationId,
            title,
            linkedAt: link.linkedAt.toISOString(),
          };
        }),
      );

      return {
        taskId: request.params.id,
        conversations,
      };
    },
  );

  // GET /api/tasks/:id/log - Get task execution log
  fastify.get<{ Params: { id: string } }>(
    "/api/tasks/:id/log",
    async (request, reply) => {
      const taskManager = fastify.taskManager;
      if (!taskManager) {
        return reply.code(503).send({ error: "Task manager not ready" });
      }

      const task = taskManager.findById(request.params.id);
      if (!task) {
        return reply.code(404).send({ error: "Task not found" });
      }

      if (!task.logPath) {
        return { taskId: task.id, entries: [] };
      }

      try {
        const content = await readFile(task.logPath, "utf-8");
        const entries = content
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line));
        return { taskId: task.id, entries };
      } catch {
        // Log file doesn't exist yet or is empty
        return { taskId: task.id, entries: [] };
      }
    },
  );

  // GET /api/conversations/:id/tasks - Get tasks linked to a conversation
  fastify.get<{ Params: { id: string } }>(
    "/api/conversations/:id/tasks",
    async (request, reply) => {
      const taskManager = fastify.taskManager;
      if (!taskManager) {
        return reply.code(503).send({ error: "Task manager not ready" });
      }

      const links = taskManager.getTasksForConversation(request.params.id);
      return {
        conversationId: request.params.id,
        tasks: links.map((link) => ({
          taskId: link.taskId,
          linkedAt: link.linkedAt.toISOString(),
        })),
      };
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Write Operations (create links when conversationId provided)
  // ═══════════════════════════════════════════════════════════════════════════

  // POST /api/tasks - Create a new task
  fastify.post<{
    Body: {
      type: string;
      sourceType: string;
      sourceRef?: string;
      title: string;
      instructions: string;
      work?: any[];
      delivery?: any[];
      recurrenceId?: string;
      occurrenceDate?: string;
      scheduledFor?: string;
      createdBy: string;
      conversationId?: string;
    };
  }>("/api/tasks", async (request, reply) => {
    const taskManager = fastify.taskManager;
    if (!taskManager) {
      return reply.code(503).send({ error: "Task manager not ready" });
    }

    const { conversationId, scheduledFor, ...rest } = request.body;

    // Validate required fields
    if (
      !rest.type ||
      !rest.sourceType ||
      !rest.title ||
      !rest.instructions ||
      !rest.createdBy
    ) {
      return reply.code(400).send({
        error:
          "Missing required fields: type, sourceType, title, instructions, createdBy",
      });
    }

    const input: CreateTaskInput = {
      ...rest,
      type: rest.type as any,
      sourceType: rest.sourceType as any,
      createdBy: rest.createdBy as any,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
    };

    const task = taskManager.create(input);

    // Link to conversation if provided
    if (conversationId) {
      taskManager.linkTaskToConversation(task.id, conversationId);
    }

    // Trigger task processor for immediate execution
    const taskProcessor = fastify.taskProcessor;
    if (taskProcessor) {
      // Fire and forget - don't block the API response
      taskProcessor.onTaskCreated(task);
    }

    return reply.code(201).send(toResponse(task));
  });

  // PATCH /api/tasks/:id - Update a task
  fastify.patch<{
    Params: { id: string };
    Body: {
      status?: string;
      conversationId?: string;
    };
  }>("/api/tasks/:id", async (request, reply) => {
    const taskManager = fastify.taskManager;
    if (!taskManager) {
      return reply.code(503).send({ error: "Task manager not ready" });
    }

    const task = taskManager.findById(request.params.id);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }

    const { status, conversationId } = request.body;

    // Validate status if provided — 'deleted' must use DELETE endpoint
    if (status) {
      if (!PATCHABLE_STATUSES.includes(status)) {
        return reply.code(400).send({
          error: `Invalid status '${status}'. Use DELETE endpoint to delete a task.`,
        });
      }
      if (task.status === "deleted") {
        return reply.code(400).send({ error: "Cannot update a deleted task" });
      }
      taskManager.update(request.params.id, { status: status as any });
    }

    // Link to conversation if provided
    if (conversationId) {
      taskManager.linkTaskToConversation(request.params.id, conversationId);
    }

    const updated = taskManager.findById(request.params.id)!;
    return toResponse(updated);
  });

  // POST /api/tasks/:id/complete - Mark task as completed
  fastify.post<{
    Params: { id: string };
    Body: { conversationId?: string };
  }>("/api/tasks/:id/complete", async (request, reply) => {
    const taskManager = fastify.taskManager;
    if (!taskManager) {
      return reply.code(503).send({ error: "Task manager not ready" });
    }

    const task = taskManager.findById(request.params.id);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }

    if (task.status === "deleted") {
      return reply.code(400).send({ error: "Cannot complete a deleted task" });
    }

    taskManager.update(request.params.id, {
      status: "completed",
      completedAt: new Date(),
    });

    // Link to conversation if provided
    const { conversationId } = request.body || {};
    if (conversationId) {
      taskManager.linkTaskToConversation(request.params.id, conversationId);
    }

    const updated = taskManager.findById(request.params.id)!;
    return toResponse(updated);
  });

  // DELETE /api/tasks/:id - Soft delete a task
  fastify.delete<{
    Params: { id: string };
    Body: { conversationId?: string };
  }>("/api/tasks/:id", async (request, reply) => {
    const taskManager = fastify.taskManager;
    if (!taskManager) {
      return reply.code(503).send({ error: "Task manager not ready" });
    }

    const task = taskManager.findById(request.params.id);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }

    if (task.status === "deleted") {
      return reply.code(400).send({ error: "Task is already deleted" });
    }

    // Link to conversation if provided (before delete)
    const { conversationId } = request.body || {};
    if (conversationId) {
      taskManager.linkTaskToConversation(request.params.id, conversationId);
    }

    taskManager.delete(request.params.id);

    return { success: true, message: "Task soft-deleted" };
  });
}
