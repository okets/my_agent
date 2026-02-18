# M4-S3: Notebook Editing Tool

> **Status:** Planned
> **Date:** 2026-02-18
> **Depends on:** M4-S1 (Notebook Infrastructure), M4-S2 (Dashboard Evolution)

---

## Objectives

Give Nina the ability to edit Notebook files during owner conversations:

1. **notebook_edit tool** — Section-based file editing
2. **Access control** — Only available in owner conversations
3. **Dashboard refresh** — Broadcast file changes to open tabs
4. **Confirmation flow** — Nina confirms edits in conversation

---

## Tool Design

### Schema

```typescript
{
  name: "notebook_edit",
  description: "Edit a Notebook file. Only available in owner conversations.",
  input_schema: {
    type: "object",
    properties: {
      file: {
        type: "string",
        enum: ["external-communications", "reminders", "standing-orders"],
        description: "Which notebook file to edit"
      },
      action: {
        type: "string",
        enum: ["append_to_section", "replace_section", "remove_entry", "read"],
        description: "What operation to perform"
      },
      section: {
        type: "string",
        description: "Section name (e.g., 'Permanent Rules', 'Today', 'Recurring')"
      },
      content: {
        type: "string",
        description: "Content to add or replace with"
      },
      entry_match: {
        type: "string",
        description: "For remove_entry: text pattern to match the entry to remove"
      }
    },
    required: ["file", "action"]
  }
}
```

### Actions

| Action | Description | Required Fields |
|--------|-------------|-----------------|
| `read` | Return current file content | file |
| `append_to_section` | Add content to end of section | file, section, content |
| `replace_section` | Replace entire section content | file, section, content |
| `remove_entry` | Remove line matching pattern | file, section, entry_match |

### Example Tool Calls

**"Block Sarah":**
```json
{
  "file": "external-communications",
  "action": "append_to_section",
  "section": "Permanent Rules",
  "content": "- **Sarah** (+15551234567): never respond"
}
```

**"What rules do I have?":**
```json
{
  "file": "external-communications",
  "action": "read"
}
```

**"Remove the rule for Sarah":**
```json
{
  "file": "external-communications",
  "action": "remove_entry",
  "section": "Permanent Rules",
  "entry_match": "Sarah"
}
```

**"Remind me to call dentist tomorrow":**
```json
{
  "file": "reminders",
  "action": "append_to_section",
  "section": "Today",
  "content": "- [ ] Call dentist"
}
```

---

## Tasks

### T0a: Extend createBrainQuery to Accept Tools (PREREQUISITE)

**File:** `packages/core/src/brain.ts`

The current `createBrainQuery()` function doesn't accept custom tools. Extend it:

```typescript
interface BrainQueryOptions {
  model: string;
  systemPrompt: string;
  continue?: boolean;
  includePartialMessages?: boolean;
  reasoning?: boolean;
  tools?: ToolDefinition[];  // NEW
}

export function createBrainQuery(
  content: string,
  options: BrainQueryOptions
): AgentQuery {
  return {
    model: options.model,
    system: options.systemPrompt,
    messages: [{ role: 'user', content }],
    tools: options.tools,  // NEW: Pass to Agent SDK
    // ... rest of options
  };
}
```

### T0b: Add tool_use Event Handling to StreamProcessor

**File:** `packages/dashboard/src/agent/stream-processor.ts`

Currently only handles `text_delta`. Add handling for `tool_use` content blocks:

```typescript
// In processStream generator
for await (const event of stream) {
  if (event.type === 'content_block_start') {
    if (event.content_block.type === 'tool_use') {
      yield {
        type: 'tool_use_start',
        id: event.content_block.id,
        name: event.content_block.name
      };
    }
  }
  if (event.type === 'content_block_delta') {
    if (event.delta.type === 'input_json_delta') {
      yield {
        type: 'tool_use_delta',
        partial_json: event.delta.partial_json
      };
    }
  }
  if (event.type === 'content_block_stop') {
    // Tool use complete, parse accumulated JSON
  }
  // ... existing text_delta handling
}
```

### T0c: Implement Tool-Use Loop in SessionManager

**File:** `packages/dashboard/src/agent/session-manager.ts`

Add a tool-use loop that:
1. Detects `tool_use` blocks in the response
2. Executes the tool handler
3. Sends tool result back to the model
4. Continues streaming

```typescript
async *streamMessage(content: string, conversationId: string) {
  const tools = [this.notebookTool.getToolDefinition()];

  let continueLoop = true;
  while (continueLoop) {
    const q = createBrainQuery(content, { ...options, tools });

    let toolUse: ToolUseBlock | null = null;
    for await (const event of processStream(q)) {
      if (event.type === 'tool_use_complete') {
        toolUse = event;
      } else {
        yield event;  // Pass through text events
      }
    }

    if (toolUse) {
      // Execute tool
      const result = await this.handleToolUse(toolUse);
      // Send result back (continue conversation with tool_result)
      content = { type: 'tool_result', tool_use_id: toolUse.id, content: result };
    } else {
      continueLoop = false;  // No tool use, done
    }
  }
}
```

---

### T1: Notebook Tool Implementation

**File:** `packages/dashboard/src/agent/notebook-tool.ts` (NEW)

```typescript
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';

interface NotebookEditInput {
  file: 'external-communications' | 'reminders' | 'standing-orders';
  action: 'read' | 'append_to_section' | 'replace_section' | 'remove_entry';
  section?: string;
  content?: string;
  entry_match?: string;
}

interface NotebookEditResult {
  success: boolean;
  message: string;
  content?: string;  // For read action
}

export class NotebookTool {
  private runtimeDir: string;

  constructor(agentDir: string) {
    this.runtimeDir = path.join(agentDir, 'runtime');
  }

  getToolDefinition() {
    return {
      name: 'notebook_edit',
      description: 'Edit a Notebook file. Only available in owner conversations.',
      input_schema: {
        type: 'object',
        properties: {
          file: { type: 'string', enum: ['external-communications', 'reminders', 'standing-orders'] },
          action: { type: 'string', enum: ['read', 'append_to_section', 'replace_section', 'remove_entry'] },
          section: { type: 'string' },
          content: { type: 'string' },
          entry_match: { type: 'string' }
        },
        required: ['file', 'action']
      }
    };
  }

  async execute(input: NotebookEditInput): Promise<NotebookEditResult> {
    const filePath = path.join(this.runtimeDir, `${input.file}.md`);

    if (!existsSync(filePath)) {
      return { success: false, message: `File ${input.file}.md does not exist` };
    }

    switch (input.action) {
      case 'read':
        return this.read(filePath);
      case 'append_to_section':
        return this.appendToSection(filePath, input.section!, input.content!);
      case 'replace_section':
        return this.replaceSection(filePath, input.section!, input.content!);
      case 'remove_entry':
        return this.removeEntry(filePath, input.section!, input.entry_match!);
      default:
        return { success: false, message: `Unknown action: ${input.action}` };
    }
  }

  private read(filePath: string): NotebookEditResult {
    const content = readFileSync(filePath, 'utf-8');
    return { success: true, message: 'File read successfully', content };
  }

  private appendToSection(filePath: string, section: string, content: string): NotebookEditResult {
    let fileContent = readFileSync(filePath, 'utf-8');
    const sectionHeader = `## ${section}`;
    const sectionIndex = fileContent.indexOf(sectionHeader);

    if (sectionIndex === -1) {
      return { success: false, message: `Section "${section}" not found` };
    }

    // Find end of section (next ## or end of file)
    const afterSection = fileContent.substring(sectionIndex + sectionHeader.length);
    const nextSectionMatch = afterSection.match(/\n## /);
    const insertIndex = nextSectionMatch
      ? sectionIndex + sectionHeader.length + nextSectionMatch.index!
      : fileContent.length;

    // Insert content before next section (with newline)
    const before = fileContent.substring(0, insertIndex).trimEnd();
    const after = fileContent.substring(insertIndex);
    fileContent = `${before}\n${content}\n${after}`;

    writeFileSync(filePath, fileContent, 'utf-8');
    return { success: true, message: `Added to "${section}"` };
  }

  private replaceSection(filePath: string, section: string, content: string): NotebookEditResult {
    let fileContent = readFileSync(filePath, 'utf-8');
    const sectionHeader = `## ${section}`;
    const sectionIndex = fileContent.indexOf(sectionHeader);

    if (sectionIndex === -1) {
      return { success: false, message: `Section "${section}" not found` };
    }

    const afterSection = fileContent.substring(sectionIndex + sectionHeader.length);
    const nextSectionMatch = afterSection.match(/\n## /);
    const sectionEnd = nextSectionMatch
      ? sectionIndex + sectionHeader.length + nextSectionMatch.index!
      : fileContent.length;

    const before = fileContent.substring(0, sectionIndex + sectionHeader.length);
    const after = fileContent.substring(sectionEnd);
    fileContent = `${before}\n\n${content}\n${after}`;

    writeFileSync(filePath, fileContent, 'utf-8');
    return { success: true, message: `Replaced "${section}"` };
  }

  private removeEntry(filePath: string, section: string, entryMatch: string): NotebookEditResult {
    let fileContent = readFileSync(filePath, 'utf-8');
    const lines = fileContent.split('\n');
    const matchLower = entryMatch.toLowerCase();

    let inSection = false;
    let removed = false;
    const newLines = lines.filter(line => {
      if (line.startsWith('## ')) {
        inSection = line === `## ${section}`;
      }
      if (inSection && line.toLowerCase().includes(matchLower) && line.trim().startsWith('-')) {
        removed = true;
        return false;
      }
      return true;
    });

    if (!removed) {
      return { success: false, message: `No entry matching "${entryMatch}" found in "${section}"` };
    }

    writeFileSync(filePath, newLines.join('\n'), 'utf-8');
    return { success: true, message: `Removed entry matching "${entryMatch}"` };
  }
}
```

### T2: Tool Registration

**File:** `packages/dashboard/src/agent/session-manager.ts`

Register the tool with the Agent SDK session:

```typescript
import { NotebookTool } from './notebook-tool.js';

// In SessionManager constructor or init
this.notebookTool = new NotebookTool(agentDir);

// When creating brain query, include tool
const tools = [
  this.notebookTool.getToolDefinition()
];

// Handle tool calls in response processing
if (message.type === 'tool_use' && message.name === 'notebook_edit') {
  const result = await this.notebookTool.execute(message.input);
  // Return result to brain
  // Broadcast update to dashboard
}
```

### T3: Access Control

**File:** `packages/dashboard/src/agent/session-manager.ts`

Only allow tool use in owner conversations:

```typescript
// Check if current conversation is owner conversation
isOwnerConversation(conversationId: string): boolean {
  // Owner conversations don't have a channel source
  // OR check against owner_identities config
  const conversation = this.conversationManager.getConversation(conversationId);
  return !conversation?.channelId;  // No channel = direct owner conversation
}

// In tool handler
if (message.name === 'notebook_edit') {
  if (!this.isOwnerConversation(this.currentConversationId)) {
    return { success: false, message: 'Notebook editing only available in owner conversations' };
  }
  // ... proceed with edit
}
```

### T4: Dashboard Broadcast

**File:** `packages/dashboard/src/ws/protocol.ts`

Add new message type:

```typescript
export type ServerMessage =
  | // ... existing types
  | { type: 'notebook_updated'; file: string; content: string };
```

**File:** `packages/dashboard/src/agent/session-manager.ts`

Broadcast after successful edit:

```typescript
// After successful notebook edit
this.broadcast({
  type: 'notebook_updated',
  file: input.file,
  content: readFileSync(filePath, 'utf-8')
});
```

### T5: Dashboard Handler

**File:** `packages/dashboard/public/js/app.js`

Handle notebook update messages:

```typescript
// In WebSocket message handler
case 'notebook_updated':
  this.handleNotebookUpdate(data.file, data.content);
  break;

// Method
handleNotebookUpdate(file, content) {
  // Find any open tabs for this file
  const tab = this.openTabs.find(t => t.type === 'notebook' && t.data?.file === file);
  if (tab) {
    tab.data.content = content;
    tab.contentChanged = false;  // Reset dirty flag (server has latest)
  }
}
```

---

## Files to Create/Modify

| File | Changes |
|------|---------|
| `packages/core/src/brain.ts` | T0a: Accept tools parameter in createBrainQuery |
| `packages/dashboard/src/agent/stream-processor.ts` | T0b: Handle tool_use events |
| `packages/dashboard/src/agent/session-manager.ts` | T0c: Tool-use loop, T2: Register tool, T3: Access control, T4: Broadcast |
| `packages/dashboard/src/agent/notebook-tool.ts` | NEW: T1: Tool implementation |
| `packages/dashboard/src/ws/protocol.ts` | T4: Add `notebook_updated` message type |
| `packages/dashboard/public/js/app.js` | T5: Handle notebook update broadcasts |

---

## Verification

1. **Read works:** Ask Nina "What's in my external communications?" → returns file content
2. **Append works:** "Block telemarketers" → rule added to Permanent Rules section
3. **Remove works:** "Remove the rule for telemarketers" → entry removed
4. **Replace works:** "Replace my Today reminders with: Call mom" → section replaced
5. **Access control:** In external conversation, tool call returns error
6. **Dashboard refresh:** Edit via chat → open tab updates automatically
7. **Confirmation:** Nina confirms the edit in her response

---

## Dependencies

- **Upstream:** M4-S1 (files exist), M4-S2 (dashboard can display tabs)
- **Downstream:** M4-S4 (External Communications uses this tool)

---

## Not in Scope

- Complex markdown parsing (MVP: section-based, line-based for remove)
- Undo/redo (future enhancement)
- Conflict resolution (single user for now)
