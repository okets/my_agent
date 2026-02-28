/**
 * Ollama Embeddings Plugin
 * GPU-accelerated embeddings via Ollama server.
 * Generic — supports any Ollama embedding model.
 *
 * @module memory/embeddings/ollama
 */

import type { HealthResult, PluginStatus } from '../../plugin/types.js'
import type { EmbeddingsPlugin, InitializeOptions } from './types.js'

const DEFAULT_HOST = 'http://localhost:11434'
const DEFAULT_MODEL = 'nomic-embed-text'

export interface OllamaPluginConfig {
  host?: string
  model?: string
  onDegraded?: (health: HealthResult) => void
}

export class OllamaEmbeddingsPlugin implements EmbeddingsPlugin {
  readonly id = 'embeddings-ollama'
  readonly name = 'Ollama Embeddings'
  readonly type = 'embeddings' as const
  readonly icon =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
  readonly description =
    'GPU-accelerated embeddings via Ollama server. Requires Ollama running with an embedding model.'
  readonly version = '1.0.0'

  private host: string
  private model: string
  private dimensions: number | null = null
  private ready = false
  private onDegraded?: (health: HealthResult) => void

  constructor(config?: OllamaPluginConfig) {
    this.host = config?.host ?? DEFAULT_HOST
    this.model = config?.model ?? DEFAULT_MODEL
    this.onDegraded = config?.onDegraded
  }

  get modelName(): string {
    return this.model
  }

  getDimensions(): number | null {
    return this.dimensions
  }

  async isReady(): Promise<boolean> {
    if (!this.ready) return false
    const result = await this.healthCheck()
    if (!result.healthy) {
      this.ready = false
      return false
    }
    return true
  }

  async needsDownload(): Promise<boolean> {
    // Ollama models are pulled via ollama CLI, not downloaded by us
    return false
  }

  async getDownloadSize(): Promise<string | null> {
    return null
  }

  async initialize(_options?: InitializeOptions): Promise<void> {
    if (this.ready) return // Idempotent — safe to call from HealthMonitor + tryLazyRecovery

    // Check server is reachable and model is available
    const healthResult = await this.healthCheck()
    if (!healthResult.healthy) {
      throw new Error(healthResult.message ?? 'Ollama health check failed')
    }

    // If we already know dimensions from a previous successful init, skip test embed
    // This avoids unnecessary cold load during recovery
    if (this.dimensions !== null) {
      this.ready = true
      return
    }

    // First-time init: detect dimensions with a test embedding
    let testEmbedding: number[]
    try {
      testEmbedding = await this.embedInternal('test')
    } catch (err) {
      throw new Error(
        `Model '${this.model}' does not support embeddings. ` +
          `Use an embeddings model like 'nomic-embed-text' or 'mxbai-embed-large'.`,
      )
    }

    if (
      testEmbedding.length === 0 ||
      !testEmbedding.every((v) => typeof v === 'number' && !Number.isNaN(v))
    ) {
      throw new Error(
        `Model '${this.model}' returned invalid embeddings. ` +
          `Use an embeddings model like 'nomic-embed-text' or 'mxbai-embed-large'.`,
      )
    }

    this.dimensions = testEmbedding.length
    this.ready = true
  }

  async cleanup(): Promise<void> {
    this.ready = false
    this.dimensions = null
  }

  async deleteModel(): Promise<void> {
    // Ollama models are managed via ollama CLI, not by us
    throw new Error(
      `Cannot delete Ollama models from here. ` +
        `Run 'ollama rm ${this.model}' on the Ollama server.`,
    )
  }

  async embed(text: string): Promise<number[]> {
    if (!this.ready) {
      throw new Error('Plugin not initialized. Call initialize() first.')
    }
    return this.embedInternal(text)
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama supports batch via array input
    if (!this.ready) {
      throw new Error('Plugin not initialized. Call initialize() first.')
    }
    return this.embedBatchInternal(texts)
  }

  configure(settings: Record<string, unknown>): Promise<void> {
    if (typeof settings.host === 'string') {
      this.host = settings.host
    }
    if (typeof settings.model === 'string') {
      this.model = settings.model
    }
    // Reset ready state — need to reinitialize
    this.ready = false
    this.dimensions = null
    return Promise.resolve()
  }

  getSettings(): Record<string, unknown> {
    return {
      host: this.host,
      model: this.model,
    }
  }

  async healthCheck(): Promise<HealthResult> {
    // Step 1: Check server is reachable
    let tagsResponse: Response
    try {
      tagsResponse = await fetch(`${this.host}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })
    } catch {
      return {
        healthy: false,
        message: `Cannot reach Ollama server at ${this.host}`,
        resolution: 'Check that Ollama is running and the host is correct.',
      }
    }

    if (!tagsResponse.ok) {
      return {
        healthy: false,
        message: `Ollama server returned HTTP ${tagsResponse.status}`,
        resolution: 'Check that the Ollama server is running correctly.',
      }
    }

    // Step 2: Check model is available
    try {
      const data = (await tagsResponse.json()) as {
        models: Array<{ name: string }>
      }
      const modelFound = data.models.some(
        (m) =>
          m.name === this.model ||
          m.name.startsWith(this.model + ':') ||
          m.name === this.model + ':latest',
      )

      if (!modelFound) {
        return {
          healthy: false,
          message: `Model '${this.model}' is not installed on the Ollama server`,
          resolution: `Run 'ollama pull ${this.model}' on the Ollama server.`,
        }
      }
    } catch {
      return {
        healthy: false,
        message: 'Failed to parse Ollama server response',
        resolution: 'Check that the Ollama server is running correctly.',
      }
    }

    return { healthy: true }
  }

  status(): PluginStatus {
    if (this.ready) {
      return { state: 'active', lastHealthCheck: new Date() }
    }
    return { state: 'disconnected' }
  }

  // ============================================================
  // PRIVATE METHODS
  // ============================================================

  private async checkModelAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.host}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) return false

      const data = (await response.json()) as {
        models: Array<{ name: string }>
      }
      return data.models.some(
        (m) =>
          m.name === this.model ||
          m.name.startsWith(this.model + ':') ||
          m.name === this.model + ':latest',
      )
    } catch {
      return false
    }
  }

  private async embedInternal(text: string): Promise<number[]> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(`${this.host}/api/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            input: text,
          }),
          signal: AbortSignal.timeout(30000),
        })

        if (!response.ok) {
          const error = await response.text()
          throw new Error(`Ollama embed failed: ${error}`)
        }

        const data = (await response.json()) as {
          embeddings: number[][]
        }

        if (!data.embeddings || data.embeddings.length === 0) {
          throw new Error('Ollama returned no embeddings')
        }

        const embedding = data.embeddings[0]

        // Normalize to unit length (L2 norm)
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0))
        return embedding.map((v) => v / norm)
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt === 0) {
          // First failure — retry once
          continue
        }
      }
    }

    // Both attempts failed — trigger degraded callback
    if (this.onDegraded) {
      this.onDegraded({
        healthy: false,
        message: `Model '${this.model}' failed to produce embeddings`,
        resolution: 'Check that Ollama is running and the model is loaded.',
      })
    }
    throw lastError ?? new Error('Embed failed after retry')
  }

  private async embedBatchInternal(texts: string[]): Promise<number[][]> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(`${this.host}/api/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            input: texts,
          }),
          signal: AbortSignal.timeout(60000),
        })

        if (!response.ok) {
          const error = await response.text()
          throw new Error(`Ollama embed batch failed: ${error}`)
        }

        const data = (await response.json()) as {
          embeddings: number[][]
        }

        if (!data.embeddings || data.embeddings.length !== texts.length) {
          throw new Error(
            `Ollama returned ${data.embeddings?.length ?? 0} embeddings for ${texts.length} inputs`,
          )
        }

        // Normalize all embeddings
        return data.embeddings.map((embedding) => {
          const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0))
          return embedding.map((v) => v / norm)
        })
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt === 0) {
          continue
        }
      }
    }

    // Both attempts failed — trigger degraded callback
    if (this.onDegraded) {
      this.onDegraded({
        healthy: false,
        message: `Model '${this.model}' failed to produce embeddings`,
        resolution: 'Check that Ollama is running and the model is loaded.',
      })
    }
    throw lastError ?? new Error('Embed batch failed after retry')
  }
}

/**
 * Create an Ollama embeddings plugin instance.
 */
export function createOllamaPlugin(config?: OllamaPluginConfig): OllamaEmbeddingsPlugin {
  return new OllamaEmbeddingsPlugin(config)
}
