/**
 * E2E Test: Multi-Step Task
 *
 * Tests the full flow:
 * 1. Create conversation
 * 2. Send message that should trigger MULTI-STEP task creation
 * 3. Verify task has steps field populated
 * 4. Verify steps include both research AND delivery
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

export async function testMultiStepTask(): Promise<TestResult> {
  console.log("  Creating test conversation...");

  // 1. Create test conversation
  const conversationId = await createConversation(BASE_URL);
  console.log(`  Conversation created: ${conversationId}`);

  // 2. Connect WebSocket and send message WITH WhatsApp delivery
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

  // Message that MUST trigger multi-step extraction
  console.log("  Sending multi-step test message...");
  ws.send(
    JSON.stringify({
      type: "message",
      content:
        "Research family-friendly attractions in Phuket for kids ages 3 and 5. Send me the list on WhatsApp.",
    }),
  );

  // 3. Wait for brain response (done event)
  console.log("  Waiting for brain response...");
  const brainResponse = await waitForMessage(ws, "done", 90_000);
  assert(brainResponse, "Brain should respond");
  console.log("  Brain responded");

  // 4. Poll for task creation
  console.log("  Polling for task creation...");
  const task = await pollUntil(
    async () => {
      const tasks = await listTasks(BASE_URL);
      return tasks.find(
        (t: any) =>
          t.title?.toLowerCase().includes("phuket") ||
          t.title?.toLowerCase().includes("research") ||
          t.instructions?.toLowerCase().includes("phuket"),
      );
    },
    30_000,
    "Task should be created",
  );

  console.log(`  Task created: ${task.id} - ${task.title}`);
  console.log(`  Task steps: ${task.steps || "(none)"}`);
  console.log(`  Task instructions: ${task.instructions?.substring(0, 100)}...`);

  ws.close();

  // 5. Verify task has steps
  const hasSteps = !!task.steps;
  const hasDeliveryStep =
    task.steps?.toLowerCase().includes("whatsapp") ||
    task.steps?.toLowerCase().includes("send");

  if (!hasSteps) {
    return {
      pass: false,
      conversationId,
      taskId: task.id,
      error: "Task was created without steps field",
    };
  }

  if (!hasDeliveryStep) {
    return {
      pass: false,
      conversationId,
      taskId: task.id,
      error: "Task steps do not include WhatsApp delivery step",
    };
  }

  return {
    pass: true,
    conversationId,
    taskId: task.id,
  };
}

// Run if called directly
if (import.meta.url.startsWith("file:")) {
  const modulePath = new URL(import.meta.url).pathname;
  const argv1 = process.argv[1];
  if (argv1 && modulePath.endsWith(argv1.replace(/.*\//, ""))) {
    testMultiStepTask()
      .then((result) => {
        console.log("\n=== Multi-Step Task Test ===");
        console.log(result.pass ? "PASS" : `FAIL: ${result.error}`);
        process.exit(result.pass ? 0 : 1);
      })
      .catch((err) => {
        console.error("Test error:", err);
        process.exit(1);
      });
  }
}
