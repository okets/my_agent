# Notebook System — Design Specification

> **Status:** Design Complete
> **Date:** 2026-02-18
> **Scope:** Agent-editable configuration files for conversational control
> **Milestone:** M4

---

## Table of Contents

1. [Context and Motivation](#context-and-motivation)
2. [Architecture: System vs Runtime](#architecture-system-vs-runtime)
3. [File Structure](#file-structure)
4. [Access Control](#access-control)
5. [Prompt Integration](#prompt-integration)
6. [File Schemas](#file-schemas)
7. [Editing Model](#editing-model)
8. [Future Extensibility](#future-extensibility)

---

## Context and Motivation

### The Problem

External communications require rules — who should Nina respond to, how, and under what circumstances. The naive approach is middleware pattern matching:

```typescript
// Brittle: every variation needs code
if (message.includes('block') && contactName) {
  rules.block(contactName)
}
```

This fails because natural language is infinite. "Block Sarah," "ignore Sarah," "I had a fight with Sarah," and "Sarah is being annoying, don't respond to her" all mean the same thing but require separate patterns.

### The Solution

Give Nina a **Notebook** — markdown files she can read always and edit when talking to her owner. Instead of parsing intent in middleware, Nina understands the request and updates her own rules:

```
User: "I had a fight with Sarah, ignore her messages for a week"
Nina: *updates external-communications.md*
      "Done. I'll ignore Sarah's messages until February 25th."
```

The Notebook is Nina's persistent memory for operational rules. It's not a database — it's a small set of markdown files designed for LLM reading and writing.

### Design Principles

- **Conversational over programmatic.** Nina interprets user intent, not regex patterns.
- **Readable by humans and agents.** Markdown with clear structure.
- **Bounded size.** Each file has a token limit to prevent prompt bloat.
- **Owner-gated writes.** Nina can only edit during owner conversations.
- **System teaches, runtime stores.** Instructions in CLAUDE.md, data in runtime files.

---

## Architecture: System vs Runtime

The Notebook uses a two-layer architecture:

| Layer | Purpose | Location | Nina Access |
|-------|---------|----------|-------------|
| **System** | HOW to use Notebook files | `.my_agent/brain/CLAUDE.md` | Read-only |
| **Runtime** | Actual rules and data | `.my_agent/runtime/` | Read always, Write with owner |

### Why Two Layers?

1. **System directives are stable.** They explain what files exist and their format. They don't change per-conversation.

2. **Runtime content evolves.** Rules are added, modified, removed through conversation.

3. **Separation prevents drift.** If Nina could edit her own instructions, she might accidentally corrupt them. The system layer is protected.

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        System Layer                              │
│  .my_agent/brain/CLAUDE.md                                       │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ ## Your Notebook                                            │ │
│  │ You have files at .my_agent/runtime/ you can read/edit...   │ │
│  │ [Explains format, access rules, when to edit]               │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Teaches Nina how to use
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Runtime Layer                              │
│  .my_agent/runtime/                                              │
│  ┌──────────────────────┐ ┌──────────────────┐ ┌──────────────┐ │
│  │ external-comms.md    │ │ reminders.md     │ │ standing-    │ │
│  │                      │ │                  │ │ orders.md    │ │
│  │ - Sarah: block       │ │ - [ ] Call mom   │ │ - Be concise │ │
│  │ - Boss: always reply │ │ - [ ] Buy milk   │ │ - Use Hebrew │ │
│  └──────────────────────┘ └──────────────────┘ └──────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Loaded into prompt
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Nina's Context                              │
│  [Brain CLAUDE.md] + [Runtime files] + [Conversation history]   │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
.my_agent/
├── brain/
│   ├── CLAUDE.md              # System directives (includes Notebook section)
│   ├── memory/
│   │   └── core/              # Identity, contacts, preferences
│   └── skills/                # Agent skills
│
└── runtime/                   # THE NOTEBOOK
    ├── external-communications.md
    ├── reminders.md
    └── standing-orders.md
```

### Why Not Under brain/?

The `brain/` directory contains Nina's identity and capabilities — things that define WHO she is. The `runtime/` directory contains operational data — things that change frequently based on owner instructions.

Keeping them separate:
- Makes backup/restore easier (runtime changes daily, brain rarely)
- Clarifies access semantics (brain = read-only, runtime = read-write)
- Prevents accidental identity corruption

---

## Access Control

### Read Access

Nina **always** sees Notebook files in her context. They're loaded into the system prompt alongside brain files.

| Context | Read Access |
|---------|-------------|
| Owner conversation | Yes |
| External message processing | Yes |
| Task execution | Yes |

### Write Access

Nina can **only edit** Notebook files during owner conversations.

| Context | Write Access | Reason |
|---------|--------------|--------|
| Owner conversation | **Yes** | Owner can approve/verify changes |
| External message processing | **No** | External parties shouldn't influence rules |
| Task execution | **No** | Tasks run autonomously, need explicit permissions |

### Enforcement

Write access is enforced by the `notebook_edit` tool (M4-S3), which checks the conversation context before allowing edits.

```typescript
// In notebook_edit tool
if (context.conversationType !== 'owner') {
  throw new Error('Notebook edits only allowed during owner conversations')
}
```

---

## Prompt Integration

### Loading Order

Notebook files are loaded **after** brain files, **before** skills:

```
1. brain/CLAUDE.md           # Core identity + system directives
2. brain/memory/core/*.md    # Identity, contacts, preferences
3. runtime/*.md              # NOTEBOOK FILES
4. skills/                   # Available commands
```

### Size Limits

Each Notebook file has a **2000 token limit** (~8000 characters). This prevents:
- Prompt bloat from accumulated rules
- Context window exhaustion
- Slow prompt assembly

If a file exceeds the limit, it's truncated with a warning:

```typescript
const MAX_NOTEBOOK_TOKENS = 2000
const charLimit = MAX_NOTEBOOK_TOKENS * 4  // ~4 chars per token

if (content.length > charLimit) {
  console.warn(`Notebook file ${file} exceeds limit, truncating`)
  content = content.substring(0, charLimit) + '\n\n[... truncated ...]'
}
```

### Truncation Strategy

When truncated, Nina sees the warning and can:
1. Inform the owner that the file is too large
2. Suggest archiving old entries
3. Prioritize recent/active rules (future enhancement)

### Section Headers

Each Notebook file is injected with a header for clarity:

| File | Header in Prompt |
|------|------------------|
| `external-communications.md` | `## External Communications Rules` |
| `reminders.md` | `## Reminders` |
| `standing-orders.md` | `## Standing Orders` |

---

## File Schemas

Each Notebook file has a defined schema documented in its header comments.

### external-communications.md

Rules for handling non-owner messages.

```markdown
# External Communications

<!--
Format: - **Name** (identity): action [optional: until DATE]
Actions: always respond [instruction], draft only, block/never respond
Identity: phone number, email, or channel-specific ID
-->

## Permanent Rules

- **Mom** (+15551234567): always respond warmly
- **Boss** (boss@company.com): always respond professionally

## Temporary Instructions

- **Sarah** (+15559876543) [until 2026-02-25]: ignore messages

## Channel-Specific

### ninas_whatsapp
- **Work Group** (group-123@g.us): observe only, never respond
```

### reminders.md

Tasks, deadlines, and recurring items.

```markdown
# Reminders

<!--
Format: - [ ] Task description [optional: due DATE]
Sections: Today, This Week, Recurring, Waiting For
-->

## Today

- [ ] Call dentist to reschedule

## This Week

- [ ] Review quarterly report [due: Friday]

## Recurring

- Every Monday: Send weekly status update
- 1st of month: Pay rent

## Waiting For

- W2 from employer [expected: Feb 28]
- Response from Sarah about dinner plans
```

### standing-orders.md

Persistent instructions that guide Nina's behavior.

```markdown
# Standing Orders

<!--
Persistent instructions from your owner.
These guide your behavior across all conversations.
-->

## Communication Style

- Be concise, no fluff
- Use Hebrew when I message in Hebrew
- Don't use emojis unless I do first

## Boundaries

- Never share my calendar with others
- Don't commit code without asking

## Preferences

- Prefer morning meeting times
- Default to dark mode recommendations
```

---

## Editing Model

### Tool-Based Editing (M4-S3)

Nina edits Notebook files using the `notebook_edit` tool:

```typescript
notebook_edit({
  file: 'external-communications.md',
  section: 'Temporary Instructions',
  action: 'add',
  content: '- **Sarah** (+15559876543) [until 2026-02-25]: ignore messages'
})
```

The tool:
1. Validates access (owner conversation only)
2. Parses the file structure
3. Applies the edit to the correct section
4. Writes the file
5. Returns confirmation

### Why Not Direct File Access?

Nina could theoretically use standard file tools (Read/Write). The dedicated tool provides:

1. **Access control** — enforces owner-only writes
2. **Structured edits** — section-based, not raw text replacement
3. **Validation** — ensures edits match the schema
4. **Audit trail** — logs all changes
5. **Dashboard sync** — notifies UI of changes (M4-S6)

### Confirmation Pattern

After editing, Nina confirms:

```
User: "Ignore Sarah's messages for a week"
Nina: "Done. I've added Sarah to my temporary ignore list until February 25th.
       I won't respond to her messages until then."
```

---

## Future Extensibility

### Additional Notebook Files

New files can be added by:
1. Creating the template in `.my_agent/runtime/`
2. Adding to the `NOTEBOOK_FILES` array in `prompt.ts`
3. Documenting the schema in the file header
4. Updating system directives in `brain/CLAUDE.md`

Potential future files:
- `shopping-list.md` — items to buy
- `projects.md` — active project summaries
- `calendar-preferences.md` — scheduling rules

### Selective Loading

Future enhancement: load only relevant Notebook files based on context.

```typescript
// During external message processing
const relevantFiles = ['external-communications.md']

// During owner conversation about reminders
const relevantFiles = ['reminders.md', 'standing-orders.md']
```

This reduces prompt size and focuses Nina's attention.

### Version History

Future enhancement: git-style versioning of Notebook files.

```
.my_agent/runtime/
├── external-communications.md
└── .history/
    └── external-communications/
        ├── 2026-02-18T10:30:00.md
        └── 2026-02-18T14:45:00.md
```

Enables "undo last change" and audit trails.

---

## Implementation Sprints

| Sprint | Deliverable |
|--------|-------------|
| M4-S1 | Infrastructure: directory, templates, prompt loading |
| M4-S2 | Dashboard evolution: workspace layout with Notebook awareness |
| M4-S3 | `notebook_edit` tool with access control |
| M4-S4 | Refactor external communications to use Notebook |
| M4-S5 | Reminders with time-based triggers |
| M4-S6 | Dashboard UI for viewing/editing Notebook files |

---

_Created: 2026-02-18_
