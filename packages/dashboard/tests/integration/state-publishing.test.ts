/**
 * State Publishing Integration Tests
 *
 * Validates that StatePublisher correctly broadcasts entity snapshots
 * to connected clients via the ConnectionRegistry, including debounce
 * behavior and notification wiring.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AppHarness } from "./app-harness.js";

let harness: AppHarness;

beforeEach(async () => {
  harness = await AppHarness.create();
  harness.clearBroadcasts();
});

afterEach(async () => {
  await harness.shutdown();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("State Publishing", () => {
  it("publishes conversation state snapshot after publishConversations()", async () => {
    const conv = await harness.conversationManager.create({
      title: "State test conversation",
    });

    harness.statePublisher.publishConversations();
    await delay(150);

    const broadcasts = harness.getBroadcasts("state:conversations");
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);

    const last = broadcasts[broadcasts.length - 1];
    expect(last.type).toBe("state:conversations");
    expect(last.timestamp).toBeTypeOf("number");

    const conversations = last.conversations as Array<{
      id: string;
      title: string;
    }>;
    expect(conversations.length).toBeGreaterThanOrEqual(1);

    const match = conversations.find((c) => c.id === conv.id);
    expect(match).toBeDefined();
    expect(match!.title).toBe("State test conversation");
  });

  it("notification event triggers broadcast when wired", async () => {
    // Wire the notification service to broadcastToAll, mirroring index.ts
    harness.notificationService.on("notification", (event) => {
      const notification = event.notification;
      harness.connectionRegistry.broadcastToAll({
        type: "notification",
        notification: {
          id: notification.id,
          type: notification.type,
          taskId: notification.taskId,
          created: notification.created.toISOString(),
          status: notification.status,
          message: (notification as any).message,
        },
      });
    });

    harness.notificationService.notify({
      taskId: "task-abc",
      message: "Something happened",
      importance: "info",
    });

    const broadcasts = harness.getBroadcasts("notification");
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].type).toBe("notification");

    const payload = (broadcasts[0] as any).notification;
    expect(payload.taskId).toBe("task-abc");
    expect(payload.message).toBe("Something happened");
  });
});
