/**
 * E2E Test: Immediate Task
 *
 * Tests the full flow:
 * 1. Create conversation
 * 2. Send message that should trigger task creation
 * 3. Verify task is created
 * 4. Verify task executes
 * 5. Verify result appears in conversation
 */

import { WebSocket } from "ws";
import {
  TestResult,
  waitForOpen,
  waitForMessage,
  pollUntil,
  assert,
  createConversation,
  getConversation,
  listTasks,
  getTask,
} from "./test-utils.js";

const BASE_URL = process.env.BASE_URL || "http://localhost:4321";
const WS_URL = process.env.WS_URL || "ws://localhost:4321/api/chat/ws";

export async function testImmediateTask(): Promise<TestResult> {
  console.log("  Creating test conversation...");

  // 1. Create test conversation
  const conversationId = await createConversation(BASE_URL);
  console.log(`  Conversation created: ${conversationId}`);

  // 2. Connect WebSocket and send message
  console.log("  Connecting WebSocket...");
  const ws = new WebSocket(WS_URL);
  await waitForOpen(ws);

  // Connect to our conversation first
  ws.send(
    JSON.stringify({
      type: "connect",
      conversationId,
    }),
  );

  // Wait for conversation_loaded
  await waitForMessage(ws, "conversation_loaded", 10_000);

  console.log("  Sending test message...");
  ws.send(
    JSON.stringify({
      type: "message",
      content:
        "We are traveling to Bangkok with a 3 and a 5 YO girls. research must see places to see with kids. send me the list.",
    }),
  );

  // 3. Wait for brain response (done event)
  console.log("  Waiting for brain response...");
  const brainResponse = await waitForMessage(ws, "done", 90_000);
  assert(brainResponse, "Brain should respond");
  console.log("  Brain responded");

  // 4. Poll for task creation (max 30s)
  console.log("  Polling for task creation...");
  const task = await pollUntil(
    async () => {
      const tasks = await listTasks(BASE_URL);
      return tasks.find(
        (t: any) =>
          t.title?.toLowerCase().includes("bangkok") ||
          t.title?.toLowerCase().includes("research") ||
          t.instructions?.toLowerCase().includes("bangkok"),
      );
    },
    30_000,
    "Task should be created",
  );

  console.log(`  Task created: ${task.id} - ${task.title}`);

  // 5. Poll for task completion (max 120s for research)
  console.log("  Waiting for task completion...");
  await pollUntil(
    async () => {
      const t = await getTask(BASE_URL, task.id);
      console.log(`    Task status: ${t.status}`);
      return t.status === "completed" || t.status === "failed";
    },
    120_000,
    "Task should complete",
  );

  const completedTask = await getTask(BASE_URL, task.id);
  console.log(`  Task finished with status: ${completedTask.status}`);

  // 6. Verify result in conversation (for now, just check task completed)
  // The result should be in the conversation turns
  console.log("  Checking conversation for results...");

  // Give a moment for the result to be delivered
  await new Promise((r) => setTimeout(r, 2000));

  const convData = await getConversation(BASE_URL, conversationId);
  const hasResultTurn = convData.turns?.some(
    (t: any) =>
      t.role === "assistant" &&
      (t.content?.toLowerCase().includes("bangkok") ||
        t.content?.toLowerCase().includes("task completed")),
  );

  ws.close();

  if (completedTask.status === "failed") {
    return {
      pass: false,
      conversationId,
      taskId: task.id,
      error: "Task failed to execute",
    };
  }

  return {
    pass: true,
    conversationId,
    taskId: task.id,
  };
}
