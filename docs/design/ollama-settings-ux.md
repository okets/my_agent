# Ollama Settings & Health UX

> **Status:** Approved
> **Milestone:** M6-S9
> **Created:** 2026-02-28

---

## Problem

The Ollama embeddings plugin has poor UX:

1. **Settings not persisted** — Host is set via `OLLAMA_HOST` env var or defaults to localhost. When user configures a remote host in the UI, it's stored in-memory only and lost on restart.

2. **Confusing UI states** — "degraded" is technical jargon. Users see amber "degraded" badge but don't know what action to take. "Connect" button appears on an already-configured plugin.

3. **No recovery feedback** — When Ollama goes down and comes back, the UI doesn't clearly communicate the transition.

---

## Solution

### 1. Config Persistence

Store embeddings settings in `.my_agent/config.yaml` alongside other user config:

```yaml
brain:
  model: claude-sonnet-4-5-20250929
agent:
  nickname: Nina
channels:
  ninas_whatsapp:
    # ...

# NEW
embeddings:
  plugin: ollama           # "ollama" | "local" | "disabled"
  host: http://your-ollama-server:11434
  model: nomic-embed-text
```

**On startup:**
1. Read `config.embeddings`
2. If `plugin: ollama`, create `OllamaEmbeddingsPlugin` with `host` and `model` from config
3. If `plugin: local`, create `LocalEmbeddingsPlugin`
4. If missing or `plugin: disabled`, no embeddings (FTS only)

**On settings change via UI:**
1. Update plugin in-memory
2. Write to `config.yaml`
3. Re-run health check

### 2. Plugin States

Four clear states replace the ambiguous "degraded":

| State | Trigger | Meaning |
|-------|---------|---------|
| **Not Set Up** | No embeddings config or `plugin: disabled` | User hasn't configured embeddings yet |
| **Connecting** | User clicked "Set Up" or server restarting | Initialization in progress |
| **Active** | `healthCheck()` passes | Everything working |
| **Error** | `healthCheck()` fails | Something wrong, needs attention |

### 3. Health Check Logic

Enhanced `healthCheck()` in `OllamaEmbeddingsPlugin`:

1. **Check server:** `GET /api/tags` with 5s timeout
   - Fails → Error: "Cannot reach Ollama server at {host}"
2. **Check model:** Parse response, verify configured model is in list
   - Missing → Error: "Model '{model}' is not installed on the Ollama server"
3. **Both pass** → Active

### 4. Settings Panel UI

**Not Set Up state:**
- Setup form: host input, model dropdown, "Set Up" button
- No status indicators

**Connecting state:**
- Breathing orange indicator
- "Connecting to Ollama..." text
- Form disabled

**Active state:**
- Green indicator
- Model name displayed
- "Test Model Load" button (triggers health check + test embedding)
- "Reconfigure" link to change settings

**Error state:**
- Red indicator
- Specific error message (human-readable)
- Two action buttons:
  - **"Retry"** — immediate health check
  - **"Use Local Embeddings"** — switches plugin, updates config

### 5. Header Status Icon

Top-right memory status icon on Home tab reflects plugin state:

| State | Icon | Color | Label |
|-------|------|-------|-------|
| **Not Set Up** | Memory | Gray | "Embeddings not configured" |
| **Connecting** | Memory + breathing | Orange (pulse) | "Connecting..." |
| **Active** | Memory | Green | "{model}" (e.g., "nomic-embed-text") |
| **Error** | Memory + warning | Red | "Ollama unavailable" |

Clicking the icon opens the Memory section in Settings.

### 6. Recovery Flow

- Health checks run every 30s while in Error state
- When health passes → auto-transition to Active
- "Retry" button triggers immediate health check (skips 30s wait)
- UI updates in real-time via existing WebSocket state publishing

---

## Error Messages

Human-readable messages with actionable guidance:

| Condition | Error Message |
|-----------|---------------|
| Server unreachable | "Cannot reach Ollama server at {host}" |
| Server timeout | "Ollama server at {host} is not responding" |
| Model not found | "Model '{model}' is not installed on the Ollama server" |
| Model load failure | "Model '{model}' failed to produce embeddings" |

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/core/src/config.ts` | Add `embeddings` section to config schema |
| `packages/core/src/memory/embeddings/ollama.ts` | Enhanced `healthCheck()` with model verification |
| `packages/dashboard/src/index.ts` | Read embeddings config, persist on change |
| `packages/dashboard/public/index.html` | Settings panel states, header icon |
| `packages/dashboard/public/js/app.js` | State machine, config save API calls |
| `packages/dashboard/src/routes/memory.ts` | API endpoints for config persistence |
| `packages/dashboard/src/state/state-publisher.ts` | Publish 4-state status (not just active/degraded) |

---

## Testing

### Unit Tests (mocked)

1. `healthCheck()` — server up + model available → healthy
2. `healthCheck()` — server down → error with correct message
3. `healthCheck()` — server up, model missing → error with correct message
4. Config parsing — valid embeddings section
5. Config parsing — missing embeddings section → disabled
6. Config writing — settings change persists

### Integration Tests (real Ollama)

1. Start with remote host in config → connects correctly
2. Change host via UI → persisted, survives restart
3. Stop Ollama → UI shows Error state with correct message
4. Start Ollama → auto-recovers to Active
5. Remove model → Error "not installed"
6. Re-pull model → auto-recovers
7. "Use Local Embeddings" → switches plugin, updates config
8. "Retry" button → immediate health check

### E2E Validation

Browser-based tests using Playwright:
1. Fresh setup → Not Set Up state shown
2. Configure Ollama → Connecting → Active
3. Simulate server down → Error state with message
4. Verify header icon reflects all 4 states
5. "Test Model Load" triggers embedding and shows result

---

## Migration

Existing users with `OLLAMA_HOST` env var:
- On first startup after update, read env var
- Write to config.yaml if embeddings section missing
- Log: "Migrated OLLAMA_HOST to config.yaml"
- Env var continues to work as override (for CI/deployment flexibility)

Priority: `config.yaml` > `OLLAMA_HOST` env var > localhost default

---

## Non-Goals

- Plugin selection UI (out of scope — this is about Ollama plugin UX once selected)
- Local embeddings plugin settings (separate design if needed)
- Multi-plugin configuration (YAGNI)
