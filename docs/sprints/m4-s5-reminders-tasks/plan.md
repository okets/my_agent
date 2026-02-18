# M4-S5: Reminders & Tasks (Notebook)

> **Status:** Planned
> **Date:** 2026-02-18
> **Depends on:** M4-S3 (Notebook Editing Tool)

---

## Objectives

Prove the Notebook pattern with `reminders.md`:

1. **Conversational task management** — Add, query, complete reminders via chat
2. **Checkbox format** — `- [ ]` and `- [x]` for task state
3. **Section organization** — Today, This Week, Recurring, Waiting For
4. **Template refinement** — Improve reminders.md based on real usage

---

## Conversation Examples

**Add reminder:**
```
User: "Remind me to call the dentist tomorrow"
Nina: *calls notebook_edit({ file: "reminders", action: "append_to_section", section: "Today", content: "- [ ] Call the dentist" })*
Nina: "Added to your Today list: Call the dentist"
```

**Query reminders:**
```
User: "What's on my list?"
Nina: *reads from context (reminders.md in system prompt)*
Nina: "For today you have:
- Call the dentist
- Send invoice to client

This week:
- Review Q1 budget"
```

**Complete task:**
```
User: "I called the dentist"
Nina: *finds "dentist" in Today, toggles checkbox*
Nina: *calls notebook_edit({ action: "replace_section", section: "Today", content: "- [x] Call the dentist\n- [ ] Send invoice to client" })*
Nina: "Nice! Marked 'Call the dentist' as done."
```

**Add recurring:**
```
User: "Remind me to send status reports every Monday"
Nina: *calls notebook_edit({ section: "Recurring", content: "- Every Monday: Send status report" })*
Nina: "Added recurring reminder: Send status report every Monday"
```

**Add waiting-for:**
```
User: "I'm waiting for the W2 from my employer"
Nina: *calls notebook_edit({ section: "Waiting For", content: "- W2 from employer" })*
Nina: "Added to Waiting For. I'll remind you if you ask about pending items."
```

---

## Tasks

### T1: Enhance reminders.md Template

**File:** `.my_agent/runtime/reminders.md`

Update template with clearer structure:

```markdown
# Reminders

<!--
Task format: - [ ] Task description [optional: due DATE]
Completed: - [x] Task description
Sections: Today, This Week, Later, Recurring, Waiting For
-->

## Today

<!-- Tasks for today. Move to completed or remove when done. -->

## This Week

<!-- Tasks for this week. -->

## Later

<!-- Future tasks without specific dates. -->

## Recurring

<!--
Format: - Every [frequency]: Task
Examples:
- Every Monday: Weekly status report
- Every 1st: Pay rent
- Every day: Take vitamins
-->

## Waiting For

<!--
Items you're waiting on from others.
Format: - Item [expected: DATE]
-->

## Completed

<!-- Recently completed tasks (auto-cleared weekly) -->
```

### T2: Checkbox Toggle Support

**File:** `packages/dashboard/src/agent/notebook-tool.ts`

Add a specialized action for checkbox toggle:

```typescript
// Add to action enum
action: 'toggle_checkbox' | ... existing actions

// Implementation
private toggleCheckbox(filePath: string, section: string, taskMatch: string): NotebookEditResult {
  let fileContent = readFileSync(filePath, 'utf-8');
  const lines = fileContent.split('\n');
  const matchLower = taskMatch.toLowerCase();

  let inSection = false;
  let toggled = false;

  const newLines = lines.map(line => {
    if (line.startsWith('## ')) {
      inSection = line === `## ${section}`;
    }
    if (inSection && line.toLowerCase().includes(matchLower)) {
      if (line.includes('- [ ]')) {
        toggled = true;
        return line.replace('- [ ]', '- [x]');
      } else if (line.includes('- [x]')) {
        toggled = true;
        return line.replace('- [x]', '- [ ]');
      }
    }
    return line;
  });

  if (!toggled) {
    return { success: false, message: `No task matching "${taskMatch}" found in "${section}"` };
  }

  writeFileSync(filePath, newLines.join('\n'), 'utf-8');
  return { success: true, message: `Toggled "${taskMatch}"` };
}
```

### T3: System Directive Enhancement

**File:** `.my_agent/brain/CLAUDE.md`

Add guidance for reminders in the Notebook section:

```markdown
### Reminders (reminders.md)

When your owner mentions tasks, reminders, or to-dos:
- Add to appropriate section: Today (urgent), This Week, Later (no date)
- Use checkbox format: `- [ ] Task description`
- For completion: toggle checkbox using `toggle_checkbox` action
- Recurring tasks go in Recurring section with frequency
- Items waiting on others go in Waiting For

Always confirm what you added and to which section.
```

### T4: Test Scenarios

Create test scenarios to verify:

| Scenario | User Says | Nina Does |
|----------|-----------|-----------|
| Add today task | "Remind me to call mom" | Appends to Today |
| Add dated task | "Remind me to file taxes by April 15" | Appends to This Week or Later based on date |
| Add recurring | "Every Friday, review inbox" | Appends to Recurring |
| Add waiting | "Waiting for quote from contractor" | Appends to Waiting For |
| Complete task | "Done with calling mom" | Toggles checkbox |
| Query tasks | "What's on my plate?" | Reads and summarizes |
| Remove task | "Remove the dentist reminder" | Removes entry |

### T5: Date Awareness (Optional)

If Nina should understand dates:
- "tomorrow" → adds to Today
- "next week" → adds to This Week
- "by March 15" → adds with date suffix `[due: 2026-03-15]`

This requires Nina to know current date (already in system prompt via environment).

---

## Files to Modify

| File | Changes |
|------|---------|
| `.my_agent/runtime/reminders.md` | Enhanced template |
| `.my_agent/brain/CLAUDE.md` | Reminders guidance in Notebook section |
| `packages/dashboard/src/agent/notebook-tool.ts` | Add `toggle_checkbox` action |

---

## Verification

1. **Add task:** "Remind me to buy groceries" → appears in Today section
2. **Query tasks:** "What do I need to do?" → Nina lists tasks by section
3. **Complete task:** "I bought groceries" → checkbox toggled to [x]
4. **Recurring:** "Every Monday, review email" → appears in Recurring
5. **Waiting for:** "Waiting for Bob's response" → appears in Waiting For
6. **Remove:** "Never mind the groceries" → entry removed
7. **Multiple sections:** Tasks correctly sorted by urgency/date

---

## Dependencies

- **Upstream:** M4-S3 (notebook_edit tool)
- **Downstream:** M5 (time-based triggers for due dates)

---

## Deferred to M5

- **Time-based triggers:** Notify when task is due
- **Auto-promotion:** Move "This Week" tasks to "Today" on day
- **Completed cleanup:** Auto-archive completed tasks weekly
- **Calendar integration:** Sync with external calendars
