/**
 * Image MCP Tool Server
 *
 * Exposes a `store_image` tool that accepts SVG, base64 data, or URL input,
 * converts to PNG via sharp, and stores via VisualActionService.
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import sharp from "sharp";
import type { VisualActionService } from "../visual/visual-action-service.js";
import type { ScreenshotSource } from "@my-agent/core";

export interface ImageServerDeps {
  visualService: VisualActionService;
}

// ── Magic byte validators ────────────────────────────────────────────────────

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const GIF_MAGIC = [0x47, 0x49, 0x46, 0x38];

function hasValidMagicBytes(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  const matchesPng = PNG_MAGIC.every((b, i) => buf[i] === b);
  const matchesJpeg = JPEG_MAGIC.every((b, i) => buf[i] === b);
  const matchesGif = GIF_MAGIC.every((b, i) => buf[i] === b);
  return matchesPng || matchesJpeg || matchesGif;
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

// ── URL fetcher ──────────────────────────────────────────────────────────────

const MAX_IMAGE_BYTES = 50 * 1024 * 1024; // 50 MB response size limit

// Private/internal IP ranges that should not be fetched (SSRF protection)
function isPrivateHost(hostname: string): boolean {
  // Block loopback, link-local, private ranges, and metadata endpoints
  return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.|localhost|::1|\[::1\]|metadata\.google|169\.254\.169\.254)/.test(hostname);
}

async function fetchImage(
  url: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const parsedUrl = new URL(url);

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(
      `Invalid URL scheme: ${parsedUrl.protocol} (only http/https allowed)`,
    );
  }

  if (isPrivateHost(parsedUrl.hostname)) {
    throw new Error("Cannot fetch from private/internal network addresses");
  }

  return new Promise((resolve, reject) => {
    const makeRequest = async (reqUrl: string, redirectCount: number) => {
      const parsed = new URL(reqUrl);

      if (isPrivateHost(parsed.hostname)) {
        reject(new Error("Redirect to private/internal network address blocked"));
        return;
      }

      // Select http module based on current URL protocol (handles protocol changes on redirect)
      const httpMod = parsed.protocol === "https:"
        ? await import("node:https")
        : await import("node:http");

      httpMod.get(reqUrl, (res) => {
        // Follow one redirect
        if (
          (res.statusCode === 301 ||
            res.statusCode === 302 ||
            res.statusCode === 307 ||
            res.statusCode === 308) &&
          res.headers.location &&
          redirectCount < 1
        ) {
          const redirectUrl = new URL(res.headers.location, parsed.origin).href;
          res.resume(); // Drain response
          makeRequest(redirectUrl, redirectCount + 1);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} fetching image`));
          return;
        }

        const contentType = res.headers["content-type"] ?? "";
        if (!contentType.startsWith("image/")) {
          res.resume();
          reject(
            new Error(
              `Expected image Content-Type, got: ${contentType}`,
            ),
          );
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        res.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_IMAGE_BYTES) {
            res.destroy();
            reject(new Error(`Image exceeds ${MAX_IMAGE_BYTES / 1024 / 1024} MB size limit`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({ buffer: Buffer.concat(chunks), contentType }),
        );
        res.on("error", reject);
      }).on("error", reject);
    };

    makeRequest(url, 0);
  });
}

// ── Handler (exported for testing) ───────────────────────────────────────────

export async function handleStoreImage(
  deps: ImageServerDeps,
  args: {
    svg?: string;
    data?: string;
    url?: string;
    description?: string;
    returnImage?: boolean;
  },
) {
  const modeCount = [args.svg, args.data, args.url].filter(
    (v) => v !== undefined && v !== "",
  ).length;

  if (modeCount === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Exactly one of svg, data, or url must be provided",
        },
      ],
      isError: true,
    };
  }

  if (modeCount > 1) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Exactly one of svg, data, or url must be provided (got multiple)",
        },
      ],
      isError: true,
    };
  }

  let pngBuffer: Buffer;
  let width: number;
  let height: number;
  let source: ScreenshotSource;

  try {
    if (args.svg) {
      // ── SVG mode ─────────────────────────────────────────────────────
      if (!args.svg.trimStart().startsWith("<svg")) {
        throw new Error("SVG input must start with <svg");
      }

      const svgWithDims = ensureSvgDimensions(args.svg);
      const sharpResult = sharp(Buffer.from(svgWithDims));
      pngBuffer = await sharpResult.png().toBuffer();
      const meta = await sharp(pngBuffer).metadata();
      width = meta.width!;
      height = meta.height!;
      source = "generated";
    } else if (args.data) {
      // ── Base64 mode ──────────────────────────────────────────────────
      const decoded = Buffer.from(args.data, "base64");

      if (!hasValidMagicBytes(decoded)) {
        throw new Error(
          "Invalid image data: unrecognized magic bytes (expected PNG, JPEG, or GIF)",
        );
      }

      pngBuffer = await sharp(decoded).png().toBuffer();
      const meta = await sharp(pngBuffer).metadata();
      width = meta.width!;
      height = meta.height!;
      source = "upload";
    } else {
      // ── URL mode ─────────────────────────────────────────────────────
      const { buffer } = await fetchImage(args.url!);

      if (!hasValidMagicBytes(buffer)) {
        throw new Error(
          "Fetched data has invalid magic bytes (not a recognized image format)",
        );
      }

      // Downscale to max 4096px longest edge
      const meta = await sharp(buffer).metadata();
      const longestEdge = Math.max(meta.width ?? 0, meta.height ?? 0);

      let sharpInstance = sharp(buffer);
      if (longestEdge > 4096) {
        sharpInstance = sharpInstance.resize({
          width: meta.width! >= meta.height! ? 4096 : undefined,
          height: meta.height! > meta.width! ? 4096 : undefined,
          fit: "inside",
          withoutEnlargement: true,
        });
      }

      pngBuffer = await sharpInstance.png().toBuffer();
      const pngMeta = await sharp(pngBuffer).metadata();
      width = pngMeta.width!;
      height = pngMeta.height!;
      source = "web";
    }
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Image processing failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }

  // Store via visual service
  const screenshot = deps.visualService.store(pngBuffer, {
    description: args.description,
    width,
    height,
    source,
  });

  const url = deps.visualService.url(screenshot);

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  > = [
    {
      type: "text" as const,
      text: JSON.stringify({ id: screenshot.id, url, width, height }),
    },
  ];

  if (args.returnImage) {
    content.push({
      type: "image" as const,
      data: pngBuffer.toString("base64"),
      mimeType: "image/png",
    });
  }

  return { content };
}

// ── MCP Server ───────────────────────────────────────────────────────────────

export function createImageServer(deps: ImageServerDeps) {
  const storeImageTool = tool(
    "store_image",
    "Store an image (SVG, base64, or URL) as PNG. Returns the stored image ID and URL. Exactly one of svg, data, or url must be provided.",
    {
      svg: z
        .string()
        .optional()
        .describe("SVG markup string (must start with <svg)"),
      data: z
        .string()
        .optional()
        .describe("Base64-encoded image data (PNG, JPEG, or GIF)"),
      url: z
        .string()
        .optional()
        .describe("HTTP(S) URL to fetch the image from"),
      description: z
        .string()
        .optional()
        .describe("Human-readable description of the image"),
      returnImage: z
        .boolean()
        .optional()
        .describe("If true, also return the PNG as a base64 image content block"),
    },
    async (args) => handleStoreImage(deps, args),
  );

  return createSdkMcpServer({
    name: "image-tools",
    tools: [storeImageTool],
  });
}
