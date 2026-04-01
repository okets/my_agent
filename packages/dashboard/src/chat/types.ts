/**
 * Chat service types — result types, events, and options.
 *
 * M6.10-S3: Design spec §S3 (Chat Handler Decomposition)
 */

import type { ConversationMeta, Turn } from "../ws/protocol.js";
import type { AbbreviationQueue } from "../conversations/abbreviation.js";
import type { IdleTimerManager } from "../conversations/idle-timer.js";
import type { AttachmentService } from "../conversations/attachments.js";
import type { PostResponseHooks } from "../conversations/post-response-hooks.js";
import type { ConversationSearchService } from "../conversations/search-service.js";

/** Event yielded from ChatService.sendMessage() */
export type ChatEvent =
  | { type: "start" }
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "thinking_end" }
  | {
      type: "done";
      cost?: number;
      usage?: { input: number; output: number };
      audioUrl?: string;
    }
  | { type: "error"; message: string }
  | { type: "turn_advanced"; turnNumber: number };

/** Result from ChatService.connect() */
export interface ConnectResult {
  conversation: ConversationMeta | null;
  turns: Turn[];
  hasMore: boolean;
  allConversations: ConversationMeta[];
}

/** Result from ChatService.newConversation() / switchConversation() */
export interface ConversationSwitchResult {
  conversation: ConversationMeta;
  turns: Turn[];
  hasMore: boolean;
}

/** Result from ChatService.loadMoreTurns() */
export interface LoadMoreResult {
  turns: Turn[];
  hasMore: boolean;
}

/** Options for sendMessage */
export interface ChatMessageOptions {
  reasoning?: boolean;
  model?: string;
  inputMedium?: "text" | "audio";
  attachments?: Array<{
    filename: string;
    base64Data: string;
    mimeType: string;
  }>;
  context?: {
    type: string;
    title: string;
    file?: string;
    automationId?: string;
    automationName?: string;
    spaceName?: string;
    conversationId?: string;
  } | null;
}

/**
 * Side effects from the "start" event in sendMessage.
 * Adapter uses these to update per-connection state and broadcast.
 */
export interface StartEffects {
  conversationId: string;
  userTurn: Turn;
  conversationCreated?: ConversationMeta;
}

/** External services that ChatService delegates to for sendMessage side effects */
export interface ChatServiceDeps {
  abbreviationQueue?: AbbreviationQueue | null;
  idleTimerManager?: IdleTimerManager | null;
  attachmentService?: AttachmentService | null;
  conversationSearchService?: ConversationSearchService | null;
  postResponseHooks?: PostResponseHooks | null;
  log: (msg: string) => void;
  logError: (err: unknown, msg: string) => void;
}
