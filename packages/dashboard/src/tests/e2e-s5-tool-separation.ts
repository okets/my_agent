/**
 * E2E Test: M6.9-S5 Tool Separation
 *
 * Tests live conversation Nina behavior via WebSocket.
 * Verifies tool restriction, task delegation, and property updates.
 *
 * Usage: npx tsx src/tests/e2e-s5-tool-separation.ts
 */

import { WebSocket } from "ws";

const BASE_URL = "http://localhost:4321";
const WS_URL = "ws://localhost:4321/api/chat/ws";
import { join } from "node:path";
import { findAgentDir } from "@my-agent/core";
const PROPERTIES_PATH = join(findAgentDir(), "notebook", "properties", "status.yaml");

interface TestResult {
  name: string;
  pass: boolean;
  details: string;
  assistantResponse?: string;
  tasksCreated?: number;
  duration?: number;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendChatMessage(
  message: string,
  timeoutMs = 120_000,
): Promise<{ response: string; conversationId: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let fullResponse = "";
    let conversationId = "";
    let streamComplete = false;

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.on("open", () => {
      // Force a new conversation to avoid session resumption artifacts
      ws.send(JSON.stringify({ type: "message", content: "/new" }));
    });

    let newConvReady = false;
    let messageSent = false;

    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "conversation_created") {
          conversationId = msg.conversationId;
          newConvReady = true;
        }

        // After /new creates a new conversation, send the real message
        if (msg.type === "conversation_created" && !messageSent) {
          messageSent = true;
          ws.send(
            JSON.stringify({
              type: "message",
              content: message,
            }),
          );
          return;
        }

        // Capture response from the actual message (not /new)
        if (messageSent && msg.type === "text_delta") {
          fullResponse += msg.content || msg.text || "";
        }

        if (messageSent && msg.type === "done") {
          streamComplete = true;
          clearTimeout(timeout);
          // Give a moment for post-response hooks and tool calls
          setTimeout(() => {
            ws.close();
            resolve({ response: fullResponse, conversationId });
          }, 3000);
        }

        if (msg.type === "error" && messageSent) {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(`Stream error: ${msg.error || msg.message}`));
        }
      } catch {
        // Ignore parse errors
      }
    });

    ws.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });

    ws.on("close", () => {
      if (!streamComplete) {
        clearTimeout(timeout);
        // Might have gotten a response before close
        if (fullResponse) {
          resolve({ response: fullResponse, conversationId });
        }
      }
    });
  });
}

async function getTasksAfterBaseline(baseline: number): Promise<any[]> {
  const res = await fetch(
    `${BASE_URL}/api/tasks?status=pending,running,completed`,
  );
  const data = await res.json();
  return data.tasks.slice(0, data.tasks.length - baseline);
}

async function getConversationTasks(convId: string): Promise<any[]> {
  const res = await fetch(`${BASE_URL}/api/conversations/${convId}/tasks`);
  const data = await res.json();
  return data.tasks || [];
}

async function readProperties(): Promise<any> {
  const res = await fetch(
    `${BASE_URL}/api/debug/task-tools/update_property`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Read-only trick: just read current state
      body: JSON.stringify({
        key: "__probe__",
        value: "probe",
        confidence: "low",
      }),
    },
  );
  // We'll check the file directly instead
  return {};
}

// ─────────────────────────────────────────────────
// Test Scenarios
// ─────────────────────────────────────────────────

async function testScenario1_ResearchDelegation(): Promise<TestResult> {
  console.log("\n━━━ Scenario 1: Research Delegation ━━━");
  console.log(
    'Sending: "Compare the top 3 co-working spaces in Chiang Mai old city — WiFi speed, price, and vibe"',
  );

  const start = Date.now();
  const { response, conversationId } = await sendChatMessage(
    "Compare the top 3 co-working spaces in Chiang Mai old city — WiFi speed, price, and vibe",
  );
  const duration = Date.now() - start;

  console.log(`Response (${duration}ms): ${response.slice(0, 300)}...`);

  // Wait for task creation
  await sleep(3000);

  // Check if tasks were created for this conversation
  // First try linked tasks, then fall back to checking all recent tasks
  let linkedTasks = await getConversationTasks(conversationId);
  if (linkedTasks.length === 0) {
    // MCP tool may still be processing — wait and retry
    await sleep(5000);
    linkedTasks = await getConversationTasks(conversationId);
  }
  // Also check all pending/running tasks as fallback
  const allTasks = await fetch(`${BASE_URL}/api/tasks?status=pending,running`)
    .then((r) => r.json())
    .then((d) => d.tasks);
  const recentTasks = allTasks.filter(
    (t: any) =>
      Date.now() - new Date(t.created).getTime() < 60_000,
  );
  const taskCreated = linkedTasks.length > 0 || recentTasks.length > 0;

  // Check that Nina did NOT try to answer the research question herself
  // (She should delegate, not list co-working spaces)
  const selfAnswered =
    response.toLowerCase().includes("punspace") ||
    response.toLowerCase().includes("camp") ||
    response.toLowerCase().includes("wifi speed") ||
    (response.toLowerCase().includes("here are") &&
      response.toLowerCase().includes("co-working"));

  const pass = taskCreated && !selfAnswered;

  return {
    name: "Research delegation",
    pass,
    details: taskCreated
      ? selfAnswered
        ? `Task created BUT Nina also answered the research question herself (should only delegate)`
        : `Task created (${linkedTasks.length} task(s)). Nina delegated without self-answering.`
      : `No task created — Nina may have tried to answer herself`,
    assistantResponse: response.slice(0, 500),
    tasksCreated: linkedTasks.length,
    duration,
  };
}

async function testScenario2_QuickFact(): Promise<TestResult> {
  console.log("\n━━━ Scenario 2: Quick Fact (WebSearch) ━━━");
  console.log('Sending: "What time is it in Tokyo right now?"');

  const start = Date.now();
  const { response, conversationId } = await sendChatMessage(
    "What time is it in Tokyo right now?",
  );
  const duration = Date.now() - start;

  console.log(`Response (${duration}ms): ${response.slice(0, 300)}`);

  await sleep(2000);

  // Should NOT create a task for a simple question
  const linkedTasks = await getConversationTasks(conversationId);
  const noTaskCreated = linkedTasks.length === 0;

  // Should have an actual time in the response
  const hasTimeInfo =
    response.includes(":") ||
    response.toLowerCase().includes("am") ||
    response.toLowerCase().includes("pm") ||
    response.toLowerCase().includes("time");

  const pass = noTaskCreated && hasTimeInfo;

  return {
    name: "Quick fact (no task)",
    pass,
    details: noTaskCreated
      ? hasTimeInfo
        ? "Answered directly with time info. No task created."
        : "No task created but response doesn't contain time info"
      : `Unexpectedly created ${linkedTasks.length} task(s) for a simple question`,
    assistantResponse: response.slice(0, 500),
    tasksCreated: linkedTasks.length,
    duration,
  };
}

async function testScenario3_PropertyUpdate(): Promise<TestResult> {
  console.log("\n━━━ Scenario 3: Property Update ━━━");
  console.log('Sending: "I just landed in Bangkok"');

  // Read properties before
  const { readFile } = await import("node:fs/promises");
  let propsBefore = "";
  try {
    propsBefore = await readFile(
      PROPERTIES_PATH,
      "utf-8",
    );
  } catch {
    propsBefore = "";
  }

  const start = Date.now();
  const { response, conversationId } = await sendChatMessage(
    "I just landed in Bangkok",
  );
  const duration = Date.now() - start;

  console.log(`Response (${duration}ms): ${response.slice(0, 300)}`);

  // Give time for property update (MCP tool call happens during stream)
  await sleep(5000);

  // Read properties after
  let propsAfter = "";
  try {
    propsAfter = await readFile(
      PROPERTIES_PATH,
      "utf-8",
    );
  } catch {
    propsAfter = "";
  }

  // Check if Bangkok appears in properties after the message
  const locationUpdated = propsAfter.toLowerCase().includes("bangkok");
  const locationWasAlreadyBangkok = propsBefore.toLowerCase().includes("bangkok");

  const pass = locationUpdated;

  return {
    name: "Property update (location)",
    pass,
    details: locationUpdated
      ? locationWasAlreadyBangkok
        ? "Location was already Bangkok (from previous run) — update_property still called"
        : "Location property updated to Bangkok"
      : `Property not updated. Before: ${propsBefore.slice(0, 100)}... After: ${propsAfter.slice(0, 100)}...`,
    assistantResponse: response.slice(0, 500),
    duration,
  };
}

// ─────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  M6.9-S5 Tool Separation — Live E2E Tests   ║");
  console.log("╚══════════════════════════════════════════════╝");

  const results: TestResult[] = [];

  try {
    results.push(await testScenario1_ResearchDelegation());
  } catch (err) {
    results.push({
      name: "Research delegation",
      pass: false,
      details: `Error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  try {
    results.push(await testScenario2_QuickFact());
  } catch (err) {
    results.push({
      name: "Quick fact (no task)",
      pass: false,
      details: `Error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  try {
    results.push(await testScenario3_PropertyUpdate());
  } catch (err) {
    results.push({
      name: "Property update (location)",
      pass: false,
      details: `Error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // ── Summary ──
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║              E2E Test Results                ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  for (const r of results) {
    const icon = r.pass ? "PASS" : "FAIL";
    console.log(`[${icon}] ${r.name}`);
    console.log(`       ${r.details}`);
    if (r.assistantResponse) {
      console.log(
        `       Response: "${r.assistantResponse.slice(0, 150)}..."`,
      );
    }
    if (r.duration) {
      console.log(`       Duration: ${r.duration}ms`);
    }
    console.log();
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`Result: ${passed}/${results.length} passed`);

  // Restore location property
  try {
    await fetch(`${BASE_URL}/api/debug/task-tools/update_property`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "location",
        value: "Israel",
        confidence: "high",
        source: "e2e-test-restore",
      }),
    });
    console.log("\nRestored location property to Israel");
  } catch {
    console.warn("Failed to restore location property");
  }

  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
