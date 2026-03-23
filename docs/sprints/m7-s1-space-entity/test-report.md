# Test Report — M7-S1

**Date:** 2026-03-23
**Reviewer:** External Opus (independent)

---

## Automated Tests

### Core Package (`packages/core`)

```
npx vitest run
Test Files  20 passed | 1 skipped (21)
Tests       210 passed | 7 skipped (217)
```

**Space-specific test files:**

| Test File | Tests | Status |
|---|---|---|
| `tests/sync/file-watcher.test.ts` | 7 | All passing |
| `tests/spaces/space-sync-service.test.ts` | 6 | All passing |

**FileWatcher tests cover:**
- Deterministic SHA256 hashing
- scanAll emits file:changed for matching files
- Hash-based dedup (skip unchanged on repeated scan)
- Re-emit after content change
- Exclude patterns
- scan:complete event
- No-pattern mode (scan all files)

**SpaceSyncService tests cover:**
- Parse SPACE.md frontmatter and call onSpaceChanged
- External spaces with path field
- Default path to manifest directory for internal spaces
- Directory name as fallback space name
- space:synced event emission
- Multiple space sync

### Dashboard Package (`packages/dashboard`)

```
npx vitest run
Test Files  74 passed (74)
Tests       698 passed | 2 skipped (700)
```

**Space-specific test files:**

| Test File | Tests | Status |
|---|---|---|
| `tests/spaces-db.test.ts` | 10 | All passing |
| `tests/mcp/space-tools-server.test.ts` | 7 | All passing |

**spaces-db tests cover:**
- Table creation on initialization
- Upsert and retrieve with all fields (name, path, tags, runtime, entry, io, maintenance, description)
- Update existing space on upsert
- List with tag filter
- List with runtime filter
- Search by name/description
- Delete
- Null for non-existent space
- Empty array for no matches

**space-tools-server tests cover:**
- Server creation with correct name and 2 tools
- create_space writes SPACE.md and creates directory
- create_space rejects duplicate names
- create_space rejects invalid names (non-kebab-case)
- list_spaces returns all spaces
- list_spaces filters by tag
- list_spaces returns message when empty

### TypeScript Compilation

| Package | Command | Result |
|---|---|---|
| core | `npx tsc --noEmit` | Clean (no errors) |
| dashboard | `npx tsc --noEmit` | Clean (no errors) |

---

## Browser Verification

**Server:** `nina-dashboard.service` (systemd user service, port 4321)
**Method:** Playwright accessibility snapshots + console log inspection

### Test 1: Dashboard loads without JS errors

- **Result:** PASS
- **Console errors:** 2 (both pre-existing: favicon 404, available-models 500)
- **Console warnings:** 1 (Tailwind CDN — pre-existing)

### Test 2: Home tab — Spaces widget renders

- **Result:** PASS
- **Empty state:** "No spaces yet" shown, "0 total" count
- **With space:** "1 total", space name "test-space" with tags "test", "verification"

### Test 3: WebSocket state:spaces received

- **Result:** PASS
- **Evidence:** Console log shows `state:spaces` message received on connect
- **Note:** Warning `Unknown message type: state:spaces` in app.js — cosmetic, store updates work via ws-client.js

### Test 4: REST API — /api/spaces/:name

- **Result:** PASS
- **404 case:** `curl http://localhost:4321/api/spaces/test-space` returns `{"error":"Space not found"}` before space exists
- **200 case:** After creating space, returns full payload:
  ```json
  {
    "name": "test-space",
    "manifest": {"name": "test-space", "tags": ["test", "verification"], "created": "2026-03-23"},
    "body": "\nA test space for external review verification.\n",
    "tree": [{"name": "SPACE.md", "path": "SPACE.md", "type": "file", "size": 120}]
  }
  ```

### Test 5: SpaceSyncService fullSync on startup

- **Result:** PASS
- **Method:** Created test space, restarted dashboard, queried DB
- **Evidence:** `spaces` table contains 1 row with correct data after restart

### Test 6: SpaceSyncService live file detection (chokidar)

- **Result:** FAIL (with explanation)
- **Method:** Created `.my_agent/spaces/test-space/SPACE.md` while dashboard running, waited 8+ seconds
- **Evidence:** `spaces` table remained empty. Space only detected after service restart.
- **Root cause:** `.my_agent/spaces/` directory didn't exist when watcher started. Chokidar silently fails on non-existent directories.
- **Severity:** Medium — affects first-run experience on fresh agent
- **After restart:** Working correctly (spaces dir existed)

### Test 7: Space detail tab opens from widget click

- **Result:** PASS
- **Evidence:** Tab created with title "test-space", file tree loaded with SPACE.md

### Test 8: File tree — Nina's Files section

- **Result:** PASS
- **Evidence:** SPACE.md shown with "manifest" badge. DECISIONS.md conditionally shown (not present in test space, correctly hidden).

### Test 9: Property view (SPACE.md selected)

- **Result:** PASS
- **Editable fields verified:**
  - Description (text input with placeholder)
  - Tags (chips with remove buttons + add input)
  - Runtime (text input with placeholder)
  - Entry (text input with placeholder)
  - External Path (text input with placeholder)
- **Notes section:** Markdown body text displayed correctly

### Test 10: Spaces browser tab

- **Result:** PASS (verified from code review — snapshot showed widget, browser tab opens via openSpacesBrowser())
- **Features confirmed:** Search input, space rows with name/tags/capability indicators/external path

---

## Manual Verification

### Test space lifecycle

1. Created test space directory + SPACE.md manually
2. Verified API endpoint returned correct data
3. Verified dashboard widget showed space after restart
4. Clicked space to open detail tab
5. Verified file tree, property view, and notes section
6. Cleaned up test space: `rm -rf .my_agent/spaces/test-space`

### Code review findings

1. **Security:** Path traversal protection in `/api/spaces/:name/file` endpoint — `fullPath.startsWith(spaceDir + "/")` check present
2. **Name validation:** `create_space` MCP tool validates kebab-case with regex
3. **Duplicate prevention:** `create_space` checks `existsSync(spaceDir)` before creation
4. **Frontmatter parsing:** SpaceSyncService implements own parser (not using shared `readFrontmatter`), uses `yaml` package — functionally correct
5. **DB schema:** Matches spec SQL exactly (spaces table with all columns)
6. **Event chain:** SpaceSyncService -> App events -> StatePublisher -> WebSocket -> Alpine store — complete chain verified
7. **Graceful shutdown:** `app.spaceSyncService.stop()` called in App shutdown

---

## Summary

| Category | Passed | Failed | Blocked |
|---|---|---|---|
| Unit tests (core) | 13/13 | 0 | 0 |
| Unit tests (dashboard) | 17/17 | 0 | 0 |
| TypeScript compilation | 2/2 | 0 | 0 |
| Browser checks | 9/10 | 1 | 0 |
| **Total** | **41/42** | **1** | **0** |

The single failure (live file detection on fresh agent) is a real bug with a straightforward 1-line fix. All other checks pass.
