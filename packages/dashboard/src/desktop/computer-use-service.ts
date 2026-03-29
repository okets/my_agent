/**
 * ComputerUseService — Claude beta API bridge for native computer use.
 *
 * Wraps the Claude `computer_20251124` tool via `client.beta.messages.create()`.
 * Runs a screenshot → action → screenshot loop, executing actions via a
 * DesktopBackend and storing screenshots via VisualActionService.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { DesktopBackend, AssetContext, ScreenshotTag } from "@my-agent/core";
import { VisualActionService } from "../visual/visual-action-service.js";
import { computeDiffRatio, DIFF_THRESHOLD } from "../visual/screenshot-tagger.js";

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface ComputerUseTask {
  instruction: string;
  context: AssetContext;
  model?: string;
  maxActions?: number;
  timeoutMs?: number;
}

export interface ComputerUseResult {
  success: boolean;
  summary: string;
  screenshots: Array<{ id: string; filename: string; path: string; tag: ScreenshotTag }>;
  actionsPerformed: number;
  error?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_ACTIONS = 50;
const DEFAULT_TIMEOUT_MS = 120_000;

const SYSTEM_PROMPT = `You are controlling a desktop computer to complete the user's task. After each action, you will receive a screenshot. For each tool_use response, you may include a "screenshot_tag" field: "keep" if the screenshot represents meaningful progress (new page loaded, target found, task milestone), or "skip" if it is an intermediate step (clicked menu, scrolled, waited for load).`;

const BETA_HEADER = "computer-use-2025-11-24";

// ── Service ───────────────────────────────────────────────────────────────────

export class ComputerUseService {
  private running = false;

  constructor(
    private readonly client: Anthropic,
    private readonly backend: DesktopBackend,
    private readonly vas: VisualActionService,
  ) {}

  // ── Static helpers ────────────────────────────────────────────────────────

  /**
   * Compute the scale factor to fit a screenshot within the API's constraints:
   * max 1568px long edge, max ~1.15 megapixels.
   */
  static computeScaleFactor(width: number, height: number): number {
    const longEdge = Math.max(width, height);
    const edgeFactor = longEdge > 1568 ? 1568 / longEdge : 1;
    const pixels = width * height;
    const mpFactor = pixels > 1_150_000 ? Math.sqrt(1_150_000 / pixels) : 1;
    return Math.min(1, edgeFactor, mpFactor);
  }

  /**
   * Scale an API coordinate back to screen coordinates.
   */
  static toScreenCoord(apiCoord: number, scaleFactor: number): number {
    return Math.round(apiCoord / scaleFactor);
  }

  // ── Main loop ─────────────────────────────────────────────────────────────

  async run(task: ComputerUseTask): Promise<ComputerUseResult> {
    if (this.running) {
      return {
        success: false,
        summary: "",
        screenshots: [],
        actionsPerformed: 0,
        error: "A desktop task is already running. Only one task may execute at a time.",
      };
    }

    const maxActions = task.maxActions ?? DEFAULT_MAX_ACTIONS;
    const timeoutMs = task.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
    const deadline = Date.now() + timeoutMs;
    const screenshots: ComputerUseResult["screenshots"] = [];
    let actionsPerformed = 0;
    let previousBuffer: Buffer | null = null;

    try {
      // 1. Get display info and compute scale factor
      const display = await this.backend.displayInfo();
      const scaleFactor = ComputerUseService.computeScaleFactor(display.width, display.height);
      const scaledWidth = Math.round(display.width * scaleFactor);
      const scaledHeight = Math.round(display.height * scaleFactor);

      // 2. Take initial screenshot, store as "keep"
      const initialBuffer = await this.backend.screenshot();
      const initialSS = this.vas.store(initialBuffer, {
        context: task.context,
        description: "Initial screenshot",
        width: display.width,
        height: display.height,
      }, "keep");
      screenshots.push({ id: initialSS.id, filename: initialSS.filename, path: initialSS.path, tag: "keep" });
      previousBuffer = initialBuffer;

      // 3. Build initial messages
      const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: task.instruction,
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: initialBuffer.toString("base64"),
              },
            },
          ],
        },
      ];

      // 4. Loop: send to API, process tool_use blocks
      while (actionsPerformed < maxActions && Date.now() < deadline) {
        const response = await this.client.beta.messages.create({
          model,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages,
          tools: [
            {
              type: "computer_20251124",
              name: "computer",
              display_width_px: scaledWidth,
              display_height_px: scaledHeight,
            },
          ],
          betas: [BETA_HEADER],
        });

        // Collect text blocks for summary
        const textBlocks = response.content.filter(
          (b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text",
        );

        // Find tool_use blocks
        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use",
        );

        // If no tool_use blocks, task is complete
        if (toolUseBlocks.length === 0) {
          // Take final screenshot
          const finalBuffer = await this.backend.screenshot();
          const finalSS = this.vas.store(finalBuffer, {
            context: task.context,
            description: "Final screenshot",
            width: display.width,
            height: display.height,
          }, "keep");
          screenshots.push({ id: finalSS.id, filename: finalSS.filename, path: finalSS.path, tag: "keep" });

          const summary = textBlocks.map((b) => b.text).join("\n") || "Task completed.";
          return { success: true, summary, screenshots, actionsPerformed };
        }

        // Add the assistant's response to messages
        messages.push({ role: "assistant", content: response.content as Anthropic.Beta.Messages.BetaContentBlock[] });

        // Process each tool_use and build tool_result content
        const toolResults: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          const input = toolUse.input as Record<string, unknown>;

          // Execute the action
          await this.executeAction(input, scaleFactor);
          actionsPerformed++;

          // Take screenshot after action
          const buffer = await this.backend.screenshot();

          // Determine tag: agent tag first, pixel diff fallback
          let tag: ScreenshotTag;
          const agentTag = input.screenshot_tag as string | undefined;
          if (agentTag === "keep" || agentTag === "skip") {
            tag = agentTag;
          } else {
            const ratio = computeDiffRatio(buffer, previousBuffer ?? buffer);
            tag = previousBuffer === null || ratio >= DIFF_THRESHOLD ? "keep" : "skip";
          }

          // Store screenshot
          const ss = this.vas.store(buffer, {
            context: task.context,
            description: `After action: ${input.action}`,
            width: display.width,
            height: display.height,
          }, tag);
          screenshots.push({ id: ss.id, filename: ss.filename, path: ss.path, tag });
          previousBuffer = buffer;

          // Build tool_result with screenshot
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: buffer.toString("base64"),
                },
              },
            ],
          });

          // Check limits after each action
          if (actionsPerformed >= maxActions || Date.now() >= deadline) {
            break;
          }
        }

        // Add tool results to messages
        messages.push({ role: "user", content: toolResults });
      }

      // Reached action or time limit
      const limitReason = actionsPerformed >= maxActions ? "action limit" : "timeout";
      return {
        success: false,
        summary: "",
        screenshots,
        actionsPerformed,
        error: `Task stopped: ${limitReason} reached (${actionsPerformed} actions).`,
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

  // ── Action execution ──────────────────────────────────────────────────────

  private async executeAction(input: Record<string, unknown>, scaleFactor: number): Promise<void> {
    const action = input.action as string;
    const coordinate = input.coordinate as [number, number] | undefined;

    switch (action) {
      case "left_click": {
        const [x, y] = coordinate!;
        await this.backend.click(
          ComputerUseService.toScreenCoord(x, scaleFactor),
          ComputerUseService.toScreenCoord(y, scaleFactor),
          "left",
        );
        break;
      }
      case "right_click": {
        const [x, y] = coordinate!;
        await this.backend.click(
          ComputerUseService.toScreenCoord(x, scaleFactor),
          ComputerUseService.toScreenCoord(y, scaleFactor),
          "right",
        );
        break;
      }
      case "middle_click": {
        const [x, y] = coordinate!;
        await this.backend.click(
          ComputerUseService.toScreenCoord(x, scaleFactor),
          ComputerUseService.toScreenCoord(y, scaleFactor),
          "middle",
        );
        break;
      }
      case "double_click": {
        const [x, y] = coordinate!;
        await this.backend.doubleClick(
          ComputerUseService.toScreenCoord(x, scaleFactor),
          ComputerUseService.toScreenCoord(y, scaleFactor),
        );
        break;
      }
      case "type": {
        await this.backend.type(input.text as string);
        break;
      }
      case "key": {
        await this.backend.keyPress(input.text as string);
        break;
      }
      case "mouse_move": {
        const [x, y] = coordinate!;
        await this.backend.mouseMove(
          ComputerUseService.toScreenCoord(x, scaleFactor),
          ComputerUseService.toScreenCoord(y, scaleFactor),
        );
        break;
      }
      case "left_click_drag":
      case "drag": {
        const startCoord = input.start_coordinate as [number, number] | undefined ?? coordinate!;
        const endCoord = input.coordinate as [number, number] | undefined
          ?? input.end_coordinate as [number, number];
        await this.backend.mouseDrag(
          ComputerUseService.toScreenCoord(startCoord[0], scaleFactor),
          ComputerUseService.toScreenCoord(startCoord[1], scaleFactor),
          ComputerUseService.toScreenCoord(endCoord[0], scaleFactor),
          ComputerUseService.toScreenCoord(endCoord[1], scaleFactor),
        );
        break;
      }
      case "scroll": {
        const [x, y] = coordinate!;
        const direction = (input.direction as string) ?? "down";
        const amount = (input.amount as number) ?? 3;
        await this.backend.scroll(
          ComputerUseService.toScreenCoord(x, scaleFactor),
          ComputerUseService.toScreenCoord(y, scaleFactor),
          direction as "up" | "down" | "left" | "right",
          amount,
        );
        break;
      }
      case "screenshot": {
        // No-op: screenshot is taken after every action anyway
        break;
      }
      case "wait": {
        const duration = ((input.duration as number) ?? 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, duration));
        break;
      }
      default:
        throw new Error(`Unknown computer use action: ${action}`);
    }
  }
}
