/**
 * Local Embeddings Plugin (node-llama-cpp)
 * Uses embeddinggemma-300M for on-device embeddings.
 *
 * @module memory/embeddings/local
 */

import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import type { EmbeddingsPlugin, InitializeOptions } from './types.js'

const MODEL_URI = 'hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf'
const MODEL_SIZE = '328MB'
const DIMENSIONS = 768

interface LlamaModule {
  getLlama: (options?: { logLevel?: string }) => Promise<Llama>
  resolveModelFile: (
    uri: string,
    options: {
      directory: string
      onProgress?: (progress: {
        downloadedSize: number
        totalSize: number
        downloadSpeed?: number
      }) => void
    },
  ) => Promise<string>
}

interface Llama {
  loadModel: (options: { modelPath: string }) => Promise<LlamaModel>
}

interface LlamaModel {
  createEmbeddingContext: () => Promise<LlamaEmbeddingContext>
}

interface LlamaEmbeddingContext {
  getEmbeddingFor: (text: string) => Promise<{ vector: Float32Array }>
  dispose: () => Promise<void>
}

export class LocalEmbeddingsPlugin implements EmbeddingsPlugin {
  readonly id = 'embeddings-local'
  readonly name = 'Local Embeddings'
  readonly description =
    'On-device embeddings using embeddinggemma-300M. No API costs, full privacy.'
  readonly version = '1.0.0'
  readonly modelName = 'embeddinggemma-300M'
  readonly modelSize = MODEL_SIZE

  private modelsDir: string
  private llama: Llama | null = null
  private model: LlamaModel | null = null
  private context: LlamaEmbeddingContext | null = null
  private dimensions: number | null = null

  constructor(agentDir: string) {
    this.modelsDir = join(agentDir, 'cache', 'models')
  }

  getDimensions(): number | null {
    return this.dimensions
  }

  async isReady(): Promise<boolean> {
    return this.context !== null
  }

  async needsDownload(): Promise<boolean> {
    // Check if model file exists in cache
    // node-llama-cpp caches to a specific path structure
    try {
      const llamaModule = await this.getLlamaModule()
      // Try to resolve without downloading to see if it exists
      // This is a heuristic — if the directory has any gguf files, assume it's there
      const { existsSync, readdirSync } = await import('fs')
      if (!existsSync(this.modelsDir)) return true
      const files = readdirSync(this.modelsDir, { recursive: true }) as string[]
      return !files.some((f) => f.endsWith('.gguf'))
    } catch {
      return true
    }
  }

  async getDownloadSize(): Promise<string | null> {
    const needsDownload = await this.needsDownload()
    return needsDownload ? MODEL_SIZE : null
  }

  async initialize(options?: InitializeOptions): Promise<void> {
    if (this.context) return // Already initialized

    const llamaModule = await this.getLlamaModule()

    if (!this.llama) {
      this.llama = await llamaModule.getLlama({ logLevel: 'warn' })
    }

    if (!this.model) {
      const modelPath = await llamaModule.resolveModelFile(MODEL_URI, {
        directory: this.modelsDir,
        onProgress: options?.onProgress
          ? ({ downloadedSize, totalSize }) => {
              const percent = totalSize ? Math.round((downloadedSize / totalSize) * 100) : 0
              const mbDownloaded = (downloadedSize / 1024 / 1024).toFixed(1)
              const mbTotal = totalSize ? (totalSize / 1024 / 1024).toFixed(1) : '?'
              options.onProgress!(percent, `Downloading model: ${mbDownloaded}/${mbTotal} MB`)
            }
          : undefined,
      })
      this.model = await this.llama.loadModel({ modelPath })
    }

    if (!this.context) {
      this.context = await this.model.createEmbeddingContext()
    }

    // Detect dimensions from first embedding
    const testResult = await this.context.getEmbeddingFor('test')
    this.dimensions = testResult.vector.length
  }

  async cleanup(): Promise<void> {
    if (this.context) {
      await this.context.dispose()
      this.context = null
    }
    this.model = null
    this.llama = null
    this.dimensions = null
  }

  async deleteModel(): Promise<void> {
    await this.cleanup()
    // Remove the models directory
    if (existsSync(this.modelsDir)) {
      rmSync(this.modelsDir, { recursive: true, force: true })
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!this.context) {
      throw new Error('Plugin not initialized. Call initialize() first.')
    }
    const result = await this.context.getEmbeddingFor(text)
    const vector = Array.from(result.vector)

    // Normalize to unit length (L2 norm)
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
    return vector.map((v) => v / norm)
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // node-llama-cpp doesn't have native batch support, so we do sequential
    return Promise.all(texts.map((t) => this.embed(t)))
  }

  private llamaModule: LlamaModule | null = null

  private async getLlamaModule(): Promise<LlamaModule> {
    if (!this.llamaModule) {
      // Lazy import to avoid loading the native module until needed
      this.llamaModule = (await import('node-llama-cpp')) as LlamaModule
    }
    return this.llamaModule
  }
}

/**
 * Create a local embeddings plugin instance.
 */
export function createLocalPlugin(agentDir: string): LocalEmbeddingsPlugin {
  return new LocalEmbeddingsPlugin(agentDir)
}
