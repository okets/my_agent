/**
 * Typed event map for the App EventEmitter.
 *
 * Every state mutation emits one of these events.
 * StatePublisher and transport adapters subscribe to them.
 */

import type { Task } from "@my-agent/core";
import type { AnyNotification } from "@my-agent/core";
import type { Conversation } from "./conversations/types.js";

export interface AppEventMap {
  // Task mutations
  "task:created": [task: Task];
  "task:updated": [task: Task];
  "task:deleted": [taskId: string];

  // Conversation mutations
  "conversation:created": [conversation: Conversation];
  "conversation:updated": [conversationId: string];
  "conversation:deleted": [conversationId: string];

  // Notification events (forwarded from NotificationService)
  "notification:created": [notification: AnyNotification];

  // Calendar mutations
  "calendar:changed": [];

  // Memory state changes
  "memory:changed": [];

  // Channel events (forwarded from TransportManager)
  "channel:status_changed": [
    transportId: string,
    status: unknown,
    reconnectAttempts?: number,
  ];
  "channel:qr_code": [transportId: string, qrDataUrl: string];
  "channel:pairing_code": [transportId: string, pairingCode: string];
  "channel:paired": [transportId: string];

  // Skills
  "skills:changed": [];
}

export type AppEvent = keyof AppEventMap;
