/**
 * Typed event map for the App EventEmitter.
 *
 * Every state mutation emits one of these events.
 * StatePublisher and transport adapters subscribe to them.
 */

import type { Automation, Job } from "@my-agent/core";
import type { AnyNotification } from "@my-agent/core";
import type { TransportStatus } from "@my-agent/core";
import type { SpaceSyncPayload } from "@my-agent/core";
import type { Conversation } from "./conversations/types.js";

export interface AppEventMap {
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
    status: TransportStatus,
  ];
  "channel:qr_code": [transportId: string, qrDataUrl: string];
  "channel:pairing_code": [transportId: string, pairingCode: string];
  "channel:paired": [transportId: string];

  // Space mutations
  "space:created": [space: SpaceSyncPayload];
  "space:updated": [space: SpaceSyncPayload];
  "space:deleted": [name: string];

  // Automation mutations
  "automation:created": [automation: Automation];
  "automation:updated": [automation: Automation];
  "automation:deleted": [automationId: string];

  // Job lifecycle
  "job:created": [job: Job];
  "job:started": [job: Job];
  "job:completed": [job: Job];
  "job:failed": [job: Job];
  "job:needs_review": [job: Job];

  // Skills
  "skills:changed": [];

  // Chat streaming events (emitted by ChatService through App)
  "chat:text_delta": [conversationId: string, text: string];
  "chat:thinking_delta": [conversationId: string, text: string];
  "chat:thinking_end": [conversationId: string];
  "chat:done": [
    conversationId: string,
    cost?: number,
    usage?: { input: number; output: number },
  ];
  "chat:error": [conversationId: string, message: string];
  "chat:start": [conversationId: string];
}

export type AppEvent = keyof AppEventMap;
