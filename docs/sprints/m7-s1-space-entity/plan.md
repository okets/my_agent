# M7-S1: Space Entity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Introduce the Space entity — filesystem-backed manifests (`SPACE.md`), a derived `spaces` table in agent.db, a reusable `FileWatcher` utility, MCP tools for creating/listing spaces, and a full dashboard UI (home widget, browser tab, detail tab with tree view + property view).

**Architecture:** Spaces are folders with a `SPACE.md` manifest containing YAML frontmatter (read/written via `readFrontmatter()`/`writeFrontmatter()`). Internal spaces live in `.my_agent/spaces/{name}/`. External spaces have a `path` field pointing elsewhere on the filesystem. A `SpaceSyncService` watches for `SPACE.md` changes and syncs parsed metadata to the `spaces` table in agent.db (derived index — rebuildable from disk). The `FileWatcher` utility is extracted from the existing `SyncService` to provide reusable watch+debounce+hash infrastructure.

**Tech Stack:** TypeScript, chokidar (file watching), better-sqlite3 (agent.db), `yaml` package (frontmatter), Alpine.js + Tailwind CSS (dashboard UI), Agent SDK MCP tools (`tool()` + `createSdkMcpServer()`).

**Spec:** `docs/superpowers/specs/2026-03-22-m7-spaces-automations-jobs.md`

---

### Task 1: Space Types

**Files:**
- Create: `packages/core/src/spaces/types.ts`
- Create: `packages/core/src/spaces/index.ts`

**Spec ref:** "Entities > Spaces" section — capability composition, manifest fields, Space interface.

- [ ] Step 1: Create the `packages/core/src/spaces/` directory.

- [ ] Step 2: Create `packages/core/src/spaces/types.ts` with the `Space` interface and related types:

```typescript
/**
 * Space manifest maintenance configuration
 */
export interface SpaceMaintenance {
  on_failure: 'fix' | 'replace' | 'alert'
  log?: string
}

/**
 * Space I/O contract — defines input/output for tool spaces
 */
export interface SpaceIO {
  input?: Record<string, string>
  output?: Record<string, string>
}

/**
 * Space manifest frontmatter — the YAML fields in SPACE.md
 */
export interface SpaceManifest {
  name: string
  tags?: string[]
  path?: string          // external spaces only — points to real folder
  runtime?: string       // 'uv' | 'node' | 'bash' (if executable)
  entry?: string         // entry point file (if tool)
  io?: SpaceIO           // I/O contract (if tool)
  maintenance?: SpaceMaintenance
  created: string        // ISO date string
}

/**
 * Space entity — in-memory representation (combines manifest + derived data)
 */
export interface Space {
  /** Space name (directory name, also primary key in agent.db) */
  name: string
  /** Absolute path to the space directory in .my_agent/spaces/{name}/ */
  manifestDir: string
  /** Tags for discovery */
  tags: string[]
  /** For external spaces: absolute path to the real folder */
  path?: string
  /** Runtime (uv, node, bash) — present means it's a code project */
  runtime?: string
  /** Entry point — present (with runtime + io) means it's a tool */
  entry?: string
  /** I/O contract */
  io?: SpaceIO
  /** Maintenance config */
  maintenance?: SpaceMaintenance
  /** Markdown body from SPACE.md (description) */
  description: string
  /** When this space was created */
  created: string
  /** When agent.db last indexed this space */
  indexedAt: string
}

/**
 * Input for creating a new space
 */
export interface CreateSpaceInput {
  name: string
  tags?: string[]
  path?: string
  runtime?: string
  entry?: string
  io?: SpaceIO
  maintenance?: SpaceMaintenance
  description?: string
}

/**
 * Filters for listing spaces
 */
export interface ListSpacesFilter {
  /** Filter by tag (spaces containing this tag) */
  tag?: string
  /** Filter by runtime */
  runtime?: string
  /** Free-text search on name + description + tags */
  search?: string
}
```

- [ ] Step 3: Create `packages/core/src/spaces/index.ts` that re-exports everything from `types.ts`.

- [ ] Step 4: Add `spaces` to the exports in `packages/core/src/index.ts`:
```typescript
export * from './spaces/index.js'
```

- [ ] Step 5: Verify the build compiles cleanly:
```bash
cd packages/core && npx tsc --noEmit
```

**Commit:** `feat(m7-s1): add Space types and interfaces`

---

### Task 2: FileWatcher Utility (extracted from SyncService)

**Files:**
- Create: `packages/core/src/sync/file-watcher.ts`
- Create: `packages/core/src/sync/index.ts`
- Test: `packages/core/tests/sync/file-watcher.test.ts`

**Spec ref:** "Sync Infrastructure > FileWatcher Utility" — extract watch+debounce+hash pattern from `packages/core/src/memory/sync-service.ts`.

**What gets extracted vs what stays:**
- **Extracted:** Chokidar setup (lines 47-87 of sync-service.ts), debouncing (lines 107-130), hash-based change detection (used in syncFile lines 160-161), start/stop lifecycle, EventEmitter pattern.
- **Stays in SyncService:** Markdown chunking, embedding generation, MemoryDb interactions, fullSync/rebuild — all memory-specific logic.

- [ ] Step 1: Create `packages/core/src/sync/` directory.

- [ ] Step 2: Write the test file `packages/core/tests/sync/file-watcher.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileWatcher } from '../../src/sync/file-watcher.js'
import { mkdtempSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('FileWatcher', () => {
  let tempDir: string
  let watcher: FileWatcher

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'fw-test-'))
  })

  afterEach(async () => {
    if (watcher) await watcher.stop()
  })

  it('should emit file:changed when a watched file is modified', async () => {
    // Test debounced file change detection
  })

  it('should emit file:deleted when a watched file is removed', async () => {
    // Test file deletion detection
  })

  it('should skip files with unchanged hash', async () => {
    // Test hash-based dedup
  })

  it('should support glob patterns for watched files', async () => {
    // Test glob filtering (e.g. '**/SPACE.md')
  })

  it('should respect exclude patterns', async () => {
    // Test exclude patterns (dotfiles, etc.)
  })

  it('should perform full scan on scanAll()', async () => {
    // Test initial full sync
  })
})
```

- [ ] Step 3: Create `packages/core/src/sync/file-watcher.ts` with the `FileWatcher` class:

```typescript
import { EventEmitter } from 'node:events'
import { watch, type FSWatcher } from 'chokidar'
import { readFile, stat } from 'fs/promises'
import { basename, relative } from 'path'
import { createHash } from 'crypto'

export interface FileWatcherOptions {
  /** Directory to watch */
  watchDir: string
  /** Glob pattern for files to include (e.g. '**/SPACE.md') */
  includePattern?: string
  /** Patterns to exclude */
  excludePatterns?: string[]
  /** Debounce delay in ms (default: 1500) */
  debounceMs?: number
  /** Use polling mode (for NAS/WSL2) */
  usePolling?: boolean
  /** Polling interval in ms (default: 1000) */
  pollInterval?: number
}

export interface FileChange {
  /** Absolute path to the file */
  absolutePath: string
  /** Path relative to watchDir */
  relativePath: string
  /** File content */
  content: string
  /** SHA256 hash of content */
  hash: string
}

export class FileWatcher extends EventEmitter {
  // ... implementation extracting the pattern from SyncService
  // Key methods: start(), stop(), scanAll(), hashContent()
  // Events: 'file:changed', 'file:deleted', 'scan:complete'
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
```

- [ ] Step 4: Implement `start()` — sets up chokidar with the same configuration as SyncService (lines 47-87): `usePolling`, `ignoreInitial: true`, basename dotfile exclusion, exclude patterns. On `add`/`change` events, call `scheduleProcess(path)`. On `unlink`, emit `file:deleted`.

- [ ] Step 5: Implement `scheduleProcess(path)` — debounced file processing (same pattern as SyncService lines 107-130). Read file content, compute SHA256 hash, emit `file:changed` with `FileChange` payload.

- [ ] Step 6: Implement `stop()` — close chokidar watcher, clear pending timeouts (same as SyncService lines 95-102).

- [ ] Step 7: Implement `scanAll()` — uses globby to find all matching files, reads each, hashes, emits `file:changed` for each. Returns count of files processed. This replaces the full-sync startup pattern.

- [ ] Step 8: Create `packages/core/src/sync/index.ts` re-exporting `FileWatcher`, `FileWatcherOptions`, `FileChange`, `hashContent`.

- [ ] Step 9: Add `sync` exports to `packages/core/src/index.ts`:
```typescript
export * from './sync/index.js'
```

- [ ] Step 10: Run tests:
```bash
cd packages/core && npx vitest run tests/sync/file-watcher.test.ts
```

**Commit:** `feat(m7-s1): extract FileWatcher utility from SyncService pattern`

---

### Task 3: agent.db Spaces Table

**Files:**
- Modify: `packages/dashboard/src/conversations/db.ts`
- Test: `packages/dashboard/tests/spaces-db.test.ts`

**Spec ref:** "Sync Infrastructure > Derived Database Schema" — `spaces` table definition.

- [ ] Step 1: Write the test file `packages/dashboard/tests/spaces-db.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ConversationDatabase } from '../src/conversations/db.js'
import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('Spaces table in agent.db', () => {
  let db: ConversationDatabase

  beforeEach(() => {
    const tempDir = mkdtempSync(join(tmpdir(), 'spaces-db-'))
    db = new ConversationDatabase(tempDir)
  })

  afterEach(() => {
    db.close()
  })

  it('should create spaces table on initialization', () => {
    // Verify table exists
  })

  it('should upsert and retrieve a space', () => {
    // Test upsertSpace + getSpace
  })

  it('should list spaces with tag filter', () => {
    // Test listSpaces({ tag: 'tool' })
  })

  it('should delete a space', () => {
    // Test deleteSpace
  })

  it('should search spaces by name/description', () => {
    // Test listSpaces({ search: 'scraper' })
  })
})
```

- [ ] Step 2: Add the `spaces` table creation to the `initialize()` method in `packages/dashboard/src/conversations/db.ts` (after the existing tasks table creation, ~line 296):

```sql
CREATE TABLE IF NOT EXISTS spaces (
  name TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  tags TEXT,
  runtime TEXT,
  entry TEXT,
  io TEXT,
  maintenance TEXT,
  description TEXT,
  indexed_at TEXT NOT NULL
);
```

- [ ] Step 3: Add index for tag-based queries:
```sql
CREATE INDEX IF NOT EXISTS idx_spaces_tags ON spaces(tags);
```

- [ ] Step 4: Add space CRUD methods to `ConversationDatabase`:

```typescript
upsertSpace(space: {
  name: string; path: string; tags?: string[];
  runtime?: string; entry?: string; io?: object;
  maintenance?: object; description?: string; indexedAt: string;
}): void

getSpace(name: string): { ... } | null

listSpaces(filter?: { tag?: string; runtime?: string; search?: string }): Array<{ ... }>

deleteSpace(name: string): void
```

- [ ] Step 5: Run tests:
```bash
cd packages/dashboard && npx vitest run tests/spaces-db.test.ts
```

**Commit:** `feat(m7-s1): add spaces table and CRUD to agent.db`

---

### Task 4: SpaceSyncService

**Files:**
- Create: `packages/core/src/spaces/space-sync-service.ts`
- Test: `packages/core/tests/spaces/space-sync-service.test.ts`

**Spec ref:** "Sync Infrastructure" — `SpaceSyncService` watches `.my_agent/spaces/*/SPACE.md`, parses YAML frontmatter, syncs to agent.db `spaces` table.

- [ ] Step 1: Write the test file `packages/core/tests/spaces/space-sync-service.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SpaceSyncService } from '../../src/spaces/space-sync-service.js'

describe('SpaceSyncService', () => {
  it('should parse SPACE.md frontmatter and call upsert', () => {})
  it('should handle external spaces with path field', () => {})
  it('should delete space from DB when SPACE.md is removed', () => {})
  it('should perform full scan on startup', () => {})
  it('should emit space:synced events', () => {})
})
```

- [ ] Step 2: Create `packages/core/src/spaces/space-sync-service.ts`:

```typescript
import { EventEmitter } from 'node:events'
import { join, basename, dirname } from 'path'
import { FileWatcher, type FileChange } from '../sync/file-watcher.js'
import { readFrontmatter } from '../../metadata/frontmatter.js'
import type { SpaceManifest } from './types.js'

export interface SpaceSyncServiceOptions {
  /** Path to .my_agent/spaces/ directory */
  spacesDir: string
  /** Callback to upsert space into agent.db */
  onSpaceChanged: (space: SpaceSyncPayload) => void
  /** Callback when space SPACE.md is deleted */
  onSpaceDeleted: (name: string) => void
  /** Debounce ms (default: 1500) */
  debounceMs?: number
}

export interface SpaceSyncPayload {
  name: string
  path: string
  tags: string[]
  runtime?: string
  entry?: string
  io?: object
  maintenance?: object
  description: string
  indexedAt: string
}

export class SpaceSyncService extends EventEmitter {
  private watcher: FileWatcher
  private opts: SpaceSyncServiceOptions

  constructor(opts: SpaceSyncServiceOptions) { ... }

  /** Start watching .my_agent/spaces/*/SPACE.md */
  start(): void { ... }

  /** Stop watching */
  stop(): void { ... }

  /** Full scan — parse all SPACE.md files and upsert */
  async fullSync(): Promise<number> { ... }

  /** Parse a SPACE.md FileChange into a SpaceSyncPayload */
  private parseSpaceManifest(change: FileChange): SpaceSyncPayload | null { ... }
}
```

- [ ] Step 3: Implement the constructor — create a `FileWatcher` with `watchDir: spacesDir`, `includePattern: '**/SPACE.md'`. Wire `file:changed` to `parseSpaceManifest()` then `onSpaceChanged()`. Wire `file:deleted` to extract the space name from the path and call `onSpaceDeleted()`.

- [ ] Step 4: Implement `parseSpaceManifest()` — uses `readFrontmatter<SpaceManifest>()` from `packages/dashboard/src/metadata/frontmatter.ts`. The space name is the directory name (parent of SPACE.md). The `path` field for internal spaces defaults to the manifest directory path. For external spaces, `path` comes from the frontmatter.

- [ ] Step 5: Implement `fullSync()` — calls `watcher.scanAll()`, returns the count of spaces synced.

- [ ] Step 6: Add `SpaceSyncService` to `packages/core/src/spaces/index.ts` exports.

- [ ] Step 7: Run tests:
```bash
cd packages/core && npx vitest run tests/spaces/space-sync-service.test.ts
```

**Commit:** `feat(m7-s1): add SpaceSyncService — watches SPACE.md and syncs to DB`

---

### Task 5: Space MCP Tools

**Files:**
- Create: `packages/dashboard/src/mcp/space-tools-server.ts`
- Test: `packages/dashboard/tests/mcp/space-tools-server.test.ts`

**Spec ref:** "Brain Integration > MCP Tools" — `create_space`, `list_spaces` tools.

- [ ] Step 1: Write the test file `packages/dashboard/tests/mcp/space-tools-server.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

describe('Space MCP tools', () => {
  it('create_space should write SPACE.md and create directory', () => {})
  it('create_space should reject duplicate names', () => {})
  it('list_spaces should return all spaces', () => {})
  it('list_spaces should filter by tag', () => {})
  it('list_spaces should filter by runtime', () => {})
  it('list_spaces should search by name/description', () => {})
})
```

- [ ] Step 2: Create `packages/dashboard/src/mcp/space-tools-server.ts` following the exact pattern from `task-tools-server.ts`:

```typescript
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
import { mkdirSync, existsSync } from "fs"
import { join } from "path"
import { writeFrontmatter } from "../metadata/frontmatter.js"
import type { ConversationDatabase } from "../conversations/db.js"

export interface SpaceToolsServerDeps {
  agentDir: string
  db: ConversationDatabase
}

export function createSpaceToolsServer(deps: SpaceToolsServerDeps) {
  const createSpaceTool = tool(
    "create_space",
    "Create a new space — a managed folder with a SPACE.md manifest. Use for organizing tools, data, external folder references, or code projects.",
    {
      name: z.string().describe("Space name (used as directory name, lowercase-kebab)"),
      tags: z.array(z.string()).optional().describe("Tags for discovery (e.g. ['tool', 'scraper'])"),
      path: z.string().optional().describe("External path (for shared folders, repos). Omit for internal spaces."),
      runtime: z.string().optional().describe("Runtime if executable: 'uv', 'node', or 'bash'"),
      entry: z.string().optional().describe("Entry point file (e.g. 'src/scraper.py')"),
      description: z.string().optional().describe("What this space contains or does"),
    },
    async (args) => { ... }
  )

  const listSpacesTool = tool(
    "list_spaces",
    "List and search spaces. Filter by tag, runtime, or free-text search across names and descriptions.",
    {
      tag: z.string().optional().describe("Filter by tag"),
      runtime: z.string().optional().describe("Filter by runtime"),
      search: z.string().optional().describe("Search name/description/tags"),
    },
    async (args) => { ... }
  )

  return createSdkMcpServer({
    name: "space-tools",
    tools: [createSpaceTool, listSpacesTool],
  })
}
```

- [ ] Step 3: Implement `create_space` handler:
  1. Validate name (lowercase, kebab-case, no special chars).
  2. Check `spacesDir = join(agentDir, 'spaces')` exists, create if not.
  3. Check `join(spacesDir, name)` doesn't already exist (error if duplicate).
  4. `mkdirSync(spaceDir, { recursive: true })`.
  5. Build frontmatter data from args + `created: new Date().toISOString()`.
  6. Call `writeFrontmatter(join(spaceDir, 'SPACE.md'), data, description ?? '')`.
  7. Return success message with space name.

- [ ] Step 4: Implement `list_spaces` handler:
  1. Call `deps.db.listSpaces({ tag, runtime, search })`.
  2. Format results as readable text with name, tags, path (if external), runtime.
  3. Return formatted list or "No spaces found."

- [ ] Step 5: Run tests:
```bash
cd packages/dashboard && npx vitest run tests/mcp/space-tools-server.test.ts
```

**Commit:** `feat(m7-s1): add create_space and list_spaces MCP tools`

---

### Task 6: App Integration — SpaceSyncService + MCP Registration

**Files:**
- Modify: `packages/dashboard/src/app.ts`
- Modify: `packages/dashboard/src/app-events.ts`
- Modify: `packages/dashboard/src/agent/session-manager.ts` (MCP server registration)

**Spec ref:** "App Integration > Initialization Order" and "App Service Namespaces".

- [ ] Step 1: Add space events to `packages/dashboard/src/app-events.ts`:

```typescript
import type { Space } from "@my-agent/core"

// Add to AppEventMap:
'space:created': [space: Space]
'space:updated': [space: Space]
'space:deleted': [name: string]
```

- [ ] Step 2: Add `AppSpaceService` class to `packages/dashboard/src/app.ts` (following `AppTaskService` pattern):

```typescript
export class AppSpaceService {
  constructor(
    private db: ConversationDatabase,
    private app: App,
  ) {}

  list(filter?: ListSpacesFilter) {
    return this.db.listSpaces(filter)
  }
  findByName(name: string) {
    return this.db.getSpace(name)
  }
}
```

- [ ] Step 3: Add space-related properties to the `App` class:
```typescript
spaces!: AppSpaceService
spaceSyncService: SpaceSyncService | null = null
```

- [ ] Step 4: Add `SpaceSyncService` initialization in `App.create()` — after ConversationManager init but before WorkLoopScheduler. Wire `onSpaceChanged` to `db.upsertSpace()` + `app.emit('space:updated')`. Wire `onSpaceDeleted` to `db.deleteSpace()` + `app.emit('space:deleted')`. Call `fullSync()` on startup.

- [ ] Step 5: Register the `space-tools` MCP server in session-manager (add to `initMcpServers()` alongside task-tools):

```typescript
import { createSpaceToolsServer } from "../mcp/space-tools-server.js"
// Add to the servers array:
const spaceServer = createSpaceToolsServer({ agentDir, db })
```

- [ ] Step 6: Verify the build compiles:
```bash
cd packages/dashboard && npx tsc --noEmit
```

**Commit:** `feat(m7-s1): integrate SpaceSyncService and space MCP tools into App`

---

### Task 7: StatePublisher — Spaces Broadcasting

**Files:**
- Modify: `packages/dashboard/src/state/state-publisher.ts`
- Modify: `packages/dashboard/src/ws/protocol.ts`

**Spec ref:** "Dashboard UI Changes > WebSocket Real-Time Updates" — `state:spaces` message.

- [ ] Step 1: Add `SpaceSnapshot` type to `packages/dashboard/src/ws/protocol.ts`:

```typescript
export interface SpaceSnapshot {
  name: string
  tags: string[]
  path?: string
  runtime?: string
  entry?: string
  description?: string
  indexedAt: string
}
```

- [ ] Step 2: Add `publishSpaces()` method to `StatePublisher` (following the existing `publishTasks()` pattern):
  1. Query `db.listSpaces()`.
  2. Broadcast `{ type: 'state:spaces', spaces: [...] }` to all connections.
  3. Debounce with the existing `DEBOUNCE_MS` pattern.

- [ ] Step 3: Wire App events `space:created`, `space:updated`, `space:deleted` to `publishSpaces()` in the StatePublisher subscription setup.

- [ ] Step 4: Add `publishSpaces()` call to the initial state push (sent when a new WebSocket client connects).

- [ ] Step 5: Verify build:
```bash
cd packages/dashboard && npx tsc --noEmit
```

**Commit:** `feat(m7-s1): broadcast space state via WebSocket`

---

### Task 8: Frontend — Alpine Store + WebSocket Handler

**Files:**
- Modify: `packages/dashboard/public/js/stores.js`
- Modify: `packages/dashboard/public/js/ws-client.js`

**Spec ref:** "Dashboard UI Changes > WebSocket Real-Time Updates" — `state:spaces` store.

- [ ] Step 1: Add spaces store to `packages/dashboard/public/js/stores.js`:

```javascript
Alpine.store("spaces", {
  items: [],
  loading: false,
});
```

- [ ] Step 2: Add `state:spaces` handler to `packages/dashboard/public/js/ws-client.js` (in the switch statement, after the existing `state:memory` case):

```javascript
case "state:spaces":
  if (Alpine.store("spaces")) {
    Alpine.store("spaces").items = data.spaces || [];
    Alpine.store("spaces").loading = false;
  }
  break;
```

- [ ] Step 3: Verify by restarting dashboard and checking browser console for `state:spaces` messages:
```bash
systemctl --user restart nina-dashboard.service
```

**Commit:** `feat(m7-s1): add spaces Alpine store and WebSocket handler`

---

### Task 9: Frontend — Spaces Home Widget

**Files:**
- Modify: `packages/dashboard/public/index.html`

**Spec ref:** "Dashboard UI Changes > Home Tab: Two-Row Grid" — Spaces widget in top-left of 2x2 grid. "Sprint Scope > S1" — Spaces widget.

The spec describes a 2x2 grid (Spaces | Automations / Notebook | Conversations). For S1 we add the Spaces widget. The grid layout is introduced but only the Spaces cell is populated — the other cells are the existing widgets, repositioned into the grid in a future sprint when Automations arrives.

- [ ] Step 1: Add the Spaces home widget to `packages/dashboard/public/index.html`, placed before the Notebook widget (after the header section, ~line 344). Uses `glass-strong rounded-xl` container matching existing widgets:

```html
<!-- Spaces Widget -->
<div class="glass-strong rounded-xl overflow-hidden mb-4">
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-3 border-b border-white/5">
    <h2 class="text-sm font-semibold text-tokyo-text flex items-center gap-2">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5 text-tokyo-muted">
        <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h2.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 9.622 4H12.5A1.5 1.5 0 0 1 14 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Z"/>
      </svg>
      Spaces
    </h2>
    <span class="text-xs text-tokyo-muted" x-text="$store.spaces.items.length + ' total'"></span>
  </div>
  <!-- Space list (compact, max 5 shown) -->
  <div class="max-h-[200px] overflow-y-auto">
    <template x-if="$store.spaces.items.length === 0">
      <div class="px-4 py-6 text-center text-xs text-tokyo-muted">
        No spaces yet
      </div>
    </template>
    <template x-for="space in $store.spaces.items.slice(0, 5)" :key="space.name">
      <button
        @click="openSpaceDetail(space.name)"
        class="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-white/5 transition-colors text-left border-b border-white/5 last:border-b-0"
      >
        <!-- Folder icon -->
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4 text-tokyo-blue shrink-0">
          <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h2.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 9.622 4H12.5A1.5 1.5 0 0 1 14 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Z"/>
        </svg>
        <div class="flex-1 min-w-0">
          <div class="text-xs font-medium text-tokyo-text truncate" x-text="space.name"></div>
          <div class="flex gap-1 mt-0.5 flex-wrap" x-show="space.tags?.length">
            <template x-for="tag in (space.tags || []).slice(0, 3)" :key="tag">
              <span class="text-[9px] px-1 py-px rounded bg-tokyo-blue/10 text-tokyo-blue/70" x-text="tag"></span>
            </template>
          </div>
        </div>
        <!-- External indicator -->
        <svg x-show="space.path" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3 text-tokyo-muted shrink-0" title="External space">
          <path fill-rule="evenodd" d="M4.22 11.78a.75.75 0 0 1 0-1.06L9.44 5.5H5.75a.75.75 0 0 1 0-1.5h5.5a.75.75 0 0 1 .75.75v5.5a.75.75 0 0 1-1.5 0V6.56l-5.22 5.22a.75.75 0 0 1-1.06 0Z" clip-rule="evenodd"/>
        </svg>
      </button>
    </template>
    <!-- "Show all" link when there are more than 5 -->
    <template x-if="$store.spaces.items.length > 5">
      <button
        @click="openSpacesBrowser()"
        class="w-full px-4 py-2 text-[11px] text-tokyo-blue hover:text-tokyo-blue/80 transition-colors text-center"
      >
        Show all <span x-text="$store.spaces.items.length"></span> spaces
      </button>
    </template>
  </div>
</div>
```

- [ ] Step 2: Add `openSpaceDetail(name)` method to the Alpine app data in `packages/dashboard/public/js/app.js`:

```javascript
openSpaceDetail(name) {
  const tabId = `space-${name}`;
  this.openTab({
    id: tabId,
    type: "space",
    title: name,
    icon: "📁",
    closeable: true,
    data: { name },
  });
},

openSpacesBrowser() {
  this.openTab({
    id: "spaces-browser",
    type: "spaces-browser",
    title: "Spaces",
    icon: "📁",
    closeable: true,
  });
},
```

- [ ] Step 3: Add mobile compact card for the Spaces widget (stacked layout) in the mobile section of index.html, matching the spec's mobile mockup.

- [ ] Step 4: Restart dashboard and verify widget renders:
```bash
systemctl --user restart nina-dashboard.service
```

**Commit:** `feat(m7-s1): add Spaces home widget with compact list`

---

### Task 10: Frontend — Spaces Browser Tab

**Files:**
- Modify: `packages/dashboard/public/index.html`
- Modify: `packages/dashboard/public/js/app.js`

**Spec ref:** "Dashboard UI Changes > Spaces Browser Tab" — full searchable list with name, tags, capability indicators, path, referencing automation count.

- [ ] Step 1: Add the spaces-browser tab content in `packages/dashboard/public/index.html`. Place it after the existing tab content sections. Show when `activeTab` matches a tab with `type === 'spaces-browser'`:

```html
<!-- Spaces Browser Tab -->
<template x-if="openTabs.find(t => t.id === activeTab && t.type === 'spaces-browser')">
  <div class="p-6" x-data="{ spacesSearch: '' }">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-tokyo-text">All Spaces</h2>
      <input
        x-model="spacesSearch"
        type="text"
        placeholder="Search spaces..."
        class="text-xs bg-tokyo-card/50 border border-white/10 rounded-md px-3 py-1.5 text-tokyo-text placeholder:text-tokyo-muted outline-none focus:border-tokyo-blue/50 w-48"
      />
    </div>
    <!-- Space rows -->
    <div class="space-y-2">
      <template x-for="space in $store.spaces.items.filter(s =>
        !spacesSearch || s.name.includes(spacesSearch.toLowerCase()) ||
        (s.tags || []).some(t => t.includes(spacesSearch.toLowerCase())) ||
        (s.description || '').toLowerCase().includes(spacesSearch.toLowerCase())
      )" :key="space.name">
        <button
          @click="openSpaceDetail(space.name)"
          class="w-full glass-strong rounded-lg px-4 py-3 flex items-center gap-4 hover:bg-white/5 transition-colors text-left"
        >
          <!-- Folder icon -->
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-5 h-5 text-tokyo-blue shrink-0">
            <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h2.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 9.622 4H12.5A1.5 1.5 0 0 1 14 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Z"/>
          </svg>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-tokyo-text" x-text="space.name"></div>
            <div class="flex gap-1.5 mt-1 flex-wrap">
              <template x-for="tag in (space.tags || [])" :key="tag">
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-tokyo-blue/10 text-tokyo-blue/70" x-text="tag"></span>
              </template>
            </div>
          </div>
          <!-- Capability indicators -->
          <div class="flex gap-2 shrink-0">
            <span x-show="space.runtime" class="text-[9px] px-1 py-px rounded bg-violet-500/15 text-violet-400" x-text="space.runtime"></span>
            <span x-show="space.entry" class="text-[9px] px-1 py-px rounded bg-amber-500/15 text-amber-400">Tool</span>
          </div>
          <!-- External indicator -->
          <span x-show="space.path" class="text-[10px] text-tokyo-muted truncate max-w-[120px]" x-text="space.path"></span>
        </button>
      </template>
    </div>
    <div x-show="$store.spaces.items.length === 0" class="text-center text-tokyo-muted text-sm py-12">
      No spaces yet. Use the chat to ask Nina to create one.
    </div>
  </div>
</template>
```

- [ ] Step 2: Verify tab opens from both the widget "Show all" link and the `openSpacesBrowser()` method.

- [ ] Step 3: Restart and test:
```bash
systemctl --user restart nina-dashboard.service
```

**Commit:** `feat(m7-s1): add Spaces browser tab with search and filtering`

---

### Task 11: REST API — Space Detail Endpoint

**Files:**
- Create: `packages/dashboard/src/routes/spaces.ts`
- Modify: `packages/dashboard/src/server.ts` (register route)

**Spec ref:** "Space Detail Tab" — needs file tree data and SPACE.md content served from the backend.

- [ ] Step 1: Create `packages/dashboard/src/routes/spaces.ts`:

```typescript
import type { FastifyInstance } from "fastify"
import { readdirSync, statSync, readFileSync, existsSync } from "fs"
import { join, relative, extname } from "path"
import { readFrontmatter } from "../metadata/frontmatter.js"

interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  children?: FileTreeNode[]
}

export function registerSpaceRoutes(
  app: FastifyInstance,
  agentDir: string,
) {
  // GET /api/spaces/:name — space detail (manifest + file tree)
  app.get("/api/spaces/:name", async (request, reply) => {
    const { name } = request.params as { name: string }
    const spaceDir = join(agentDir, "spaces", name)
    if (!existsSync(spaceDir)) {
      return reply.code(404).send({ error: "Space not found" })
    }
    const manifestPath = join(spaceDir, "SPACE.md")
    let manifest = null
    let body = ""
    if (existsSync(manifestPath)) {
      const fm = readFrontmatter(manifestPath)
      manifest = fm.data
      body = fm.body
    }
    const tree = buildFileTree(spaceDir, spaceDir)
    return { name, manifest, body, tree }
  })

  // GET /api/spaces/:name/file — read a file from the space
  app.get("/api/spaces/:name/file", async (request, reply) => {
    const { name } = request.params as { name: string }
    const { path: filePath } = request.query as { path: string }
    const spaceDir = join(agentDir, "spaces", name)
    const fullPath = join(spaceDir, filePath)
    // Security: ensure path is within the space dir
    if (!fullPath.startsWith(spaceDir)) {
      return reply.code(403).send({ error: "Access denied" })
    }
    if (!existsSync(fullPath)) {
      return reply.code(404).send({ error: "File not found" })
    }
    const content = readFileSync(fullPath, "utf-8")
    const ext = extname(filePath).slice(1)
    return { path: filePath, content, extension: ext }
  })
}

function buildFileTree(dir: string, rootDir: string): FileTreeNode[] {
  // Recursively build tree, separating Nina's files (SPACE.md, DECISIONS.md) from content
  ...
}
```

- [ ] Step 2: Register the route in `packages/dashboard/src/server.ts`:
```typescript
import { registerSpaceRoutes } from "./routes/spaces.js"
// In registerRoutes():
registerSpaceRoutes(app, agentDir)
```

- [ ] Step 3: Verify:
```bash
curl http://localhost:4321/api/spaces/test-space
```

**Commit:** `feat(m7-s1): add REST API endpoints for space detail and file reading`

---

### Task 12: Frontend — Space Detail Tab (Tree View + Property View)

**Files:**
- Modify: `packages/dashboard/public/index.html`
- Modify: `packages/dashboard/public/js/app.js`

**Spec ref:** "Dashboard UI Changes > Space Detail Tab" — split-panel layout with file tree (left) + content preview / property view (right). Nina's Files section (SPACE.md, DECISIONS.md) separated from Content section. Property view with inline-editable fields that appear as content until interacted with.

- [ ] Step 1: Add `loadSpaceDetail(name)` method to `packages/dashboard/public/js/app.js`:

```javascript
async loadSpaceDetail(name) {
  const tab = this.openTabs.find(t => t.id === `space-${name}`);
  if (!tab) return;
  tab.loading = true;
  this.openTabs = [...this.openTabs]; // trigger reactivity
  try {
    const resp = await fetch(`/api/spaces/${encodeURIComponent(name)}`);
    const data = await resp.json();
    tab.data = { ...tab.data, ...data, loaded: true };
    tab.selectedFile = null;
    tab.fileContent = null;
  } catch (err) {
    console.error('Failed to load space:', err);
  }
  tab.loading = false;
  this.openTabs = [...this.openTabs];
},

async loadSpaceFile(tabId, filePath) {
  const tab = this.openTabs.find(t => t.id === tabId);
  if (!tab) return;
  const name = tab.data.name;
  try {
    const resp = await fetch(`/api/spaces/${encodeURIComponent(name)}/file?path=${encodeURIComponent(filePath)}`);
    const data = await resp.json();
    tab.selectedFile = filePath;
    tab.fileContent = data.content;
    tab.fileExtension = data.extension;
    this.openTabs = [...this.openTabs];
  } catch (err) {
    console.error('Failed to load file:', err);
  }
},
```

- [ ] Step 2: Add space detail tab template in `packages/dashboard/public/index.html`:

```html
<!-- Space Detail Tab -->
<template x-if="openTabs.find(t => t.id === activeTab && t.type === 'space')">
  <div class="flex h-full" x-init="loadSpaceDetail(openTabs.find(t => t.id === activeTab).data.name)">
    <!-- Left: File Tree -->
    <div class="w-64 border-r border-white/5 overflow-y-auto shrink-0">
      <!-- Nina's Files section -->
      <div class="px-3 py-2 text-[10px] font-semibold uppercase text-tokyo-muted tracking-wider">
        Nina's Files
      </div>
      <!-- SPACE.md, DECISIONS.md entries with badges -->
      ...
      <!-- Content section (divider) -->
      <div class="px-3 py-2 text-[10px] font-semibold uppercase text-tokyo-muted tracking-wider border-t border-white/5 mt-1">
        Content
      </div>
      <!-- Recursive file tree -->
      ...
    </div>
    <!-- Right: Content / Property View -->
    <div class="flex-1 overflow-y-auto p-6">
      <!-- When SPACE.md selected: Property view -->
      <!-- When other file selected: Code preview -->
      <!-- When nothing selected: Space overview -->
    </div>
  </div>
</template>
```

- [ ] Step 3: Implement the file tree component with folder expand/collapse, file type SVG icons, and size indicators. Separate Nina's Files (SPACE.md with manifest badge, DECISIONS.md with history badge) from Content files.

- [ ] Step 4: Implement the SPACE.md property view — inline-editable fields that appear as content until hovered/focused:
  - Name in header bar (editable on click)
  - Tag chips with x-on-hover for removal, plus add button
  - Property rows: runtime, entry, path — plain text that shows subtle underline on hover
  - Description as readable text
  - "Referenced by automations" footer (empty for S1 — placeholder text "No automations reference this space yet")

- [ ] Step 5: Implement code preview for content files — syntax-highlighted with file extension displayed, monospace font, line numbers.

- [ ] Step 6: Add chat tag injection when viewing a space tab — set `chatContext` so the brain knows what the user is looking at:

```javascript
// In switchTab(), add handling for space tabs:
if (tab.type === 'space') {
  this.chatContext = {
    type: 'space',
    title: tab.data.name,
    icon: '📁',
    spaceName: tab.data.name,
  };
}
```

- [ ] Step 7: Restart and verify:
```bash
systemctl --user restart nina-dashboard.service
```

**Commit:** `feat(m7-s1): add Space detail tab with tree view, property view, and code preview`

---

### Task 13: Frontend — Space Property Editing (Write-Back)

**Files:**
- Create: `packages/dashboard/src/routes/spaces.ts` (add PATCH endpoint)
- Modify: `packages/dashboard/public/js/app.js`

**Spec ref:** "Space Detail Tab" — edits write back to SPACE.md frontmatter via `writeFrontmatter()`.

- [ ] Step 1: Add PATCH endpoint to `packages/dashboard/src/routes/spaces.ts`:

```typescript
// PATCH /api/spaces/:name — update space manifest fields
app.patch("/api/spaces/:name", async (request, reply) => {
  const { name } = request.params as { name: string }
  const updates = request.body as Record<string, unknown>
  const spaceDir = join(agentDir, "spaces", name)
  const manifestPath = join(spaceDir, "SPACE.md")
  if (!existsSync(manifestPath)) {
    return reply.code(404).send({ error: "Space not found" })
  }
  const { data, body } = readFrontmatter(manifestPath)
  const merged = { ...data, ...updates }
  writeFrontmatter(manifestPath, merged, body)
  return { ok: true, manifest: merged }
})
```

- [ ] Step 2: Add `updateSpaceField(name, field, value)` method to `packages/dashboard/public/js/app.js`:

```javascript
async updateSpaceField(name, field, value) {
  try {
    await fetch(`/api/spaces/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    // SpaceSyncService will detect the change and broadcast updated state
  } catch (err) {
    console.error('Failed to update space:', err);
  }
},

async addSpaceTag(name, tag) {
  const tab = this.openTabs.find(t => t.id === `space-${name}`);
  const currentTags = tab?.data?.manifest?.tags || [];
  if (!currentTags.includes(tag)) {
    await this.updateSpaceField(name, 'tags', [...currentTags, tag]);
  }
},

async removeSpaceTag(name, tag) {
  const tab = this.openTabs.find(t => t.id === `space-${name}`);
  const currentTags = tab?.data?.manifest?.tags || [];
  await this.updateSpaceField(name, 'tags', currentTags.filter(t => t !== tag));
},
```

- [ ] Step 3: Wire the property view UI elements to call `updateSpaceField()` on blur/change. Use `@blur` for text fields, `@click` for tag removal.

- [ ] Step 4: Restart and test editing a property:
```bash
systemctl --user restart nina-dashboard.service
```

**Commit:** `feat(m7-s1): add space property editing with write-back to SPACE.md`

---

### Task 14: End-to-End Verification

**Files:**
- No new files — verification task

**Spec ref:** Full S1 scope verification.

- [ ] Step 1: Create a test space via MCP tool (or manually create `.my_agent/spaces/test-space/SPACE.md`):

```yaml
---
name: test-space
tags: [test, data]
created: 2026-03-23
---

# Test Space

A test space for S1 verification.
```

- [ ] Step 2: Verify SpaceSyncService detects the file and syncs to agent.db:
```bash
sqlite3 .my_agent/conversations/agent.db "SELECT * FROM spaces"
```

- [ ] Step 3: Verify the dashboard Spaces widget shows the space.

- [ ] Step 4: Click the space — verify the detail tab opens with tree view and property view.

- [ ] Step 5: Edit a tag in the property view — verify SPACE.md is updated on disk.

- [ ] Step 6: Create an external space (with `path` field) and verify it appears with the external indicator icon.

- [ ] Step 7: Open the Spaces browser tab and verify search works.

- [ ] Step 8: Verify chat tag injection — switch to a space tab and send a message; confirm the brain receives space context.

- [ ] Step 9: Delete a SPACE.md file and verify the space is removed from agent.db and dashboard.

- [ ] Step 10: Verify the build is clean:
```bash
cd packages/core && npx tsc --noEmit && cd ../dashboard && npx tsc --noEmit
```

**Commit:** `test(m7-s1): end-to-end verification of Space entity`
