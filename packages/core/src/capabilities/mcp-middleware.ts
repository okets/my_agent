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

export function createScreenshotInterceptor(): ScreenshotInterceptor {
  const PNG_MAGIC_B64 = 'iVBORw0KGgo'

  function findImageContent(result: unknown): { type: string; data: string } | null {
    if (!result || typeof result !== 'object') return null
    const r = result as { content?: unknown[] }
    if (!Array.isArray(r.content)) return null
    for (const block of r.content) {
      if (
        block &&
        typeof block === 'object' &&
        'type' in block &&
        (block as { type: string }).type === 'image' &&
        'data' in block &&
        typeof (block as { data: unknown }).data === 'string'
      ) {
        return block as { type: string; data: string }
      }
    }
    return null
  }

  return {
    hasScreenshot(result: unknown): boolean {
      const img = findImageContent(result)
      if (!img) return false
      return img.data.startsWith(PNG_MAGIC_B64)
    },

    extractImage(result: unknown): string | null {
      const img = findImageContent(result)
      if (!img) return null
      return img.data
    },
  }
}
