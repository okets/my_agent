/**
 * Chart MCP Tool Server
 *
 * Exposes a `create_chart` tool that accepts SVG markup,
 * converts to PNG via sharp, and stores via VisualActionService.
 * No network access — no security surface.
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import sharp from "sharp";
import type { VisualActionService } from "../visual/visual-action-service.js";

export interface ChartServerDeps {
  visualService: VisualActionService;
}

// ── SVG helpers ──────────────────────────────────────────────────────────────

function ensureSvgDimensions(svg: string): string {
  // If width and height are present, return as-is
  if (/\bwidth\s*=/.test(svg) && /\bheight\s*=/.test(svg)) {
    return svg;
  }

  // Try to infer from viewBox
  const viewBoxMatch = svg.match(/viewBox\s*=\s*["']([^"']+)["']/);
  if (!viewBoxMatch) {
    throw new Error(
      "SVG has no width/height and no viewBox to infer dimensions from",
    );
  }

  const parts = viewBoxMatch[1].trim().split(/[\s,]+/);
  if (parts.length < 4) {
    throw new Error("Invalid viewBox format");
  }

  const vbWidth = parts[2];
  const vbHeight = parts[3];

  // Insert width and height into the <svg tag
  return svg.replace("<svg", `<svg width="${vbWidth}" height="${vbHeight}"`);
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handleCreateChart(
  deps: ChartServerDeps,
  args: {
    svg: string;
    description?: string;
  },
) {
  try {
    if (!args.svg.trimStart().startsWith("<svg")) {
      throw new Error("SVG input must start with <svg");
    }

    // Sanitize SVG: fix common LLM mistakes (unescaped &, degree symbols, etc.)
    const sanitized = args.svg
      .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/g, "&amp;")
      .replace(/°/g, "&#176;");
    const svgWithDims = ensureSvgDimensions(sanitized);
    const sharpResult = sharp(Buffer.from(svgWithDims));
    const pngBuffer = await sharpResult.png().toBuffer();
    const meta = await sharp(pngBuffer).metadata();
    const width = meta.width!;
    const height = meta.height!;

    // Store via visual service
    const screenshot = deps.visualService.store(pngBuffer, {
      description: args.description,
      width,
      height,
      source: "generated",
    });

    const url = deps.visualService.url(screenshot);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ id: screenshot.id, url, width, height }),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Chart creation failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}

// ── MCP Server ───────────────────────────────────────────────────────────────

export function createChartServer(deps: ChartServerDeps) {
  const createChartTool = tool(
    "create_chart",
    "Generate a chart or visual from SVG markup. Converts SVG to PNG and stores it. Returns { id, url, width, height }. IMPORTANT: After calling this tool, you MUST include the returned url in your response text as ![description](url) — otherwise the user will not see the image. Use this for data visualization: line charts, bar charts, gauges, diagrams.",
    {
      svg: z
        .string()
        .describe(
          "SVG markup string (must start with <svg). Use xmlns, explicit width/height, inline styles, sans-serif font, Tokyo Night colors.",
        ),
      // description is required in the Zod schema so every chart has meaningful alt text.
      description: z
        .string()
        .describe("What this chart shows — used for alt text and ![description](url)"),
    },
    async (args) => handleCreateChart(deps, args),
  );

  return createSdkMcpServer({
    name: "chart-tools",
    tools: [createChartTool],
  });
}
