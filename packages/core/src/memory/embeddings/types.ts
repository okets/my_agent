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

export interface PluginDegradedState {
  pluginId: string
  pluginName: string
  model: string
  error: string
  resolution: string // Actionable fix guidance
  since: string // ISO 8601
  lastAttempt: string | null
}

/**
 * Map common embeddings errors to actionable resolution guidance.
 */
export function deriveResolution(pluginId: string, error: string): string {
  const msg = error.toLowerCase()

  if (msg.includes('connect') || msg.includes('econnrefused') || msg.includes('fetch failed')) {
    if (pluginId.includes('ollama')) {
      return 'Start the Ollama Docker container or check that the host is reachable.'
    }
    return 'Check that the embeddings server is running and reachable.'
  }

  if (msg.includes('does not support embedding') || msg.includes('not an embedding model')) {
    return "Use an embeddings model like 'nomic-embed-text'."
  }

  if (msg.includes('model not found') || msg.includes('not found')) {
    return "Pull the model first (e.g., 'ollama pull nomic-embed-text')."
  }

  return 'Check the embeddings plugin configuration and server status.'
}
