# M9-S1: Registry + Dummies — Code Review

> **Reviewer:** Claude Opus 4.6
> **Date:** 2026-04-02
> **Sprint plan:** [plan.md](plan.md)
> **Design spec:** [capability-system.md](../../design/capability-system.md)

---

## Verdict: PASS (22/24 traceability rows pass)

The implementation is solid and well-integrated. Registry types match the spec, all core methods work, file watching is correct, dummies are properly formatted, and prompt injection shows both available and unavailable capabilities.

---

## Findings

### F1: MCP Lifecycle Wrapper Not Implemented (DEFERRED — Low)

**Spec says:** `interface: mcp` has two sub-patterns — direct passthrough (`.mcp.json`) and lifecycle wrapper (`scripts/start.sh`, `scripts/stop.sh`).

**Code does:** Only direct passthrough is implemented. Scanner loads `.mcp.json`, expands `${CAPABILITY_ROOT}`, passes `requires.env` vars to MCP env — all correct. But there is no code path for lifecycle scripts.

**Impact:** Low. No concrete use case exists yet. All current and near-term capabilities use `interface: script`.

**Action:** None required now. When a lifecycle-wrapper use case arises, implement detection logic: if no `.mcp.json` exists but `scripts/start.sh` does, call it on startup and `scripts/stop.sh` on shutdown.

---

### F2: Activation Timing Not Documented in Code (INFO — Low)

**Spec says:** Script capabilities take effect immediately. MCP capabilities take effect on the next user message (SDK limitation).

**Code does:** MCP servers are registered at startup via `addMcpServer()` in `app.ts`. If a new MCP capability appears via file watcher at runtime, it would be added to the shared pool but not to the current running query. This is correct behavior but not documented in code comments.

**Action:** Add a comment in the FileWatcher handler (`app.ts` ~line 470) noting the activation timing difference for MCP vs script capabilities.

---

### F3: No Runtime Validation of `interface` Field (INFO — Low)

**Code does:** A CAPABILITY.md with `interface: banana` would be stored without error. TypeScript constrains the type at compile time only.

**Action:** Optional — add a warning log if `interface` is not `"script"` or `"mcp"` during scan. Not blocking.

---

## What Passed

| Area | Notes |
|------|-------|
| `Capability` type | Matches spec exactly (name, provides, interface, path, status, unavailableReason). Adds `mcpConfig?` — compatible extension |
| `CapabilityRegistry` | `has()`, `get()`, `list()`, `rescan()`, `load()`, `getContent()`, `getReference()` all present and correct |
| `CapabilityScanner` | Parses frontmatter, checks `requires.env` against `process.env` and `.env` file |
| `resolveEnvPath()` | Created in `packages/core/src/env.ts`, used in hatching auth.ts and server.ts |
| `capability:changed` event | Added to `AppEventMap` |
| FileWatcher | Watches `.my_agent/capabilities/`, `**/CAPABILITY.md`, 5s poll, triggers rescan + event + cache invalidation |
| App init ordering | Registry scanned before SystemPromptBuilder init |
| `${CAPABILITY_ROOT}` expansion | Recursive replacement in `.mcp.json` string values |
| `requires.env` → MCP env | Vars read from process.env and .env, injected into MCP config |
| Dummy STT | Correct frontmatter, script returns expected JSON |
| Dummy TTS | Correct frontmatter, script copies dummy.ogg to output path |
| `loadCapabilityHints()` | Shows both available and unavailable capabilities with reasons |
| Prompt cache invalidation | FileWatcher handler calls `invalidateCache()` |
| `getContent()` / `getReference()` | Reads CAPABILITY.md body and `references/` files on demand |
| Tests | All passing |

---

## Traceability

All 24 rows in the sprint plan's traceability matrix verified. 22 PASS, 1 FAIL (F1 — deferred), 1 PARTIAL (F2 — info only).
