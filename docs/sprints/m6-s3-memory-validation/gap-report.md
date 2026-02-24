# M6 Memory System — Gap Report

**Date:** 2026-02-24
**Author:** CTO Review
**Status:** Requires Hotfix

---

## Executive Summary

Design-to-implementation review found **1 critical bug**, **1 high-priority UI gap**, and **3 structural inconsistencies**. The critical bug prevents Nina's standing orders from loading into her system prompt — her operational rules are invisible to her.

**Recommendation:** Hotfix before M6 closure.

---

## Critical Issues

### GAP-001: Standing Orders Not Loaded in Prompt (CRITICAL)

**Design spec** ([memory-system.md](../../design/memory-system.md) lines 139-141, 166):
```markdown
| `reference/` | Contacts, preferences, standing orders | **Always loaded in prompt** |
```

**Expected behavior:** Files in `notebook/reference/` are auto-loaded into Nina's system prompt on every query.

**Actual behavior:**
- `standing-orders.md` is in `notebook/operations/` (not `reference/`)
- `external-communications.md` is in `notebook/operations/` (not `reference/`)
- `prompt.ts` only loads from `notebook/reference/` (line 95)
- **Result: Standing orders are NEVER in Nina's prompt**

**Files affected:**
```
.my_agent/notebook/operations/standing-orders.md      ← NOT LOADED
.my_agent/notebook/operations/external-communications.md ← NOT LOADED
.my_agent/notebook/reference/contacts.md              ← loaded correctly
```

**Code location:**
- `packages/core/src/prompt.ts` line 94-141 — `loadNotebookReference()` only reads `reference/`
- `packages/dashboard/src/routes/notebook.ts` line 135 — UI lists `operations` as valid folder
- `packages/core/src/memory/init.ts` line 12 — `NOTEBOOK_FOLDERS` doesn't include `operations`

**Impact:** Nina cannot follow user's standing orders. Critical for agent behavior.

**Fix options:**

| Option | Description | Effort | Recommendation |
|--------|-------------|--------|----------------|
| A | Add `operations/` loading to `prompt.ts` | 30 min | **Recommended** |
| B | Move files from `operations/` to `reference/` | 15 min | Quick fix but loses semantic separation |
| C | Merge `operations/` into `reference/` everywhere | 2 hr | Clean but more work |

**Recommended fix (Option A):**
```typescript
// prompt.ts — add after loadNotebookReference()
async function loadNotebookOperations(agentDir: string): Promise<string | null> {
  const operationsDir = path.join(agentDir, 'notebook', 'operations')
  // Same logic as loadNotebookReference, different header
  // Return "## Your Operating Rules\n\n{content}"
}
```

---

### GAP-005: Settings Screen for Embeddings Incomplete (HIGH)

**Design spec** ([embeddings-plugin.md](../../design/embeddings-plugin.md) lines 199-260):
- Settings UI for plugin management
- Download progress indicator
- Plugin switcher (Local / Ollama / disabled)
- Ollama host configuration input
- Delete local model button

**Design spec requirement:** Full settings UI for embeddings management.

**S3 verification checklist** marked this as "deferred" — **not acceptable**.

**Current state:**
- Backend API exists (`POST /api/admin/memory/embeddings/activate`)
- Plugin switcher dropdown exists
- **Missing:** Ollama host input field in UI
- **Missing:** Download progress indicator
- **Missing:** Clear status when switching plugins
- **Missing:** Model info display (dimensions, size)

**Impact:** Users cannot configure Ollama from dashboard. System is not production-ready.

**Required for M6 closure:**
1. Ollama host input (shown when Ollama selected)
2. Model download progress bar (for local plugin first-run)
3. Clear feedback on plugin switch success/failure
4. Display active model info (name, dimensions, status)

**Estimate:** 1.5-2 hours frontend work

---

## Structural Inconsistencies

### GAP-002: Folder Structure Mismatch

**Design spec:**
```
notebook/
├── lists/       # High-churn tracking lists
├── reference/   # Stable reference (always loaded)
├── knowledge/   # Learned facts
└── daily/       # Temporal logs
```

**Actual implementation:**
```
notebook/
├── lists/
├── operations/  ← NOT IN DESIGN
├── reference/
├── knowledge/
└── daily/
```

**Code contradictions:**

| File | What it says |
|------|--------------|
| `init.ts` line 12 | `NOTEBOOK_FOLDERS = ['lists', 'reference', 'knowledge', 'daily']` |
| `notebook.ts` line 135 | `folders = ["operations", "lists", "reference", "knowledge", "daily"]` |
| `memory-system.md` | No mention of `operations/` |

**Fix:** Either:
1. Add `operations` to `init.ts` and design spec
2. Or merge `operations/` content into `reference/`

---

### GAP-003: Migration Targets Wrong Folder

**Design spec** ([memory-system.md](../../design/memory-system.md) lines 660-663):
```markdown
3. Migrate runtime files: `runtime/standing-orders.md` → `notebook/reference/standing-orders.md`
```

**Code** (`init.ts` lines 46-48):
```typescript
from: join(agentDir, 'runtime', 'standing-orders.md'),
to: join(notebookDir, 'reference', 'standing-orders.md'),  // → reference
```

**Actual file location:**
```
notebook/operations/standing-orders.md  // NOT reference/
```

**Analysis:** Migration code is correct per design, but someone (likely dashboard UI) created `operations/` folder and put files there instead.

**Fix:** Move files to match design, or update design to match reality.

---

### GAP-004: `remember()` Cannot Route to Operations

**Design spec** ([memory-system.md](../../design/memory-system.md) line 348):
```typescript
category?: "lists" | "reference" | "knowledge"
```

**Code** (`tools.ts` line 18):
```typescript
export type RememberCategory = 'lists' | 'reference' | 'knowledge'
```

**Issue:** If `operations/` is a legitimate folder, `remember()` can't route to it. Agent must use `notebook_write()` escape hatch.

**Impact:** Low — standing orders are rarely written by agent, usually by user.

**Fix:** Either:
1. Document that `notebook_write()` is the path for operations files
2. Or add `'operations'` to `RememberCategory` if we formalize that folder

---

## Verification Checklist (Post-Fix)

After fixes are applied, verify:

- [ ] `standing-orders.md` content appears in system prompt
- [ ] `external-communications.md` content appears in system prompt
- [ ] `init.ts` creates all folders used by dashboard
- [ ] Design spec matches implementation folder structure
- [ ] Migration path in design spec matches code

**Test command:**
```typescript
// In brain query, Nina should be able to answer:
"What are my standing orders?"
// Without using recall() — content should be in her context
```

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/core/src/prompt.ts` | Add `loadNotebookOperations()` or include `operations/` in reference loading |
| `packages/core/src/memory/init.ts` | Add `'operations'` to `NOTEBOOK_FOLDERS` |
| `packages/dashboard/public/index.html` | Add Ollama host input, download progress UI |
| `packages/dashboard/public/js/app.js` | Wire Ollama config to API, handle progress events |
| `docs/design/memory-system.md` | Add `operations/` folder to spec OR document as `reference/` subfolder |

---

## Timeline

| Priority | Issue | Estimate |
|----------|-------|----------|
| P0 | GAP-001 (standing orders not loaded) | 30 min |
| P0 | GAP-005 (settings screen incomplete) | 1.5 hr |
| P1 | GAP-002 (folder mismatch) | 15 min |
| P2 | GAP-003 (migration targets) | 15 min |
| P3 | GAP-004 (remember routing) | Document only |

**Total estimated fix time:** 2.5 hours

---

_Gap report created: 2026-02-24_
_Review requested by: CTO_
