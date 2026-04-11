import { describe, it, expect } from 'vitest'
import {
  createCapabilityRateLimiter,
  createCapabilityAuditLogger,
  createScreenshotInterceptor,
  inferSource,
  parseImageMetadata,
} from '../../src/capabilities/mcp-middleware.js'
import type { ScreenshotMetadata } from '../../src/visual/types.js'

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

describe('inferSource', () => {
  it('maps desktop_* tools to desktop', () => {
    expect(inferSource('desktop_click')).toBe('desktop')
    expect(inferSource('desktop_screenshot')).toBe('desktop')
  })

  it('maps browser_* tools to playwright', () => {
    expect(inferSource('browser_navigate')).toBe('playwright')
    expect(inferSource('browser_take_screenshot')).toBe('playwright')
  })

  it('maps playwright_* tools to playwright', () => {
    expect(inferSource('playwright_click')).toBe('playwright')
  })

  it('maps unknown tools to generated', () => {
    expect(inferSource('generate_image')).toBe('generated')
    expect(inferSource('some_tool')).toBe('generated')
  })
})

describe('parseImageMetadata', () => {
  it('extracts metadata from text content block JSON', () => {
    const result = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ description: 'A screenshot', width: 1920, height: 1080 }),
        },
        { type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==' },
      ],
    }
    const meta: ScreenshotMetadata = parseImageMetadata(result, 'desktop_screenshot')
    expect(meta.description).toBe('A screenshot')
    expect(meta.width).toBe(1920)
    expect(meta.height).toBe(1080)
    expect(meta.source).toBe('desktop')
  })

  it('falls back when text block is not valid JSON', () => {
    const result = {
      content: [
        { type: 'text', text: 'not json' },
        { type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==' },
      ],
    }
    const meta: ScreenshotMetadata = parseImageMetadata(result, 'browser_take_screenshot')
    expect(meta.description).toBeUndefined()
    expect(meta.width).toBe(0)
    expect(meta.height).toBe(0)
    expect(meta.source).toBe('playwright')
  })

  it('falls back when no text block exists', () => {
    const result = {
      content: [{ type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==' }],
    }
    const meta: ScreenshotMetadata = parseImageMetadata(result, 'some_tool')
    expect(meta.description).toBeUndefined()
    expect(meta.width).toBe(0)
    expect(meta.height).toBe(0)
    expect(meta.source).toBe('generated')
  })
})

describe('screenshot interceptor — dual format', () => {
  it('detects Anthropic API format: { type: image, source: { type: base64, data } }', () => {
    const interceptor = createScreenshotInterceptor()
    const result = {
      content: [
        {
          type: 'image',
          source: { type: 'base64', data: 'iVBORw0KGgoAAAANSUhEUg==' },
        },
      ],
    }
    expect(interceptor.hasScreenshot(result)).toBe(true)
    expect(interceptor.extractImage(result)).toBe('iVBORw0KGgoAAAANSUhEUg==')
  })

  it('still detects MCP format: { type: image, data }', () => {
    const interceptor = createScreenshotInterceptor()
    const result = {
      content: [{ type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==' }],
    }
    expect(interceptor.hasScreenshot(result)).toBe(true)
    expect(interceptor.extractImage(result)).toBe('iVBORw0KGgoAAAANSUhEUg==')
  })

  it('rejects non-PNG base64 data in MCP format', () => {
    const interceptor = createScreenshotInterceptor()
    const result = {
      content: [{ type: 'image', data: 'AAABBBCCC' }],
    }
    expect(interceptor.hasScreenshot(result)).toBe(false)
  })

  it('rejects non-PNG base64 data in Anthropic API format', () => {
    const interceptor = createScreenshotInterceptor()
    const result = {
      content: [
        {
          type: 'image',
          source: { type: 'base64', data: 'AAABBBCCC' },
        },
      ],
    }
    expect(interceptor.hasScreenshot(result)).toBe(false)
  })
})
