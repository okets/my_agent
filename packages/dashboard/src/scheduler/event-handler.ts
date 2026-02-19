/**
 * Scheduled Task Handler for CalendarScheduler
 *
 * Spawns brain queries when scheduled tasks fire.
 * This closes the loop: scheduled task fires → brain responds.
 */

import {
  createBrainQuery,
  loadConfig,
  assembleSystemPrompt,
  assembleCalendarContext,
  createCalDAVClient,
  loadCalendarConfig,
  loadCalendarCredentials,
} from "@my-agent/core";
import type { CalendarEvent, ScheduledTaskContext } from "@my-agent/core";
import type { ConversationManager } from "../conversations/index.js";

const SCHEDULER_CHANNEL = "system";
const SCHEDULER_CONVERSATION_TITLE = "Scheduled Events";

/**
 * Configuration for the event handler.
 */
interface EventHandlerConfig {
  conversationManager: ConversationManager;
  agentDir: string;
}

/**
 * Convert CalendarEvent to ScheduledTaskContext for prompt injection.
 */
function toScheduledTaskContext(event: CalendarEvent): ScheduledTaskContext {
  return {
    title: event.title,
    start: event.start.toISOString(),
    end: event.end?.toISOString(),
    calendarId: event.calendarId,
    description: event.description,
    action: event.action,
  };
}

/**
 * Get or create the scheduler conversation.
 * Uses a consistent ID so all scheduler events go to the same conversation.
 */
async function getSchedulerConversation(
  manager: ConversationManager,
): Promise<string> {
  // Try to find existing scheduler conversation
  const conversations = await manager.list({ channel: SCHEDULER_CHANNEL });
  const existing = conversations.find(
    (c) => c.title === SCHEDULER_CONVERSATION_TITLE,
  );

  if (existing) {
    return existing.id;
  }

  // Create new conversation for scheduler events
  const conv = await manager.create(SCHEDULER_CHANNEL, {
    title: SCHEDULER_CONVERSATION_TITLE,
  });

  console.log(`[EventHandler] Created scheduler conversation: ${conv.id}`);
  return conv.id;
}

/**
 * Spawn a brain query for a fired scheduled task.
 *
 * The brain receives the scheduled task context in its system prompt and
 * responds appropriately (acknowledge reminder, execute action, etc.)
 */
export async function spawnEventQuery(
  event: CalendarEvent,
  config: EventHandlerConfig,
): Promise<string> {
  const { conversationManager, agentDir } = config;

  console.log(`[EventHandler] Processing event: "${event.title}"`);

  // Get or create scheduler conversation
  const conversationId = await getSchedulerConversation(conversationManager);

  // Load brain configuration
  const brainConfig = loadConfig();

  // Try to assemble calendar context (for awareness of other events)
  let calendarContext: string | undefined;
  try {
    const calConfig = loadCalendarConfig(agentDir);
    const credentials = loadCalendarCredentials(agentDir);

    if (calConfig && credentials) {
      const calendarRepo = createCalDAVClient(calConfig, credentials);
      calendarContext = await assembleCalendarContext(calendarRepo);
    }
  } catch (err) {
    console.warn(
      `[EventHandler] Calendar context unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Assemble system prompt with scheduled task context
  const scheduledTaskContext = toScheduledTaskContext(event);
  const systemPrompt = await assembleSystemPrompt(brainConfig.brainDir, {
    calendarContext,
    scheduledTaskContext,
  });

  // Build the user message
  const userMessage = `Calendar event fired: "${event.title}"${
    event.description ? `\n\nDescription: ${event.description}` : ""
  }${event.action ? `\n\nAction: ${event.action}` : ""}`;

  // Spawn brain query
  const query = createBrainQuery(userMessage, {
    model: brainConfig.model,
    systemPrompt,
    continue: false,
    includePartialMessages: false, // We want complete messages
  });

  // Collect response
  let response = "";
  try {
    for await (const msg of query) {
      if (msg.type === "assistant") {
        const textBlocks = msg.message.content.filter(
          (block: { type: string }) => block.type === "text",
        );
        for (const block of textBlocks) {
          if ("text" in block) {
            response += block.text;
          }
        }
      }
    }
  } catch (err) {
    console.error(`[EventHandler] Error querying brain:`, err);
    response = `[Error: ${err instanceof Error ? err.message : String(err)}]`;
  }

  // Log the response
  console.log(`[EventHandler] Brain response for "${event.title}":`);
  console.log(response);

  // Record turn in conversation transcript
  try {
    // Get current conversation to determine turn number
    const conversation = await conversationManager.get(conversationId);
    const turnNumber = (conversation?.turnCount ?? 0) + 1;
    const timestamp = new Date().toISOString();

    await conversationManager.appendTurn(conversationId, {
      type: "turn",
      role: "user",
      content: userMessage,
      timestamp,
      turnNumber,
    });
    await conversationManager.appendTurn(conversationId, {
      type: "turn",
      role: "assistant",
      content: response,
      timestamp: new Date().toISOString(),
      turnNumber,
    });
  } catch (err) {
    console.warn(`[EventHandler] Failed to record turn:`, err);
  }

  return response;
}

/**
 * Create an event handler function for use with CalendarScheduler.
 *
 * Usage:
 *   const handler = createEventHandler({ conversationManager, agentDir });
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
