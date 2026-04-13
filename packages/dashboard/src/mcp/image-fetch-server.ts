/**
 * Image Fetch MCP Tool Server
 *
 * Exposes a `fetch_image` tool that downloads images from URLs,
 * validates, converts to PNG via sharp, and stores via
 * VisualActionService. All network/security surface is concentrated here.
 *
 * Also exposes a `store_local_image` tool that reads an image from the
 * local filesystem (within the project root) and stores it in VAS.
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import type { VisualActionService } from "../visual/visual-action-service.js";
import type { ScreenshotSource } from "@my-agent/core";

export interface ImageFetchServerDeps {
  visualService: VisualActionService;
  /** Absolute path to the .my_agent directory. Used to derive allowed root for local file access. */
  agentDir: string;
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

// ── URL fetcher ──────────────────────────────────────────────────────────────

const MAX_IMAGE_BYTES = 50 * 1024 * 1024; // 50 MB response size limit

// Private/internal IP ranges that should not be fetched (SSRF protection)
function isPrivateHost(hostname: string): boolean {
  return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.|localhost|::1|\[::1\]|metadata\.google|169\.254\.169\.254)/.test(
    hostname,
  );
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
        reject(
          new Error("Redirect to private/internal network address blocked"),
        );
        return;
      }

      // Select http module based on current URL protocol (handles protocol changes on redirect)
      const httpMod =
        parsed.protocol === "https:"
          ? await import("node:https")
          : await import("node:http");

      httpMod
        .get(reqUrl, (res) => {
          // Follow one redirect
          if (
            (res.statusCode === 301 ||
              res.statusCode === 302 ||
              res.statusCode === 307 ||
              res.statusCode === 308) &&
            res.headers.location &&
            redirectCount < 1
          ) {
            const redirectUrl = new URL(res.headers.location, parsed.origin)
              .href;
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
              new Error(`Expected image Content-Type, got: ${contentType}`),
            );
            return;
          }

          const chunks: Buffer[] = [];
          let totalBytes = 0;
          res.on("data", (chunk: Buffer) => {
            totalBytes += chunk.length;
            if (totalBytes > MAX_IMAGE_BYTES) {
              res.destroy();
              reject(
                new Error(
                  `Image exceeds ${MAX_IMAGE_BYTES / 1024 / 1024} MB size limit`,
                ),
              );
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () =>
            resolve({ buffer: Buffer.concat(chunks), contentType }),
          );
          res.on("error", reject);
        })
        .on("error", reject);
    };

    makeRequest(url, 0);
  });
}

// ── Handler (exported for testing) ──────────────────────────────────────────

export async function handleFetchImage(
  deps: ImageFetchServerDeps,
  args: {
    url: string;
    description?: string;
  },
) {
  if (!args.url) {
    return {
      content: [
        {
          type: "text" as const,
          text: "url is required",
        },
      ],
      isError: true,
    };
  }

  let pngBuffer: Buffer;
  let width: number;
  let height: number;
  const source: ScreenshotSource = "web";

  try {
    {
      const { buffer } = await fetchImage(args.url);

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

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ id: screenshot.id, url, width, height }),
      },
    ],
  };
}

// ── Local file handler ───────────────────────────────────────────────────────

/**
 * Resolve an allowed root for local file access.
 * agentDir is e.g. /path/to/project/.my_agent — parent is the project root.
 */
function resolveAllowedRoot(agentDir: string): string {
  return path.resolve(path.dirname(agentDir));
}

export async function handleStoreLocalImage(
  deps: ImageFetchServerDeps,
  args: { file_path: string; description?: string },
) {
  const allowedRoot = resolveAllowedRoot(deps.agentDir);
  const resolved = path.resolve(args.file_path);

  if (!resolved.startsWith(allowedRoot + path.sep) && resolved !== allowedRoot) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Access denied: path must be within ${allowedRoot}`,
        },
      ],
      isError: true,
    };
  }

  let rawBuffer: Buffer;
  try {
    rawBuffer = fs.readFileSync(resolved);
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: `File read failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }

  if (!hasValidMagicBytes(rawBuffer)) {
    return {
      content: [
        {
          type: "text" as const,
          text: "File is not a recognized image format (PNG, JPEG, or GIF required)",
        },
      ],
      isError: true,
    };
  }

  let pngBuffer: Buffer;
  let width: number;
  let height: number;
  try {
    const meta = await sharp(rawBuffer).metadata();
    const longestEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
    let sharpInstance = sharp(rawBuffer);
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

  const source: ScreenshotSource = "upload";
  const screenshot = deps.visualService.store(pngBuffer, {
    description: args.description ?? path.basename(resolved),
    width,
    height,
    source,
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
}

// ── MCP Server ───────────────────────────────────────────────────────────────

export function createImageFetchServer(deps: ImageFetchServerDeps) {
  const fetchImageTool = tool(
    "fetch_image",
    "Fetch an image from a URL and store it. Downloads the image, validates it, downscales if needed, and stores as PNG. Returns { id, url, width, height }. IMPORTANT: After calling this tool, you MUST include the returned url in your response text as ![description](url). Use this when you want to include a web image in your response.",
    {
      url: z.string().describe("HTTP(S) URL of the image to fetch"),
      // description is required so every image has meaningful alt text.
      description: z
        .string()
        .describe("What this image shows — used for alt text and ![description](url)"),
    },
    async (args) =>
      handleFetchImage(deps, { url: args.url, description: args.description }),
  );

  const storeLocalImageTool = tool(
    "store_local_image",
    "Read a local image file from disk and store it so it can be included in your response. Takes an absolute file path within the project, validates it is an image, and returns { id, url, width, height }. IMPORTANT: After calling this tool, you MUST include the returned url in your response text as ![description](url). Use this when the user asks you to send or show a local file (e.g. a logo, screenshot, or photo already on disk).",
    {
      file_path: z.string().describe("Absolute path to the local image file (must be within the project root)"),
      description: z
        .string()
        .optional()
        .describe("What this image shows — used for alt text and ![description](url)"),
    },
    async (args) =>
      handleStoreLocalImage(deps, {
        file_path: args.file_path,
        description: args.description,
      }),
  );

  return createSdkMcpServer({
    name: "image-fetch-tools",
    tools: [fetchImageTool, storeLocalImageTool],
  });
}
