import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Screenshot } from "@my-agent/core";
import type { VisualActionService } from "../visual/visual-action-service.js";

interface StoreOptions {
  description?: string;
  width?: number;
  height?: number;
}

export class PlaywrightScreenshotBridge {
  private browserInstance: import("playwright").Browser | null = null;
  private browserLaunchPromise: Promise<import("playwright").Browser> | null =
    null;

  constructor(private readonly vas: VisualActionService) {}

  /**
   * Get or launch a shared browser instance. Concurrent calls share the same launch promise.
   */
  private async getBrowser(): Promise<import("playwright").Browser> {
    if (this.browserInstance?.isConnected()) {
      return this.browserInstance;
    }

    if (!this.browserLaunchPromise) {
      this.browserLaunchPromise = (async () => {
        const { chromium } = await import("playwright");
        const browser = await chromium.launch({ headless: true });
        browser.on("disconnected", () => {
          this.browserInstance = null;
          this.browserLaunchPromise = null;
        });
        this.browserInstance = browser;
        this.browserLaunchPromise = null;
        return browser;
      })();
    }

    return this.browserLaunchPromise;
  }

  /**
   * Close the shared browser instance. Call on shutdown.
   */
  async closeBrowser(): Promise<void> {
    if (this.browserInstance?.isConnected()) {
      await this.browserInstance.close();
    }
    this.browserInstance = null;
    this.browserLaunchPromise = null;
  }

  /**
   * Store a base64-encoded screenshot via VisualActionService.
   */
  storeFromBase64(base64Data: string, options: StoreOptions): Screenshot {
    const image = Buffer.from(base64Data, "base64");
    return this.vas.store(image, {
      description: options.description ?? "Playwright browser screenshot",
      width: options.width ?? 1280,
      height: options.height ?? 720,
      source: "playwright",
    });
  }

  /**
   * Create an MCP server with a browser_screenshot_and_store tool.
   */
  createMcpServer() {
    const bridge = this;

    const screenshotAndStoreTool = tool(
      "browser_screenshot_and_store",
      "Take a browser screenshot and store it in the visual audit trail. " +
        "Use this instead of browser_take_screenshot when you want the screenshot " +
        "to appear in the dashboard timeline. The screenshot is stored, served, " +
        "and returned to you for analysis.",
      {
        url: z
          .string()
          .optional()
          .describe("URL to navigate to before screenshotting (optional)"),
        description: z
          .string()
          .optional()
          .describe("Description of what this screenshot captures"),
        fullPage: z
          .boolean()
          .optional()
          .describe("Capture full scrollable page (default: viewport only)"),
      },
      async (args) => {
        try {
          const browser = await bridge.getBrowser();
          const page = await browser.newPage();

          try {
            if (args.url) {
              await page.goto(args.url, { waitUntil: "networkidle" });
            }

            const screenshotBuffer = await page.screenshot({
              fullPage: args.fullPage ?? false,
              type: "png",
            });

            const viewport = page.viewportSize() ?? {
              width: 1280,
              height: 720,
            };

            const base64 = screenshotBuffer.toString("base64");
            bridge.storeFromBase64(base64, {
              description:
                args.description ?? `Playwright: ${args.url ?? "current page"}`,
              width: viewport.width,
              height: viewport.height,
            });

            return {
              content: [
                {
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "image/png",
                    data: base64,
                  },
                },
              ],
            };
          } finally {
            await page.close();
          }
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Screenshot failed: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    return createSdkMcpServer({
      name: "playwright-screenshot",
      tools: [screenshotAndStoreTool],
    });
  }
}
