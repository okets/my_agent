// Attachment type for file uploads
export interface Attachment {
  filename: string;
  base64Data: string;
  mimeType: string;
}

// Chat control types (used in hatching + future features)

export interface ButtonsControl {
  type: "buttons";
  id: string;
  options: Array<{
    label: string;
    value: string;
    variant?: "primary" | "secondary";
  }>;
}

export interface CardsControl {
  type: "cards";
  id: string;
  columns?: 1 | 2;
  options: Array<{
    label: string;
    value: string;
    emoji?: string;
    description?: string;
  }>;
}

export type ChatControl = ButtonsControl | CardsControl;

// Conversation metadata for UI display
export interface ConversationMeta {
  id: string;
  channel: string;
  title: string | null;
  topics: string[];
  created: string;
  updated: string;
  turnCount: number;
  model: string | null;
  externalParty: string | null;
  /** Whether this is the pinned (active) conversation for a channel.
   *  Only pinned channel conversations are read-only in dashboard.
   *  Unpinned channel conversations can be continued via dashboard. */
  isPinned?: boolean;
}

// Attachment metadata for display (stored in transcript)
export interface AttachmentMeta {
  id: string;
  filename: string;
  localPath: string;
  mimeType: string;
  size: number;
}

// Turn data for UI display
export interface Turn {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  turnNumber: number;
  thinkingText?: string;
  usage?: { input: number; output: number };
  cost?: number;
  attachments?: AttachmentMeta[];
}

// Context from dashboard (what user is currently viewing)
export interface ViewContext {
  type: "notebook" | "conversation" | "settings";
  title: string;
  icon?: string;
  file?: string; // For notebook tabs
  conversationId?: string; // For external conversation tabs
}

// Client → Server messages
export type ClientMessage =
  | {
      type: "message";
      content: string;
      reasoning?: boolean;
      model?: string;
      attachments?: Attachment[];
      context?: ViewContext | null; // What user is viewing in dashboard
    }
  | { type: "abort" }
  | { type: "control_response"; controlId: string; value: string }
  | { type: "connect"; conversationId?: string }
  | { type: "new_conversation" }
  | { type: "switch_conversation"; conversationId: string }
  | { type: "rename_conversation"; title: string }
  | { type: "load_more_turns"; before: string }
  | { type: "delete_conversation"; conversationId: string }
  | { type: "set_model"; model: string }
  // Notification interactions
  | { type: "get_notifications" }
  | { type: "notification_read"; notificationId: string }
  | {
      type: "notification_respond";
      notificationId: string;
      response: string;
    }
  | { type: "notification_dismiss"; notificationId: string };

// Server → Client messages
export type ServerMessage =
  | { type: "start" }
  | { type: "text_delta"; content: string }
  | { type: "thinking_delta"; content: string }
  | { type: "thinking_end" }
  | { type: "done"; cost?: number; usage?: { input: number; output: number } }
  | { type: "error"; message: string }
  | { type: "controls"; controls: ChatControl[] }
  | {
      type: "compose_hint";
      placeholder: string;
      password?: boolean;
      controlId: string;
    }
  | { type: "hatching_complete"; agentName: string }
  | {
      type: "conversation_loaded";
      conversation: ConversationMeta | null;
      turns: Turn[];
      hasMore: boolean;
    }
  | {
      type: "conversation_list";
      conversations: ConversationMeta[];
      channelConversations?: ConversationMeta[];
    }
  | { type: "conversation_renamed"; conversationId: string; title: string }
  | { type: "conversation_created"; conversation: ConversationMeta }
  | { type: "conversation_updated"; conversationId: string; turn: Turn }
  | { type: "turns_loaded"; turns: Turn[]; hasMore: boolean }
  | { type: "conversation_deleted"; conversationId: string }
  | {
      type: "channel_status_changed";
      channelId: string;
      status: string;
      reconnectAttempts: number;
    }
  | { type: "channel_qr_code"; channelId: string; qrDataUrl: string }
  | { type: "channel_paired"; channelId: string }
  | {
      type: "channel_authorized";
      channelId: string;
      ownerJid: string;
      ownerName: string | null;
    }
  | { type: "conversation_unpinned"; conversationId: string }
  | {
      type: "conversation_model_changed";
      conversationId: string;
      model: string;
    }
  // Notification events
  | {
      type: "notification";
      notification: NotificationPayload;
    }
  | {
      type: "notification_list";
      notifications: NotificationPayload[];
      pendingCount: number;
    };

// Notification payload for WebSocket transport
export interface NotificationPayload {
  id: string;
  type: "notify" | "request_input" | "escalate";
  taskId?: string;
  created: string;
  status: "pending" | "delivered" | "read" | "dismissed";
  // For notify
  message?: string;
  importance?: "info" | "warning" | "success" | "error";
  // For request_input
  question?: string;
  options?: Array<{ label: string; value: string }>;
  response?: string;
  respondedAt?: string;
  // For escalate
  problem?: string;
  severity?: "low" | "medium" | "high" | "critical";
}
