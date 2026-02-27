# Embeddings System Validation — Test Report

Sprint: Embeddings System E2E Testing
Date: 2026-02-26
Tech Lead: Claude Opus

---

## Test Summary

| # | Test | Status | Notes |
|---|------|--------|-------|
| 1 | Local plugin activation | PASS | 768 dims, embeddinggemma-300M |
| 2 | Local plugin rebuild + search | PASS | 7 files, 20 chunks, 0 errors, 1.8s |
| 3 | Ollama plugin activation | PASS | 768 dims, nomic-embed-text via $OLLAMA_HOST |
| 4 | Ollama plugin rebuild + search | PASS | 7 files, 0 errors, 5.4s |
| 5 | Plugin switching (local → ollama) | PASS | Warning shown, vector index cleared |
| 6 | Model change warning | PASS | "Embeddings model changed. Vector index cleared — rebuild needed." |
| 7 | Same-model re-activation (no warning) | PASS | No warning when plugin/model unchanged |
| 8 | Deactivate plugin ("none") | PASS | Meta cleared, UI shows disabled |
| 9 | Persistence across restart | PASS | "Restored embeddings plugin" in startup logs (both local and ollama) |
| 10 | File watcher natural flow | PASS | New file detected, chunked, embedded, searchable in <5s |
| 11 | Ollama chat model rejection | PASS | Ollama API returns "does not support embeddings", our catch wraps with helpful message |
| 12 | Settings UI — desktop | PASS | All memory controls visible and functional |
| 13 | Settings UI — mobile (390px) | PASS | Modal layout, all controls accessible |
| 14 | Local model deletion + re-download | PASS | Model deleted (314MB freed), re-downloaded on activate |
| 15 | Delete button disabled when local active | PASS | Desktop + mobile: disabled when local plugin active, enabled when switched away |

**Result: 15/15 PASS**

---

## Test Details

### 1. Local Plugin E2E

- Activated `embeddings-local` → dimensions 768
- Rebuild: 7 files added, 0 errors, 1797ms
- Search "personality traits" → `knowledge/test-embeddings.md` ranked #1 (score 0.03)
- Search uses RRF (Reciprocal Rank Fusion) with FTS5 + vector, scores range 0.01–0.03

### 2. Ollama Plugin E2E

- **Prerequisites:** Ollama running on Docker at `$OLLAMA_HOST`, `nomic-embed-text` pulled
- Activated `embeddings-ollama` → dimensions 768, warning about model change
- Rebuild: 7 files, 0 errors, 5386ms (slower than local due to network hop)
- Search "communication style preferences" → relevant results ranked at top

### 3. Plugin Switching

1. Started with local plugin active (auto-restored from persistence)
2. Deactivated (set to "none") → meta cleared, status shows no active plugin
3. Reactivated local → `resetVectorIndex` detected change (meta was cleared), showed warning, cleared vector index
4. Reactivated same local again → no warning (correctly detected no change)
5. Switched to Ollama → warning shown, rebuild worked with new model

### 4. Persistence

- Server startup log confirmed: `Restored embeddings plugin: embeddings-local (embeddinggemma-300M)`
- Verified across multiple restarts
- After switching to Ollama and restarting: `Restored embeddings plugin: embeddings-ollama (nomic-embed-text)`
- Graceful fallback: if Ollama server is unreachable on restart, logs warning and continues without embeddings

### 5. File Watcher

1. Created `knowledge/test-embeddings.md` with semantic content about embeddings
2. Waited 5s for watcher debounce
3. Searched "semantic meaning vectors" → new file's "Key Concepts" chunk ranked #1
4. All 3 chunks from new file appeared in results
5. Cleaned up test file after verification

### 6. Ollama Validation

- Direct API test: `POST /api/embed` with `gemma3:12b` (chat model) → `{"error":"this model does not support embeddings"}`
- Our `embedInternal()` throws on non-OK response
- `initialize()` catch wraps with: `"Model 'X' does not support embeddings. Use an embeddings model like 'nomic-embed-text' or 'mxbai-embed-large'."`

### 7. Settings UI

- **Desktop:** Full settings panel with Appearance, Channels, Memory sections. Memory shows stats grid (files, chunks, sync time, model), plugin dropdown, active status with Plugin/Model/Dimensions, Rebuild button, debug search.
- **Mobile (390px):** Settings opens as modal overlay. Compact layout with 2-column stats grid (Files/Chunks), dropdown, active badge, Rebuild button. All functional.
- Screenshots saved to `.playwright_output/`

### 8. Local Model Deletion & Re-download

1. Confirmed Ollama plugin was active (safe to delete local model)
2. Deleted local model via admin API: `DELETE /api/admin/memory/embeddings/local-model` with `X-Confirm-Destructive: true`
3. Verified model file removed (314MB freed)
4. Switched to local plugin → triggered `resolveModelFile()` which auto-downloaded from HuggingFace (314MB)
5. Verified model file re-appeared on disk, plugin activated successfully

### 9. Delete Button UI State

- **Desktop (local active):** "Delete Local Model" button visible, **disabled** (faded with `opacity-50`, cursor `not-allowed`). Tooltip: "Deactivate local plugin first".
- **Desktop (plugin disabled):** Button **enabled** (full pink text, clickable).
- **Mobile (local active):** Same disabled behavior in settings modal.
- **Mobile (plugin disabled):** Same enabled behavior.
- Screenshots: `settings-delete-disabled-desktop.png`, `settings-delete-enabled.png`, `settings-delete-disabled-mobile.png`

---

## Issues Found & Fixed

### Issue 1: Ollama host hardcoded to localhost

**Problem:** `OllamaEmbeddingsPlugin` was registered with `host: "http://localhost:11434"` in `index.ts`. Ollama runs on Docker at a different IP.
**Fix:** Changed to `process.env.OLLAMA_HOST ?? "http://localhost:11434"` — configurable via env var, backward compatible.
**File:** `packages/dashboard/src/index.ts`

### Issue 2: `setActive()` not awaited — stale status after plugin switch

**Problem:** `pluginRegistry.setActive()` is async (awaits `cleanup()` on previous plugin). Both `memory.ts` and `admin.ts` called it without `await`. Result: status endpoint returned old plugin immediately after switch.
**Fix:** Added `await` to all three `setActive()` calls in memory.ts (activate + "none" branches) and admin.ts.
**Files:** `packages/dashboard/src/routes/memory.ts`, `packages/dashboard/src/routes/admin.ts`

### Issue 3: Ollama host hardcoded

**Problem:** Ollama plugin registered with `host: "http://localhost:11434"`. Ollama runs on a separate host.
**Fix:** `process.env.OLLAMA_HOST ?? "http://localhost:11434"` — configurable, backward compatible.
**File:** `packages/dashboard/src/index.ts`

### Local model download flow

Model is 314MB GGUF. The `initialize()` flow uses `node-llama-cpp`'s `resolveModelFile()` which auto-downloads from HuggingFace if not cached, with `onProgress` callback for UI updates. Destructively tested: model deleted via admin API, re-downloaded successfully on next local plugin activation.

### Issue 4: Delete Local Model button missing from Settings UI

**Problem:** Admin API had `DELETE /api/admin/memory/embeddings/local-model` endpoint but no UI button to invoke it.
**Fix:** Added "Delete Local Model" button to both desktop and mobile Settings UI. Button is disabled when local plugin is active (prevents deleting model in use). Uses confirm dialog before deletion.
**Files:** `packages/dashboard/public/index.html`, `packages/dashboard/public/js/app.js`

---

## Code Changes Summary

| File | Change |
|------|--------|
| `packages/core/src/memory/memory-db.ts` | Added `resetVectorIndex()` method |
| `packages/core/src/memory/embeddings/ollama.ts` | Improved error message for non-embedding models |
| `packages/dashboard/src/routes/memory.ts` | Integrated `resetVectorIndex`, clear meta on "none", `await setActive()` |
| `packages/dashboard/src/routes/admin.ts` | Same `resetVectorIndex` integration, `await setActive()` |
| `packages/dashboard/src/index.ts` | Auto-restore plugin on startup + `OLLAMA_HOST` env var |
| `packages/dashboard/public/index.html` | Added "Delete Local Model" button (desktop + mobile) |
| `packages/dashboard/public/js/app.js` | Added `deleteLocalModel()` function + state vars |
| `.guardrails` | Added private network address pattern |

---

## Verdict

**Status: PASS**

All planned features work correctly. Both embeddings plugins (local and Ollama) tested end-to-end. Plugin switching, persistence, file watcher, and validation all verified. Settings UI works on desktop and mobile.

**Recommendation:** Ready for CTO review. Changes are uncommitted on working tree.
