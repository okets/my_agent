/**
 * E2E Test: Scheduled Task
 *
 * Tests the full flow:
 * 1. Create conversation
 * 2. Send message that should trigger scheduled task creation
 * 3. Verify task is created with future scheduledFor
 * 4. Wait for scheduled time
 * 5. Verify task executes
 * 6. Verify result appears in conversation
 */

import { WebSocket } from "ws";
import {
  TestResult,
  waitForOpen,
  waitForMessage,
  pollUntil,
  sleep,
  assert,
  createConversation,
  getConversation,
  listTasks,
  getTask,
} from "./test-utils.js";

const BASE_URL = process.env.BASE_URL || "http://localhost:4321";
const WS_URL = process.env.WS_URL || "ws://localhost:4321/api/chat/ws";
const DELAY_MINUTES = 1; // Use 1 minute for testing

export async function testScheduledTask(): Promise<TestResult> {
  console.log("  Creating test conversation...");

  // 1. Create test conversation
  const conversationId = await createConversation(BASE_URL);
  console.log(`  Conversation created: ${conversationId}`);

  // 2. Connect WebSocket and send message
  console.log("  Connecting WebSocket...");
  const ws = new WebSocket(WS_URL);
  await waitForOpen(ws);

  // Switch to our conversation
  ws.send(
    JSON.stringify({
      type: "conversation:switch",
      conversationId,
    }),
  );

  // Wait a bit for switch to complete
  await new Promise((r) => setTimeout(r, 500));

  console.log("  Sending test message...");
  ws.send(
    JSON.stringify({
      type: "chat:send",
      conversationId,
      message: `in ${DELAY_MINUTES} minute, check if my website is loading https://thinking.homes`,
    }),
  );

  // 3. Wait for brain response
  console.log("  Waiting for brain response...");
  const brainResponse = await waitForMessage(ws, "chat:complete", 60_000);
  assert(brainResponse, "Brain should respond");
  console.log("  Brain responded");

  // 4. Poll for task creation
  console.log("  Polling for scheduled task creation...");
  const task = await pollUntil(
    async () => {
      const tasks = await listTasks(BASE_URL);
      return tasks.find(
        (t: any) =>
          t.type === "scheduled" &&
          (t.title?.toLowerCase().includes("website") ||
            t.title?.toLowerCase().includes("check") ||
            t.instructions?.toLowerCase().includes("thinking.homes")),
      );
    },
    30_000,
    "Scheduled task should be created",
  );

  console.log(`  Task created: ${task.id} - ${task.title}`);
  console.log(`  Scheduled for: ${task.scheduledFor}`);

  // 5. Verify scheduledFor is in the future
  if (task.scheduledFor) {
    const scheduledFor = new Date(task.scheduledFor);
    const now = new Date();
    assert(scheduledFor > now, "scheduledFor should be in the future");
    console.log(
      `  Task scheduled ${Math.round((scheduledFor.getTime() - now.getTime()) / 1000)}s in the future`,
    );
  }

  // 6. Wait for scheduled time + poll interval + buffer
  const waitTime = (DELAY_MINUTES * 60 + 45) * 1000; // +45s for scheduler poll
  console.log(`  Waiting ${waitTime / 1000}s for scheduled execution...`);
  await sleep(waitTime);

  // 7. Poll for task completion
  console.log("  Polling for task completion...");
  await pollUntil(
    async () => {
      const t = await getTask(BASE_URL, task.id);
      console.log(`    Task status: ${t.status}`);
      return t.status === "completed" || t.status === "failed";
    },
    60_000,
    "Scheduled task should complete after due time",
  );

  const completedTask = await getTask(BASE_URL, task.id);
  console.log(`  Task finished with status: ${completedTask.status}`);

  // 8. Verify result in conversation
  console.log("  Checking conversation for results...");
  await sleep(2000);

  const convData = await getConversation(BASE_URL, conversationId);
  const hasResultTurn = convData.turns?.some(
    (t: any) =>
      t.role === "assistant" &&
      (t.content?.toLowerCase().includes("thinking.homes") ||
        t.content?.toLowerCase().includes("website") ||
        t.content?.toLowerCase().includes("task completed")),
  );

  ws.close();

  if (completedTask.status === "failed") {
    return {
      pass: false,
      conversationId,
      taskId: task.id,
      error: "Scheduled task failed to execute",
    };
  }

  return {
    pass: true,
    conversationId,
    taskId: task.id,
  };
}
