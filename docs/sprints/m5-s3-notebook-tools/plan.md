# M5-S3: Notebook Tools

> **Milestone:** M5 — Task System
> **Sprint:** S3 of 4
> **Status:** Planned
> **Goal:** notebook_edit tool for Nina to manage standing orders

---

## Overview

Give Nina the ability to edit her own configuration files, particularly standing orders and preferences. This enables the "learnable" philosophy — user feedback creates standing orders that Nina writes and respects.

## Deliverables

1. **notebook_edit tool** (`packages/core/src/tools/notebook-edit.ts`)
   - Section-based file editing (not line-based)
   - Operations: read_section, write_section, append_to_section, delete_section
   - Markdown-aware: respects heading hierarchy
   - Safe: validates paths, prevents breaking syntax

2. **Standing orders file** (`.my_agent/brain/standing-orders.md`)
   - Template with common sections
   - Nina reads on startup
   - Nina writes when user gives feedback

3. **Tool integration**
   - Register notebook_edit in brain's tool list
   - Include standing orders in system prompt
   - Prompt Nina to use tool when user gives feedback

4. **Guardrails**
   - Only edit files in `.my_agent/brain/` by default
   - Configurable allowed paths
   - No editing outside agent directory

## Technical Approach

### notebook_edit Interface

```typescript
interface NotebookEditParams {
  path: string;           // File path (must be in allowed dirs)
  operation: 'read' | 'write' | 'append' | 'delete';
  section: string;        // Heading text (e.g., "## Notification Preferences")
  content?: string;       // For write/append operations
}

// Example: Nina stops notifying about routine completions
notebook_edit({
  path: '.my_agent/brain/standing-orders.md',
  operation: 'append',
  section: '## Notification Preferences',
  content: '- Do not notify for routine email processing completions'
});
```

### Standing Orders Template

```markdown
# Standing Orders

Instructions Nina has learned from user feedback.

## Notification Preferences

(Nina appends learned preferences here)

## Communication Style

(Tone, formality preferences)

## Task Handling

(When to proceed vs ask)

## Off-Limits

(Things Nina should never do automatically)
```

### Prompt Integration

System prompt includes:
```
You have standing orders that modify your default behavior.
Read them at startup. When the user gives feedback like
"stop notifying about X" or "always do Y", use notebook_edit
to add this as a standing order.
```

## Team

| Role | Model | Responsibility |
|------|-------|----------------|
| Backend Dev | Sonnet | notebook_edit tool implementation |
| Reviewer | Opus | Security review, edge cases |

## Success Criteria

- [ ] notebook_edit reads/writes sections correctly
- [ ] Standing orders file created with template
- [ ] Nina includes standing orders in behavior
- [ ] User feedback triggers standing order creation
- [ ] Path guardrails prevent unsafe edits

## Risks

| Risk | Mitigation |
|------|------------|
| Nina edits wrong section | Section matching uses exact heading text |
| Malformed markdown breaks file | Validate syntax before write |
| User feedback misinterpreted | Nina confirms interpretation before writing |

## Dependencies

- S1: Task foundation (for testing in task context)
- Brain system prompt assembly

---

*Created: 2026-02-20*
