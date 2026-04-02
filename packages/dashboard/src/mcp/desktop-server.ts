/**
 * Desktop Info MCP Server
 *
 * Exposes desktop_info tool for querying desktop state (windows, display, capabilities).
 * Action tools (click, type, screenshot, etc.) live in desktop-action-server.ts.
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { DesktopBackend } from "@my-agent/core";
import type { VisualActionService } from "../visual/visual-action-service.js";

export interface DesktopServerDeps {
  backend: DesktopBackend | null;
  visualService?: VisualActionService;
  rateLimiter?: { check(): { allowed: boolean; reason?: string } };
  auditLogger?: {
    log(entry: { tool: string; instruction?: string; timestamp: string }): void;
  };
  isEnabled?: () => boolean;
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// ── Exported handler (testable) ─────────────────────────────────────────────

export async function handleDesktopInfo(
  deps: DesktopServerDeps,
  args: { query: "windows" | "display" | "capabilities" },
): Promise<ToolResult> {
  if (!deps.backend) {
    if (args.query === "capabilities") {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              capabilities: null,
              platform: null,
              available: false,
              reason: "No desktop backend configured — no display detected.",
            }),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: "Desktop backend is not available. No display detected.",
        },
      ],
      isError: true,
    };
  }

  try {
    switch (args.query) {
      case "windows": {
        const windows = await deps.backend.listWindows();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ windows }),
            },
          ],
        };
      }

      case "display": {
        const displayInfo = await deps.backend.displayInfo();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ displayInfo }),
            },
          ],
        };
      }

      case "capabilities": {
        const capabilities = deps.backend.capabilities();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                capabilities,
                platform: deps.backend.platform,
              }),
            },
          ],
        };
      }
    }
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: `desktop_info failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        },
      ],
      isError: true,
    };
  }
}

// ── MCP server creator ───────────────────────────────────────────────────────

export function createDesktopServer(deps: DesktopServerDeps) {
  const desktopInfoTool = tool(
    "desktop_info",
    "Query desktop state: open windows, display configuration, or available capabilities. Use first to orient before interacting.",
    {
      query: z
        .enum(["windows", "display", "capabilities"])
        .describe(
          '"windows" — list open windows; "display" — monitor/resolution info; "capabilities" — what desktop tools are available',
        ),
    },
    (args) => handleDesktopInfo(deps, args),
  );

  return createSdkMcpServer({
    name: "desktop-tools",
    tools: [desktopInfoTool],
  });
}
