/**
 * Scheduled Event Handler for CalendarScheduler
 *
 * Logs when calendar events fire. The old task system has been removed;
 * scheduled work is now handled by the automation system.
 */

import type { CalendarEvent } from "@my-agent/core";
import type { ConversationManager } from "../conversations/index.js";
import type { ConversationDatabase } from "../conversations/db.js";

const SCHEDULER_CHANNEL = "system";
const SCHEDULER_CONVERSATION_TITLE = "Scheduled Events";

/**
 * Configuration for the event handler.
 */
interface EventHandlerConfig {
  conversationManager: ConversationManager;
  agentDir: string;
  /** Database for SDK session persistence (M6.5-S2) */
  db: ConversationDatabase;
  /** App instance — when available, uses injectTurn() for proper event emission */
  app?: {
    chat: {
      injectTurn(conversationId: string, turn: {
        role: "user" | "assistant"; content: string; turnNumber: number; channel?: string;
      }): Promise<void>;
    };
  };
}

/**
 * Get or create the scheduler conversation.
 * Used to log event firing for user visibility.
 */
async function getSchedulerConversation(
  manager: ConversationManager,
): Promise<string> {
  const conversations = await manager.list({});
  const existing = conversations.find(
    (c) => c.title === SCHEDULER_CONVERSATION_TITLE,
  );

  if (existing) {
    return existing.id;
  }

  const conv = await manager.create({
    title: SCHEDULER_CONVERSATION_TITLE,
  });

  console.log(`[EventHandler] Created scheduler conversation: ${conv.id}`);
  return conv.id;
}

/**
 * Handle a fired calendar event by logging it.
 * Scheduled work execution is now handled by the automation system.
 */
export async function spawnEventQuery(
  event: CalendarEvent,
  config: EventHandlerConfig,
): Promise<string> {
  const { conversationManager } = config;

  console.log(`[EventHandler] Calendar event fired: "${event.title}"`);

  // Log to scheduler conversation for visibility
  const conversationId = await getSchedulerConversation(conversationManager);

  try {
    const conversation = await conversationManager.get(conversationId);
    const turnNumber = (conversation?.turnCount ?? 0) + 1;
    const timestamp = new Date().toISOString();

    let description = `Calendar event: "${event.title}"`;
    if (event.description) description += `\n${event.description}`;
    if (event.action) description += `\nAction: ${event.action}`;

    const chat = config.app?.chat;
    if (chat) {
      await chat.injectTurn(conversationId, {
        role: "user", content: description, turnNumber, channel: SCHEDULER_CHANNEL,
      });
      await chat.injectTurn(conversationId, {
        role: "assistant",
        content: "Event logged. Scheduled work is handled by automations.",
        turnNumber: turnNumber + 1, channel: SCHEDULER_CHANNEL,
      });
    } else {
      // Fallback for cases without app
      await conversationManager.appendTurn(conversationId, {
        type: "turn", role: "user", content: description, timestamp, turnNumber,
      });
      await conversationManager.appendTurn(conversationId, {
        type: "turn", role: "assistant",
        content: "Event logged. Scheduled work is handled by automations.",
        timestamp: new Date().toISOString(), turnNumber: turnNumber + 1,
      });
    }
  } catch (err) {
    console.warn(`[EventHandler] Failed to record turn:`, err);
  }

  return "";
}

/**
 * Create an event handler function for use with CalendarScheduler.
 *
 * Usage:
 *   const handler = createEventHandler({ conversationManager, agentDir, db });
 *   scheduler = new CalendarScheduler(caldavClient, { onEventFired: handler });
 */
export function createEventHandler(
  config: EventHandlerConfig,
): (event: CalendarEvent) => Promise<void> {
  return async (event: CalendarEvent) => {
    try {
      await spawnEventQuery(event, config);
    } catch (err) {
      console.error(
        `[EventHandler] Failed to handle event "${event.title}":`,
        err,
      );
    }
  };
}
