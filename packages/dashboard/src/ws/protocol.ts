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
}

// Client → Server messages
export type ClientMessage =
  | { type: "message"; content: string }
  | { type: "abort" }
  | { type: "control_response"; controlId: string; value: string }
  | { type: "connect"; conversationId?: string }
  | { type: "new_conversation" }
  | { type: "switch_conversation"; conversationId: string }
  | { type: "rename_conversation"; title: string }
  | { type: "load_more_turns"; before: string };

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
  | { type: "conversation_list"; conversations: ConversationMeta[] }
  | { type: "conversation_renamed"; conversationId: string; title: string }
  | { type: "conversation_created"; conversation: ConversationMeta }
  | { type: "conversation_updated"; conversationId: string; turn: Turn }
  | { type: "turns_loaded"; turns: Turn[]; hasMore: boolean };
