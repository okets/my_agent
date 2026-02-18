# M4-S1: Notebook Infrastructure — Review

> **Status:** Complete
> **Date:** 2026-02-18
> **Team:** Tech Lead (Opus)

---

## Deliverables

| Task | Deliverable | Status |
|------|-------------|--------|
| T1 | Design documentation | [docs/design/notebook.md](../../design/notebook.md) |
| T2 | Runtime directory | `.my_agent/runtime/` created |
| T3 | Template files | 3 files with schema documentation |
| T4 | System directives | `brain/CLAUDE.md` updated with Notebook section |
| T5 | Prompt assembly | `packages/core/src/prompt.ts` loads Notebook files |

---

## Files Created/Modified

### New Files
- `docs/design/notebook.md` — Architecture spec (System vs Runtime model)
- `.my_agent/runtime/external-communications.md` — Rules for non-owner messages
- `.my_agent/runtime/reminders.md` — Tasks, deadlines, recurring items
- `.my_agent/runtime/standing-orders.md` — Persistent owner instructions

### Modified Files
- `.my_agent/brain/CLAUDE.md` — Added "Your Notebook" section with usage instructions
- `packages/core/src/prompt.ts` — Added NOTEBOOK_FILES loading with 8000 char limit

---

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass |
| `npx prettier --write src/` | Applied |
| Runtime directory exists | 3 files present |
| Prompt includes Notebook | All 4 sections detected |
| Prompt size | 5261 chars (well under limits) |

---

## Architecture Decisions

1. **Two-layer model:** System directives in `brain/CLAUDE.md` (read-only), runtime data in `runtime/` (read-write during owner conversations)

2. **Size limits:** 8000 chars (~2000 tokens) per Notebook file to prevent prompt bloat

3. **Path structure:** Notebook files at `../runtime/` relative to brainDir, keeping them separate from identity files

4. **Section headers:** Each file gets a header when injected (e.g., `## External Communications Rules`) for clarity in prompt

---

## What's Next

- **M4-S2:** Dashboard workspace layout with Notebook awareness
- **M4-S3:** `notebook_edit` tool for agent to modify files
- **M4-S4:** Refactor stashed M3-S4 code to use Notebook

---

## User Stories for Testing

### Story 1: Verify Notebook in Context

**Steps:**
1. Start dashboard: `cd packages/dashboard && npm run dev`
2. Open http://localhost:4321
3. In chat, ask Nina: "What's in your notebook?"

**Expected:** Nina describes her Notebook files — external communications, reminders, standing orders — and mentions they're currently empty templates.

### Story 2: Verify System Directives

**Steps:**
1. Ask Nina: "Can you edit your notebook right now?"

**Expected:** Nina explains she can edit during owner conversations (which this is), and describes the access rules from her system directives.

### Story 3: Verify Templates Are Readable

**Steps:**
1. Open `.my_agent/runtime/external-communications.md` in a text editor
2. Verify the header comment explains the format
3. Repeat for `reminders.md` and `standing-orders.md`

**Expected:** Each file has clear documentation of its schema in HTML comments.

---

_Completed: 2026-02-18_
