# Embeddings Plugin System — Design Specification

> **Status:** Design Complete
> **Date:** 2026-02-24
> **Scope:** Plugin architecture for embedding providers
> **Milestone:** M6 (Memory System)

---

## Overview

Embeddings are provided via a plugin system, allowing users to choose their embedding provider or create custom plugins. The default plugin uses local embeddings via node-llama-cpp.

### Why Plugins?

- **Flexibility:** Users can choose local vs cloud-based embeddings
- **Cost control:** Local = free, cloud = pay per use
- **Privacy:** Local embeddings never leave the machine
- **Extensibility:** Community can create plugins for new providers
- **Resource management:** Switch plugins, delete unused models

---

## Plugin Interface

```typescript
interface EmbeddingsPlugin {
  // Identity
  id: string;                    // "embeddings-local", "embeddings-openai"
  name: string;                  // "Local Embeddings (node-llama-cpp)"
  description: string;           // Shown in settings UI
  version: string;

  // Model info
  dimensions: number;            // Embedding vector size (e.g., 384)
  modelName: string;             // "embeddinggemma-300M"
  modelSize?: string;            // "600MB" — for UI display

  // Lifecycle
  isReady(): Promise<boolean>;   // Can embed right now?
  needsDownload(): Promise<boolean>;  // Model needs downloading?
  getDownloadSize(): Promise<string>; // "600MB"

  initialize(options?: {
    onProgress?: (percent: number, message: string) => void;
  }): Promise<void>;             // Download model if needed, load into memory

  cleanup(): Promise<void>;      // Unload model, optionally delete files
  deleteModel(): Promise<void>;  // Remove downloaded model files

  // Core operations
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;

  // Optional: configuration
  configure?(settings: Record<string, unknown>): Promise<void>;
  getSettings?(): Record<string, unknown>;
}
```

---

## Default Plugin: `embeddings-local`

The framework ships with a local embeddings plugin using node-llama-cpp.

### Configuration

```typescript
const defaultConfig = {
  model: "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf",
  modelCacheDir: ".my_agent/cache/models/",
  dimensions: 384,
};
```

### Behavior

1. **First use:** Checks if model exists in cache
2. **If missing:** Downloads from HuggingFace (~600MB) with progress callback
3. **Loading:** node-llama-cpp loads GGUF model into memory
4. **Embedding:** Single context instance, reused across calls
5. **Normalization:** Vectors normalized to unit length (L2 norm)

### Implementation Notes

```typescript
// Lazy loading — don't import node-llama-cpp until needed
async function createLocalEmbeddingPlugin(): Promise<EmbeddingsPlugin> {
  const { getLlama, resolveModelFile } = await import("node-llama-cpp");

  let llama: Llama | null = null;
  let model: LlamaModel | null = null;
  let context: LlamaEmbeddingContext | null = null;

  return {
    id: "embeddings-local",
    name: "Local Embeddings",
    description: "On-device embeddings using embeddinggemma-300M. No API costs, full privacy.",
    version: "1.0.0",
    dimensions: 384,
    modelName: "embeddinggemma-300M",
    modelSize: "600MB",

    async isReady() {
      return context !== null;
    },

    async needsDownload() {
      // Check if model file exists in cache
      return !await modelFileExists();
    },

    async initialize({ onProgress } = {}) {
      if (!llama) {
        llama = await getLlama({ logLevel: "error" });
      }
      if (!model) {
        const modelPath = await resolveModelFile(
          defaultConfig.model,
          defaultConfig.modelCacheDir,
          { onProgress }
        );
        model = await llama.loadModel({ modelPath });
      }
      if (!context) {
        context = await model.createEmbeddingContext();
      }
    },

    async embed(text: string) {
      if (!context) throw new Error("Plugin not initialized");
      const result = await context.getEmbeddingFor(text);
      return normalizeVector(Array.from(result.vector));
    },

    async embedBatch(texts: string[]) {
      return Promise.all(texts.map(t => this.embed(t)));
    },

    async cleanup() {
      context = null;
      model = null;
      llama = null;
    },

    async deleteModel() {
      await this.cleanup();
      await deleteModelFiles(defaultConfig.modelCacheDir);
    },
  };
}
```

---

## Plugin Registry

Plugins are registered and managed by the PluginRegistry.

```typescript
interface PluginRegistry {
  // Registration
  register(plugin: EmbeddingsPlugin): void;
  unregister(pluginId: string): void;

  // Discovery
  list(): EmbeddingsPlugin[];
  get(pluginId: string): EmbeddingsPlugin | null;

  // Active plugin
  getActive(): EmbeddingsPlugin | null;
  setActive(pluginId: string): Promise<void>;

  // Persistence
  getActivePluginId(): string;  // From config
  setActivePluginId(id: string): void;  // To config
}
```

### Configuration Storage

```yaml
# .my_agent/config.yaml
memory:
  embeddingsPlugin: "embeddings-local"  # Active plugin ID
  plugins:
    embeddings-local:
      model: "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf"
    embeddings-openai:
      apiKey: "${OPENAI_API_KEY}"
      model: "text-embedding-3-small"
```

---

## Dashboard Settings UI

### Memory Settings Section

```
┌─────────────────────────────────────────────────────────────────┐
│  MEMORY                                                          │
│  ───────────────────────────────────────────────────────────    │
│                                                                  │
│  Index Status: ✓ 47 files, 312 chunks                           │
│  Last Sync: 2 minutes ago                                        │
│                                                                  │
│  [Recreate Memory Database]                                      │
│                                                                  │
│  ───────────────────────────────────────────────────────────    │
│                                                                  │
│  EMBEDDINGS                                                      │
│                                                                  │
│  Active: Local Embeddings (embeddinggemma-300M)         [Change] │
│  Status: ✓ Ready (model loaded)                                  │
│  Model size: 600MB                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Plugin Switcher

When user clicks [Change]:

```
┌─────────────────────────────────────────────────────────────────┐
│  SELECT EMBEDDINGS PROVIDER                                      │
│  ───────────────────────────────────────────────────────────    │
│                                                                  │
│  ● Local Embeddings (active)                                     │
│    embeddinggemma-300M · 600MB · Free, private                   │
│    [Delete Model]                                                │
│                                                                  │
│  ○ OpenAI Embeddings                                             │
│    text-embedding-3-small · API key required                     │
│    [Configure]                                                   │
│                                                                  │
│  ○ Disable Semantic Search                                       │
│    Keyword search only (FTS5)                                    │
│                                                                  │
│                                           [Cancel] [Apply]       │
└─────────────────────────────────────────────────────────────────┘
```

### Download Progress

When initializing a plugin that needs download:

```
┌─────────────────────────────────────────────────────────────────┐
│  DOWNLOADING MODEL                                               │
│                                                                  │
│  embeddinggemma-300M (600MB)                                     │
│  ████████████████░░░░░░░░░░░░░░░░░░░░░░░░  42%                  │
│  252MB / 600MB · 2.4 MB/s · ~2 min remaining                    │
│                                                                  │
│                                                        [Cancel]  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Future Plugins

### `embeddings-openai`

```typescript
{
  id: "embeddings-openai",
  name: "OpenAI Embeddings",
  description: "Cloud embeddings via OpenAI API. Requires API key.",
  dimensions: 1536,  // text-embedding-3-small
  modelName: "text-embedding-3-small",

  // No download needed
  async needsDownload() { return false; },

  // Requires configuration
  async configure({ apiKey, model }) {
    this.apiKey = apiKey;
    this.model = model || "text-embedding-3-small";
  },
}
```

### `embeddings-ollama`

```typescript
{
  id: "embeddings-ollama",
  name: "Ollama Embeddings",
  description: "Local embeddings via Ollama server. Requires Ollama running.",

  async isReady() {
    // Check if Ollama server is running
    return await checkOllamaHealth();
  },
}
```

### `embeddings-voyage`

```typescript
{
  id: "embeddings-voyage",
  name: "Voyage AI Embeddings",
  description: "High-quality embeddings optimized for retrieval.",
  dimensions: 1024,
  modelName: "voyage-2",
}
```

---

## Reindexing on Plugin Change

When the active embeddings plugin changes, the memory index must be rebuilt because:
- Different plugins produce different vector dimensions
- Same text → different embeddings across providers
- Mixing embeddings from different sources breaks similarity search

### Automatic Reindex Trigger

```typescript
async function setActivePlugin(pluginId: string): Promise<void> {
  const currentId = registry.getActivePluginId();
  if (currentId === pluginId) return;

  const newPlugin = registry.get(pluginId);
  if (!newPlugin) throw new Error(`Plugin not found: ${pluginId}`);

  // Initialize new plugin (may download model)
  await newPlugin.initialize();

  // Update config
  registry.setActivePluginId(pluginId);

  // Trigger full reindex with new embeddings
  await memoryManager.rebuildIndex({ reason: "plugin-change" });

  // Optionally cleanup old plugin
  const oldPlugin = registry.get(currentId);
  if (oldPlugin) {
    await oldPlugin.cleanup();
  }
}
```

### Index Metadata

Store which plugin was used to build the index:

```typescript
// In memory.db meta table
{
  key: "index_meta",
  value: JSON.stringify({
    embeddingsPlugin: "embeddings-local",
    embeddingsModel: "embeddinggemma-300M",
    dimensions: 384,
    chunkTokens: 400,
    chunkOverlap: 80,
    builtAt: "2026-02-24T10:30:00Z",
  })
}
```

On startup, compare current plugin config vs stored metadata. If mismatch → prompt for reindex.

---

## Graceful Degradation

If no embeddings plugin is active or ready:
- `recall()` falls back to FTS5-only search (keyword matching)
- Results are still useful, just less semantic
- UI shows: "Semantic search disabled. Enable in Settings > Memory."

```typescript
async function search(query: string): Promise<SearchResults> {
  const plugin = registry.getActive();

  if (plugin && await plugin.isReady()) {
    // Hybrid search: vector + BM25
    const queryVec = await plugin.embed(query);
    return hybridSearch(queryVec, query);
  } else {
    // Fallback: BM25 only
    return keywordSearch(query);
  }
}
```

---

## Security Considerations

1. **API keys:** Store in config with `${ENV_VAR}` substitution, never hardcode
2. **Model downloads:** Verify checksums, use HTTPS only
3. **Plugin loading:** Only load plugins from trusted sources (shipped or user-installed)
4. **Network access:** Local plugin works offline; cloud plugins need network

---

## Implementation Phases

**M6-S1:** Core infrastructure
- Plugin interface definition
- Plugin registry
- `embeddings-local` plugin (node-llama-cpp)
- Graceful fallback to FTS5

**M6-S2:** Dashboard integration
- Settings UI for plugin management
- Download progress indicator
- Plugin switcher

**Future:** Additional plugins
- `embeddings-openai`
- `embeddings-ollama`
- Community plugin support

---

_Design specification created: 2026-02-24_
