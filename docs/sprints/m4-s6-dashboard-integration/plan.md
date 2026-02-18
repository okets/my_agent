# M4-S6: Notebook REST API + Dashboard Integration

> **Status:** Planned
> **Date:** 2026-02-18
> **Depends on:** M4-S2 (Dashboard Evolution), M4-S3 (Notebook Editing Tool)

---

## Objectives

Complete the Notebook experience in the dashboard:

1. **REST API** — CRUD operations for Notebook files
2. **File tabs** — Open Notebook files as editable tabs
3. **Markdown rendering** — View mode with formatted markdown
4. **Change tracking** — Dirty flag, save button, unsaved warning
5. **Auto-refresh** — When Nina edits, tab updates automatically

---

## Tasks

### T1: Notebook REST API

**File:** `packages/dashboard/src/routes/notebook.ts` (NEW)

```typescript
import type { FastifyInstance } from 'fastify';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import * as path from 'node:path';

export async function registerNotebookRoutes(fastify: FastifyInstance) {
  const runtimeDir = path.join(fastify.agentDir, 'runtime');

  // List all notebook files
  fastify.get('/api/notebook', async (req, reply) => {
    if (!existsSync(runtimeDir)) {
      return { files: [] };
    }

    const files = readdirSync(runtimeDir)
      .filter(f => f.endsWith('.md'))
      .map(f => ({
        name: f.replace('.md', ''),
        path: f,
        modified: getModifiedTime(path.join(runtimeDir, f))
      }));

    return { files };
  });

  // Get single file content
  fastify.get('/api/notebook/:file', async (req, reply) => {
    const { file } = req.params as { file: string };
    const filePath = path.join(runtimeDir, `${file}.md`);

    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: 'File not found' });
    }

    const content = readFileSync(filePath, 'utf-8');
    const modified = getModifiedTime(filePath);

    return { file, content, modified };
  });

  // Save file content
  fastify.put('/api/notebook/:file', async (req, reply) => {
    const { file } = req.params as { file: string };
    const { content } = req.body as { content: string };
    const filePath = path.join(runtimeDir, `${file}.md`);

    // Only allow editing existing files (no arbitrary file creation)
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: 'File not found' });
    }

    writeFileSync(filePath, content, 'utf-8');

    // Broadcast update to other tabs/clients
    fastify.websocketServer?.clients.forEach(client => {
      client.send(JSON.stringify({
        type: 'notebook_updated',
        file,
        content
      }));
    });

    return { success: true, modified: new Date().toISOString() };
  });
}

function getModifiedTime(filePath: string): string {
  const stats = statSync(filePath);
  return stats.mtime.toISOString();
}
```

### T2: Register Routes

**File:** `packages/dashboard/src/server.ts`

```typescript
import { registerNotebookRoutes } from './routes/notebook.js';

// In server setup
await registerNotebookRoutes(fastify);
```

### T3: Notebook Tab Content

**File:** `packages/dashboard/public/index.html`

Add template for notebook tab content:

```html
<!-- Notebook file tab content -->
<template x-if="getActiveTab()?.type === 'notebook'">
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="flex items-center justify-between p-4 border-b">
      <h2 class="text-lg font-semibold" x-text="getActiveTab().title"></h2>
      <div class="flex items-center gap-2">
        <span x-show="getActiveTab().contentChanged"
              class="text-sm text-orange-600">Unsaved changes</span>
        <button x-show="getActiveTab().contentChanged"
                @click="saveNotebookFile()"
                class="px-3 py-1 bg-blue-600 text-white rounded text-sm">
          Save
        </button>
        <button @click="toggleNotebookView()"
                class="px-3 py-1 border rounded text-sm">
          <span x-text="notebookViewMode === 'edit' ? 'Preview' : 'Edit'"></span>
        </button>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-auto p-4">
      <!-- Edit mode -->
      <textarea x-show="notebookViewMode === 'edit'"
                x-model="getActiveTab().data.content"
                @input="markTabDirty()"
                class="w-full h-full font-mono text-sm border rounded p-3 resize-none">
      </textarea>

      <!-- Preview mode -->
      <div x-show="notebookViewMode === 'preview'"
           x-html="renderMarkdown(getActiveTab().data.content)"
           class="prose max-w-none">
      </div>
    </div>
  </div>
</template>
```

### T4: Frontend State & Methods

**File:** `packages/dashboard/public/js/app.js`

```javascript
// Notebook state
notebookViewMode: 'edit',  // 'edit' | 'preview'

// Get active tab helper
getActiveTab() {
  return this.openTabs.find(t => t.id === this.activeTab);
},

// Open notebook file as tab
async openNotebookTab(file) {
  const tabId = `notebook-${file}`;

  // Check if already open
  const existing = this.openTabs.find(t => t.id === tabId);
  if (existing) {
    this.switchTab(tabId);
    return;
  }

  // Fetch file content
  try {
    const res = await fetch(`/api/notebook/${file}`);
    if (!res.ok) throw new Error('Failed to load file');
    const data = await res.json();

    this.openTabs.push({
      id: tabId,
      type: 'notebook',
      title: `${file}.md`,
      icon: '📝',
      closeable: true,
      contentChanged: false,
      data: {
        file,
        content: data.content,
        modified: data.modified
      }
    });

    this.switchTab(tabId);
  } catch (err) {
    console.error('Failed to open notebook file:', err);
    alert('Failed to open file');
  }
},

// Mark tab as dirty
markTabDirty() {
  const tab = this.getActiveTab();
  if (tab) {
    tab.contentChanged = true;
    this.saveUIState();
  }
},

// Save notebook file
async saveNotebookFile() {
  const tab = this.getActiveTab();
  if (!tab || tab.type !== 'notebook') return;

  try {
    const res = await fetch(`/api/notebook/${tab.data.file}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: tab.data.content })
    });

    if (!res.ok) throw new Error('Failed to save');

    tab.contentChanged = false;
    this.saveUIState();
  } catch (err) {
    console.error('Failed to save notebook file:', err);
    alert('Failed to save file');
  }
},

// Toggle view mode
toggleNotebookView() {
  this.notebookViewMode = this.notebookViewMode === 'edit' ? 'preview' : 'edit';
},

// Render markdown (using marked.js)
renderMarkdown(content) {
  if (typeof marked !== 'undefined') {
    return marked.parse(content || '');
  }
  return content;
},
```

### T5: Markdown Rendering

**File:** `packages/dashboard/public/index.html`

Add marked.js CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
```

Add prose styles for rendered markdown:

```html
<style>
  .prose h1 { font-size: 1.5rem; font-weight: bold; margin-bottom: 1rem; }
  .prose h2 { font-size: 1.25rem; font-weight: bold; margin-top: 1.5rem; margin-bottom: 0.5rem; }
  .prose ul { list-style-type: disc; padding-left: 1.5rem; }
  .prose li { margin-bottom: 0.25rem; }
  .prose code { background: #f3f4f6; padding: 0.125rem 0.25rem; border-radius: 0.25rem; }
  .prose pre { background: #f3f4f6; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; }
</style>
```

### T6: Auto-Refresh on Nina Edit

**File:** `packages/dashboard/public/js/app.js`

Already implemented in M4-S3, but ensure it handles edge cases:

```javascript
handleNotebookUpdate(file, content) {
  const tabId = `notebook-${file}`;
  const tab = this.openTabs.find(t => t.id === tabId);

  if (tab) {
    // Check if user has unsaved local changes
    if (tab.contentChanged) {
      // Option 1: Warn and ask
      if (confirm('Nina edited this file. Discard your local changes?')) {
        tab.data.content = content;
        tab.contentChanged = false;
      }
      // Option 2: Just update (simpler, Nina's edit wins)
      // tab.data.content = content;
      // tab.contentChanged = false;
    } else {
      tab.data.content = content;
    }
  }
}
```

### T7: Close Warning

**File:** `packages/dashboard/public/js/app.js`

Update closeTab to warn about unsaved changes:

```javascript
closeTab(id) {
  const tab = this.openTabs.find(t => t.id === id);

  if (tab?.contentChanged) {
    if (!confirm('You have unsaved changes. Close anyway?')) {
      return;
    }
  }

  this.openTabs = this.openTabs.filter(t => t.id !== id);
  if (this.activeTab === id) {
    this.activeTab = this.openTabs[this.openTabs.length - 1]?.id || 'home';
  }
  this.saveUIState();
}
```

Also warn on page unload:

```javascript
// In init
window.addEventListener('beforeunload', (e) => {
  const hasUnsaved = this.openTabs.some(t => t.contentChanged);
  if (hasUnsaved) {
    e.preventDefault();
    e.returnValue = '';
  }
});
```

---

## Files to Create/Modify

| File | Changes |
|------|---------|
| `packages/dashboard/src/routes/notebook.ts` | NEW: REST API |
| `packages/dashboard/src/server.ts` | Register notebook routes |
| `packages/dashboard/public/index.html` | Notebook tab template, marked.js, styles |
| `packages/dashboard/public/js/app.js` | Notebook state, methods, auto-refresh |

---

## Verification

1. **API list:** `GET /api/notebook` returns file list
2. **API read:** `GET /api/notebook/reminders` returns content
3. **API save:** `PUT /api/notebook/reminders` with content saves file
4. **Open tab:** Click "Reminders" on Home → opens tab with content
5. **Edit mode:** Can edit markdown in textarea
6. **Preview mode:** Toggle shows rendered markdown
7. **Dirty tracking:** Edit content → "Unsaved changes" appears
8. **Save:** Click Save → changes persisted, dirty flag cleared
9. **Auto-refresh:** Nina edits file via chat → open tab updates
10. **Close warning:** Close tab with unsaved changes → confirmation dialog
11. **Session storage:** Refresh page → tabs restored (content re-fetched)

---

## Dependencies

- **Upstream:** M4-S2 (tab system), M4-S3 (notebook_updated broadcast)
- **Downstream:** None (completes M4)

---

## Not in Scope

- Syntax highlighting in edit mode (future enhancement)
- Collaborative editing (single user MVP)
- File creation via dashboard (only edit existing)
- Version history / undo across sessions
