# M6-S5 Embeddings Validation — Sprint Review

**Sprint:** M6-S5 Embeddings System Validation & E2E Testing
**Mode:** Overnight (autonomous)
**Duration:** 2026-02-26 → 2026-02-27
**Status:** Complete

## Objective

Verify both embeddings plugins (local + Ollama) work end-to-end. Fix bugs found during testing. Ensure plugin switching, persistence, and UI controls all function correctly.

## Implementation Summary

### Planned Fixes (3)

1. **`resetVectorIndex()` method** — Detects plugin/model/dimensions change on switch. Drops stale vector data + embedding cache, recreates table, updates meta. Returns `{ modelChanged }` for route-level warnings.

2. **Ollama model validation** — Wrapped test embed in try/catch with clear error: _"Model 'X' does not support embeddings. Use 'nomic-embed-text' or 'mxbai-embed-large'."_ Also validates result array is non-empty and all numbers.

3. **Persist active plugin across restarts** — Reads saved plugin from SQLite meta on startup, initializes + sets active. Graceful fallback if Ollama server unreachable.

### Bugs Found During Testing (3)

1. **`setActive()` not awaited** — `pluginRegistry.setActive()` is async (awaits `cleanup()` on previous plugin). Both `memory.ts` and `admin.ts` called it without `await`, causing stale status after switch. Added `await` to all 3 call sites.

2. **Ollama host hardcoded to localhost** — Ollama runs on Docker at a remote host. Changed to `process.env.OLLAMA_HOST ?? "http://localhost:11434"` — configurable, backward compatible.

3. **Delete Local Model button missing from UI** — Admin API had the endpoint but no UI to invoke it. Added button to desktop + mobile Settings. Disabled when local plugin is active.

### Files Modified

| File | Change |
|------|--------|
| `packages/core/src/memory/memory-db.ts` | Added `resetVectorIndex()` method |
| `packages/core/src/memory/embeddings/ollama.ts` | Improved error message for non-embedding models |
| `packages/dashboard/src/routes/memory.ts` | `resetVectorIndex` integration, `await setActive()`, clear meta on "none" |
| `packages/dashboard/src/routes/admin.ts` | Same `resetVectorIndex` + `await` fix |
| `packages/dashboard/src/index.ts` | Auto-restore plugin on startup + `OLLAMA_HOST` env var |
| `packages/dashboard/public/index.html` | "Delete Local Model" button (desktop + mobile) |
| `packages/dashboard/public/js/app.js` | `deleteLocalModel()` function + state vars |
| `.guardrails` | Added private network address pattern |

## Test Results — 15/15 PASS

| # | Test | Result |
|---|------|--------|
| 1 | Local plugin activation | PASS |
| 2 | Local plugin rebuild + search | PASS |
| 3 | Ollama plugin activation | PASS |
| 4 | Ollama plugin rebuild + search | PASS |
| 5 | Plugin switching (local → ollama) | PASS |
| 6 | Model change warning | PASS |
| 7 | Same-model re-activation (no warning) | PASS |
| 8 | Deactivate plugin ("none") | PASS |
| 9 | Persistence across restart | PASS |
| 10 | File watcher natural flow | PASS |
| 11 | Ollama chat model rejection | PASS |
| 12 | Settings UI — desktop | PASS |
| 13 | Settings UI — mobile (390px) | PASS |
| 14 | Local model deletion + re-download | PASS |
| 15 | Delete button disabled when local active | PASS |

Full test details: [`docs/testing/embeddings-validation/test-report.md`](../../testing/embeddings-validation/test-report.md)

## Decisions Made

| # | Decision | Risk |
|---|----------|------|
| D1 | `OLLAMA_HOST` env var for Ollama plugin config | None — backward compatible |
| D2 | `await` added to all `setActive()` calls | None — correctness fix |
| D3 | Delete Local Model button added to Settings UI | None — uses existing admin API |

Full log: [`docs/testing/embeddings-validation/DECISIONS.md`](../../testing/embeddings-validation/DECISIONS.md)

## Deliverables

- Both embeddings plugins verified end-to-end (local + Ollama)
- Plugin switching with stale data cleanup
- Persistence across server restarts
- Delete Local Model UI with safety guard (disabled when active)
- `OLLAMA_HOST` env var for deployment flexibility
