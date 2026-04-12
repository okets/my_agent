/**
 * MCP Capability Middleware
 *
 * Framework-side middleware for MCP capability tool calls:
 * - Rate limiter: sliding window per capability type
 * - Audit logger: JSONL logging of tool calls
 * - Screenshot interceptor: detects base64 images in tool results
 *
 * These run in the framework, not in the capability server process.
 * Wired via PostToolUse hooks in the Agent SDK (done in S3).
 */

import type { ScreenshotSource, ScreenshotMetadata } from '../visual/types.js'

/**
 * Parse the SDK's `mcp__<server>__<tool>` convention.
 * Returns `{ server, tool }` for MCP tools, or `null` for built-in tools.
 */
export function parseMcpToolName(toolName: string): { server: string; tool: string } | null {
  const m = toolName.match(/^mcp__([^_]+(?:-[^_]+)*)__(.+)$/)
  return m ? { server: m[1], tool: m[2] } : null
}

export function inferSource(toolName: string): ScreenshotSource {
  const parsed = parseMcpToolName(toolName)
  const name = parsed ? parsed.tool : toolName
  if (name.startsWith('desktop_')) return 'desktop'
  if (name.startsWith('browser_') || name.startsWith('playwright_')) return 'playwright'
  return 'generated'
}

/**
 * Normalize a tool response into a content-block array.
 * The SDK passes MCP tool responses as either:
 *  - `[...blocks]` (raw content array — most common)
 *  - `{ content: [...blocks] }` (wrapped — some code paths)
 */
function toContentBlocks(result: unknown): unknown[] | null {
  if (Array.isArray(result)) return result
  if (result && typeof result === 'object') {
    const r = result as { content?: unknown }
    if (Array.isArray(r.content)) return r.content
  }
  return null
}

export function parseImageMetadata(result: unknown, toolName: string): ScreenshotMetadata {
  const fallback: ScreenshotMetadata = {
    description: undefined,
    width: 0,
    height: 0,
    source: inferSource(toolName),
  }

  const blocks = toContentBlocks(result)
  if (!blocks) return fallback

  for (const block of blocks) {
    if (
      block &&
      typeof block === 'object' &&
      'type' in block &&
      (block as { type: string }).type === 'text' &&
      'text' in block &&
      typeof (block as { text: unknown }).text === 'string'
    ) {
      const text = (block as { text: string }).text
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>
        return {
          description: typeof parsed.description === 'string' ? parsed.description : undefined,
          width: typeof parsed.width === 'number' ? parsed.width : 0,
          height: typeof parsed.height === 'number' ? parsed.height : 0,
          source: inferSource(toolName),
        }
      } catch {
        return fallback
      }
    }
  }

  return fallback
}

export interface RateLimiter {
  check(capabilityType: string): boolean
}

export function createCapabilityRateLimiter(options: { maxPerMinute: number }): RateLimiter {
  const windows: Map<string, number[]> = new Map()

  return {
    check(capabilityType: string): boolean {
      const now = Date.now()
      const windowMs = 60_000
      const timestamps = windows.get(capabilityType) ?? []
      const valid = timestamps.filter(t => now - t < windowMs)

      if (valid.length >= options.maxPerMinute) {
        windows.set(capabilityType, valid)
        return false
      }

      valid.push(now)
      windows.set(capabilityType, valid)
      return true
    },
  }
}

export interface AuditEntry {
  timestamp: string
  capability: string
  tool: string
  session: string
}

export interface AuditLogger {
  log(params: { capabilityName: string; toolName: string; sessionId: string }): Promise<void>
}

export function createCapabilityAuditLogger(
  writer: (entry: AuditEntry) => void | Promise<void>,
): AuditLogger {
  return {
    async log({ capabilityName, toolName, sessionId }) {
      await writer({
        timestamp: new Date().toISOString(),
        capability: capabilityName,
        tool: toolName,
        session: sessionId,
      })
    },
  }
}

export interface ScreenshotInterceptor {
  hasScreenshot(result: unknown): boolean
  extractImage(result: unknown): string | null
}

export type StoreCallback = (image: Buffer, metadata: ScreenshotMetadata) => { id: string; filename: string }

/**
 * Shape matches the SDK's `tool_response` for MCP tools: a raw content block array.
 * The SDK assigns `Q = hookSpecificOutput.updatedMCPToolOutput` directly, replacing
 * the tool response in-place — no wrapping, no `{ content: [...] }` object.
 */
export type McpContentBlock = { type: string; text?: string; data?: string; mimeType?: string; source?: unknown }

export interface StoreAndInjectResult {
  hookSpecificOutput?: {
    hookEventName: 'PostToolUse'
    updatedMCPToolOutput: McpContentBlock[]
  }
}

export function storeAndInject(
  toolResponse: unknown,
  toolName: string,
  store: StoreCallback,
): StoreAndInjectResult {
  const interceptor = createScreenshotInterceptor()
  if (!interceptor.hasScreenshot(toolResponse)) return {}

  const base64 = interceptor.extractImage(toolResponse)
  if (!base64) return {}

  const image = Buffer.from(base64, 'base64')
  const metadata = parseImageMetadata(toolResponse, toolName)
  const screenshot = store(image, metadata)

  const blocks = toContentBlocks(toolResponse)
  const originalContent: McpContentBlock[] = (blocks ?? []) as McpContentBlock[]

  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      updatedMCPToolOutput: [
        ...originalContent,
        { type: 'text', text: `Screenshot URL: /api/assets/screenshots/${screenshot.filename}` },
      ],
    },
  }
}

export function createScreenshotInterceptor(): ScreenshotInterceptor {
  const PNG_MAGIC_B64 = 'iVBORw0KGgo'

  function findImageData(result: unknown): string | null {
    const blocks = toContentBlocks(result)
    if (!blocks) return null
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      if (b['type'] !== 'image') continue

      // MCP format: { type: 'image', data: string }
      if (typeof b['data'] === 'string') return b['data']

      // Anthropic API format: { type: 'image', source: { type: 'base64', data: string } }
      if (
        b['source'] &&
        typeof b['source'] === 'object' &&
        (b['source'] as Record<string, unknown>)['type'] === 'base64' &&
        typeof (b['source'] as Record<string, unknown>)['data'] === 'string'
      ) {
        return (b['source'] as Record<string, unknown>)['data'] as string
      }
    }
    return null
  }

  return {
    hasScreenshot(result: unknown): boolean {
      const data = findImageData(result)
      if (!data) return false
      return data.startsWith(PNG_MAGIC_B64)
    },

    extractImage(result: unknown): string | null {
      return findImageData(result)
    },
  }
}
