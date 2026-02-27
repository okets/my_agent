# Overnight Sprint: Embeddings Validation — Decisions Log

Sprint: Embeddings System Validation & E2E Testing
Started: 2026-02-26 (overnight)
Tech Lead: Claude Opus

---

## Decision Log

*Decisions made during autonomous execution, logged for CTO review.*

---

### D1: Ollama host configurable via env var [Minor]

**Context:** Ollama runs on Docker at `a remote host`, not localhost.
**Decision:** Changed `index.ts` to use `process.env.OLLAMA_HOST ?? "http://localhost:11434"` instead of hardcoded localhost. This is the right pattern — host varies by deployment.
**Risk:** None — backward compatible, falls back to localhost.

### D2: Fix missing `await` on `setActive()` [Minor — bug fix]

**Context:** Status endpoint returned stale plugin after switching because `setActive()` is async but wasn't awaited.
**Decision:** Added `await` to all 3 call sites. Straightforward correctness fix.
**Risk:** None.

### D3: Add "Delete Local Model" button to Settings UI [Minor — UI gap]

**Context:** Admin API had `DELETE /memory/embeddings/local-model` endpoint but no UI to invoke it. CTO requested testing that delete is disabled when local plugin is active.
**Decision:** Added button to both desktop and mobile Settings. Disabled when `embeddings-local` is active (prevents deleting model in use). Uses browser `confirm()` dialog + `X-Confirm-Destructive` header. Shows result message (freed MB on success, error on failure).
**Risk:** None — uses existing admin API. Disabled state prevents accidental deletion of in-use model.

---
