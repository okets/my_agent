/**
 * Ollama Embeddings Plugin
 * GPU-accelerated embeddings via Ollama server.
 * Generic — supports any Ollama embedding model.
 *
 * @module memory/embeddings/ollama
 */

import type { EmbeddingsPlugin, InitializeOptions } from './types.js'

const DEFAULT_HOST = 'http://localhost:11434'
const DEFAULT_MODEL = 'nomic-embed-text'

export interface OllamaPluginConfig {
  host?: string
  model?: string
}

export class OllamaEmbeddingsPlugin implements EmbeddingsPlugin {
  readonly id = 'embeddings-ollama'
  readonly name = 'Ollama Embeddings'
  readonly description =
    'GPU-accelerated embeddings via Ollama server. Requires Ollama running with an embedding model.'
  readonly version = '1.0.0'

  private host: string
  private model: string
  private dimensions: number | null = null
  private ready = false

  constructor(config?: OllamaPluginConfig) {
    this.host = config?.host ?? DEFAULT_HOST
    this.model = config?.model ?? DEFAULT_MODEL
  }

  get modelName(): string {
    return this.model
  }

  getDimensions(): number | null {
    return this.dimensions
  }

  async isReady(): Promise<boolean> {
    if (!this.ready) return false
    // Probe the server to verify it's still reachable
    const healthy = await this.checkHealth()
    if (!healthy) {
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
    // Check server is reachable
    const healthy = await this.checkHealth()
    if (!healthy) {
      throw new Error(`Cannot connect to Ollama at ${this.host}. Is the server running?`)
    }

    // Check model is available
    const hasModel = await this.checkModelAvailable()
    if (!hasModel) {
      throw new Error(
        `Model '${this.model}' not found on Ollama server. ` +
          `Run 'ollama pull ${this.model}' on the server.`,
      )
    }

    // Detect dimensions with a test embedding — also validates the model supports embeddings
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

  // ============================================================
  // PRIVATE METHODS
  // ============================================================

  private async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.host}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })
      return response.ok
    } catch {
      return false
    }
  }

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
  }

  private async embedBatchInternal(texts: string[]): Promise<number[][]> {
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
  }
}

/**
 * Create an Ollama embeddings plugin instance.
 */
export function createOllamaPlugin(config?: OllamaPluginConfig): OllamaEmbeddingsPlugin {
  return new OllamaEmbeddingsPlugin(config)
}
