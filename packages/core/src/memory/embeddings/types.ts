/**
 * Embeddings Plugin Interface
 * Defines the contract for embedding providers.
 *
 * @module memory/embeddings/types
 */

export interface EmbeddingsPlugin {
  // Identity
  readonly id: string // "embeddings-local", "embeddings-ollama"
  readonly name: string // "Local Embeddings (node-llama-cpp)"
  readonly description: string // Shown in settings UI
  readonly version: string

  // Model info
  readonly modelName: string // "embeddinggemma-300M", "nomic-embed-text"
  readonly modelSize?: string // "600MB" — for UI display

  // Dimensions (available after initialization)
  getDimensions(): number | null

  // Lifecycle
  isReady(): Promise<boolean> // Can embed right now?
  needsDownload(): Promise<boolean> // Model needs downloading? (local only)
  getDownloadSize(): Promise<string | null> // "600MB" or null if no download needed

  initialize(options?: InitializeOptions): Promise<void> // Download model if needed, load into memory
  cleanup(): Promise<void> // Unload model, free resources
  deleteModel(): Promise<void> // Remove downloaded model files (local only)

  // Core operations
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>

  // Optional: configuration
  configure?(settings: Record<string, unknown>): Promise<void>
  getSettings?(): Record<string, unknown>
}

export interface InitializeOptions {
  onProgress?: (percent: number, message: string) => void
}

export interface PluginConfig {
  id: string
  settings: Record<string, unknown>
}

export interface EmbeddingsConfig {
  activePlugin: string | null
  plugins: Record<string, Record<string, unknown>>
}
