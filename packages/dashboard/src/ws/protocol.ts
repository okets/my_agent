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

// Client → Server messages
export type ClientMessage =
  | { type: "message"; content: string }
  | { type: "abort" }
  | { type: "control_response"; controlId: string; value: string };

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
  | { type: "hatching_complete"; agentName: string };
