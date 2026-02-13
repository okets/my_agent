// Client → Server messages
export interface ClientMessage {
  type: "message";
  content: string;
}

// Server → Client messages
export type ServerMessage =
  | { type: "start" }
  | { type: "chunk"; content: string }
  | { type: "done" }
  | { type: "error"; message: string };
