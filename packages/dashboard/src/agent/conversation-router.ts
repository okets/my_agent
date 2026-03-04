/**
 * Conversation Router
 *
 * Determines routing for incoming messages:
 * - Owner messages go to Conversation Nina
 * - External messages go to Working Agent
 *
 * Detects channel switches that trigger new conversations:
 * - Web to WhatsApp = new conversation (user changing contexts)
 * - WhatsApp to Web = same conversation (web shows full transcript)
 */

export interface RouteResult {
  /** Where this message should be routed */
  target: "conversation-nina" | "working-agent";
  /** Whether this message should trigger a new conversation */
  newConversation: boolean;
  /** The channel the message came from */
  channel: string;
}

export class ConversationRouter {
  private ownerIdentifiers: Set<string>;
  private currentChannel: string | null = null;

  constructor(ownerIdentifiers: string[]) {
    this.ownerIdentifiers = new Set(
      ownerIdentifiers.map((id) => id.toLowerCase()),
    );
  }

  /**
   * Route an incoming message.
   *
   * Channel switch detection rules:
   * - Web to non-web: new conversation (user moved to phone)
   * - Non-web to Web: NOT new (web UI shows full transcript)
   * - Same channel: NOT new
   * - External messages: never trigger new conversation
   */
  route(message: { channel: string; sender: string }): RouteResult {
    const isOwner = this.ownerIdentifiers.has(message.sender.toLowerCase());

    if (!isOwner) {
      return {
        target: "working-agent",
        newConversation: false,
        channel: message.channel,
      };
    }

    // Owner message — check for channel switch
    const previousChannel = this.currentChannel;
    this.currentChannel = message.channel;

    // Web to non-web = new conversation
    const isNewConversation =
      previousChannel !== null &&
      previousChannel === "web" &&
      message.channel !== "web";

    return {
      target: "conversation-nina",
      newConversation: isNewConversation,
      channel: message.channel,
    };
  }

  /**
   * Get the current channel (last channel an owner message came from).
   * Returns null if no owner messages received yet.
   */
  getCurrentChannel(): string | null {
    return this.currentChannel;
  }
}
