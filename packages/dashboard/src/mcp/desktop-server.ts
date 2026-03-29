/**
 * Desktop MCP Tools Server
 *
 * Exposes desktop_task, desktop_screenshot, and desktop_info tools for the
 * brain to interact with the desktop GUI during conversation.
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { DesktopBackend } from "@my-agent/core";
import type { ComputerUseService } from "../desktop/computer-use-service.js";
import type { VisualActionService } from "../visual/visual-action-service.js";

export function createDesktopServer(deps: {
  backend: DesktopBackend | null;
  computerUse: ComputerUseService | null;
  visualService?: VisualActionService;
  rateLimiter?: { check(): { allowed: boolean; reason?: string } };
  auditLogger?: { log(entry: { tool: string; instruction?: string; timestamp: string }): void };
  isEnabled?: () => boolean;
}) {
  const desktopTaskTool = tool(
    "desktop_task",
    "Delegate a multi-step GUI task to Claude computer use. Describe the goal, not individual clicks. Returns a summary of what was done.",
    {
      instruction: z
        .string()
        .describe("What to accomplish on the desktop — describe the goal, not individual steps"),
      context: z
        .object({
          type: z.enum(["job", "conversation"]),
          id: z.string(),
          automationId: z.string().optional(),
        })
        .describe("Asset context for screenshot storage"),
      model: z.string().optional().describe("Model override (default: claude-sonnet-4-6)"),
      maxActions: z.number().optional().describe("Maximum number of actions before stopping (default: 50)"),
      timeoutMs: z.number().optional().describe("Timeout in milliseconds (default: 120000)"),
    },
    async (args) => {
      // Check if desktop control is enabled
      if (deps.isEnabled && !deps.isEnabled()) {
        return {
          content: [{ type: "text" as const, text: "Desktop control is disabled. Enable it in Settings > Desktop Control." }],
          isError: true,
        };
      }
      // Safety: rate limit check
      if (deps.rateLimiter) {
        const check = deps.rateLimiter.check();
        if (!check.allowed) {
          return {
            content: [{ type: "text" as const, text: check.reason ?? "Rate limit exceeded" }],
            isError: true,
          };
        }
      }
      // Safety: audit log
      if (deps.auditLogger) {
        deps.auditLogger.log({ tool: "desktop_task", instruction: args.instruction, timestamp: new Date().toISOString() });
      }

      if (!deps.computerUse) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Desktop computer use is not available. No ComputerUseService was configured.",
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await deps.computerUse.run({
          instruction: args.instruction,
          context: args.context,
          model: args.model,
          maxActions: args.maxActions,
          timeoutMs: args.timeoutMs,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: result.success,
                summary: result.summary,
                actionsPerformed: result.actionsPerformed,
                screenshots: result.screenshots.length,
                error: result.error,
              }),
            },
          ],
          isError: !result.success,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Desktop task failed: ${err instanceof Error ? err.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  const desktopScreenshotTool = tool(
    "desktop_screenshot",
    "Take a screenshot of the current desktop state. Use to visually inspect the screen without performing any action.",
    {
      context: z
        .object({
          type: z.enum(["job", "conversation"]),
          id: z.string(),
          automationId: z.string().optional(),
        })
        .optional()
        .describe("Asset context for screenshot storage (optional)"),
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
    async (args) => {
      if (deps.isEnabled && !deps.isEnabled()) {
        return {
          content: [{ type: "text" as const, text: "Desktop control is disabled. Enable it in Settings > Desktop Control." }],
          isError: true,
        };
      }
      if (!deps.backend) {
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
        const buffer = await deps.backend.screenshot(
          args.region ? { region: args.region } : undefined,
        );

        // Store via VisualActionService if provided and context is given
        if (deps.visualService && args.context) {
          const display = await deps.backend.displayInfo();
          deps.visualService.store(
            buffer,
            {
              context: args.context,
              description: "desktop_screenshot tool",
              width: display.width,
              height: display.height,
            },
            "keep",
          );
        }

        const base64 = buffer.toString("base64");

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
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Screenshot failed: ${err instanceof Error ? err.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

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
    async (args) => {
      if (!deps.backend) {
        if (args.query === "capabilities") {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  capabilities: null,
                  platform: null,
                  computerUseAvailable: false,
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
                    computerUseAvailable: deps.computerUse !== null,
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
    },
  );

  return createSdkMcpServer({
    name: "desktop-tools",
    tools: [desktopTaskTool, desktopScreenshotTool, desktopInfoTool],
  });
}
