/**
 * Notification API Routes
 *
 * REST endpoints for notification management.
 */

import { FastifyInstance } from "fastify";
import type { AnyNotification } from "@my-agent/core";

/**
 * Convert notification to API response format
 */
function toResponse(notification: AnyNotification) {
  const base = {
    id: notification.id,
    type: notification.type,
    taskId: notification.taskId,
    created: notification.created.toISOString(),
    status: notification.status,
    readAt: notification.readAt?.toISOString(),
  };

  if (notification.type === "notify") {
    return {
      ...base,
      message: notification.message,
      importance: notification.importance,
    };
  }

  if (notification.type === "request_input") {
    return {
      ...base,
      question: notification.question,
      options: notification.options,
      response: notification.response,
      respondedAt: notification.respondedAt?.toISOString(),
    };
  }

  if (notification.type === "escalate") {
    return {
      ...base,
      problem: notification.problem,
      severity: notification.severity,
    };
  }

  return base;
}

export async function registerNotificationRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // GET /api/notifications - List all notifications
  fastify.get("/api/notifications", async (request, reply) => {
    const service = fastify.notificationService;
    if (!service) {
      return reply.code(503).send({ error: "Notification service not ready" });
    }

    const notifications = service.getAll().map(toResponse);
    const pending = service.getPending().length;

    return {
      notifications,
      pendingCount: pending,
    };
  });

  // GET /api/notifications/pending - List pending notifications
  fastify.get("/api/notifications/pending", async (request, reply) => {
    const service = fastify.notificationService;
    if (!service) {
      return reply.code(503).send({ error: "Notification service not ready" });
    }

    const notifications = service.getPending().map(toResponse);
    return { notifications };
  });

  // GET /api/notifications/:id - Get single notification
  fastify.get<{ Params: { id: string } }>(
    "/api/notifications/:id",
    async (request, reply) => {
      const service = fastify.notificationService;
      if (!service) {
        return reply
          .code(503)
          .send({ error: "Notification service not ready" });
      }

      const notification = service.get(request.params.id);
      if (!notification) {
        return reply.code(404).send({ error: "Notification not found" });
      }

      return toResponse(notification);
    },
  );

  // POST /api/notifications/:id/read - Mark notification as read
  fastify.post<{ Params: { id: string } }>(
    "/api/notifications/:id/read",
    async (request, reply) => {
      const service = fastify.notificationService;
      if (!service) {
        return reply
          .code(503)
          .send({ error: "Notification service not ready" });
      }

      const success = service.markRead(request.params.id);
      if (!success) {
        return reply.code(404).send({ error: "Notification not found" });
      }

      return { success: true };
    },
  );

  // POST /api/notifications/:id/respond - Respond to input request
  fastify.post<{ Params: { id: string }; Body: { response: string } }>(
    "/api/notifications/:id/respond",
    async (request, reply) => {
      const service = fastify.notificationService;
      if (!service) {
        return reply
          .code(503)
          .send({ error: "Notification service not ready" });
      }

      const { response } = request.body;
      if (!response) {
        return reply.code(400).send({ error: "Response required" });
      }

      const success = service.respond(request.params.id, response);
      if (!success) {
        return reply
          .code(404)
          .send({ error: "Notification not found or not an input request" });
      }

      return { success: true };
    },
  );

  // POST /api/notifications/:id/dismiss - Dismiss notification
  fastify.post<{ Params: { id: string } }>(
    "/api/notifications/:id/dismiss",
    async (request, reply) => {
      const service = fastify.notificationService;
      if (!service) {
        return reply
          .code(503)
          .send({ error: "Notification service not ready" });
      }

      const success = service.dismiss(request.params.id);
      if (!success) {
        return reply.code(404).send({ error: "Notification not found" });
      }

      return { success: true };
    },
  );

  // GET /api/tasks/:taskId/notifications - Get notifications for a task
  fastify.get<{ Params: { taskId: string } }>(
    "/api/tasks/:taskId/notifications",
    async (request, reply) => {
      const service = fastify.notificationService;
      if (!service) {
        return reply
          .code(503)
          .send({ error: "Notification service not ready" });
      }

      const notifications = service
        .getForTask(request.params.taskId)
        .map(toResponse);
      return { notifications };
    },
  );
}
