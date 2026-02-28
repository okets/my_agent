/**
 * M6-S9: Ollama Plugin Edge Tests
 *
 * Tests edge cases and error paths for the Ollama embeddings plugin.
 * Uses mocked fetch to test plugin logic without requiring Ollama server.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { OllamaEmbeddingsPlugin, createOllamaPlugin } from '../src/memory/embeddings/ollama.js'
import type { HealthResult } from '../src/plugin/types.js'

// Mock global fetch
const originalFetch = global.fetch
let mockFetch: ReturnType<typeof vi.fn>

function setupMockFetch() {
  mockFetch = vi.fn()
  global.fetch = mockFetch
}

function restoreFetch() {
  global.fetch = originalFetch
}

// Helper to create mock responses
function mockJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response
}

function mockErrorResponse(message: string, status = 500): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ error: message }),
    text: () => Promise.resolve(message),
  } as Response
}

// -------------------------------------------------------------------
// 1. Health Check Edge Cases
// -------------------------------------------------------------------

describe('OllamaEmbeddingsPlugin - healthCheck', () => {
  beforeEach(setupMockFetch)
  afterEach(restoreFetch)

  it('returns healthy when server is up and model is available', async () => {
    const plugin = createOllamaPlugin({ model: 'nomic-embed-text' })

    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        models: [{ name: 'nomic-embed-text:latest' }],
      }),
    )

    const result = await plugin.healthCheck()
    expect(result.healthy).toBe(true)
  })

  it('returns unhealthy with message when server is unreachable', async () => {
    const plugin = createOllamaPlugin({ host: 'http://your-ollama-server:11434' })

    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const result = await plugin.healthCheck()
    expect(result.healthy).toBe(false)
    expect(result.message).toContain('Cannot reach Ollama server')
    expect(result.resolution).toBeDefined()
  })

  it('returns unhealthy when model is not installed', async () => {
    const plugin = createOllamaPlugin({ model: 'not-installed-model' })

    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        models: [{ name: 'other-model:latest' }],
      }),
    )

    const result = await plugin.healthCheck()
    expect(result.healthy).toBe(false)
    expect(result.message).toContain('not installed')
    expect(result.resolution).toContain('ollama pull')
  })

  it('returns unhealthy on HTTP error from server', async () => {
    const plugin = createOllamaPlugin()

    mockFetch.mockResolvedValueOnce(mockErrorResponse('Internal error', 500))

    const result = await plugin.healthCheck()
    expect(result.healthy).toBe(false)
    expect(result.message).toContain('HTTP 500')
  })

  it('returns unhealthy on timeout', async () => {
    const plugin = createOllamaPlugin()

    mockFetch.mockRejectedValueOnce(new Error('AbortError: timeout'))

    const result = await plugin.healthCheck()
    expect(result.healthy).toBe(false)
  })

  it('matches model with :latest suffix', async () => {
    const plugin = createOllamaPlugin({ model: 'nomic-embed-text' })

    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        models: [{ name: 'nomic-embed-text:latest' }],
      }),
    )

    const result = await plugin.healthCheck()
    expect(result.healthy).toBe(true)
  })

  it('matches model with exact name', async () => {
    const plugin = createOllamaPlugin({ model: 'mxbai-embed-large:v2' })

    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        models: [{ name: 'mxbai-embed-large:v2' }],
      }),
    )

    const result = await plugin.healthCheck()
    expect(result.healthy).toBe(true)
  })

  it('handles malformed JSON response', async () => {
    const plugin = createOllamaPlugin()

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('Invalid JSON')),
      text: () => Promise.resolve('not json'),
    } as Response)

    const result = await plugin.healthCheck()
    expect(result.healthy).toBe(false)
    expect(result.message).toContain('Failed to parse')
  })
})

// -------------------------------------------------------------------
// 2. Initialization Edge Cases
// -------------------------------------------------------------------

describe('OllamaEmbeddingsPlugin - initialize', () => {
  beforeEach(setupMockFetch)
  afterEach(restoreFetch)

  it('sets dimensions from test embedding', async () => {
    const plugin = createOllamaPlugin()

    // Health check
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ models: [{ name: 'nomic-embed-text:latest' }] }),
    )
    // Test embed
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ embeddings: [[0.1, 0.2, 0.3, 0.4]] }))

    await plugin.initialize()

    expect(plugin.getDimensions()).toBe(4)

    // isReady() does another health check
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ models: [{ name: 'nomic-embed-text:latest' }] }),
    )
    expect(await plugin.isReady()).toBe(true)
  })

  it('skips test embed on recovery when dimensions known', async () => {
    const plugin = createOllamaPlugin()

    // First init: health check + test embed
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ models: [{ name: 'nomic-embed-text:latest' }] }),
    )
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ embeddings: [[0.1, 0.2, 0.3]] }))

    await plugin.initialize()
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(plugin.getDimensions()).toBe(3)

    // Simulate health check failure (sets ready=false but keeps dimensions)
    mockFetch.mockRejectedValueOnce(new Error('Server temporarily down'))
    const isReady = await plugin.isReady()
    expect(isReady).toBe(false)
    expect(mockFetch).toHaveBeenCalledTimes(3)
    // Dimensions should still be known
    expect(plugin.getDimensions()).toBe(3)

    // Recovery init: only health check (skip test embed because dimensions known)
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ models: [{ name: 'nomic-embed-text:latest' }] }),
    )

    await plugin.initialize()
    // Should only call health check (1 call), not test embed (would be 2 calls)
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('throws when health check fails during init', async () => {
    const plugin = createOllamaPlugin()

    mockFetch.mockRejectedValueOnce(new Error('Connection refused'))

    await expect(plugin.initialize()).rejects.toThrow('Cannot reach')
  })

  it('throws when model does not support embeddings', async () => {
    const plugin = createOllamaPlugin({ model: 'llama3' })

    // Health check passes (model exists)
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ models: [{ name: 'llama3:latest' }] }))
    // Test embed fails
    mockFetch.mockResolvedValueOnce(mockErrorResponse('model does not support embeddings', 400))

    await expect(plugin.initialize()).rejects.toThrow('does not support embeddings')
  })

  it('throws when test embed returns empty embeddings', async () => {
    const plugin = createOllamaPlugin()

    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ models: [{ name: 'nomic-embed-text:latest' }] }),
    )
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ embeddings: [[]] }))

    await expect(plugin.initialize()).rejects.toThrow('invalid embeddings')
  })
})

// -------------------------------------------------------------------
// 3. Embed Edge Cases
// -------------------------------------------------------------------

describe('OllamaEmbeddingsPlugin - embed', () => {
  let plugin: OllamaEmbeddingsPlugin

  beforeEach(async () => {
    setupMockFetch()
    plugin = createOllamaPlugin()

    // Setup: init the plugin
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ models: [{ name: 'nomic-embed-text:latest' }] }),
    )
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ embeddings: [[0.6, 0.8]] }))
    await plugin.initialize()
    mockFetch.mockClear()
  })

  afterEach(restoreFetch)

  it('returns normalized embedding vector', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ embeddings: [[3, 4]] }))

    const result = await plugin.embed('test')

    // 3/5 = 0.6, 4/5 = 0.8
    expect(result[0]).toBeCloseTo(0.6, 5)
    expect(result[1]).toBeCloseTo(0.8, 5)
  })

  it('retries once on failure then succeeds', async () => {
    // First call fails
    mockFetch.mockRejectedValueOnce(new Error('Network error'))
    // Second call succeeds
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ embeddings: [[1, 0]] }))

    const result = await plugin.embed('test')

    expect(result).toHaveLength(2)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('calls onDegraded callback when both retries fail', async () => {
    const onDegraded = vi.fn()
    const pluginWithCallback = createOllamaPlugin({ onDegraded })

    // Init
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ models: [{ name: 'nomic-embed-text:latest' }] }),
    )
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ embeddings: [[0.6, 0.8]] }))
    await pluginWithCallback.initialize()
    mockFetch.mockClear()

    // Both embed attempts fail
    mockFetch.mockRejectedValue(new Error('Server down'))

    await expect(pluginWithCallback.embed('test')).rejects.toThrow()
    expect(onDegraded).toHaveBeenCalledWith(
      expect.objectContaining({
        healthy: false,
        message: expect.stringContaining('failed to produce embeddings'),
      }),
    )
  })

  it('throws when called before initialization', async () => {
    const uninitPlugin = createOllamaPlugin()

    await expect(uninitPlugin.embed('test')).rejects.toThrow('not initialized')
  })

  it('handles empty text input', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ embeddings: [[0, 0, 0, 0]] }))

    // Should not throw - Ollama handles empty input
    const result = await plugin.embed('')
    expect(result).toHaveLength(4)
  })

  it('handles very long text input', async () => {
    const longText = 'word '.repeat(10000)

    mockFetch.mockResolvedValueOnce(mockJsonResponse({ embeddings: [[0.5, 0.5]] }))

    const result = await plugin.embed(longText)
    expect(result).toHaveLength(2)
  })
})

// -------------------------------------------------------------------
// 4. Batch Embed Edge Cases
// -------------------------------------------------------------------

describe('OllamaEmbeddingsPlugin - embedBatch', () => {
  let plugin: OllamaEmbeddingsPlugin

  beforeEach(async () => {
    setupMockFetch()
    plugin = createOllamaPlugin()

    // Setup: init the plugin
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ models: [{ name: 'nomic-embed-text:latest' }] }),
    )
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ embeddings: [[0.6, 0.8]] }))
    await plugin.initialize()
    mockFetch.mockClear()
  })

  afterEach(restoreFetch)

  it('returns normalized embeddings for batch', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        embeddings: [
          [3, 4],
          [0, 1],
        ],
      }),
    )

    const results = await plugin.embedBatch(['hello', 'world'])

    expect(results).toHaveLength(2)
    expect(results[0][0]).toBeCloseTo(0.6, 5)
    expect(results[1][1]).toBeCloseTo(1.0, 5)
  })

  it('throws when response has wrong count', async () => {
    // Both retries return wrong count
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        embeddings: [[1, 0]], // Only 1 embedding for 2 inputs
      }),
    )

    await expect(plugin.embedBatch(['a', 'b'])).rejects.toThrow()
  })

  it('handles empty batch', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ embeddings: [] }))

    const results = await plugin.embedBatch([])
    expect(results).toEqual([])
  })
})

// -------------------------------------------------------------------
// 5. Configure Edge Cases
// -------------------------------------------------------------------

describe('OllamaEmbeddingsPlugin - configure', () => {
  it('resets ready state when host changes', async () => {
    setupMockFetch()

    const plugin = createOllamaPlugin()

    // Init: health check + test embed
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ models: [{ name: 'nomic-embed-text:latest' }] }),
    )
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ embeddings: [[0.5, 0.5]] }))
    await plugin.initialize()

    // isReady() also does a health check
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ models: [{ name: 'nomic-embed-text:latest' }] }),
    )
    expect(await plugin.isReady()).toBe(true)

    // Reconfigure
    await plugin.configure({ host: 'http://new-host:11434' })

    // Should no longer be ready (needs re-init) - dimensions cleared
    expect(plugin.getDimensions()).toBeNull()

    restoreFetch()
  })

  it('resets ready state when model changes', async () => {
    setupMockFetch()

    const plugin = createOllamaPlugin()

    // Init
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ models: [{ name: 'nomic-embed-text:latest' }] }),
    )
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ embeddings: [[0.5, 0.5]] }))
    await plugin.initialize()

    await plugin.configure({ model: 'different-model' })

    expect(plugin.getDimensions()).toBeNull()
    expect(plugin.modelName).toBe('different-model')

    restoreFetch()
  })

  it('returns settings from getSettings', () => {
    const plugin = createOllamaPlugin({
      host: 'http://custom:1234',
      model: 'custom-model',
    })

    const settings = plugin.getSettings()
    expect(settings.host).toBe('http://custom:1234')
    expect(settings.model).toBe('custom-model')
  })
})

// -------------------------------------------------------------------
// 6. Edge Cases - Status
// -------------------------------------------------------------------

describe('OllamaEmbeddingsPlugin - status', () => {
  it('returns disconnected when not initialized', () => {
    const plugin = createOllamaPlugin()
    const status = plugin.status()

    expect(status.state).toBe('disconnected')
  })

  it('returns active when ready', async () => {
    setupMockFetch()

    const plugin = createOllamaPlugin()

    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ models: [{ name: 'nomic-embed-text:latest' }] }),
    )
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ embeddings: [[0.5, 0.5]] }))

    await plugin.initialize()

    const status = plugin.status()
    expect(status.state).toBe('active')
    expect(status.lastHealthCheck).toBeInstanceOf(Date)

    restoreFetch()
  })
})

// -------------------------------------------------------------------
// 7. Edge Cases - Cleanup
// -------------------------------------------------------------------

describe('OllamaEmbeddingsPlugin - cleanup', () => {
  it('resets state on cleanup', async () => {
    setupMockFetch()

    const plugin = createOllamaPlugin()

    // Init: health check + test embed
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ models: [{ name: 'nomic-embed-text:latest' }] }),
    )
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ embeddings: [[0.5, 0.5]] }))

    await plugin.initialize()

    // isReady() also does a health check
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ models: [{ name: 'nomic-embed-text:latest' }] }),
    )
    expect(await plugin.isReady()).toBe(true)

    await plugin.cleanup()

    expect(plugin.getDimensions()).toBeNull()

    restoreFetch()
  })
})
