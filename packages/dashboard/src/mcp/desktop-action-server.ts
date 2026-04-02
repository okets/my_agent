/**
 * Desktop Action MCP Server
 *
 * Direct desktop control tools for both Conversation Nina and Working Nina.
 * Follows the Playwright pattern: tools registered on the shared MCP pool,
 * Nina uses them turn by turn — no subagent, no intermediary.
 *
 * Each action tool executes via X11Backend, takes a screenshot, stores it
 * in VAS, and returns the image + URL for Nina to share with the user.
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { DesktopBackend } from "@my-agent/core";
import type { VisualActionService } from "../visual/visual-action-service.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

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

// ── Types ───────────────────────────────────────────────────────────────────

export interface DesktopActionServerDeps {
  backend: DesktopBackend;
  vas: VisualActionService;
  isEnabled?: () => boolean;
}

// ── Server Creator ──────────────────────────────────────────────────────────

export async function createDesktopActionServer(deps: DesktopActionServerDeps) {
  const { backend, vas } = deps;

  // Compute scale factor once at creation
  const display = await backend.displayInfo();
  const scaleFactor = computeScaleFactor(display.width, display.height);

  // Helper: take screenshot, store in VAS, return image + URL
  const captureAndReturn = async (description: string) => {
    const buffer = await backend.screenshot();
    const ss = vas.store(buffer, {
      description,
      width: display.width,
      height: display.height,
      source: "desktop",
    });
    const screenshotUrl = `/api/assets/screenshots/${ss.filename}`;
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ screenshotUrl }),
        },
        {
          type: "image" as const,
          data: buffer.toString("base64"),
          mimeType: "image/png",
        },
      ],
    };
  };

  const disabledResult = () => ({
    content: [
      {
        type: "text" as const,
        text: "Desktop control is disabled. Enable it in Settings > Desktop Control.",
      },
    ],
    isError: true as const,
  });

  const checkEnabled = () => deps.isEnabled && !deps.isEnabled();

  // ── Tools ───────────────────────────────────────────────────────────────

  const screenshotTool = tool(
    "desktop_screenshot",
    "Take a screenshot of the current desktop state. Use this first to see what's on screen before performing any action.",
    {
      region: z
        .object({
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number(),
        })
        .optional()
        .describe("Capture a specific region instead of the full screen"),
    },
    async ({ region }) => {
      if (checkEnabled()) return disabledResult();
      const buffer = await backend.screenshot(region ? { region } : undefined);
      const ss = vas.store(buffer, {
        description: "desktop_screenshot",
        width: display.width,
        height: display.height,
        source: "desktop",
      });
      const screenshotUrl = `/api/assets/screenshots/${ss.filename}`;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ screenshotUrl }),
          },
          {
            type: "image" as const,
            data: buffer.toString("base64"),
            mimeType: "image/png",
          },
        ],
      };
    },
  );

  const clickTool = tool(
    "desktop_click",
    "Click at pixel coordinates on the screen. Returns a screenshot after the click.",
    {
      x: z.number().describe("X coordinate in pixels"),
      y: z.number().describe("Y coordinate in pixels"),
      button: z
        .enum(["left", "right", "middle"])
        .optional()
        .describe("Mouse button (default: left)"),
      double: z.boolean().optional().describe("Double-click (default: false)"),
    },
    async ({ x, y, button, double: dbl }) => {
      if (checkEnabled()) return disabledResult();
      const screenX = toScreenCoord(x, scaleFactor);
      const screenY = toScreenCoord(y, scaleFactor);
      if (dbl) {
        await backend.doubleClick(screenX, screenY);
      } else {
        await backend.click(
          screenX,
          screenY,
          (button as "left" | "right" | "middle") ?? "left",
        );
      }
      return captureAndReturn(`After click (${x}, ${y})`);
    },
  );

  const typeTool = tool(
    "desktop_type",
    "Type text at the current cursor position. Returns a screenshot after typing.",
    {
      text: z.string().describe("Text to type"),
    },
    async ({ text }) => {
      if (checkEnabled()) return disabledResult();
      await backend.type(text);
      return captureAndReturn("After typing");
    },
  );

  const keyTool = tool(
    "desktop_key",
    "Press a key or key combination. Examples: 'Return', 'ctrl+c', 'alt+Tab', 'ctrl+shift+p'. Returns a screenshot after the keypress.",
    {
      key: z
        .string()
        .describe("Key or combo to press (e.g., 'Return', 'ctrl+c', 'alt+F4')"),
    },
    async ({ key }) => {
      if (checkEnabled()) return disabledResult();
      await backend.keyPress(key);
      return captureAndReturn(`After key press: ${key}`);
    },
  );

  const scrollTool = tool(
    "desktop_scroll",
    "Scroll at a position on the screen. Returns a screenshot after scrolling.",
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
      if (checkEnabled()) return disabledResult();
      await backend.scroll(
        toScreenCoord(x, scaleFactor),
        toScreenCoord(y, scaleFactor),
        direction,
        amount ?? 3,
      );
      return captureAndReturn(`After scroll ${direction}`);
    },
  );

  const waitTool = tool(
    "desktop_wait",
    "Wait for a specified number of seconds (for UI animations or loading). Returns a screenshot after waiting.",
    {
      seconds: z.number().min(0.1).max(10).describe("Seconds to wait (0.1–10)"),
    },
    async ({ seconds }) => {
      if (checkEnabled()) return disabledResult();
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      return captureAndReturn(`After wait ${seconds}s`);
    },
  );

  return createSdkMcpServer({
    name: "desktop-actions",
    tools: [screenshotTool, clickTool, typeTool, keyTool, scrollTool, waitTool],
  });
}
