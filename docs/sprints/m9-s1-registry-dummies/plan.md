# M9-S1: Registry + Dummy Capabilities

> **Milestone:** M9 — Capability System
> **Design spec:** [capability-system.md](../../design/capability-system.md)
> **Implementation plan:** [2026-04-01-capability-system.md](../../plans/2026-04-01-capability-system.md)
> **Status:** Planned

---

## Goal

Build the capability registry that discovers capabilities from `.my_agent/capabilities/`, makes them queryable, and injects them into the brain's system prompt. Prove it works with dummy STT and TTS capabilities.

## Prerequisites

- M8 complete (Rich I/O, asset serving pipeline)

## Tasks

### Registry Core

| # | Task | Files | Parallel? |
|---|------|-------|-----------|
| 1 | Create `Capability` type and `CapabilityRegistry` class | `packages/core/src/capabilities/types.ts`, `packages/core/src/capabilities/registry.ts` | Yes (with 2, 3) |
| 2 | Create `CapabilityScanner` — scans `.my_agent/capabilities/*/CAPABILITY.md`, parses frontmatter, checks `requires.env` | `packages/core/src/capabilities/scanner.ts` | Yes (with 1, 3) |
| 3 | Unify `.env` path resolution — add `resolveEnvPath()`, replace hardcoded paths in hatching + server | `packages/core/src/env.ts`, `packages/core/src/hatching/steps/auth.ts`, `packages/dashboard/src/server.ts` | Yes (with 1, 2) |
| 4 | Add `capability:changed` event to `AppEventMap` | `packages/dashboard/src/app-events.ts` | After 1 |
| 5 | Wire FileWatcher for capabilities — reuse existing `FileWatcher`, watch `capabilities/`, `**/CAPABILITY.md`, 5s poll. On change → `registry.rescan()` → emit `capability:changed` | `packages/dashboard/src/index.ts` | After 1, 4 |
| 6 | Wire registry into App init — scan at startup, before MCP init. For `interface: mcp`: detect `.mcp.json` (direct passthrough → `addMcpServer()`) or lifecycle scripts (`start.sh`/`stop.sh`). Document: MCP capabilities activate on next message, script capabilities activate immediately | `packages/dashboard/src/index.ts`, `packages/dashboard/src/app.ts` | After 1, 2 |
| 7 | `${CAPABILITY_ROOT}` expansion in `.mcp.json` — replace with absolute path, pass `requires.env` vars to MCP server `env` field | `packages/core/src/capabilities/scanner.ts` | After 2 |

### Dummy Capabilities

| # | Task | Files | Parallel? |
|---|------|-------|-----------|
| 8 | Create dummy STT — `provides: audio-to-text`, `interface: script`. Script returns `{ "text": "This is a dummy transcription for testing." }` | `.my_agent/capabilities/stt-dummy/CAPABILITY.md`, `.my_agent/capabilities/stt-dummy/scripts/transcribe.sh` | Yes (with 9) |
| 9 | Create dummy TTS — `provides: text-to-audio`, `interface: script`. Script copies `assets/dummy.ogg` to output path | `.my_agent/capabilities/tts-dummy/CAPABILITY.md`, `.my_agent/capabilities/tts-dummy/scripts/synthesize.sh`, `.my_agent/capabilities/tts-dummy/assets/dummy.ogg` | Yes (with 8) |
| 10 | Verify registry discovers dummies — start app, check logs, confirm both show as `available` | Manual test | After 6, 8, 9 |

### System Prompt Integration

| # | Task | Files | Parallel? |
|---|------|-------|-----------|
| 11 | Add `loadCapabilityHints()` — reads from registry, formats as "You have the following capabilities available:" block. Include both available and unavailable with reasons | `packages/core/src/prompt.ts` | After 1 |
| 12 | Invalidate prompt cache on `capability:changed` event → call `invalidateCache()` | `packages/dashboard/src/agent/system-prompt-builder.ts` | After 4, 11 |
| 12b | Add `getContent(type)` and `getReference(type, filename)` to registry — reads full CAPABILITY.md body and `references/` files on demand | `packages/core/src/capabilities/registry.ts` | After 1, 2 |

### Migration

| # | Task | Files | Parallel? |
|---|------|-------|-----------|
| 45 | Migrate hatching + server to use `resolveEnvPath()` | `packages/core/src/hatching/steps/auth.ts`, `packages/dashboard/src/server.ts` | After 3 |

## Verification

- [ ] App starts, logs show capabilities scan results
- [ ] `stt-dummy` and `tts-dummy` appear as `available`
- [ ] Remove a dummy folder → file watcher triggers re-scan → capability disappears from registry
- [ ] Add a dummy with `requires.env: [FAKE_KEY]` → shows as `unavailable` with reason
- [ ] Brain's system prompt includes capability listing
- [ ] Prompt cache invalidates when capability changes

## Deliverables

- `packages/core/src/capabilities/` — types, registry, scanner
- `packages/core/src/env.ts` — `resolveEnvPath()`
- `.my_agent/capabilities/stt-dummy/` and `tts-dummy/`
- System prompt integration
