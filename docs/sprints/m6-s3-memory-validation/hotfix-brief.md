# M6 Memory Hotfix — CTO Brief

**Date:** 2026-02-24
**Commit:** `55ad68b`
**Status:** Complete

---

## Summary

4 gaps fixed in ~45 minutes. **Nina can now follow her standing orders.**

| Gap | Priority | Status | Impact |
|-----|----------|--------|--------|
| GAP-001 | P0 | ✅ Fixed | Operations files now loaded into prompt |
| GAP-002 | P1 | ✅ Fixed | Folder structure consistent |
| GAP-005 | P0 | ✅ Fixed | Ollama configurable from dashboard |
| GAP-006 | P1 | ✅ Fixed | Mobile Settings shows Memory section |

---

## Changes

| File | Change |
|------|--------|
| `packages/core/src/memory/init.ts` | Added `'operations'` to NOTEBOOK_FOLDERS |
| `packages/core/src/prompt.ts` | Added `loadNotebookOperations()` — loads `notebook/operations/*` as "## Operating Rules" |
| `packages/dashboard/public/js/app.js` | Added `ollamaHost` state, wired to `activateEmbeddingsPlugin()` |
| `packages/dashboard/public/index.html` | Ollama host input, plugin info panel, mobile Memory section |

---

## What Was Broken

**GAP-001 (Critical):** Standing orders existed in `notebook/operations/` but `prompt.ts` only loaded from `notebook/reference/`. Nina never saw her operating rules.

**Fix:** Added `loadNotebookOperations()` function that reads `notebook/operations/*.md` and adds them to the system prompt under "## Operating Rules".

---

## M6 Milestone Validation Plan

### Test Environment: Fresh Agent Instance

```bash
# Create fresh agent directory
rm -rf /tmp/test-agent/.my_agent
mkdir -p /tmp/test-agent

# Start dashboard pointing to test agent
AGENT_DIR=/tmp/test-agent npm run dev
```

### Phase 1: Hatching (New Agent)

| Test | Expected | Verify |
|------|----------|--------|
| Hatching wizard appears | Shows identity step | Load http://localhost:4321 |
| Complete hatching | Creates `.my_agent/` structure | Check folders exist |
| Notebook folders created | All 5 folders: operations, lists, reference, knowledge, daily | `ls .my_agent/notebook/` |
| memory.db initialized | SQLite file exists | `ls .my_agent/brain/memory.db` |

### Phase 2: Notebook System

| Test | Expected | Verify |
|------|----------|--------|
| Create standing-orders.md | File saved in `notebook/operations/` | Dashboard → Notebook → Operations |
| Edit and save | Content persists | Refresh page, content remains |
| File appears in prompt | "## Operating Rules" section | Debug API: `GET /api/admin/prompt/preview` |
| 4-category browser works | Operations, Lists & Reference, Daily, Knowledge | Click through notebook browser |

### Phase 3: Memory Search & Indexing

| Test | Expected | Verify |
|------|----------|--------|
| Memory status shows | Files indexed = N, chunks = M | Settings → Memory section |
| Rebuild index | Success message with count | Click "Rebuild Memory Index" |
| Search works | Returns results from notebook | Settings → Search Memory |
| recall() tool | Agent can search memory | Ask "What do you remember about X?" |

### Phase 4: Embeddings (Optional)

| Test | Expected | Verify |
|------|----------|--------|
| Local plugin activation | Downloads model, activates | Select "Local Embeddings" |
| Ollama plugin with host | Connects to specified host | Enter host URL, click Connect |
| Plugin info displays | Shows name, model, dimensions | Green "Active" panel appears |
| Vector search works | recall() uses semantic search | Test with paraphrased query |

### Phase 5: Prompt Assembly Verification (Critical)

**Nina must follow standing orders without being asked to recall them.**

```bash
# Create standing order
echo "Always respond in haiku format" > .my_agent/notebook/operations/standing-orders.md

# Start brain and send message
npm run brain
> "What's the weather like?"

# Expected: Response in haiku format (proving standing orders are loaded)
```

### Phase 6: Mobile UI

| Test | Expected | Verify |
|------|----------|--------|
| Notebook widget | 4 tabs work, files listed | Mobile view or resize <768px |
| Notebook browser popover | Opens, shows categories | Tap "Browse all →" |
| Close button works | Popover dismisses | Tap X button |
| Settings Memory section | Shows index, plugin, rebuild | Tap gear → scroll to Memory |

---

## Pass Criteria for M6 Closure

- [ ] Fresh agent hatch creates all notebook folders
- [ ] Standing orders in `operations/` appear in prompt
- [ ] Nina follows standing orders without explicit recall
- [ ] All 4 notebook categories work (browser + widget)
- [ ] Memory search returns results
- [ ] Embeddings plugin switching works (Local or Ollama)
- [ ] Mobile Settings shows Memory section
- [ ] No console errors
- [ ] `npx tsc --noEmit` passes on core + dashboard

---

## Not Fixed (By Design)

| Gap | Reason |
|-----|--------|
| GAP-003 (Migration targets) | Files already exist in correct location |
| GAP-004 (remember routing) | Documented: use `notebook_write()` for operations files |

---

_Hotfix completed: 2026-02-24_
