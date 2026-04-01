# External Verification Report

**Sprint:** M9-S1 Registry + Dummy Capabilities
**Reviewer:** External Opus (independent)
**Date:** 2026-04-01

## Spec Coverage

| Spec Requirement | Status | Evidence |
|-----------------|--------|----------|
| Principles §1 — Capabilities are files, not code registrations | COVERED | Scanner discovers from `*/CAPABILITY.md` on disk; registry is derived |
| Principles §4 — Markdown is source of truth | COVERED | CAPABILITY.md frontmatter parsed via `readFrontmatter()` |
| Principles §5 — Secrets centralized in .env | COVERED | `resolveEnvPath()` in `env.ts`, used by hatching + server + scanner |
| Principles §6 — Registry is the contract | COVERED | `CapabilityRegistry` is single query point: `has()`, `get()`, `list()` |
| Principles §7 — Scripts are universal adapter | COVERED | Both dummies use `interface: script` with shell scripts |
| Directory Convention — flat, one level deep | COVERED | `globby('*/CAPABILITY.md', { deep: 1 })` in scanner |
| Directory Convention — references/ support | COVERED | `registry.getReference(type, filename)` reads from `references/` subdir |
| CAPABILITY.md Format — frontmatter fields | COVERED | `CapabilityFrontmatter` type: name, provides, interface, requires.env |
| CAPABILITY.md Format — body as brain instructions | COVERED | `registry.getContent(type)` reads body after frontmatter |
| Interface Types — `interface: script` | COVERED | Dummy STT and TTS both use script interface |
| Interface Types — `interface: mcp` direct passthrough (.mcp.json) | COVERED | Scanner loads `.mcp.json`, app.ts registers via `addMcpServer()` |
| Interface Types — `interface: mcp` lifecycle wrapper | PARTIAL | App.ts only handles `.mcp.json` passthrough; no `start.sh`/`stop.sh` lifecycle management code exists |
| Interface Types — `${CAPABILITY_ROOT}` expansion | COVERED | `expandCapabilityRoot()` in scanner.ts recursively replaces in all string values |
| Interface Types — requires.env vars passed to MCP env | **MISSING** | Scanner expands `${CAPABILITY_ROOT}` but does NOT inject `requires.env` values into MCP server env field |
| Interface Types — Activation timing (script=immediate, MCP=next message) | PARTIAL | MCP registered at startup via `addMcpServer()`; documented in plan but no runtime enforcement of "next message" semantics |
| Discovery — Scan on startup | COVERED | `App.create()` scans before SystemPromptBuilder init |
| Discovery — Check requires.env, mark available/unavailable | COVERED | Scanner checks `process.env` and `.env` file, sets status + reason |
| Discovery — Emit capability_changed event | COVERED | `capability:changed` added to `AppEventMap`, emitted on file watcher re-scan |
| Discovery — File watcher, re-scan on change | COVERED | `FileWatcher` watches `capabilities/` dir, `**/CAPABILITY.md`, 5s poll |
| Registry API — has(), get(), list() | COVERED | All three methods on `CapabilityRegistry` |
| Registry API — rescan() | COVERED | `rescan(scanFn)` method accepts injected scanner function |
| Brain Prompt — Inject available + unavailable capabilities | COVERED | `loadCapabilityHints()` formats both statuses with reasons |
| Brain Prompt — Invalidate prompt cache on change | COVERED | File watcher handler calls `getPromptBuilder()?.invalidateCache()` |
| Secrets Management — Unify .env path resolution | COVERED | `resolveEnvPath()` used in auth.ts, server.ts, and app.ts |
| Phase 1 — Dummy STT capability | COVERED | `.my_agent/capabilities/stt-dummy/` with CAPABILITY.md + transcribe.sh |
| Phase 1 — Dummy TTS capability | COVERED | `.my_agent/capabilities/tts-dummy/` with CAPABILITY.md + synthesize.sh + dummy.ogg |

## Test Results

- **Claimed:** 884 passed, 0 failed
- **Actual:** 903 passed, **8 failed**, 8 skipped (919 total)
- TypeScript: compiles clean (both core and dashboard packages)

### Test Failures (all in `tests/unit/capabilities/capability-system.test.ts`)

**Root cause 1 — Missing helper function (8 scanner tests):**
The test file defines `writeCapabilityRaw(name, yaml, body)` but all scanner tests call `writeCapability(name, obj)` which does not exist. This function was likely intended to serialize an object to YAML frontmatter but was never implemented. All 8 `scanCapabilities` tests fail with `ReferenceError` or empty results.

**Root cause 2 — Assertion logic error (1 resolveEnvPath test):**
The test asserts `resolveEnvPath("/home/user/.my_agent")` returns `"/home/user/.my_agent/../.env"` (the raw unresolved path), then asserts `resolve(result)` equals `"/home/user/.env"`. The first assertion fails because `path.join()` normalizes the `..` segment, so the actual return value is `"/home/user/.env"`, not the un-normalized form.

**Impact:** 18 of 27 capability tests pass (registry, prompt hints). The 8 scanner tests and 1 resolveEnvPath test need fixes. The test infrastructure is sound — only the helpers and assertions need correction.

## Browser Verification

Skipped — no UI changes in this sprint.

## Gaps Found

### Critical

1. **Test suite has 8 failures.** The `writeCapability()` helper is undefined. All scanner tests are broken. This must be fixed before merge — the scanner is the core of the registry and has zero passing tests.

### Moderate

2. **`requires.env` vars not passed to MCP server env field (Task 7, partial).** The design spec states: "Variables from `requires.env` are automatically passed to MCP servers via the `env` field." The scanner expands `${CAPABILITY_ROOT}` correctly but does NOT inject the required environment variables into the MCP config. This means MCP capabilities that need API keys won't receive them automatically.

3. **MCP lifecycle wrapper not implemented (Task 6, partial).** The plan says Task 6 should handle both `.mcp.json` (direct passthrough) and `start.sh`/`stop.sh` (lifecycle wrapper). Only the passthrough path exists in `app.ts`. The lifecycle pattern is documented in the spec but has no code.

### Minor

4. **Duplicate JSDoc comment in env.ts (line 83).** A stale `/** Return all secret values... */` comment sits above `resolveEnvPath()`, which has its own correct comment on line 84. The stale comment belongs to `getAllSecrets()` below.

5. **No runtime validation of `interface` field.** The scanner accepts any string for `interface` — if a CAPABILITY.md has `interface: banana`, it will be stored without error. TypeScript types constrain this at compile time but not at runtime.

6. **`resolveEnvPath` uses `path.join` with `..` rather than `path.resolve`.** The function returns a normalized but potentially surprising path. The test that fails actually proves this — the path is already resolved by `path.join`. Not a bug, but the test needs to match the actual behavior.

## Code Quality Notes

- **Clean architecture.** The separation of types/registry/scanner into distinct files is good. No circular dependencies.
- **Error handling is solid.** Scanner silently skips malformed files. App.ts wraps scan and MCP registration in try/catch with descriptive warnings.
- **Integration is well-wired.** Capabilities are scanned before SystemPromptBuilder init, `getCapabilities` callback flows through session-manager to prompt assembly, and the file watcher invalidates the prompt cache.
- **Consistent with existing patterns.** Uses the same `FileWatcher`, `readFrontmatter`, and event emission patterns as the rest of the codebase.

## Verdict

**PASS WITH CONCERNS**

The architecture and integration are sound. The registry, scanner, prompt integration, file watcher, env path unification, and dummy capabilities all match the design spec. However:

1. **Must fix before merge:** The 8 scanner test failures (missing `writeCapability` helper) mean the most critical component has zero test coverage at runtime. This is a 5-minute fix — rename `writeCapabilityRaw` or add a `writeCapability` wrapper that serializes objects to YAML.
2. **Should fix before merge:** The `resolveEnvPath` test assertion needs correction (trivial).
3. **Should fix in S1 or document for S2:** The `requires.env` to MCP env injection (Task 7 incomplete) will matter when real MCP capabilities are introduced.
4. **Acceptable deferral:** MCP lifecycle wrapper can wait for a concrete use case.
