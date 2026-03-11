# M6.6-S1: Context Foundation — Sprint Plan

> **Status:** Complete
> **Date:** 2026-03-11
> **Spec:** [memory-perfection-design.md](../../superpowers/specs/2026-03-11-memory-perfection-design.md) § Sprint 1

---

## Goal

The system prompt carries temporal awareness and a `current-state.md` briefing. When that file exists, Nina "already knows" without searching.

## Tasks

| # | Task | Type | Description |
|---|------|------|-------------|
| 1.1 | `current-state.md` schema | Schema | Define format in `notebook/operations/` — 500-1000 char briefing |
| 1.2 | Temporal context injection | Backend | Add current time + session start to SystemPromptBuilder Layer 3 |
| 1.3 | Cache invalidation wiring | Backend | SyncService `sync` events → `SystemPromptBuilder.invalidateCache()` |
| 1.4 | Verify `loadNotebookOperations()` | Verification | Confirm `current-state.md` is picked up by existing loader |
| 1.5 | Verify `notebook.md` skill | Verification | Confirm skill is included in assembled system prompt |
| 1.6 | Fix stale test data | Test setup | Update `reference/contacts.md` for testing (private, `.my_agent/`) |
| 1.7 | Fix `channel NOT NULL` schema bug | Bugfix | `channel TEXT NOT NULL` → `channel TEXT` in conversations table |

## Architecture Notes

- **Temporal context** belongs in `SystemPromptBuilder.build()` (dashboard, Layer 3 dynamic block), not in `packages/core/src/prompt.ts` (shared core)
- **`current-state.md`** is loaded by existing `loadNotebookOperations()` in stable prompt cache — invalidated by SyncService on file change
- **Cache invalidation** crosses packages: SyncService (core) → SystemPromptBuilder (dashboard). Wiring in `index.ts` where both are available.

## Key Discovery

SystemPromptBuilder was per-session (each SessionManager created its own). Cache invalidation from SyncService would only reach one instance. Solution: shared builder pattern via `initPromptBuilder()` / `getPromptBuilder()`, matching existing `initMcpServers` / `sharedMcpServers`.

## Files Modified

- `packages/dashboard/src/agent/system-prompt-builder.ts` — Temporal context, `sessionStartTime`, `resetSessionStart()`
- `packages/dashboard/src/agent/session-manager.ts` — `initPromptBuilder()`, `getPromptBuilder()`, shared builder
- `packages/dashboard/src/conversations/db.ts` — `channel` column nullable
- `packages/dashboard/src/index.ts` — `initPromptBuilder()` + SyncService → cache invalidation

## What S1 Does NOT Do

- Does not write `current-state.md` automatically (S2 — morning prep job)
- Does not extract facts from conversations (S3)
- The file is written by the system when it's supposed to — pipeline is wired and ready

## Team

Single-agent execution. < 3 substantial implementation tasks, all tightly coupled around the same files.
