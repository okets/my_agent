/**
 * E2E Task Flow Test — Research with WhatsApp Delivery
 *
 * Tests both immediate and scheduled task flows end-to-end.
 * Uses internal APIs (REST + WebSocket) per self-evolving infrastructure pattern.
 *
 * Prerequisites:
 * - Dashboard server running on localhost:4321
 * - WhatsApp channel connected with ownerJid configured
 * - Agent hatched with valid auth
 *
 * Usage:
 *   npx tsx tests/e2e-task-whatsapp.ts
 */

import WebSocket from "ws";

const BASE_URL = "http://localhost:4321";
const WS_URL = "ws://localhost:4321/api/chat/ws";

// Timeouts
const TASK_CREATION_TIMEOUT = 60_000; // 60s for extraction LLM call + creation
const TASK_COMPLETION_TIMEOUT = 180_000; // 180s for brain research execution
const SCHEDULED_TASK_TIMEOUT = 90_000; // 90s for scheduler pickup + execution
const BRAIN_RESPONSE_TIMEOUT = 180_000; // 180s for brain to finish streaming

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface Assertion {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface TestResult {
  name: string;
  pass: boolean;
  assertions: Assertion[];
  error?: string;
  conversationId?: string;
  taskId?: string;
  durationMs: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchJSON(path: string, options?: RequestInit): Promise<any> {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status} ${options?.method ?? "GET"} ${path}: ${text}`);
  }

  return response.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll<T>(
  fn: () => Promise<T | null>,
  opts: { interval?: number; timeout: number; description: string },
): Promise<T> {
  const { interval = 2000, timeout, description } = opts;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const result = await fn();
    if (result !== null) return result;
    await sleep(interval);
  }

  throw new Error(`Poll timeout: ${description} (waited ${timeout}ms)`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pre-flight Checks
// ═══════════════════════════════════════════════════════════════════════════════

export async function preflight(): Promise<{
  ok: boolean;
  issues: string[];
}> {
  const issues: string[] = [];

  // Check server is running
  try {
    await fetchJSON("/api/hatching/status");
  } catch {
    issues.push("Dashboard server not reachable at localhost:4321");
    return { ok: false, issues };
  }

  // Check hatched
  const status = await fetchJSON("/api/hatching/status");
  if (!status.hatched) {
    issues.push("Agent not hatched");
  }

  // Check WhatsApp channel connected
  const channels = await fetchJSON("/api/channels");
  const whatsapp = channels.find((c: any) => c.plugin === "baileys");

  if (!whatsapp) {
    issues.push("No WhatsApp (baileys) channel configured");
  } else if (whatsapp.status !== "connected") {
    issues.push(
      `WhatsApp channel "${whatsapp.id}" status is "${whatsapp.status}", expected "connected"`,
    );
  } else {
    console.log(
      `  WhatsApp: ${whatsapp.id} (connected, owner: ${whatsapp.ownerIdentities?.[0] ?? "unknown"})`,
    );
  }

  return { ok: issues.length === 0, issues };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WebSocket Helper
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Send a message via WebSocket and wait for brain to finish responding.
 * Returns true if done event received, false on timeout/error.
 */
async function sendMessageViaWS(
  conversationId: string,
  message: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        resolve(false);
      }
    }, BRAIN_RESPONSE_TIMEOUT);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "connect", conversationId }));
    });

    let messageSent = false;

    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "conversation_loaded" && !messageSent) {
          messageSent = true;
          // Small delay to let the server finish the connect handler
          setTimeout(() => {
            ws.send(JSON.stringify({ type: "message", content: message }));
          }, 500);
        }

        if (msg.type === "done") {
          // Brain finished responding
          clearTimeout(timeout);
          resolved = true;
          ws.close();
          resolve(true);
        }

        if (msg.type === "error") {
          console.error(`    [WS] Error: ${msg.message}`);
          clearTimeout(timeout);
          resolved = true;
          ws.close();
          resolve(false);
        }
      } catch {
        // Ignore parse errors
      }
    });

    ws.on("error", (err) => {
      console.error(`    [WS] Connection error: ${err.message}`);
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    });

    ws.on("close", () => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test 1: Immediate Task (Ko Samui Research + WhatsApp Delivery)
// ═══════════════════════════════════════════════════════════════════════════════

export async function testImmediateTask(): Promise<TestResult> {
  const start = Date.now();
  const assertions: Assertion[] = [];
  let conversationId: string | undefined;
  let taskId: string | undefined;

  try {
    // 1. Create test conversation
    const conv = await fetchJSON("/api/admin/conversations", {
      method: "POST",
      body: JSON.stringify({
        channel: "web",
        title: "E2E Immediate Task Test",
      }),
    });
    conversationId = conv.id;
    assertions.push({
      name: "Conversation created",
      pass: true,
      detail: conv.id,
    });

    // 2. Send message via WebSocket and wait for brain response
    console.log("    Sending message via WebSocket, waiting for brain...");
    const brainDone = await sendMessageViaWS(
      conversationId,
      "we are heading to Ko Samui with Riley, 5 YO and Via 3 YO. what are the must do in Samui that are possible with kids? research. send me the list on whatsapp",
    );
    assertions.push({
      name: "Brain responded",
      pass: brainDone,
      detail: brainDone ? "Got done event" : "Brain response timeout",
    });

    if (!brainDone) {
      return {
        name: "Immediate Task",
        pass: false,
        assertions,
        error: "Brain did not respond within timeout",
        conversationId,
        durationMs: Date.now() - start,
      };
    }

    // 3. Wait for task creation (extraction runs async after brain response)
    console.log("    Waiting for task extraction...");
    const task = await poll(
      async () => {
        const convTasks = await fetchJSON(
          `/api/conversations/${conversationId}/tasks`,
        );
        if (convTasks.tasks && convTasks.tasks.length > 0) {
          const taskDetail = await fetchJSON(
            `/api/tasks/${convTasks.tasks[0].taskId}`,
          );
          return taskDetail;
        }
        return null;
      },
      { timeout: TASK_CREATION_TIMEOUT, description: "Task creation" },
    );
    taskId = task.id;

    assertions.push({
      name: "Task created",
      pass: true,
      detail: `${task.id}: "${task.title}"`,
    });

    assertions.push({
      name: "Task type is immediate",
      pass: task.type === "immediate",
      detail: `type=${task.type}`,
    });

    const hasWhatsAppStep = task.steps?.toLowerCase().includes("whatsapp");
    assertions.push({
      name: "Steps include WhatsApp delivery",
      pass: !!hasWhatsAppStep,
      detail: task.steps?.substring(0, 120),
    });

    // 4. Wait for task completion
    console.log("    Waiting for task completion...");
    const completedTask = await poll(
      async () => {
        const t = await fetchJSON(`/api/tasks/${taskId}`);
        if (t.status === "completed" || t.status === "failed") return t;
        return null;
      },
      { timeout: TASK_COMPLETION_TIMEOUT, description: "Task completion" },
    );

    assertions.push({
      name: "Task completed successfully",
      pass: completedTask.status === "completed",
      detail: `status=${completedTask.status}`,
    });

    // 5. Verify conversation has result turn (poll — delivery is async after completion)
    let resultTurnDetail = "No result turn found";
    try {
      await poll(
        async () => {
          const cd = await fetchJSON(
            `/api/admin/conversations/${conversationId}`,
          );
          const rt = cd.turns?.find(
            (t: any) =>
              t.role === "assistant" && t.content?.includes("Task Completed"),
          );
          if (rt) {
            resultTurnDetail = `Turn ${rt.turnNumber}`;
            return true;
          }
          return null;
        },
        { interval: 2000, timeout: 30_000, description: "Result delivery" },
      );
      assertions.push({
        name: "Result delivered to conversation",
        pass: true,
        detail: resultTurnDetail,
      });
    } catch {
      assertions.push({
        name: "Result delivered to conversation",
        pass: false,
        detail: resultTurnDetail,
      });
    }

    // 6. Verify notification created (poll — notification fires after delivery)
    let notificationDetail = "No notification for task";
    try {
      await poll(
        async () => {
          const notifs = await fetchJSON("/api/notifications");
          const tn = notifs.notifications?.find(
            (n: any) => n.taskId === taskId,
          );
          if (tn) {
            notificationDetail = `id=${tn.id}`;
            return true;
          }
          return null;
        },
        { interval: 2000, timeout: 15_000, description: "Notification creation" },
      );
      assertions.push({
        name: "Notification created",
        pass: true,
        detail: notificationDetail,
      });
    } catch {
      assertions.push({
        name: "Notification created",
        pass: false,
        detail: notificationDetail,
      });
    }

    // 7. Verify WhatsApp delivery (poll — delivery runs after status is set to completed)
    console.log("    Waiting for WhatsApp delivery step...");
    let whatsAppDelivered = false;
    let finalSteps = "";
    try {
      await poll(
        async () => {
          const t = await fetchJSON(`/api/tasks/${taskId}`);
          finalSteps = t.steps ?? "";
          if (t.steps?.match(/- \[x\].*whatsapp/i)) return true;
          return null;
        },
        { interval: 2000, timeout: 30_000, description: "WhatsApp step completion" },
      );
      whatsAppDelivered = true;
    } catch {
      // Timeout — check final state
      const t = await fetchJSON(`/api/tasks/${taskId}`);
      finalSteps = t.steps ?? "";
    }
    assertions.push({
      name: "WhatsApp step marked complete",
      pass: whatsAppDelivered,
      detail: finalSteps.substring(0, 200),
    });

    const allPassed = assertions.every((a) => a.pass);
    return {
      name: "Immediate Task",
      pass: allPassed,
      assertions,
      conversationId,
      taskId,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      name: "Immediate Task",
      pass: false,
      assertions,
      error,
      conversationId,
      taskId,
      durationMs: Date.now() - start,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test 2: Scheduled Task (API-created + WhatsApp Delivery)
// ═══════════════════════════════════════════════════════════════════════════════

export async function testScheduledTask(): Promise<TestResult> {
  const start = Date.now();
  const assertions: Assertion[] = [];
  let conversationId: string | undefined;
  let taskId: string | undefined;

  try {
    // 1. Create test conversation for result delivery
    const conv = await fetchJSON("/api/admin/conversations", {
      method: "POST",
      body: JSON.stringify({
        channel: "web",
        title: "E2E Scheduled Task Test",
      }),
    });
    conversationId = conv.id;
    assertions.push({
      name: "Conversation created",
      pass: true,
      detail: conv.id,
    });

    // 2. Create scheduled task with scheduledFor = now + 5s
    //    Scheduler polls every 30s, so max wait is ~35s
    const scheduledFor = new Date(Date.now() + 5_000).toISOString();
    console.log(`    Creating scheduled task (due at ${scheduledFor})...`);

    const taskResponse = await fetchJSON("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        type: "scheduled",
        sourceType: "manual",
        title: "Research Phuket family activities",
        instructions:
          "List the top 3 family-friendly activities in Phuket, Thailand for families with young children (ages 3-5). Keep it brief, 2-3 sentences per activity.",
        steps:
          "- [ ] Research family-friendly activities in Phuket\n- [ ] Send results via WhatsApp",
        scheduledFor,
        createdBy: "agent",
        conversationId,
      }),
    });
    taskId = taskResponse.id;

    assertions.push({
      name: "Scheduled task created",
      pass: !!taskId && taskResponse.type === "scheduled",
      detail: `${taskId}, scheduledFor=${scheduledFor}`,
    });

    // 3. Wait for task completion (scheduler picks up due tasks every 30s)
    console.log("    Waiting for scheduler to pick up task...");
    const completedTask = await poll(
      async () => {
        const t = await fetchJSON(`/api/tasks/${taskId}`);
        if (t.status === "completed" || t.status === "failed") return t;
        // Log current status periodically
        if (t.status === "running") {
          console.log("    Task is running...");
        }
        return null;
      },
      {
        interval: 5000,
        timeout: SCHEDULED_TASK_TIMEOUT,
        description: "Scheduled task completion",
      },
    );

    assertions.push({
      name: "Task completed successfully",
      pass: completedTask.status === "completed",
      detail: `status=${completedTask.status}`,
    });

    // 4. Verify WhatsApp delivery step completed (poll — delivery runs after status is set)
    // Check this FIRST because result delivery and notification happen AFTER step execution
    console.log("    Waiting for WhatsApp delivery step...");
    let whatsAppDelivered = false;
    let finalSteps = "";
    try {
      await poll(
        async () => {
          const t = await fetchJSON(`/api/tasks/${taskId}`);
          finalSteps = t.steps ?? "";
          if (t.steps?.match(/- \[x\].*whatsapp/i)) return true;
          return null;
        },
        { interval: 2000, timeout: 30_000, description: "WhatsApp step completion" },
      );
      whatsAppDelivered = true;
    } catch {
      const t = await fetchJSON(`/api/tasks/${taskId}`);
      finalSteps = t.steps ?? "";
    }
    assertions.push({
      name: "WhatsApp step marked complete",
      pass: whatsAppDelivered,
      detail: finalSteps.substring(0, 200),
    });

    // 5. Verify conversation has result turn (poll — delivery runs after step execution)
    let resultTurnDetail = "No result turn found";
    try {
      await poll(
        async () => {
          const cd = await fetchJSON(
            `/api/admin/conversations/${conversationId}`,
          );
          const rt = cd.turns?.find(
            (t: any) =>
              t.role === "assistant" && t.content?.includes("Task Completed"),
          );
          if (rt) {
            resultTurnDetail = `Turn ${rt.turnNumber}`;
            return true;
          }
          return null;
        },
        { interval: 2000, timeout: 30_000, description: "Result delivery" },
      );
      assertions.push({
        name: "Result delivered to conversation",
        pass: true,
        detail: resultTurnDetail,
      });
    } catch {
      assertions.push({
        name: "Result delivered to conversation",
        pass: false,
        detail: resultTurnDetail,
      });
    }

    // 6. Verify notification (poll — notification fires during deliverResult)
    let notificationDetail = "No notification for task";
    try {
      await poll(
        async () => {
          const notifs = await fetchJSON("/api/notifications");
          const tn = notifs.notifications?.find(
            (n: any) => n.taskId === taskId,
          );
          if (tn) {
            notificationDetail = `id=${tn.id}`;
            return true;
          }
          return null;
        },
        { interval: 2000, timeout: 15_000, description: "Notification creation" },
      );
      assertions.push({
        name: "Notification created",
        pass: true,
        detail: notificationDetail,
      });
    } catch {
      assertions.push({
        name: "Notification created",
        pass: false,
        detail: notificationDetail,
      });
    }

    const allPassed = assertions.every((a) => a.pass);
    return {
      name: "Scheduled Task",
      pass: allPassed,
      assertions,
      conversationId,
      taskId,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      name: "Scheduled Task",
      pass: false,
      assertions,
      error,
      conversationId,
      taskId,
      durationMs: Date.now() - start,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Cleanup
// ═══════════════════════════════════════════════════════════════════════════════

export async function cleanup(result: TestResult): Promise<void> {
  try {
    if (result.conversationId) {
      await fetch(
        `${BASE_URL}/api/admin/conversation/${result.conversationId}/delete`,
        { method: "POST" },
      );
    }
  } catch (err) {
    console.warn(
      `    Cleanup (conversation): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    if (result.taskId) {
      await fetch(`${BASE_URL}/api/tasks/${result.taskId}`, {
        method: "DELETE",
      });
    }
  } catch (err) {
    console.warn(
      `    Cleanup (task): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main (standalone execution)
// ═══════════════════════════════════════════════════════════════════════════════

export function printResult(result: TestResult): void {
  const icon = result.pass ? "\u2713" : "\u2717";
  console.log(
    `\n${icon} ${result.name} (${(result.durationMs / 1000).toFixed(1)}s)`,
  );

  for (const a of result.assertions) {
    const aIcon = a.pass ? "  \u2713" : "  \u2717";
    console.log(`${aIcon} ${a.name}${a.detail ? ` \u2014 ${a.detail}` : ""}`);
  }

  if (result.error) {
    console.log(`  ERROR: ${result.error}`);
  }
}

// Run directly with: npx tsx tests/e2e-task-whatsapp.ts
const isMain =
  process.argv[1]?.endsWith("e2e-task-whatsapp.ts") ||
  process.argv[1]?.endsWith("e2e-task-whatsapp.js");

if (isMain) {
  (async () => {
    console.log("\u2550".repeat(50));
    console.log("  E2E Task Flow Test");
    console.log("\u2550".repeat(50));

    // Pre-flight
    console.log("\nPre-flight checks:");
    const pf = await preflight();
    if (!pf.ok) {
      console.error("\nPre-flight FAILED:");
      for (const issue of pf.issues) {
        console.error(`  \u2717 ${issue}`);
      }
      process.exit(1);
    }
    console.log("  All checks passed\n");

    // Test 1: Immediate
    console.log("--- Test 1: Immediate Task (Ko Samui) ---");
    const r1 = await testImmediateTask();
    printResult(r1);
    await cleanup(r1);

    // Test 2: Scheduled
    console.log("\n--- Test 2: Scheduled Task (Phuket) ---");
    const r2 = await testScheduledTask();
    printResult(r2);
    await cleanup(r2);

    // Summary
    const allPass = r1.pass && r2.pass;
    console.log(`\n${"=".repeat(50)}`);
    console.log(`  ${allPass ? "ALL PASSED" : "SOME FAILED"}`);
    console.log(`${"=".repeat(50)}`);
    process.exit(allPass ? 0 : 1);
  })();
}
