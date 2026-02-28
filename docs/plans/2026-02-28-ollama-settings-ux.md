# Ollama Settings & Health UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist Ollama settings to config.yaml and implement clear 4-state UI (Not Set Up / Connecting / Active / Error).

**Architecture:** Config stored in `.my_agent/config.yaml` alongside channels. Plugin states map to existing `PluginState` enum. Enhanced healthCheck verifies both server AND model availability.

**Tech Stack:** TypeScript, YAML (yaml package), Vitest, Alpine.js, Playwright

---

## Task 1: Add Embeddings Config to config.ts

**Files:**
- Modify: `packages/core/src/config.ts`

**Step 1: Add EmbeddingsConfig interface**

Add after line 70 (after YamlConfig interface):

```typescript
export interface EmbeddingsConfig {
  plugin: 'ollama' | 'local' | 'disabled'
  host?: string  // Ollama only
  model?: string // Ollama only
}
```

**Step 2: Extend YamlConfig interface**

Add to YamlConfig (inside the interface, after `health?`):

```typescript
  embeddings?: EmbeddingsConfig
```

**Step 3: Add loadEmbeddingsConfig function**

Add after `loadConfig()` function:

```typescript
/**
 * Load embeddings configuration.
 * Priority: config.yaml > OLLAMA_HOST env var > defaults
 */
export function loadEmbeddingsConfig(agentDir?: string): EmbeddingsConfig {
  const dir = agentDir ?? process.env.MY_AGENT_DIR ?? DEFAULT_AGENT_DIR
  const yaml = loadYamlConfig(dir)

  // If config.yaml has embeddings section, use it
  if (yaml?.embeddings) {
    return {
      plugin: yaml.embeddings.plugin ?? 'disabled',
      host: yaml.embeddings.host,
      model: yaml.embeddings.model,
    }
  }

  // Migration: if OLLAMA_HOST env var set but no config, migrate it
  const envHost = process.env.OLLAMA_HOST
  if (envHost) {
    return {
      plugin: 'ollama',
      host: envHost,
      model: 'nomic-embed-text',
    }
  }

  // Default: disabled
  return { plugin: 'disabled' }
}
```

**Step 4: Add saveEmbeddingsConfig function**

Add after `loadEmbeddingsConfig`:

```typescript
/**
 * Save embeddings configuration to config.yaml.
 */
export function saveEmbeddingsConfig(
  embeddings: EmbeddingsConfig,
  agentDir?: string,
): void {
  const dir = agentDir ?? process.env.MY_AGENT_DIR ?? DEFAULT_AGENT_DIR
  const configPath = path.join(dir, CONFIG_FILENAME)

  let yaml: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    try {
      yaml = (parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>) ?? {}
    } catch {
      yaml = {}
    }
  }

  yaml.embeddings = embeddings
  writeFileSync(configPath, stringify(yaml, { lineWidth: 120 }), 'utf-8')
}
```

**Step 5: Export new functions**

Already exported via `export function` declarations.

**Step 6: Run build to verify**

Run: `cd packages/core && npm run build`
Expected: Compiles successfully

**Step 7: Commit**

```bash
git add packages/core/src/config.ts
git commit -m "feat(config): add embeddings section to config.yaml schema"
```

---

## Task 2: Enhance healthCheck with Model Verification

**Files:**
- Modify: `packages/core/src/memory/embeddings/ollama.ts`

**Step 1: Rewrite healthCheck to include model check**

Replace the `healthCheck()` method (lines 158-179):

```typescript
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
```

**Step 2: Run build**

Run: `cd packages/core && npm run build`
Expected: Compiles successfully

**Step 3: Commit**

```bash
git add packages/core/src/memory/embeddings/ollama.ts
git commit -m "feat(ollama): enhance healthCheck to verify model availability"
```

---

## Task 3: Add onDegraded Callback to Ollama Plugin

**Files:**
- Modify: `packages/core/src/memory/embeddings/ollama.ts`

**Step 1: Extend OllamaPluginConfig interface**

Update lines 15-18:

```typescript
export interface OllamaPluginConfig {
  host?: string
  model?: string
  onDegraded?: (health: HealthResult) => void
}
```

**Step 2: Store callback in constructor**

Add private field after line 33:

```typescript
private onDegraded?: (health: HealthResult) => void
```

Update constructor to store it:

```typescript
constructor(config?: OllamaPluginConfig) {
  this.host = config?.host ?? DEFAULT_HOST
  this.model = config?.model ?? DEFAULT_MODEL
  this.onDegraded = config?.onDegraded
}
```

**Step 3: Add retry logic to embedInternal**

Replace `embedInternal` method:

```typescript
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
```

**Step 4: Add retry logic to embedBatchInternal**

Replace `embedBatchInternal` method (similar pattern):

```typescript
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
```

**Step 5: Run build**

Run: `cd packages/core && npm run build`
Expected: Compiles successfully

**Step 6: Commit**

```bash
git add packages/core/src/memory/embeddings/ollama.ts
git commit -m "feat(ollama): add embed retry logic and onDegraded callback"
```

---

## Task 4: Skip Test Embed on Re-initialization

**Files:**
- Modify: `packages/core/src/memory/embeddings/ollama.ts`

**Step 1: Modify initialize() to skip test embed if dimensions known**

Replace the `initialize()` method:

```typescript
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
```

**Step 2: Update cleanup() to preserve dimensions for recovery**

The current `cleanup()` clears dimensions. For recovery to skip test embed, we need a separate "soft cleanup" vs "full cleanup". But actually, for recovery scenarios, the plugin instance is reused, so dimensions are preserved. The current code is fine.

Actually, looking at the flow: when degraded → recovery, the same plugin instance is used, so `this.dimensions` is preserved. Only `this.ready` is false. The change above handles this correctly.

**Step 3: Run build**

Run: `cd packages/core && npm run build`
Expected: Compiles successfully

**Step 4: Commit**

```bash
git add packages/core/src/memory/embeddings/ollama.ts
git commit -m "feat(ollama): skip test embed on re-initialization if dimensions known"
```

---

## Task 5: Update Dashboard to Read/Write Embeddings Config

**Files:**
- Modify: `packages/dashboard/src/index.ts`

**Step 1: Import config functions**

Add to imports at top of file (around line 15):

```typescript
import {
  loadEmbeddingsConfig,
  saveEmbeddingsConfig,
  type EmbeddingsConfig,
} from "@anthropic-ai/my-agent-core/config";
```

**Step 2: Read embeddings config on startup**

Replace the plugin registration code (lines 358-365):

```typescript
// Create plugin registry and register available plugins
pluginRegistry = new PluginRegistry();
pluginRegistry.register(new LocalEmbeddingsPlugin(agentDir));

// Load embeddings config and create Ollama plugin with correct settings
const embeddingsConfig = loadEmbeddingsConfig(agentDir);
const ollamaPlugin = new OllamaEmbeddingsPlugin({
  host: embeddingsConfig.plugin === 'ollama'
    ? (embeddingsConfig.host ?? "http://localhost:11434")
    : "http://localhost:11434",
  model: embeddingsConfig.model ?? "nomic-embed-text",
  onDegraded: (health) => {
    if (pluginRegistry) {
      pluginRegistry.setDegraded(health);
      server.statePublisher?.publishMemory();
    }
  },
});
pluginRegistry.register(ollamaPlugin);

// Store config reference for later saves
(server as any).embeddingsConfig = embeddingsConfig;
```

**Step 3: Update plugin restoration logic**

After the plugin restoration (around line 385-430), add migration logging:

```typescript
// Log if we migrated from env var
if (process.env.OLLAMA_HOST && !loadYamlConfig(agentDir)?.embeddings) {
  console.log(
    `Migrated OLLAMA_HOST=${process.env.OLLAMA_HOST} to config.yaml`,
  );
  saveEmbeddingsConfig(embeddingsConfig, agentDir);
}
```

**Step 4: Run build**

Run: `cd packages/dashboard && npm run build`
Expected: Compiles successfully

**Step 5: Commit**

```bash
git add packages/dashboard/src/index.ts
git commit -m "feat(dashboard): read embeddings config from config.yaml on startup"
```

---

## Task 6: Add API Endpoint to Save Embeddings Config

**Files:**
- Modify: `packages/dashboard/src/routes/memory.ts`

**Step 1: Import saveEmbeddingsConfig**

Add to imports:

```typescript
import {
  saveEmbeddingsConfig,
  type EmbeddingsConfig,
} from "@anthropic-ai/my-agent-core/config";
```

**Step 2: Add POST /api/memory/embeddings/config endpoint**

Add before the closing of `registerMemoryRoutes`:

```typescript
/**
 * POST /api/memory/embeddings/config
 * Save embeddings configuration to config.yaml
 */
fastify.post<{
  Body: EmbeddingsConfig;
}>("/embeddings/config", async (request, reply) => {
  const { plugin, host, model } = request.body;

  if (!plugin || !['ollama', 'local', 'disabled'].includes(plugin)) {
    return reply.code(400).send({
      error: "Invalid plugin. Must be 'ollama', 'local', or 'disabled'.",
    });
  }

  const config: EmbeddingsConfig = { plugin };
  if (plugin === 'ollama') {
    config.host = host ?? 'http://localhost:11434';
    config.model = model ?? 'nomic-embed-text';
  }

  try {
    const agentDir = fastify.memoryDb
      ? (fastify.memoryDb as any).agentDir
      : undefined;
    saveEmbeddingsConfig(config, agentDir);

    // Update running plugin if Ollama
    if (plugin === 'ollama' && fastify.pluginRegistry) {
      const ollamaPlugin = fastify.pluginRegistry.get('embeddings-ollama');
      if (ollamaPlugin) {
        await ollamaPlugin.configure({ host: config.host, model: config.model });
      }
    }

    return reply.send({ success: true, config });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({
      error: "Failed to save embeddings config",
    });
  }
});
```

**Step 3: Run build**

Run: `cd packages/dashboard && npm run build`
Expected: Compiles successfully

**Step 4: Commit**

```bash
git add packages/dashboard/src/routes/memory.ts
git commit -m "feat(api): add POST /api/memory/embeddings/config endpoint"
```

---

## Task 7: Update State Publisher with 4-State Status

**Files:**
- Modify: `packages/dashboard/src/state/state-publisher.ts`

**Step 1: Add pluginState field to memory status**

Update the `buildMemoryState` method to include a `pluginState` field:

Find the return object (around line 359-390) and add:

```typescript
// Determine 4-state plugin status
let pluginState: 'not_set_up' | 'connecting' | 'active' | 'error' = 'not_set_up';
if (active) {
  pluginState = 'active';
} else if (degradedHealth) {
  pluginState = 'error';
} else if (intendedId) {
  // Has intended but not active — connecting or recovering
  pluginState = 'connecting';
}
```

Add `pluginState` to the return object:

```typescript
return {
  initialized: true,
  pluginState,  // NEW
  filesIndexed: status.filesIndexed,
  // ... rest unchanged
};
```

**Step 2: Run build**

Run: `cd packages/dashboard && npm run build`
Expected: Compiles successfully

**Step 3: Commit**

```bash
git add packages/dashboard/src/state/state-publisher.ts
git commit -m "feat(state): add pluginState to memory status for 4-state UI"
```

---

## Task 8: Update Settings Panel UI (HTML)

**Files:**
- Modify: `packages/dashboard/public/index.html`

**Step 1: Find the Memory settings panel**

Search for the embeddings plugin section in the Settings tab. Update the Ollama section to show different states.

This is a larger UI change. The key changes:

1. Remove "Connect" button when already active
2. Show state-appropriate UI:
   - **Not Set Up**: Show setup form
   - **Connecting**: Show spinner with breathing orange
   - **Active**: Show green status + "Test Model Load" button
   - **Error**: Show red status + error message + "Retry" / "Use Local" buttons

**Step 2: Update the embeddings plugin UI section**

Find the embeddings section (around line 1330-1400) and replace with state-aware UI:

```html
<!-- Embeddings Status -->
<template x-if="memoryStatus?.pluginState === 'not_set_up'">
  <div class="p-4 bg-gray-50 rounded-lg border border-gray-200">
    <h4 class="text-sm font-medium text-gray-700 mb-3">Set Up Embeddings</h4>
    <div class="space-y-3">
      <div>
        <label class="block text-sm text-gray-600 mb-1">Ollama Host</label>
        <input type="text" x-model="ollamaHost"
          class="w-full px-3 py-2 border rounded-lg text-sm"
          placeholder="http://localhost:11434">
      </div>
      <div>
        <label class="block text-sm text-gray-600 mb-1">Model</label>
        <input type="text" x-model="ollamaModel"
          class="w-full px-3 py-2 border rounded-lg text-sm"
          placeholder="nomic-embed-text">
      </div>
      <button @click="setupOllama()"
        class="w-full px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600">
        Set Up Ollama
      </button>
    </div>
  </div>
</template>

<template x-if="memoryStatus?.pluginState === 'connecting'">
  <div class="p-4 bg-orange-50 rounded-lg border border-orange-200">
    <div class="flex items-center gap-3">
      <div class="w-3 h-3 rounded-full bg-orange-400 animate-pulse"></div>
      <span class="text-sm text-orange-700">Connecting to Ollama...</span>
    </div>
  </div>
</template>

<template x-if="memoryStatus?.pluginState === 'active'">
  <div class="p-4 bg-green-50 rounded-lg border border-green-200">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-3 h-3 rounded-full bg-green-400"></div>
        <span class="text-sm text-green-700" x-text="memoryStatus?.activePlugin?.model || 'Active'"></span>
      </div>
      <button @click="testModelLoad()"
        class="px-3 py-1 text-sm text-green-700 hover:bg-green-100 rounded">
        Test Model Load
      </button>
    </div>
  </div>
</template>

<template x-if="memoryStatus?.pluginState === 'error'">
  <div class="p-4 bg-red-50 rounded-lg border border-red-200">
    <div class="flex items-center gap-3 mb-3">
      <div class="w-3 h-3 rounded-full bg-red-400"></div>
      <span class="text-sm text-red-700" x-text="memoryStatus?.degraded?.error || 'Error'"></span>
    </div>
    <div class="flex gap-2">
      <button @click="retryOllama()"
        class="px-3 py-1 text-sm bg-red-100 text-red-700 hover:bg-red-200 rounded">
        Retry
      </button>
      <button @click="useLocalEmbeddings()"
        class="px-3 py-1 text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 rounded">
        Use Local Embeddings
      </button>
    </div>
  </div>
</template>
```

**Step 3: Commit**

```bash
git add packages/dashboard/public/index.html
git commit -m "feat(ui): implement 4-state embeddings settings panel"
```

---

## Task 9: Update Header Status Icon

**Files:**
- Modify: `packages/dashboard/public/index.html`

**Step 1: Find the memory status icon in header**

Search for the memory status indicator in the header (top-right area). Update to show 4 states:

```html
<!-- Memory Status Icon (Header) -->
<div class="flex items-center gap-2 cursor-pointer" @click="openSettings('memory')">
  <!-- Not Set Up: Gray -->
  <template x-if="memoryStatus?.pluginState === 'not_set_up'">
    <div class="flex items-center gap-1.5 text-gray-500">
      <div class="w-2 h-2 rounded-full bg-gray-400"></div>
      <span class="text-xs">Not configured</span>
    </div>
  </template>

  <!-- Connecting: Breathing Orange -->
  <template x-if="memoryStatus?.pluginState === 'connecting'">
    <div class="flex items-center gap-1.5 text-orange-500">
      <div class="w-2 h-2 rounded-full bg-orange-400 animate-pulse"></div>
      <span class="text-xs">Connecting...</span>
    </div>
  </template>

  <!-- Active: Green -->
  <template x-if="memoryStatus?.pluginState === 'active'">
    <div class="flex items-center gap-1.5 text-green-600">
      <div class="w-2 h-2 rounded-full bg-green-400"></div>
      <span class="text-xs" x-text="memoryStatus?.activePlugin?.model"></span>
    </div>
  </template>

  <!-- Error: Red -->
  <template x-if="memoryStatus?.pluginState === 'error'">
    <div class="flex items-center gap-1.5 text-red-500">
      <div class="w-2 h-2 rounded-full bg-red-400"></div>
      <span class="text-xs">Ollama unavailable</span>
    </div>
  </template>
</div>
```

**Step 2: Commit**

```bash
git add packages/dashboard/public/index.html
git commit -m "feat(ui): update header memory status icon with 4 states"
```

---

## Task 10: Add JavaScript Functions for UI Actions

**Files:**
- Modify: `packages/dashboard/public/js/app.js`

**Step 1: Add ollamaModel to Alpine data**

Find the Alpine data initialization and add:

```javascript
ollamaModel: "nomic-embed-text",
```

**Step 2: Add setupOllama function**

```javascript
async setupOllama() {
  try {
    const response = await fetch('/api/memory/embeddings/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plugin: 'ollama',
        host: this.ollamaHost,
        model: this.ollamaModel,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to save config');
    }

    // Trigger connect
    await this.connectEmbeddings('ollama');
  } catch (err) {
    console.error('Setup Ollama failed:', err);
    this.showNotification('Failed to set up Ollama: ' + err.message, 'error');
  }
},
```

**Step 3: Add retryOllama function**

```javascript
async retryOllama() {
  try {
    await this.connectEmbeddings('ollama');
  } catch (err) {
    console.error('Retry failed:', err);
  }
},
```

**Step 4: Add useLocalEmbeddings function**

```javascript
async useLocalEmbeddings() {
  try {
    const response = await fetch('/api/memory/embeddings/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plugin: 'local' }),
    });

    if (!response.ok) {
      throw new Error('Failed to save config');
    }

    await this.connectEmbeddings('local');
  } catch (err) {
    console.error('Switch to local failed:', err);
    this.showNotification('Failed to switch to local embeddings', 'error');
  }
},
```

**Step 5: Add testModelLoad function**

```javascript
async testModelLoad() {
  try {
    const response = await fetch('/api/memory/search?q=test&maxResults=1');
    if (response.ok) {
      this.showNotification('Model loaded successfully!', 'success');
    } else {
      this.showNotification('Model load test failed', 'error');
    }
  } catch (err) {
    this.showNotification('Model load test failed: ' + err.message, 'error');
  }
},
```

**Step 6: Commit**

```bash
git add packages/dashboard/public/js/app.js
git commit -m "feat(ui): add JavaScript functions for embeddings UI actions"
```

---

## Task 11: Write Unit Tests

**Files:**
- Create: `packages/core/tests/ollama-plugin.test.ts`

**Step 1: Create test file with all unit tests**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OllamaEmbeddingsPlugin } from '../src/memory/embeddings/ollama.js'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('OllamaEmbeddingsPlugin', () => {
  let plugin: OllamaEmbeddingsPlugin

  beforeEach(() => {
    mockFetch.mockReset()
    plugin = new OllamaEmbeddingsPlugin({
      host: 'http://test:11434',
      model: 'nomic-embed-text',
    })
  })

  describe('healthCheck', () => {
    it('returns healthy when server up and model available', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: 'nomic-embed-text:latest' }],
        }),
      })

      const result = await plugin.healthCheck()
      expect(result.healthy).toBe(true)
    })

    it('returns unhealthy when server down', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))

      const result = await plugin.healthCheck()
      expect(result.healthy).toBe(false)
      expect(result.message).toContain('Cannot reach')
    })

    it('returns unhealthy when model missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: 'other-model:latest' }],
        }),
      })

      const result = await plugin.healthCheck()
      expect(result.healthy).toBe(false)
      expect(result.message).toContain('not installed')
    })

    it('handles model name variants with :latest suffix', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: 'nomic-embed-text:latest' }],
        }),
      })

      const result = await plugin.healthCheck()
      expect(result.healthy).toBe(true)
    })
  })

  describe('initialize', () => {
    it('succeeds when health check passes and embed works', async () => {
      // Health check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: 'nomic-embed-text' }],
        }),
      })
      // Test embed
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          embeddings: [[0.1, 0.2, 0.3]],
        }),
      })

      await plugin.initialize()
      expect(await plugin.isReady()).toBe(true)
      expect(plugin.getDimensions()).toBe(3)
    })

    it('throws when server down', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))

      await expect(plugin.initialize()).rejects.toThrow('Cannot reach')
    })

    it('skips test embed on re-initialization when dimensions known', async () => {
      // First init
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'nomic-embed-text' }] }),
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
      })
      await plugin.initialize()

      // Reset ready but keep dimensions
      ;(plugin as any).ready = false

      // Re-init (should only call health check, not embed)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'nomic-embed-text' }] }),
      })
      await plugin.initialize()

      // Should have 3 fetch calls total (2 first init + 1 re-init health)
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })
  })

  describe('embed', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'nomic-embed-text' }] }),
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embeddings: [[0.6, 0.8]] }),
      })
      await plugin.initialize()
    })

    it('returns normalized vector on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embeddings: [[3, 4]] }),
      })

      const result = await plugin.embed('test')
      expect(result).toHaveLength(2)
      expect(result[0]).toBeCloseTo(0.6)
      expect(result[1]).toBeCloseTo(0.8)
    })

    it('retries on first failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('timeout'))
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embeddings: [[1, 0]] }),
      })

      const result = await plugin.embed('test')
      expect(result).toHaveLength(2)
    })

    it('calls onDegraded when both attempts fail', async () => {
      const onDegraded = vi.fn()
      const pluginWithCallback = new OllamaEmbeddingsPlugin({
        host: 'http://test:11434',
        model: 'nomic-embed-text',
        onDegraded,
      })
      // Initialize
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'nomic-embed-text' }] }),
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embeddings: [[0.6, 0.8]] }),
      })
      await pluginWithCallback.initialize()

      // Both embed attempts fail
      mockFetch.mockRejectedValueOnce(new Error('fail1'))
      mockFetch.mockRejectedValueOnce(new Error('fail2'))

      await expect(pluginWithCallback.embed('test')).rejects.toThrow()
      expect(onDegraded).toHaveBeenCalledWith(
        expect.objectContaining({ healthy: false }),
      )
    })
  })

  describe('configure', () => {
    it('resets ready state', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'nomic-embed-text' }] }),
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embeddings: [[0.1]] }),
      })
      await plugin.initialize()

      await plugin.configure({ host: 'http://new:11434' })

      // isReady should now be false (but won't call healthCheck since ready=false)
      expect((plugin as any).ready).toBe(false)
    })
  })
})
```

**Step 2: Run tests**

Run: `cd packages/core && npx vitest run tests/ollama-plugin.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/core/tests/ollama-plugin.test.ts
git commit -m "test(ollama): add unit tests for plugin with mocked fetch"
```

---

## Task 12: Write Integration Tests

**Files:**
- Create: `packages/core/tests/ollama-integration.test.ts`

**Step 1: Create integration test file**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { OllamaEmbeddingsPlugin } from '../src/memory/embeddings/ollama.js'

const OLLAMA_HOST = process.env.OLLAMA_HOST
const SKIP_REASON = 'Set OLLAMA_HOST env var to run integration tests'

describe.skipIf(!OLLAMA_HOST)('OllamaEmbeddingsPlugin Integration', () => {
  let plugin: OllamaEmbeddingsPlugin

  beforeAll(() => {
    plugin = new OllamaEmbeddingsPlugin({
      host: OLLAMA_HOST!,
      model: 'nomic-embed-text',
    })
  })

  it('health check passes for real server', async () => {
    const result = await plugin.healthCheck()
    expect(result.healthy).toBe(true)
  })

  it('health check fails for wrong model', async () => {
    const badPlugin = new OllamaEmbeddingsPlugin({
      host: OLLAMA_HOST!,
      model: 'nonexistent-model-xyz',
    })
    const result = await badPlugin.healthCheck()
    expect(result.healthy).toBe(false)
    expect(result.message).toContain('not installed')
  })

  it('initializes and embeds text', async () => {
    await plugin.initialize()
    expect(await plugin.isReady()).toBe(true)

    const embedding = await plugin.embed('Hello world')
    expect(embedding).toHaveLength(768) // nomic-embed-text has 768 dimensions

    // Verify normalized (L2 norm ≈ 1)
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0))
    expect(norm).toBeCloseTo(1, 5)
  })

  it('embeds batch of texts', async () => {
    const texts = ['Hello', 'World', 'Test']
    const embeddings = await plugin.embedBatch(texts)

    expect(embeddings).toHaveLength(3)
    expect(embeddings[0]).toHaveLength(768)
  })

  it('completes cold load within 30 seconds', async () => {
    const start = Date.now()
    await plugin.embed('Cold load test')
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(30000)
  })
})

// Separate describe for server manipulation (requires UNRAID_API_KEY)
describe.skipIf(!process.env.UNRAID_API_KEY)('OllamaEmbeddingsPlugin Docker Control', () => {
  // These tests would manipulate the Ollama Docker container
  // Skipped unless UNRAID_API_KEY is set

  it.todo('server down causes health check failure')
  it.todo('server recovery causes health check success')
  it.todo('model removal causes health check failure')
  it.todo('model re-pull causes health check success')
})
```

**Step 2: Run tests (requires OLLAMA_HOST)**

Run: `OLLAMA_HOST=http://your-ollama-server:11434 npx vitest run tests/ollama-integration.test.ts`
Expected: Tests pass (skipped if OLLAMA_HOST not set)

**Step 3: Commit**

```bash
git add packages/core/tests/ollama-integration.test.ts
git commit -m "test(ollama): add integration tests for real Ollama server"
```

---

## Task 13: Update Documentation

**Files:**
- Modify: `docs/design/ollama-settings-ux.md`
- Modify: `docs/design/embeddings-plugin.md`
- Create: `docs/sprints/m6-s9-ollama-settings-ux/plan.md`

**Step 1: Add supersession note to ollama-settings-ux.md**

Add after the Non-Goals section:

```markdown
---

## Supersedes

This design supersedes the M6-S6 "degraded" mode UX for the Ollama plugin. The generic "degraded" state is replaced with specific, actionable error states.
```

**Step 2: Update embeddings-plugin.md config schema**

Find the config section and update to reference `embeddings:` top-level section.

**Step 3: Create sprint plan**

Copy the plan content to `docs/sprints/m6-s9-ollama-settings-ux/plan.md`.

**Step 4: Commit**

```bash
mkdir -p docs/sprints/m6-s9-ollama-settings-ux
git add docs/
git commit -m "docs: add M6-S9 sprint plan and update design docs"
```

---

## Task 14: Run Full Test Suite

**Step 1: Build core package**

Run: `cd packages/core && npm run build`

**Step 2: Run core unit tests**

Run: `cd packages/core && npx vitest run tests/ollama-plugin.test.ts`
Expected: All pass

**Step 3: Run core integration tests**

Run: `OLLAMA_HOST=http://your-ollama-server:11434 npx vitest run tests/ollama-integration.test.ts`
Expected: All pass (5 tests)

**Step 4: Start dashboard and test manually**

Run: `cd packages/dashboard && npm run dev`

Test:
1. Open http://localhost:4321
2. Go to Settings → Memory
3. Verify state shows correctly
4. Change host, verify it saves
5. Stop Ollama → verify Error state
6. Start Ollama → verify auto-recovery

**Step 5: Commit final state**

```bash
git add -A
git commit -m "feat(M6-S9): complete Ollama settings persistence and 4-state UX"
```

---

## Verification Checklist

After all tasks complete:

- [ ] Unit tests pass (14 tests)
- [ ] Integration tests pass against real Ollama (5 tests)
- [ ] Config saved to config.yaml persists across restart
- [ ] Header icon shows correct state (Not Set Up / Connecting / Active / Error)
- [ ] Settings panel shows correct UI for each state
- [ ] "Retry" button triggers immediate health check
- [ ] "Use Local Embeddings" switches plugin and persists
- [ ] Stop Ollama → Error state within 30s
- [ ] Start Ollama → auto-recovers to Active within 60s
- [ ] ROADMAP.md updated with M6-S9
