import { describe, it, expect, vi } from 'vitest'
import {
  createCapabilityRateLimiter,
  createCapabilityAuditLogger,
  createScreenshotInterceptor,
} from '../../src/capabilities/mcp-middleware.js'

describe('Capability middleware', () => {
  describe('rate limiter', () => {
    it('allows requests under limit', () => {
      const limiter = createCapabilityRateLimiter({ maxPerMinute: 3 })
      expect(limiter.check('desktop-control')).toBe(true)
      expect(limiter.check('desktop-control')).toBe(true)
      expect(limiter.check('desktop-control')).toBe(true)
    })

    it('blocks requests over limit', () => {
      const limiter = createCapabilityRateLimiter({ maxPerMinute: 2 })
      expect(limiter.check('desktop-control')).toBe(true)
      expect(limiter.check('desktop-control')).toBe(true)
      expect(limiter.check('desktop-control')).toBe(false)
    })

    it('tracks types independently', () => {
      const limiter = createCapabilityRateLimiter({ maxPerMinute: 1 })
      expect(limiter.check('desktop-control')).toBe(true)
      expect(limiter.check('audio-to-text')).toBe(true)
      expect(limiter.check('desktop-control')).toBe(false)
    })
  })

  describe('audit logger', () => {
    it('calls writer with enriched entry', async () => {
      const writer = vi.fn()
      const logger = createCapabilityAuditLogger(writer)

      await logger.log({ capabilityName: 'desktop-x11', toolName: 'desktop_click', sessionId: 's1' })

      expect(writer).toHaveBeenCalledOnce()
      const entry = writer.mock.calls[0][0]
      expect(entry.capability).toBe('desktop-x11')
      expect(entry.tool).toBe('desktop_click')
      expect(entry.session).toBe('s1')
      expect(entry.timestamp).toBeDefined()
    })

    it('supports async writer', async () => {
      const writer = vi.fn().mockResolvedValue(undefined)
      const logger = createCapabilityAuditLogger(writer)

      await logger.log({ capabilityName: 'test', toolName: 'tool', sessionId: 's1' })

      expect(writer).toHaveBeenCalledOnce()
    })
  })

  describe('screenshot interceptor', () => {
    it('detects PNG image in tool result', () => {
      const interceptor = createScreenshotInterceptor()
      const result = {
        content: [
          { type: 'text', text: 'Screenshot captured' },
          { type: 'image', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
        ],
      }
      expect(interceptor.hasScreenshot(result)).toBe(true)
      expect(interceptor.extractImage(result)).toBeTruthy()
    })

    it('returns false for non-image results', () => {
      const interceptor = createScreenshotInterceptor()
      const result = {
        content: [{ type: 'text', text: 'Hello' }],
      }
      expect(interceptor.hasScreenshot(result)).toBe(false)
      expect(interceptor.extractImage(result)).toBeNull()
    })
  })
})
