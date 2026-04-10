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
import type { Capability } from "@my-agent/core";
import type { Conversation, TranscriptTurn } from "./conversations/types.js";
import type { ConversationMeta } from "./ws/protocol.js";

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
  "channel:status_changed": [transportId: string, status: TransportStatus];
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
  "job:progress": [job: Job];
  "job:completed": [job: Job];
  "job:failed": [job: Job];
  "job:needs_review": [job: Job];
  "job:interrupted": [job: Job];

  // Skills
  "skills:changed": [];

  // Capabilities
  "capability:changed": [capabilities: Capability[]];

  // Chat streaming events (emitted by ChatService through App)
  "chat:text_delta": [conversationId: string, text: string];
  "chat:thinking_delta": [conversationId: string, text: string];
  "chat:thinking_end": [conversationId: string];
  "chat:done": [
    conversationId: string,
    cost?: number,
    usage?: { input: number; output: number },
    audioUrl?: string,
  ];
  "chat:error": [conversationId: string, message: string];
  "chat:start": [conversationId: string];
  "chat:user_turn": [conversationId: string, turn: TranscriptTurn];
  "chat:conversation_created": [
    conversationId: string,
    conversation: ConversationMeta,
  ];

  // External messages (stored for S3 trust tier)
  "external_message:created": [
    message: {
      id: string;
      channelId: string;
      from: string;
      content: string;
    },
  ];
}

export type AppEvent = keyof AppEventMap;
