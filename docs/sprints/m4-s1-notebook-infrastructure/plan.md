# M4-S1: Notebook Infrastructure

> **Status:** Planned
> **Date:** 2026-02-18
> **Depends on:** M3 complete (channels working)

---

## Objectives

Create the foundational Notebook system:

1. **Directory structure** — `.my_agent/runtime/` as Notebook location
2. **Prompt integration** — Nina sees Notebook files in her context
3. **System directives** — Instructions in CLAUDE.md explaining Notebook usage
4. **Template files** — Initial Notebook files with format documentation

---

## Architecture: System vs Runtime

| Layer | Purpose | Location | Nina Access |
|-------|---------|----------|-------------|
| **System** | HOW to use Notebook files | `brain/CLAUDE.md` | Read-only |
| **Runtime** | Actual rules/data | `.my_agent/runtime/` | Read always, Write with owner |

The system directives tell Nina the Notebook exists and how to interpret its files.
The runtime files contain the actual user-specific content Nina works with.

---

## Tasks

### T1: Design Documentation (FIRST)

**File:** `docs/design/notebook.md` (NEW)

Create design doc explaining:
- System vs Runtime directive model
- File locations and purposes
- Access control model (owner vs external)
- Prompt size limits and truncation strategy
- Future extensibility

This establishes the architecture before implementation.

### T2: Directory Structure

**Files:**
- `.my_agent/runtime/` (NEW directory)

Create the runtime directory if it doesn't exist. This is the Notebook location.

### T3: Template Files

**Files:**
- `.my_agent/runtime/external-communications.md` (NEW)
- `.my_agent/runtime/reminders.md` (NEW)
- `.my_agent/runtime/standing-orders.md` (NEW)

Create template files with:
- Header comment explaining format
- Section structure
- Example entries (commented out)

**external-communications.md template:**
```markdown
# External Communications

<!--
Format: - **Name** (identity): action [optional: until DATE]
Actions: always respond [instruction], draft only, block/never respond
Identity: phone number, email, or WhatsApp JID
-->

## Permanent Rules

<!-- Example: - **Sarah** (+15551234567): always respond warmly -->

## Temporary Instructions

<!-- Example: - **Sarah** [until 2026-02-25]: Ignore her messages -->

## Channel-Specific

<!-- Example:
### ninas_whatsapp
- **Work Group** (group-123): observe only, never respond
-->
```

**reminders.md template:**
```markdown
# Reminders

<!--
Format: - [ ] Task description [optional: due DATE]
Sections: Today, This Week, Recurring, Waiting For
-->

## Today

## This Week

## Recurring

<!-- Example: - Every Monday: Weekly status report -->

## Waiting For

<!-- Example: - W2 from employer [expected: Feb 28] -->
```

**standing-orders.md template:**
```markdown
# Standing Orders

<!--
Persistent instructions from your owner.
These guide your behavior across all conversations.
-->

## Communication Style

## Boundaries

## Preferences
```

### T4: System Directives

**File:** `.my_agent/brain/CLAUDE.md`

Append a new section explaining the Notebook:

```markdown
## Your Notebook

You have a Notebook at `.my_agent/runtime/` with files you can read and edit.

**Files:**
- `external-communications.md` — Rules for handling non-owner messages
- `reminders.md` — Tasks, deadlines, recurring items
- `standing-orders.md` — Persistent instructions from your owner

**Access:**
- Always visible in your context (injected into your system prompt)
- Editable ONLY during owner conversations (using notebook_edit tool)
- Read-only when processing external messages

**Format:** Each file has its own schema documented in its header comments.

**Reading:** You always see the current content. Reference it naturally in conversation.

**Writing:** When your owner asks to add, change, or remove something, use the notebook_edit tool.
Do NOT edit during external message processing — only when talking directly to your owner.
```

### T5: Prompt Assembly with Size Limit

**File:** `packages/core/src/prompt.ts`

Modify `assembleSystemPrompt()` to load Notebook files after the existing BRAIN_FILES.

**IMPORTANT:** Include size limit to prevent prompt bloat.

```typescript
// After loading BRAIN_FILES...

const MAX_NOTEBOOK_TOKENS = 2000;  // Per file limit

// Load Notebook files from runtime directory
const NOTEBOOK_FILES = [
  { rel: '../runtime/external-communications.md', header: '## External Communications Rules' },
  { rel: '../runtime/reminders.md', header: '## Reminders' },
  { rel: '../runtime/standing-orders.md', header: '## Standing Orders' },
];

for (const { rel, header } of NOTEBOOK_FILES) {
  let content = await readOptionalFile(path.join(brainDir, rel));
  if (content) {
    // Truncate if too large (rough token estimate: 4 chars per token)
    const charLimit = MAX_NOTEBOOK_TOKENS * 4;
    if (content.length > charLimit) {
      console.warn(`[Prompt] Notebook file ${rel} exceeds ${MAX_NOTEBOOK_TOKENS} tokens, truncating`);
      content = content.substring(0, charLimit) + '\n\n[... truncated ...]';
    }
    sections.push(`${header}\n\n${content.trim()}`);
  }
}
```

Note: Path is `../runtime/` because `brainDir` points to `.my_agent/brain/`.

---

## Files to Modify

| File | Changes |
|------|---------|
| `docs/design/notebook.md` | NEW: T1 Design documentation (FIRST) |
| `packages/core/src/prompt.ts` | T5: Add Notebook file loading with size limit |
| `.my_agent/brain/CLAUDE.md` | T4: Add system directives section |
| `.my_agent/runtime/external-communications.md` | NEW: T3 Template |
| `.my_agent/runtime/reminders.md` | NEW: T3 Template |
| `.my_agent/runtime/standing-orders.md` | NEW: T3 Template |

---

## Verification

1. **Directory exists:** `ls -la .my_agent/runtime/` shows 3 template files
2. **Prompt includes Notebook:** Start dashboard, send message, check Nina's response references Notebook
3. **Nina describes Notebook:** Ask "What's in your notebook?" → Nina lists files and their purposes
4. **Templates are readable:** Each file has clear format documentation in header

---

## Dependencies

- **Upstream:** M3 channels must be working (so we have context for external-communications.md)
- **Downstream:** M4-S2 (Dashboard Evolution) and M4-S3 (Editing Tool) depend on this

---

## Not in Scope

- Notebook editing (M4-S3)
- Dashboard UI for Notebook (M4-S6)
- Time-based triggers for reminders (M5)
