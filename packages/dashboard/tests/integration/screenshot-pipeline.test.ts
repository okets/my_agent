import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { VisualActionService } from '../../src/visual/visual-action-service.js'
import { storeAndInject } from '@my-agent/core'
import type { StoreCallback } from '@my-agent/core'

describe('Screenshot pipeline integration', () => {
  let tempDir: string
  let vas: VisualActionService

  // Minimal 1x1 PNG
  const PNG_B64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=='

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'vas-test-'))
    vas = new VisualActionService(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('stores screenshot in VAS and injects URL into tool output', () => {
    const store: StoreCallback = (image, metadata) => {
      const ss = vas.store(image, metadata)
      return { id: ss.id, filename: ss.filename }
    }

    const toolResponse = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            description: 'Screenshot captured',
            width: 1920,
            height: 1080,
          }),
        },
        { type: 'image', data: PNG_B64 },
      ],
    }

    const result = storeAndInject(toolResponse, 'desktop_screenshot', store)

    // VAS has the screenshot on disk
    const screenshots = vas.listUnreferenced()
    expect(screenshots).toHaveLength(1)
    expect(screenshots[0].source).toBe('desktop')
    expect(screenshots[0].width).toBe(1920)

    // Output has URL injected
    expect(result.hookSpecificOutput).toBeDefined()
    const updated = result.hookSpecificOutput!.updatedMCPToolOutput as {
      content: unknown[]
    }
    expect(updated.content).toHaveLength(3)
    const urlBlock = updated.content[2] as { type: string; text: string }
    expect(urlBlock.text).toContain(screenshots[0].filename)
  })

  it('does not store non-image tool results', () => {
    const store: StoreCallback = () => {
      throw new Error('should not be called')
    }
    const toolResponse = { content: [{ type: 'text', text: 'hello' }] }
    const result = storeAndInject(toolResponse, 'desktop_info', store)
    expect(result).toEqual({})
    expect(vas.listUnreferenced()).toHaveLength(0)
  })

  it('handles Playwright source detection', () => {
    const store: StoreCallback = (image, metadata) => {
      const ss = vas.store(image, metadata)
      return { id: ss.id, filename: ss.filename }
    }

    const toolResponse = {
      content: [{ type: 'image', data: PNG_B64 }],
    }

    storeAndInject(toolResponse, 'browser_take_screenshot', store)

    const screenshots = vas.listUnreferenced()
    expect(screenshots).toHaveLength(1)
    expect(screenshots[0].source).toBe('playwright')
  })

  it('ref scanner picks up screenshot URLs from conversation turn content', () => {
    // Store a screenshot
    const store: StoreCallback = (image, metadata) => {
      const ss = vas.store(image, metadata)
      return { id: ss.id, filename: ss.filename }
    }

    const toolResponse = {
      content: [{ type: 'image', data: PNG_B64 }],
    }

    storeAndInject(toolResponse, 'desktop_screenshot', store)
    const screenshots = vas.listUnreferenced()
    const ssId = screenshots[0].id

    // Simulate conversation turn with screenshot URL
    const turnContent = `Here is what I see: ![screenshot](/api/assets/screenshots/${screenshots[0].filename})`
    const urlPattern = /\/api\/assets\/screenshots\/(ss-[a-f0-9-]+)\.png/g
    const matches = [...turnContent.matchAll(urlPattern)]

    // Add refs like onTurnAppended does
    vas.addRefs(matches.map((m) => ({ id: m[1], ref: 'conv/test-conversation' })))

    // Verify ref was added
    const referenced = vas.listByRef('conv/test-conversation')
    expect(referenced).toHaveLength(1)
    expect(referenced[0].id).toBe(ssId)

    // Should no longer appear as unreferenced
    expect(vas.listUnreferenced()).toHaveLength(0)
  })

  it('automation job summary can reference stored screenshots', () => {
    const store: StoreCallback = (image, metadata) => {
      const ss = vas.store(image, metadata)
      return { id: ss.id, filename: ss.filename }
    }

    const toolResponse = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            description: 'Page loaded',
            width: 1280,
            height: 720,
          }),
        },
        { type: 'image', data: PNG_B64 },
      ],
    }

    storeAndInject(toolResponse, 'browser_take_screenshot', store)
    const screenshots = vas.listUnreferenced()
    const ssFilename = screenshots[0].filename

    // Simulate worker composing a job summary with the screenshot URL
    const jobSummary = `Homepage captured: ![cnn](/api/assets/screenshots/${ssFilename})`
    const urlPattern = /\/api\/assets\/screenshots\/(ss-[a-f0-9-]+)\.png/g
    const matches = [...jobSummary.matchAll(urlPattern)]

    // Add refs like job:completed handler does
    vas.addRefs(matches.map((m) => ({ id: m[1], ref: 'job/auto-1/job-1' })))

    const referenced = vas.listByRef('job/auto-1')
    expect(referenced).toHaveLength(1)
    expect(referenced[0].source).toBe('playwright')
  })
})
