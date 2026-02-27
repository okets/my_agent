/**
 * Scheduled Task Handler for CalendarScheduler
 *
 * Creates Task entities and executes them when calendar events fire.
 * This closes the loop: scheduled event fires → Task created → TaskExecutor runs.
 *
 * M5-S2: Updated to use TaskManager/TaskExecutor instead of direct brain queries.
 */

import type { CalendarEvent } from "@my-agent/core";
import type { ConversationManager } from "../conversations/index.js";
import type { ConversationDatabase } from "../conversations/db.js";
import { TaskManager, TaskLogStorage, TaskExecutor } from "../tasks/index.js";
import type { CreateTaskInput } from "../tasks/index.js";

const SCHEDULER_CHANNEL = "system";
const SCHEDULER_CONVERSATION_TITLE = "Scheduled Events";

/**
 * Configuration for the event handler.
 */
interface EventHandlerConfig {
  conversationManager: ConversationManager;
  taskManager: TaskManager;
  logStorage: TaskLogStorage;
  agentDir: string;
  /** Database for SDK session persistence (M6.5-S2) */
  db: ConversationDatabase;
}

/**
 * Get or create the scheduler conversation.
 * Used to log task execution summaries for user visibility.
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
 * Check if an event is recurring and generate a recurrence ID.
 * Groups all occurrences of the same recurring event.
 *
 * For recurring events (has rrule), we use the event UID as the recurrence ID
 * since all occurrences share the same UID.
 */
function getRecurrenceId(event: CalendarEvent): string | undefined {
  if (!event.rrule) {
    return undefined;
  }
  // Use calendar ID + UID to ensure uniqueness across calendars
  return `${event.calendarId}:${event.uid}`;
}

/**
 * Generate the occurrence date key for a recurring event.
 */
function getOccurrenceDate(event: CalendarEvent): string {
  return event.start.toISOString().split("T")[0]; // YYYY-MM-DD
}

/**
 * Build task instructions from calendar event.
 */
function buildInstructions(event: CalendarEvent): string {
  let instructions = `Calendar event fired: "${event.title}"`;

  if (event.description) {
    instructions += `\n\nDescription: ${event.description}`;
  }

  if (event.action) {
    instructions += `\n\nAction: ${event.action}`;
  }

  return instructions;
}

/**
 * Handle a fired calendar event by creating/resuming a Task and executing it.
 */
export async function spawnEventQuery(
  event: CalendarEvent,
  config: EventHandlerConfig,
): Promise<string> {
  const { conversationManager, taskManager, logStorage, agentDir, db } = config;

  console.log(`[EventHandler] Processing event: "${event.title}"`);

  let task;
  let created: boolean;

  // Check if event has a linked task (conversation-created scheduled tasks)
  if (event.taskId) {
    const existingTask = taskManager.findById(event.taskId);
    if (existingTask) {
      console.log(
        `[EventHandler] Found linked task ${event.taskId}, executing existing task`,
      );
      task = existingTask;
      created = false;
    } else {
      console.warn(
        `[EventHandler] Linked task ${event.taskId} not found, creating new task`,
      );
      // Fall through to create task from event
      task = null;
    }
  }

  // If no linked task found, create from event (legacy CalDAV events)
  if (!task) {
    const recurrenceId = getRecurrenceId(event);
    const occurrenceDate = getOccurrenceDate(event);

    // Store calendarId:uid as sourceRef so executor can extract calendarId
    const sourceRef = `${event.calendarId}:${event.uid}`;

    if (recurrenceId) {
      // Recurring event: find existing or create new with shared session
      const result = taskManager.findOrCreateForOccurrence({
        type: "scheduled",
        sourceType: "caldav",
        sourceRef,
        title: event.title,
        instructions: buildInstructions(event),
        createdBy: "scheduler",
        scheduledFor: event.start,
        recurrenceId,
        occurrenceDate,
      });
      task = result.task;
      created = result.created;

      if (created) {
        console.log(
          `[EventHandler] Created task for recurring event: ${task.id}`,
        );
      } else {
        console.log(`[EventHandler] Resuming recurring task: ${task.id}`);
      }
    } else {
      // One-time event: create new task
      const taskInput: CreateTaskInput = {
        type: "scheduled",
        sourceType: "caldav",
        sourceRef,
        title: event.title,
        instructions: buildInstructions(event),
        createdBy: "scheduler",
        scheduledFor: event.start,
      };
      task = taskManager.create(taskInput);
      created = true;

      console.log(`[EventHandler] Created task for one-time event: ${task.id}`);
    }
  }

  // Create executor and run
  const executor = new TaskExecutor({
    taskManager,
    logStorage,
    agentDir,
    db,
  });

  const result = await executor.run(task);

  // Log execution summary to scheduler conversation
  const conversationId = await getSchedulerConversation(conversationManager);

  try {
    const conversation = await conversationManager.get(conversationId);
    const turnNumber = (conversation?.turnCount ?? 0) + 1;
    const timestamp = new Date().toISOString();

    // User turn: task trigger
    await conversationManager.appendTurn(conversationId, {
      type: "turn",
      role: "user",
      content: `[Task: ${task.id}] ${task.title}`,
      timestamp,
      turnNumber,
    });

    // Assistant turn: execution result
    const summary = result.success ? result.work : `[Error: ${result.error}]`;

    await conversationManager.appendTurn(conversationId, {
      type: "turn",
      role: "assistant",
      content: summary,
      timestamp: new Date().toISOString(),
      turnNumber,
    });
  } catch (err) {
    console.warn(`[EventHandler] Failed to record turn:`, err);
  }

  return result.work;
}

/**
 * Create an event handler function for use with CalendarScheduler.
 *
 * Usage:
 *   const handler = createEventHandler({ conversationManager, taskManager, logStorage, agentDir });
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
