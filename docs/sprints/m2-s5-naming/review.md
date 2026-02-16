# Sprint M2-S5 Review: Conversation Naming

> **Reviewer:** Opus 4.6 (Independent)
> **Date:** 2026-02-16
> **Sprint plan:** [plan.md](plan.md)
> **Design spec:** `docs/design/conversation-system.md` (Section: Conversation Naming)

---

## Verdict: PASS

All five tasks implemented and verified. The naming system generates human-readable titles at turn 5, re-names on idle/switch cycles, protects manual renames, and displays titles in a resizable sidebar. TypeScript compiles clean, Prettier passes, CTO verified naming and rename flows manually.

---

## Review Summary

| Area                       | Status | Notes                                                   |
| -------------------------- | ------ | ------------------------------------------------------- |
| Task 1: NamingService      | PASS   | Descriptive titles (2-6 words), topic tags, retry logic |
| Task 2: Naming Trigger     | PASS   | Turn 5 trigger, fire-and-forget, closure captured       |
| Task 3: Frontend Title     | PASS   | Header edit + sidebar display + real-time WS updates    |
| Task 4: Integration        | PASS   | tsc clean, prettier clean, naming + rename verified     |
| Task 5: Periodic Re-naming | PASS   | Abbreviation piggyback, manuallyNamed flag, cooldown    |
| Draggable Sidebar          | PASS   | Drag handle, 180-500px range, mobile-safe               |
| TypeScript                 | PASS   | `npx tsc --noEmit` clean                                |
| Prettier                   | PASS   | `npx prettier --check src/` clean                       |
| Security                   | PASS   | Title truncated, `x-text` used, no XSS vectors          |

---

## Detailed Findings

### Task 1: NamingService (PASS)

**File:** `packages/dashboard/src/conversations/naming.ts`

- Correct Haiku model (`claude-haiku-4-5-20251001`)
- Retry logic (2 attempts) for invalid title format
- JSON parsing with markdown code block fallback
- Title validation: 2-6 words, max 80 chars, title case
- Topic normalization to kebab-case via regex
- Cost-efficient: `max_tokens: 200`, single prompt

### Task 2: Naming Trigger Integration (PASS)

**File:** `packages/dashboard/src/ws/chat-handler.ts`

Turn 5 fire-and-forget async IIFE. Lazily initializes NamingService. Captures `currentConversationId` by value to prevent race conditions. Skips if conversation already has a title. Broadcasts `conversation_renamed` to all clients.

### Task 3: Frontend Title Display + Manual Rename (PASS)

**Files:** `index.html`, `app.js`, `app.css`

- Header: click-to-edit with `x-show` toggle, Enter confirms, Escape/blur cancels
- Sidebar: `conversation_renamed` WS handler updates Alpine state reactively
- Computed `currentTitle` getter prevents stale state
- CSS: Tokyo Night themed title display/input styles

### Task 4: Integration + Verification (PASS)

- `npx tsc --noEmit` — clean
- `npx prettier --check src/` — clean
- CTO verified: naming at turn 5, manual rename, live sidebar updates

### Task 5: Periodic Re-naming on Idle (PASS)

**Files:** `types.ts`, `db.ts`, `manager.ts`, `abbreviation.ts`, `chat-handler.ts`

- `manuallyNamed` boolean added to Conversation type + DB schema + migration
- `setTitleManual()` sets both title and flag; auto-rename uses `setTitle()` only
- AbbreviationQueue re-names after abbreviation if `!manuallyNamed`
- `lastRenamedAt` Map with 10-turn minimum cooldown
- `undefined` (never renamed) always qualifies — no false negatives
- `onRenamed` callback decouples queue from WebSocket layer
- Abbreviation enqueued on conversation switch (not just idle timer)
- CTO verified: rename triggers on switch, respects manual names

### Draggable Sidebar (PASS)

**Files:** `index.html`, `app.js`, `app.css`

- Drag handle between sidebar and chat (4px, col-resize cursor)
- Min 180px, max 500px
- `body.sidebar-resizing` prevents text selection during drag
- Hidden on mobile (overlay mode)
- CTO verified: drag works, titles no longer truncated

---

## Bug Fixes Applied During Sprint

| #   | Bug                                   | Root Cause                                                      | Fix                                     |
| --- | ------------------------------------- | --------------------------------------------------------------- | --------------------------------------- |
| 1   | Auth: naming never triggered          | Only checked `ANTHROPIC_API_KEY`, not `CLAUDE_CODE_OAUTH_TOKEN` | Added fallback                          |
| 2   | Model ID: `claude-haiku-4` invalid    | Short alias not supported by SDK                                | Changed to `claude-haiku-4-5-20251001`  |
| 3   | Response parsing: empty text          | Parsed `stream_event` but SDK sends `assistant` messages        | Fixed message type handling             |
| 4   | Viewer count blocking enqueue         | Switch socket still counted as viewer                           | Removed viewer check on switch          |
| 5   | 10-turn minimum blocking first rename | `lastRenamedAt` defaulted to 0, not undefined                   | Check for `undefined` = always eligible |

---

## Security Assessment

| Check                      | Result                               |
| -------------------------- | ------------------------------------ |
| API key handling           | From env vars, not hardcoded         |
| XSS in title display       | `x-text` used (safe), not `x-html`   |
| Title input sanitization   | Truncated to 100 chars server-side   |
| Conversation ID validation | Regex `^conv-[A-Z0-9]{26}$` applied  |
| DOMPurify for markdown     | Used in all `renderMarkdown()` calls |
| No secrets in public files | Clean                                |

---

## Plan Adherence

| Plan Item                   | Implemented | Notes                                       |
| --------------------------- | ----------- | ------------------------------------------- |
| NamingService class         | Yes         | Stateless, uses `createBrainQuery`          |
| Haiku model call            | Yes         | `claude-haiku-4-5-20251001`                 |
| Title format                | Changed     | CTO directed: descriptive titles, not haiku |
| Topic tags (kebab-case)     | Yes         | Normalized by regex                         |
| Turn 5 trigger              | Yes         | Fire-and-forget async IIFE                  |
| Frontend title display      | Yes         | Header + sidebar, click-to-edit             |
| `conversation_renamed` WS   | Yes         | Broadcasts to all clients                   |
| Periodic re-naming (Task 5) | Yes         | CTO augmentation, abbreviation piggyback    |
| `manuallyNamed` flag        | Yes         | DB + types + manager                        |
| Draggable sidebar           | Yes         | CTO request, drag handle UI                 |

---

## Files Modified

| File                                 | Changes                                                |
| ------------------------------------ | ------------------------------------------------------ |
| `src/conversations/types.ts`         | Added `manuallyNamed: boolean`                         |
| `src/conversations/db.ts`            | Added `manually_named` column + migration              |
| `src/conversations/manager.ts`       | Added `setTitleManual()` method                        |
| `src/conversations/naming.ts`        | Descriptive title prompt + validation                  |
| `src/conversations/abbreviation.ts`  | NamingService integration, `onRenamed`, cooldown       |
| `src/ws/chat-handler.ts`             | `setTitleManual()`, switch enqueue, `onRenamed` wiring |
| `public/index.html`                  | Drag handle, dynamic sidebar width                     |
| `public/js/app.js`                   | Drag state/method, `sidebarWidth`                      |
| `public/css/app.css`                 | Drag handle styles, sidebar-resizing class             |
| `docs/design/conversation-system.md` | Updated naming spec, schema, data model                |
| `docs/ROADMAP.md`                    | Updated naming description, channel-specific future    |
| `docs/sprints/m2-s5-naming/plan.md`  | Added Task 5                                           |

---

_Review completed: 2026-02-16_
_Reviewer: Opus 4.6 (Independent)_
