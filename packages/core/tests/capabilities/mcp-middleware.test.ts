import { describe, it, expect } from 'vitest'
import {
  createCapabilityRateLimiter,
  createCapabilityAuditLogger,
  createScreenshotInterceptor,
} from '../../src/capabilities/mcp-middleware.js'

describe('createCapabilityRateLimiter', () => {
  it('allows calls within the limit', () => {
    const limiter = createCapabilityRateLimiter({ maxPerMinute: 5 })
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('desktop-control')).toBe(true)
    }
  })

  it('blocks calls exceeding the limit', () => {
    const limiter = createCapabilityRateLimiter({ maxPerMinute: 2 })
    expect(limiter.check('desktop-control')).toBe(true)
    expect(limiter.check('desktop-control')).toBe(true)
    expect(limiter.check('desktop-control')).toBe(false)
  })

  it('tracks capabilities independently', () => {
    const limiter = createCapabilityRateLimiter({ maxPerMinute: 1 })
    expect(limiter.check('desktop-control')).toBe(true)
    expect(limiter.check('other-type')).toBe(true)
    expect(limiter.check('desktop-control')).toBe(false)
  })
})

describe('createCapabilityAuditLogger', () => {
  it('logs tool calls to the provided writer', async () => {
    const entries: unknown[] = []
    const logger = createCapabilityAuditLogger((entry) => { entries.push(entry) })

    await logger.log({
      capabilityName: 'Desktop Control',
      toolName: 'desktop_screenshot',
      sessionId: 'test-session',
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      capability: 'Desktop Control',
      tool: 'desktop_screenshot',
      session: 'test-session',
    })
  })
})

describe('createScreenshotInterceptor', () => {
  it('detects base64 PNG content in tool results', () => {
    const interceptor = createScreenshotInterceptor()
    const result = { content: [{ type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==' }] }
    expect(interceptor.hasScreenshot(result)).toBe(true)
  })

  it('returns false for non-image results', () => {
    const interceptor = createScreenshotInterceptor()
    const result = { content: [{ type: 'text', text: 'hello' }] }
    expect(interceptor.hasScreenshot(result)).toBe(false)
  })

  it('extracts base64 image data', () => {
    const interceptor = createScreenshotInterceptor()
    const result = { content: [{ type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==' }] }
    const extracted = interceptor.extractImage(result)
    expect(extracted).toBe('iVBORw0KGgoAAAANSUhEUg==')
  })
})
