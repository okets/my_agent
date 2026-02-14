# Memory System — Design Specification

> **Status:** Design Complete
> **Date:** 2026-02-14
> **Scope:** Notebook memory with flexible lists, explicit storage, agent tools, daily summaries
> **Milestone:** M4b
> **Dependencies:** M2 (Conversation System)

---

## Table of Contents

1. [Context and Motivation](#context-and-motivation)
2. [Core Concepts](#core-concepts)
3. [Notebook Categories](#notebook-categories)
4. [Agent Memory Tools](#agent-memory-tools)
5. [Prompted Additions](#prompted-additions)
6. [Recall Priority](#recall-priority)
7. [Daily Summaries](#daily-summaries)
8. [Storage Format](#storage-format)
9. [Dashboard Viewer](#dashboard-viewer)
10. [Configuration](#configuration)
11. [Implementation Notes](#implementation-notes)

---

## Context and Motivation

### The Problem

An assistant needs persistent memory across conversations. The user mentions important information — contacts, preferences, lists, facts — that should be remembered and recalled later.

### Design Principles

- **Explicit over automatic.** The user controls what gets remembered. No background extraction.
- **Simple structure.** Categories like contacts, lists, and facts — not complex graphs.
- **User owns the data.** Memory lives in `.my_agent/` and is human-readable.
- **Agent assists.** The agent stores, retrieves, and occasionally suggests additions.

### What This Is Not

This is **not** an automatic knowledge extraction system. The agent does not:

- Parse conversations to extract entities automatically
- Build relationship graphs between concepts
- Score confidence on facts
- Enrich incoming messages with memory context

Instead, the user explicitly says "remember X" and the agent stores X.

---

## Core Concepts

### The Notebook Metaphor

Memory is a **notebook** with **user-defined lists**. No rigid categories — users create lists for whatever they need, and the agent learns what each list is for.

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  NOTEBOOK (flexible lists)                          │
│                                                     │
│  User-created lists, each with a description:       │
│  ├── "contacts" — People and their details          │
│  ├── "shopping" — Things I need to buy              │
│  ├── "restaurants" — Places to try                  │
│  ├── "project ideas" — Things I might build         │
│  └── ... (user creates as needed)                   │
│                                                     │
│  HOW IT WORKS                                       │
│  ├── User: "Remember Sarah's number is 555-1234"    │
│  ├── Agent: Adds to "contacts" list                 │
│  ├── User: "What's Sarah's number?"                 │
│  └── Agent: Searches "contacts", finds it           │
│                                                     │
│  AGENT CONTEXT                                      │
│  At session start, agent sees:                      │
│  "You have these lists: contacts (12 entries),      │
│   shopping (4 items), restaurants (8 places)..."    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Memory Lifecycle

```
User says "remember X"
    → Agent calls notebook_add
    → Stored in appropriate category
    → Agent confirms: "Got it."

User asks about X
    → Agent calls notebook_search or notebook_get
    → Returns stored information
    → Agent responds naturally

Agent notices important info
    → Agent asks: "Should I remember this?"
    → User confirms → Agent stores
    → User declines → Nothing stored
```

---

## Lists Architecture

### Flexible, User-Created Lists

Instead of fixed categories, users create lists as needed. Each list has:

- **Name** — identifier ("contacts", "shopping", "project-ideas")
- **Description** — what the list is for (agent uses this to decide where to store things)
- **Entries** — flexible key-value items

```typescript
interface NotebookList {
  id: string;
  name: string;              // "contacts", "shopping", "restaurants"
  description: string;       // "People I know and their contact info"
  entryCount: number;        // For context priming
  created: string;
  updated?: string;
}

interface ListEntry {
  id: string;
  listId: string;
  data: Record<string, string>;  // Flexible fields: { name: "Sarah", phone: "555-1234" }
  created: string;
  updated?: string;
}
```

### Example Lists

**contacts** — "People I know and their contact info"
```json
{ "name": "Sarah Chen", "phone": "555-1234", "email": "sarah@example.com", "notes": "Works at Acme" }
{ "name": "Bob Smith", "phone": "555-9876" }
```

**shopping** — "Things I need to buy"
```json
{ "item": "milk" }
{ "item": "eggs", "quantity": "12" }
```

**restaurants** — "Places to try"
```json
{ "name": "Sushi Place", "location": "Downtown", "notes": "Bob recommended" }
```

**preferences** — "My preferences and settings"
```json
{ "preference": "I prefer morning meetings" }
{ "preference": "My anniversary is March 15" }
```

### Why Flexible Lists?

| Rigid Categories | Flexible Lists |
|------------------|----------------|
| User must fit data into predefined boxes | User creates lists that match their mental model |
| "Is this a Fact or a Note?" | "Add to my 'gift ideas' list" |
| Agent guesses category | Agent asks "Which list?" or creates new one |
| Limited to 4 types | Unlimited, user-defined organization |

### Agent Context Priming

At session start, the agent's context includes:

```
You have access to these notebook lists:
- contacts (12 entries): People I know and their contact info
- shopping (4 entries): Things I need to buy
- restaurants (8 entries): Places to try
- preferences (6 entries): My preferences and settings

Use notebook_search to find information. Use notebook_add to store new entries.
When unsure which list to use, ask the user or suggest creating a new list.
```

This gives the agent awareness of what's stored without loading all entries.

---

## Agent Memory Tools

MCP tools for notebook operations.

### list_create

Create a new list.

```typescript
interface ListCreateInput {
  name: string;              // "contacts", "shopping", "project-ideas"
  description: string;       // "People I know and their contact info"
}

interface ListCreateOutput {
  success: boolean;
  listId: string;
  message: string;
}
```

### list_all

Get all lists (for context priming).

```typescript
interface ListAllOutput {
  lists: Array<{
    id: string;
    name: string;
    description: string;
    entryCount: number;
  }>;
}
```

### entry_add

Add an entry to a list.

```typescript
interface EntryAddInput {
  list: string;              // List name
  data: Record<string, string>;  // Flexible fields: { name: "Sarah", phone: "555-1234" }
}

interface EntryAddOutput {
  success: boolean;
  entryId: string;
  message: string;
}
```

**Examples:**
```typescript
// "Remember Sarah's phone is 555-1234"
entry_add({ list: "contacts", data: { name: "Sarah", phone: "555-1234" } })

// "Add milk to my shopping list"
entry_add({ list: "shopping", data: { item: "milk" } })

// "Remember I prefer morning meetings"
entry_add({ list: "preferences", data: { preference: "I prefer morning meetings" } })
```

### entry_search

Search across all lists or specific lists.

```typescript
interface EntrySearchInput {
  query: string;             // Search term
  lists?: string[];          // Filter by list names (default: all)
  limit?: number;            // Default: 10
}

interface EntrySearchOutput {
  results: Array<{
    list: string;            // Which list it's in
    entry: ListEntry;
    matchedField: string;    // Which field matched
  }>;
}
```

### entry_list

Get entries from a specific list.

```typescript
interface EntryListInput {
  list: string;              // List name
  limit?: number;            // Default: 20
  offset?: number;           // For pagination
}

interface EntryListOutput {
  entries: ListEntry[];
  total: number;
}
```

### entry_update

Update an existing entry.

```typescript
interface EntryUpdateInput {
  entryId: string;
  data: Record<string, string>;  // New/updated fields (merged with existing)
}
```

### entry_delete

Remove an entry.

```typescript
interface EntryDeleteInput {
  entryId: string;
}
```

### list_delete

Remove an entire list and all its entries.

```typescript
interface ListDeleteInput {
  list: string;              // List name
  confirm: boolean;          // Must be true to delete
}
```

---

## Prompted Additions

The agent occasionally suggests storing information.

### When to Prompt

The agent may ask "Should I remember this?" when:

1. **User shares contact info** — "Sarah's number is 555-1234"
2. **User states a preference** — "I prefer morning meetings"
3. **User mentions dates** — "My anniversary is March 15"
4. **User shares credentials** — "The wifi password is XYZ"
5. **User gives instructions** — "Always remind me about X before Y"

### When NOT to Prompt

The agent does **not** prompt for:

- Information already being stored (user said "remember")
- Trivial or temporary information
- Information discussed in passing
- Anything the agent isn't confident about

### Prompt Format

```
Agent: "Would you like me to remember Sarah's phone number (555-1234)?"
User: "Yes" → Agent stores and confirms
User: "No"  → Agent acknowledges and doesn't store
```

### Configuration

```yaml
memory:
  promptedAdditions:
    enabled: true
    categories:
      - contact_info
      - preferences
      - dates
      - credentials
```

---

## Recall Priority

When the user asks a question, the agent retrieves information in this order:

### Priority Order

```
1. NOTEBOOK (explicit memory)
   └── Check notebook_search for relevant entries

2. CONVERSATION SEARCH (recent context)
   └── Search past conversations for relevant discussion

3. ASK USER (last resort)
   └── "I don't have that information. Could you tell me?"
```

### Example Flow

```
User: "What's Sarah's phone number?"

Agent:
  1. notebook_search({ query: "Sarah phone" })
     → Found: Contact with phone = "555-1234"
     → Response: "Sarah's number is 555-1234"

  OR if not found:

  2. search_conversations({ query: "Sarah phone number" })
     → Found: Discussion mentioning number
     → Response: "I found a conversation where you mentioned it was X. Should I save this?"

  OR if not found:

  3. Response: "I don't have Sarah's phone number saved. What is it?"
```

---

## Daily Summaries

Optional feature to summarize daily activity.

### Purpose

- Track what was accomplished
- Identify patterns over time
- Provide audit trail for memory changes

### Generation

```
Daily at configured time (default: 23:59)
    │
    ├── Gather today's data:
    │   - Conversations (count, topics)
    │   - Memory additions
    │   - Memory updates
    │   - Lists modified
    │
    ├── Generate summary via Haiku:
    │   - Brief activity overview
    │   - Notable memory changes
    │
    └── Store in daily summary file
        .my_agent/brain/daily/2026-02-14.md
```

### Summary Format

```markdown
# Daily Summary — 2026-02-14

## Activity
- 3 conversations
- 5 tasks discussed

## Memory Changes
- Added contact: Bob (555-9876)
- Updated: Sarah's email
- Added to shopping list: milk, eggs

## Lists
- Shopping: 3 items added
- Todo: 2 items completed

---
_Generated: 2026-02-14T23:59:00Z_
```

### Storage

```
.my_agent/
├── brain/
│   ├── daily/
│   │   ├── 2026-02-14.md
│   │   ├── 2026-02-13.md
│   │   └── ...
│   └── CLAUDE.md
```

---

## Storage Format

### Backend

Memory is stored in **SQLite** with JSON columns for flexible entry data.

```sql
-- Lists table (user-defined)
CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,    -- "contacts", "shopping", "restaurants"
  description TEXT NOT NULL,     -- "People I know and their contact info"
  created TEXT,
  updated TEXT
);

-- Entries table (flexible key-value data)
CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  list_id TEXT REFERENCES lists(id) ON DELETE CASCADE,
  data JSON NOT NULL,            -- { "name": "Sarah", "phone": "555-1234" }
  created TEXT,
  updated TEXT
);

-- Full-text search index
CREATE VIRTUAL TABLE entries_fts USING fts5(
  data,
  content='entries',
  content_rowid='rowid'
);
```

### File Location

```
.my_agent/brain/memory.db
```

### Why SQLite?

- Zero external dependencies
- Human-inspectable (sqlite3 CLI)
- Full-text search support
- Simple backup (copy file)
- Sufficient for personal assistant scale

---

## Dashboard Viewer

Memory viewer in the operations dashboard (M5).

### Features

```
┌─────────────────────────────────────────────────────┐
│  NOTEBOOK                                           │
│                                                     │
│  LISTS                          [+ New List]        │
│  ┌───────────────────────────────────────────────┐  │
│  │ contacts (12)    People I know...      [▼]    │  │
│  │ shopping (4)     Things to buy...      [▼]    │  │
│  │ restaurants (8)  Places to try...      [▼]    │  │
│  │ preferences (6)  My preferences...     [▼]    │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  [🔍 Search all lists...]                           │
│                                                     │
│  CONTACTS (12 entries)              [+ Add Entry]   │
│  ┌───────────────────────────────────────────────┐  │
│  │ Sarah Chen    555-1234    sarah@...  [Ed][Del]│  │
│  │ Bob Smith     555-9876              [Ed][Del] │  │
│  │ ...                                           │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Operations

| Action | Description |
|--------|-------------|
| View Lists | See all user-created lists with entry counts |
| Browse | Expand a list to see its entries |
| Search | Full-text search across all lists |
| Edit | Modify any entry's fields |
| Delete | Remove entries or entire lists |
| Add | Create new lists or entries |
| Export | Download as JSON |

---

## Configuration

```yaml
# .my_agent/config.yaml

memory:
  # Storage
  database: brain/memory.db

  # Prompted additions
  promptedAdditions:
    enabled: true
    categories:
      - contact_info
      - preferences
      - dates
      - credentials

  # Daily summaries
  dailySummary:
    enabled: true
    time: "23:59"
    timezone: "local"

  # Search
  search:
    maxResults: 20
    fuzzyMatch: true
```

---

## Implementation Notes

### M4b Scope

| Feature | Included |
|---------|----------|
| Notebook storage (SQLite) | Yes |
| Agent tools (add, get, list, search, update, delete) | Yes |
| Prompted additions | Yes |
| Recall priority (notebook → conversations → ask) | Yes |
| Daily summaries | Yes |
| Dashboard viewer | M5 |

### Out of Scope

| Feature | Notes |
|---------|-------|
| Automatic extraction | Explicitly not included |
| Memory visualization | M5 (Dashboard) |
| Memory export/import | Post-M5 |
| Sync across devices | Not planned |

### Dependencies

| Dependency | Purpose |
|------------|---------|
| M2 (Conversation System) | Conversation search as fallback |
| SQLite | Memory storage |
| Haiku | Daily summary generation |

### After M4b

The agent has simple, explicit memory:

- **Notebook** — what the user asked to remember
- **Conversations** — what was said (M2)
- **Tasks** — what was done (M4a)

This enables the agent to recall information the user explicitly chose to save.

---

_Design specification created: 2026-02-14_
_Rewritten from graph-based to notebook-based architecture_
