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
  title: string | null;
  topics: string[];
  created: string;
  updated: string;
  turnCount: number;
  model: string | null;
  externalParty: string | null;
  /** Whether this is the pinned conversation for channel message routing */
  isPinned?: boolean;
  status: "current" | "inactive";
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
  /** TTS audio URL for voice responses */
  audioUrl?: string;
  /** Channel the message came from (undefined = web) */
  channel?: string;
}

// Context from dashboard (what user is currently viewing)
export interface ViewContext {
  type: string;
  title: string;
  icon?: string;
  file?: string; // For notebook tabs
  taskId?: string;
  automationId?: string;
  automationName?: string;
  spaceName?: string;
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
      inputMedium?: "text" | "audio";
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
  | { type: "interim_status"; message: string }
  | { type: "text_delta"; content: string }
  | { type: "thinking_delta"; content: string }
  | { type: "thinking_end" }
  | {
      type: "done";
      cost?: number;
      usage?: { input: number; output: number };
      audioUrl?: string;
    }
  | { type: "error"; message: string }
  | { type: "controls"; controls: ChatControl[] }
  | {
      type: "compose_hint";
      placeholder: string;
      password?: boolean;
      controlId: string;
    }
  | { type: "auth_required" }
  | { type: "auth_ok" }
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
    }
  | { type: "conversation_renamed"; conversationId: string; title: string }
  | { type: "conversation_created"; conversation: ConversationMeta }
  | { type: "conversation_updated"; conversationId: string; turn: Turn }
  | { type: "turns_loaded"; turns: Turn[]; hasMore: boolean }
  | { type: "conversation_deleted"; conversationId: string }
  | {
      type: "transport_status_changed";
      transportId: string;
      status: string;
      reconnectAttempts: number;
    }
  | { type: "transport_qr_code"; transportId: string; qrDataUrl: string }
  | { type: "transport_paired"; transportId: string }
  | { type: "transport_pairing_code"; transportId: string; pairingCode: string }
  | { type: "transport_owner_removed"; transportId: string }
  | {
      type: "transport_authorized";
      transportId: string;
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
    }
  // State sync — full collection snapshots pushed to all connected clients
  | {
      type: "state:calendar";
      events: CalendarEventSnapshot[];
      timestamp: number;
    }
  | {
      type: "state:conversations";
      conversations: ConversationMeta[];
      timestamp: number;
    }
  | {
      type: "state:memory";
      stats: MemoryStats;
      timestamp: number;
    }
  | { type: "state:spaces"; spaces: SpaceSnapshot[]; timestamp: number }
  | {
      type: "state:automations";
      automations: AutomationSnapshot[];
      timestamp: number;
    }
  | { type: "state:jobs"; jobs: JobSnapshot[]; timestamp: number }
  | {
      type: "state:screenshot";
      screenshot: ScreenshotSnapshot;
      timestamp: number;
    }
  | { type: "state:skills"; timestamp: number }
  | {
      type: "capabilities";
      capabilities: Array<{
        name: string;
        provides?: string;
        interface: string;
        status: string;
        unavailableReason?: string;
      }>;
    }
  | { type: "model_changed"; model: string };

// ─── State Sync Messages ───────────────────────────────────────────────────
//
// Server pushes full snapshots of entity collections to all connected clients.
// These are used for live dashboard panels (Tasks, Calendar, Conversations).

export interface CalendarEventSnapshot {
  uid: string;
  calendarId: string;
  title: string;
  description?: string;
  start: string;
  end: string;
  allDay: boolean;
  rrule?: string;
  status: string;
  transparency: string;
  location?: string;
  action?: string;
}

// Memory status snapshot for live updates
export interface MemoryStats {
  initialized: boolean;
  pluginState: "not_set_up" | "connecting" | "active" | "error";
  filesIndexed: number;
  totalChunks: number;
  lastSync: string | null;
  hasVectorIndex: boolean;
  embeddingsReady: boolean;
  activePlugin: {
    id: string;
    name: string;
    model: string;
    dimensions: number | null;
  } | null;
  degraded: {
    pluginId: string;
    pluginName: string;
    model: string;
    error: string;
    resolution: string;
    since: string;
  } | null;
  availablePlugins: Array<{
    id: string;
    name: string;
    model: string;
  }>;
  localModelCached?: boolean; // M6-S9: For "Delete Local Model" visibility
}

export interface SpaceSnapshot {
  name: string;
  tags: string[];
  path?: string;
  runtime?: string;
  entry?: string;
  description?: string;
  indexedAt: string;
}

export interface AutomationSnapshot {
  id: string;
  name: string;
  status: string;
  triggerTypes: string[];
  spaces: string[];
  model?: string;
  notify?: string;
  autonomy?: string;
  once?: boolean;
  lastFiredAt?: string;
  jobCount: number;
}

export interface JobSnapshot {
  id: string;
  automationId: string;
  automationName: string;
  status: string;
  created: string;
  completed?: string;
  summary?: string;
  triggerType?: string;
  todoProgress?: {
    done: number
    total: number
    current: string | null
    items: Array<{ id: string; text: string; status: import("@my-agent/core").TodoStatus }>
  }
}

export interface ScreenshotSnapshot {
  id: string;
  filename: string;
  url: string;
  timestamp: string;
  source: "desktop" | "playwright" | "upload" | "web" | "generated";
  description?: string;
  width: number;
  height: number;
  refs: string[];
}

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
