/**
 * E2E Test Utilities
 *
 * Shared utilities for E2E tests using internal APIs.
 */

import { WebSocket } from "ws";

export interface TestResult {
  pass: boolean;
  conversationId?: string;
  taskId?: string;
  error?: string;
}

/**
 * Wait for WebSocket to open
 */
export function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    ws.on("open", () => resolve());
    ws.on("error", (err: Error) => reject(err));
    setTimeout(() => reject(new Error("WebSocket connection timeout")), 10000);
  });
}

/**
 * Wait for a specific message type from WebSocket
 */
export function waitForMessage(
  ws: WebSocket,
  type: string,
  timeoutMs: number = 30000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for message type: ${type}`));
    }, timeoutMs);

    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === type) {
          clearTimeout(timeout);
          ws.off("message", handler);
          resolve(msg);
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    ws.on("message", handler);
  });
}

/**
 * Poll until condition is met or timeout
 */
export async function pollUntil<T>(
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs: number,
  description: string,
): Promise<T> {
  const start = Date.now();
  const pollInterval = 1000; // 1 second

  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result) {
      return result;
    }
    await sleep(pollInterval);
  }

  throw new Error(`Timeout: ${description}`);
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simple assertion
 */
export function assert(condition: any, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

/**
 * Create a test conversation
 */
export async function createConversation(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    throw new Error(`Failed to create conversation: ${res.status}`);
  }

  const data = await res.json();
  return data.id;
}

/**
 * Get conversation details
 */
export async function getConversation(
  baseUrl: string,
  conversationId: string,
): Promise<any> {
  const res = await fetch(`${baseUrl}/api/conversations/${conversationId}`);
  if (!res.ok) {
    throw new Error(`Failed to get conversation: ${res.status}`);
  }
  return res.json();
}

/**
 * List tasks with optional filters
 */
export async function listTasks(
  baseUrl: string,
  filters?: Record<string, string>,
): Promise<any[]> {
  const params = new URLSearchParams(filters);
  const url = filters
    ? `${baseUrl}/api/tasks?${params}`
    : `${baseUrl}/api/tasks`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to list tasks: ${res.status}`);
  }

  const data = await res.json();
  return data.tasks;
}

/**
 * Get task by ID
 */
export async function getTask(baseUrl: string, taskId: string): Promise<any> {
  const res = await fetch(`${baseUrl}/api/tasks/${taskId}`);
  if (!res.ok) {
    throw new Error(`Failed to get task: ${res.status}`);
  }
  return res.json();
}
