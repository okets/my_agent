/**
 * AgentComputerUseService — Agent SDK bridge for desktop computer use.
 *
 * Replaces the raw Anthropic API ComputerUseService. Uses Agent SDK query()
 * with custom MCP tools so it works with OAuth (Max subscription).
 *
 * The loop: screenshot → Claude decides action → MCP tool executes via
 * X11Backend → returns screenshot → repeat until Claude is done.
 */

import {
  query,
  tool,
  createSdkMcpServer,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { appendFile } from "fs/promises";
import { join } from "path";
import type { DesktopBackend } from "@my-agent/core";
import { VisualActionService } from "../visual/visual-action-service.js";
import type {
  ComputerUseTask,
  ComputerUseResult,
} from "./computer-use-service.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_ACTIONS = 50;
const DEFAULT_TIMEOUT_MS = 120_000;

const SYSTEM_PROMPT = `You are controlling a Linux desktop to complete the user's task.

After each action, you receive a screenshot showing the current state.
Use the screenshot to decide your next action.

Available tools:
- screenshot: See the current screen state
- click(x, y): Click at pixel coordinates. Use button="right" for context menus, double=true for double-click.
- type_text(text): Type text at the current cursor position
- key_press(key): Press a key or combo (e.g., "ctrl+c", "Return", "alt+Tab")
- scroll(x, y, direction, amount): Scroll at a position
- wait(seconds): Wait for animations or loading

Guidelines:
- ALWAYS start by taking a screenshot to see the current state
- Use coordinates from the most recent screenshot
- After clicking, the tool automatically returns a new screenshot
- When the task is complete, describe what you accomplished`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute the scale factor to fit a screenshot within the API's constraints:
 * max 1568px long edge, max ~1.15 megapixels.
 */
function computeScaleFactor(width: number, height: number): number {
  const longEdge = Math.max(width, height);
  const edgeFactor = longEdge > 1568 ? 1568 / longEdge : 1;
  const pixels = width * height;
  const mpFactor = pixels > 1_150_000 ? Math.sqrt(1_150_000 / pixels) : 1;
  return Math.min(1, edgeFactor, mpFactor);
}

function toScreenCoord(apiCoord: number, scaleFactor: number): number {
  return Math.round(apiCoord / scaleFactor);
}

// ── Service ───────────────────────────────────────────────────────────────────

export class AgentComputerUseService {
  private running = false;

  constructor(
    private readonly backend: DesktopBackend,
    private readonly vas: VisualActionService,
  ) {}

  async run(task: ComputerUseTask): Promise<ComputerUseResult> {
    if (this.running) {
      return {
        success: false,
        summary: "",
        screenshots: [],
        actionsPerformed: 0,
        error:
          "A desktop task is already running. Only one task may execute at a time.",
      };
    }

    const maxActions = task.maxActions ?? DEFAULT_MAX_ACTIONS;
    const model = task.model ?? DEFAULT_MODEL;

    if (maxActions <= 0) {
      return {
        success: false,
        summary: "",
        screenshots: [],
        actionsPerformed: 0,
        error: "maxActions must be greater than 0.",
      };
    }

    this.running = true;
    const screenshots: ComputerUseResult["screenshots"] = [];
    let actionsPerformed = 0;

    try {
      // Get display info for coordinate scaling
      const display = await this.backend.displayInfo();
      const scaleFactor = computeScaleFactor(display.width, display.height);

      // Helper: take screenshot, store in VAS, track in results
      const takeScreenshot = async (
        description: string,
      ): Promise<{ buffer: Buffer; base64: string }> => {
        const buffer = await this.backend.screenshot();
        const ss = this.vas.store(buffer, {
          description,
          width: display.width,
          height: display.height,
          source: "desktop",
        });
        screenshots.push({ id: ss.id, filename: ss.filename, path: ss.path });
        return { buffer, base64: buffer.toString("base64") };
      };

      // Helper: log action to audit JSONL
      const logAction = async (action: string, params: unknown) => {
        if (task.logDir) {
          const entry = {
            action,
            params,
            timestamp: new Date().toISOString(),
          };
          const logPath = join(task.logDir, "desktop-actions.jsonl");
          await appendFile(logPath, JSON.stringify(entry) + "\n", "utf-8");
        }
      };

      // ── Build MCP tools ──────────────────────────────────────────────

      const screenshotTool = tool(
        "screenshot",
        "Take a screenshot of the current desktop state",
        {},
        async () => {
          const { base64 } = await takeScreenshot("Agent screenshot");
          return {
            content: [
              {
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: "image/png" as const,
                  data: base64,
                },
              },
            ],
          };
        },
      );

      const clickTool = tool(
        "click",
        "Click at pixel coordinates on the screen",
        {
          x: z.number().describe("X coordinate in pixels"),
          y: z.number().describe("Y coordinate in pixels"),
          button: z
            .enum(["left", "right", "middle"])
            .optional()
            .describe("Mouse button (default: left)"),
          double: z
            .boolean()
            .optional()
            .describe("Double-click (default: false)"),
        },
        async ({ x, y, button, double: dbl }) => {
          const screenX = toScreenCoord(x, scaleFactor);
          const screenY = toScreenCoord(y, scaleFactor);
          if (dbl) {
            await this.backend.doubleClick(screenX, screenY);
          } else {
            await this.backend.click(
              screenX,
              screenY,
              (button as "left" | "right" | "middle") ?? "left",
            );
          }
          actionsPerformed++;
          await logAction("click", { x, y, button, double: dbl });
          const { base64 } = await takeScreenshot(`After click (${x}, ${y})`);
          return {
            content: [
              {
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: "image/png" as const,
                  data: base64,
                },
              },
            ],
          };
        },
      );

      const typeTextTool = tool(
        "type_text",
        "Type text at the current cursor position",
        {
          text: z.string().describe("Text to type"),
        },
        async ({ text }) => {
          await this.backend.type(text);
          actionsPerformed++;
          await logAction("type_text", { text });
          const { base64 } = await takeScreenshot(`After typing`);
          return {
            content: [
              {
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: "image/png" as const,
                  data: base64,
                },
              },
            ],
          };
        },
      );

      const keyPressTool = tool(
        "key_press",
        "Press a key or key combination (e.g., 'ctrl+s', 'Return', 'alt+Tab')",
        {
          key: z
            .string()
            .describe(
              "Key or combo to press (e.g., 'Return', 'ctrl+c', 'alt+F4')",
            ),
        },
        async ({ key }) => {
          await this.backend.keyPress(key);
          actionsPerformed++;
          await logAction("key_press", { key });
          const { base64 } = await takeScreenshot(`After key press: ${key}`);
          return {
            content: [
              {
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: "image/png" as const,
                  data: base64,
                },
              },
            ],
          };
        },
      );

      const scrollTool = tool(
        "scroll",
        "Scroll at a position on the screen",
        {
          x: z.number().describe("X coordinate"),
          y: z.number().describe("Y coordinate"),
          direction: z
            .enum(["up", "down", "left", "right"])
            .describe("Scroll direction"),
          amount: z
            .number()
            .optional()
            .describe("Scroll amount in clicks (default: 3)"),
        },
        async ({ x, y, direction, amount }) => {
          await this.backend.scroll(
            toScreenCoord(x, scaleFactor),
            toScreenCoord(y, scaleFactor),
            direction,
            amount ?? 3,
          );
          actionsPerformed++;
          await logAction("scroll", { x, y, direction, amount });
          const { base64 } = await takeScreenshot(`After scroll ${direction}`);
          return {
            content: [
              {
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: "image/png" as const,
                  data: base64,
                },
              },
            ],
          };
        },
      );

      const waitTool = tool(
        "wait",
        "Wait for a specified number of seconds (for UI animations or loading)",
        {
          seconds: z
            .number()
            .min(0.1)
            .max(10)
            .describe("Seconds to wait (0.1–10)"),
        },
        async ({ seconds }) => {
          await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
          await logAction("wait", { seconds });
          const { base64 } = await takeScreenshot(`After wait ${seconds}s`);
          return {
            content: [
              {
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: "image/png" as const,
                  data: base64,
                },
              },
            ],
          };
        },
      );

      const desktopMcp = createSdkMcpServer({
        name: "desktop-actions",
        tools: [
          screenshotTool,
          clickTool,
          typeTextTool,
          keyPressTool,
          scrollTool,
          waitTool,
        ],
      });

      // ── Run Agent SDK session ────────────────────────────────────────

      let resultText = "";

      const q = query({
        prompt: task.instruction,
        options: {
          model,
          systemPrompt: SYSTEM_PROMPT,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          maxTurns: maxActions,
          mcpServers: { "desktop-actions": desktopMcp },
          thinking: { type: "disabled" },
        },
      });

      const timeout = task.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const deadline = Date.now() + timeout;

      for await (const msg of q) {
        if (msg.type === "result") {
          if ("result" in msg && typeof msg.result === "string") {
            resultText = msg.result;
          }
          break;
        }
        // Check timeout
        if (Date.now() >= deadline) {
          resultText = `Task stopped: timeout reached (${actionsPerformed} actions performed).`;
          break;
        }
      }

      return {
        success: screenshots.length > 0 || resultText.length > 0,
        summary: resultText || "Task completed.",
        screenshots,
        actionsPerformed,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        summary: "",
        screenshots,
        actionsPerformed,
        error: `Task failed: ${message}`,
      };
    } finally {
      this.running = false;
    }
  }
}
