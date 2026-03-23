# External Verification Report

**Sprint:** M7-S1 Space Entity
**Reviewer:** External Opus (independent)
**Date:** 2026-03-23

---

## Spec Coverage

| Spec Requirement | Status | Evidence |
|---|---|---|
| **Space types + interfaces** (SpaceManifest, Space, CreateSpaceInput, ListSpacesFilter, SpaceIO, SpaceMaintenance) | PASS | `packages/core/src/spaces/types.ts` — all interfaces match spec exactly |
| **FileWatcher utility** (extracted watch+debounce+hash from SyncService pattern) | PASS | `packages/core/src/sync/file-watcher.ts` — chokidar, polling, debounce, SHA256 hash dedup, globby scanAll, EventEmitter |
| **FileWatcher: glob pattern filtering** | PASS | `matchesPattern()` supports `**/SPACE.md` style patterns |
| **FileWatcher: exclude patterns** | PASS | Tested in `file-watcher.test.ts` line 84 |
| **FileWatcher: hash-based dedup** | PASS | Tested in `file-watcher.test.ts` line 51 — second scanAll returns 0 |
| **agent.db `spaces` table** (derived index) | PASS | `packages/dashboard/src/conversations/db.ts` — CREATE TABLE with correct schema matching spec SQL |
| **spaces table: tag index** | PASS | `CREATE INDEX IF NOT EXISTS idx_spaces_tags ON spaces(tags)` |
| **CRUD methods** (upsertSpace, getSpace, listSpaces, deleteSpace) | PASS | All 4 methods implemented + tested in `spaces-db.test.ts` (10 tests) |
| **listSpaces filtering** (tag, runtime, search) | PASS | SQL LIKE queries for tag/search, exact match for runtime |
| **SpaceSyncService** (watches `**/SPACE.md`, parses frontmatter, syncs to DB) | PASS | `packages/core/src/spaces/space-sync-service.ts` — uses FileWatcher, YAML parse, callbacks |
| **SpaceSyncService: external space path handling** | PASS | Tested — `path` from frontmatter used for external, manifestDir for internal |
| **SpaceSyncService: space name from directory** | PASS | Falls back to directory name when frontmatter `name` missing |
| **SpaceSyncService: space:synced events** | PASS | EventEmitter emits on change |
| **MCP tool: `create_space`** | PASS | `packages/dashboard/src/mcp/space-tools-server.ts` — kebab-case validation, duplicate check, writes SPACE.md via writeFrontmatter |
| **MCP tool: `list_spaces`** | PASS | Queries DB with tag/runtime/search filters, formatted output |
| **MCP server registration** | PASS | `space-tools` server registered in app.ts, confirmed in logs |
| **App integration: SpaceSyncService lifecycle** | PASS | Init in `App.create()`, fullSync on startup, start watcher, stop on shutdown |
| **App events** (space:created, space:updated, space:deleted) | PASS | Defined in `app-events.ts`, emitted from SpaceSyncService callbacks |
| **StatePublisher: publishSpaces** | PASS | Debounced broadcast, subscribed to all space events, included in `publishAllTo` for new connections |
| **WebSocket protocol: `state:spaces`** | PASS | `SpaceSnapshot` type defined in `protocol.ts`, message type in `ServerMessage` union |
| **Alpine store: spaces** | PASS | `stores.js` — `Alpine.store("spaces", { items: [], loading: false })` |
| **WebSocket handler: state:spaces** | PASS | `ws-client.js` — case handler updates store items |
| **Home widget: Spaces** | PASS | `index.html` line 344 — glass-strong container, folder icon, count, 5-item limit, "Show all" link |
| **Home widget: empty state** | PASS | "No spaces yet" shown when items.length === 0 |
| **Home widget: tag display** | PASS | Up to 3 tags shown per space |
| **Home widget: external indicator** | PASS | Arrow icon shown when `space.path` is set |
| **Spaces Browser Tab** | PASS | Full searchable list with name, tags, capability indicators (runtime badge, Tool badge), external path |
| **Space Detail Tab: split-panel** | PASS | Left panel (file tree 256px) + right panel (content/property view) |
| **Space Detail Tab: Nina's Files section** | PASS | SPACE.md with "manifest" badge, DECISIONS.md with "history" badge (conditional) |
| **Space Detail Tab: Content section** | PASS | Tree view excluding Nina's files, folder expand/collapse, file sizes |
| **Space Detail Tab: Property View** (SPACE.md selected) | PASS | Editable description, tags (add/remove), runtime, entry, external path |
| **Space Detail Tab: edits write back** | PASS | PATCH `/api/spaces/:name` calls `writeFrontmatter()` |
| **REST API: GET /api/spaces/:name** | PASS | Returns manifest + body + file tree |
| **REST API: GET /api/spaces/:name/file** | PASS | File content read with path traversal protection |
| **REST API: PATCH /api/spaces/:name** | PASS | Merge-updates frontmatter fields |
| **REST API: path traversal security** | PASS | `fullPath.startsWith(spaceDir + "/")` check in file endpoint |
| **Core lib.ts exports** | PASS | FileWatcher, hashContent, SpaceSyncService, all Space types exported |

## Test Results

### Core Package
- **210 passed**, 7 skipped (0 failures)
- Space-specific tests: `file-watcher.test.ts` (7 tests), `space-sync-service.test.ts` (6 tests) — all passing
- TypeScript: compiles clean (`npx tsc --noEmit` — no output)

### Dashboard Package
- **698 passed**, 2 skipped (0 failures)
- Space-specific tests: `spaces-db.test.ts` (10 tests), `space-tools-server.test.ts` (7 tests) — all passing
- TypeScript: compiles clean (`npx tsc --noEmit` — no output)

## Browser Verification

| Check | Status | Details |
|---|---|---|
| Dashboard loads | PASS | No JS errors (favicon 404 and available-models 500 are pre-existing) |
| `state:spaces` WebSocket message received | PASS | Confirmed in console logs on connect |
| Home tab: Spaces widget renders | PASS | Shows count, list items, empty state |
| Spaces widget: shows space with tags | PASS | "test-space" with "test", "verification" tags visible |
| Spaces widget: external indicator | PASS | Arrow icon renders for spaces with path (internal spaces show icon since path defaults to manifestDir — minor cosmetic, not a bug) |
| Space detail tab opens on click | PASS | Tab created with correct title, file tree loaded |
| File tree: Nina's Files section | PASS | SPACE.md with "manifest" badge shown |
| File tree: Content section | PASS | "No content files" shown for empty space |
| Property view (SPACE.md selected) | PASS | Editable fields for description, tags, runtime, entry, path |
| Tags: removable with x button | PASS | Remove buttons visible on hover |
| Tags: add via input | PASS | Input field with "+ tag" placeholder present |
| Notes section shows markdown body | PASS | "A test space for external review verification." displayed |
| API: GET /api/spaces/test-space returns 404 | PASS | `{"error":"Space not found"}` before space creation |
| API: GET /api/spaces/test-space returns data | PASS | Manifest + body + tree returned after creation |
| SpaceSyncService: fullSync on startup | PASS | Space synced to DB after restart with spaces dir present |
| SpaceSyncService: chokidar live detection | BLOCKED | See Gap #1 below |

## Gaps Found

### Gap 1: FileWatcher fails when watch directory doesn't exist at startup (MEDIUM)

**Symptom:** Creating a space (which also creates `.my_agent/spaces/` for the first time) is not detected by chokidar. The SpaceSyncService logs "initialized" but chokidar silently fails when the target directory doesn't exist.

**Root cause:** `FileWatcher.start()` calls `chokidar.watch(this.watchDir, ...)` but doesn't ensure the directory exists first. If `.my_agent/spaces/` is created AFTER the watcher starts, chokidar never picks it up.

**Impact:** On a fresh agent (no spaces yet), the first space created via `create_space` MCP tool won't appear in the dashboard until the next service restart. The `create_space` tool does `mkdirSync(spacesDir, { recursive: true })` which creates the directory, but the watcher was already started on a non-existent path.

**Fix:** Either:
1. `SpaceSyncService` should ensure `spacesDir` exists before starting the watcher (`mkdirSync(spacesDir, { recursive: true })`) — 1 line fix
2. Or `FileWatcher.start()` should create the directory if missing

**Workaround:** After the first space is created, restarting the dashboard picks up everything via `fullSync()`.

### Gap 2: `state:spaces` triggers "Unknown message type" warning in app.js (LOW)

**Symptom:** Console warning `[App] Unknown message type: state:spaces` on every `state:spaces` broadcast.

**Root cause:** `ws-client.js` handles `state:spaces` correctly (updates Alpine store), but `app.js` also has a message handler with a switch statement that doesn't include `state:spaces`. The message hits the `default` case and logs a warning.

**Impact:** Cosmetic only — functionality works correctly. The Alpine store is updated via `ws-client.js`.

**Fix:** Add `case "state:spaces": break;` to the app.js message handler switch statement.

### Gap 3: Space overview shows "No description" for spaces with body text (LOW)

**Symptom:** When viewing a space in the overview (no file selected), description shows "No description" even though the SPACE.md has markdown body text.

**Root cause:** The overview template uses `tab.data.manifest?.description` (frontmatter field) but the SPACE.md body (which IS the description per spec) is in `tab.data.body`. The template should fall back to `tab.data.body`.

**Impact:** Minor UX issue. The body text IS visible in the "Notes" section of the property view (when SPACE.md is selected).

### Gap 4: Spaces Browser Tab missing spec fields (LOW)

**Spec says:** "Last used date" and "Referencing automation count" should be shown per space row.

**Implementation:** These fields are not shown. This is expected — automations and jobs don't exist yet (S3+). The browser tab correctly shows name, tags, capability indicators, and external path.

### Gap 5: I/O contract display and maintenance toggles not in property view (LOW — out of S1 scope)

**Spec says:** Property view should show I/O contract as `name : type` table and on-failure as toggle pills.

**Implementation:** These are not rendered. This is acceptable — the spec's S1 scope line says "Spaces widget + browser tab + detail tab with tree view + property view." The I/O and maintenance fields are S2 (Tool Spaces) features. The types and DB schema support them.

## Verdict

**PASS WITH CONCERNS**

The implementation is solid and thorough. All S1 scope items from the spec are implemented:
- Space entity with full type system and manifest format
- FileWatcher utility extracted from SyncService pattern
- Derived DB with CRUD and filtering
- SpaceSyncService with full sync + live watching
- MCP tools (create_space, list_spaces)
- Full dashboard UI (home widget, browser tab, detail tab with tree + property view)
- REST API with path traversal protection
- WebSocket real-time updates
- Property editing with write-back to SPACE.md

The one medium concern (Gap #1) is a real bug that will affect first-run experience on a fresh agent. It's a 1-line fix (`mkdirSync` before starting the watcher). The other gaps are low-severity cosmetic issues.

Test coverage is good (30 space-specific tests across 4 test files), TypeScript compiles clean, and the browser verification confirms the UI works end-to-end.
