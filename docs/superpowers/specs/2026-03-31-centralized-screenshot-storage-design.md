# M8-S3.5: Centralized Screenshot Storage — Design Spec

> **Goal:** Replace distributed per-context screenshot folders with a single central `screenshots/` folder using ref-based lifecycle management.
> **Date:** 2026-03-31
> **Status:** Draft
> **Supersedes:** S1's per-context storage design (VisualActionService directories)

---

## Problem

After S1-S3, screenshots are scattered across context-specific directories:
- `.my_agent/automations/.runs/{automationId}/{jobId}/screenshots/`
- `.my_agent/conversations/{conversationId}/screenshots/`

This causes:
1. **Producers need context** — the Playwright bridge had to hardcode `{ type: "conversation", id: "active" }` because it doesn't know where a screenshot belongs at capture time.
2. **Computer use loop spam** — a 20-step desktop task writes 20 screenshots into a job folder. Most are intermediate navigation nobody will see.
3. **Orphaned files** — conversation deletion doesn't clean up screenshots. Neither does job cleanup.
4. **No global visibility** — querying "all screenshots from today" requires scanning every context folder.

## Solution

### Central Folder

All screenshots land in `.my_agent/screenshots/`. One folder, one `index.jsonl`, one DB table.

```
.my_agent/screenshots/
  ├── index.jsonl          # Source of truth
  ├── ss-abc123.png
  ├── ss-def456.png
  └── ...
```

### Producers Are Dumb

Desktop control, Playwright, future sources — they call `store(image, metadata)` and get an ID back. No context needed. The metadata is just description + dimensions.

```typescript
interface ScreenshotMetadata {
  description?: string;
  width: number;
  height: number;
  source: "desktop" | "playwright" | "upload";
}

// Producer call — no context
const screenshot = vas.store(imageBuffer, {
  description: "After: click submit button",
  width: 1920,
  height: 1080,
  source: "desktop",
});
```

### Refs, Not Moves

The index tracks a `refs` array per screenshot. A ref is a string identifying what context uses this screenshot (e.g., `"conv/abc"`, `"job/auto-1/job-5"`).

Contexts register interest by adding a ref. Files never move.

```jsonl
{"id":"ss-abc123","filename":"ss-abc123.png","timestamp":"2026-03-31T10:00:00Z","width":1920,"height":1080,"source":"desktop","description":"Final screenshot","refs":["conv/main-123"]}
{"id":"ss-def456","filename":"ss-def456.png","timestamp":"2026-03-31T10:00:01Z","width":1920,"height":1080,"source":"desktop","description":"After: click menu","refs":[]}
```

### When Refs Are Added

A screenshot gets a ref when it becomes visible to the user:

- **Conversation Nina shows a screenshot in chat** — when the transcript records a message containing a screenshot URL → `addRef(screenshotId, "conv/{conversationId}")`
- **Job deliverable includes a screenshot** — when a job completes and its summary/deliverable references a screenshot → `addRef(screenshotId, "job/{automationId}/{jobId}")`
- **Timeline renders a screenshot** — when the dashboard displays a screenshot thumbnail in a timeline entry, the ref should already exist from the above triggers

The ref is added at write time (transcript write, job completion), not at render time.

### Expiry

Two states, no tags:

| State | Lifetime | Example |
|---|---|---|
| **Referenced** (refs.length > 0) | Lives as long as the referencing context | Screenshot in a conversation → lives until conversation is deleted |
| **Unreferenced** (refs.length === 0) | 7-day expiry from timestamp | Intermediate computer use screenshot nobody referenced |

No `keep`/`skip` tags. No tiered expiry. Referenced = alive, unreferenced = 7 days.

### Context Deletion Removes Refs

- **Conversation deleted** → remove all `"conv/{conversationId}"` refs from index
- **Automation deleted** → remove all `"job/{automationId}/*"` refs from index
- **Job run_dir cleaned up** → remove `"job/{automationId}/{jobId}"` ref from index

Zero-ref screenshots fall to 7-day expiry automatically.

### DB Table (Derived)

`agent.db` gets a `screenshots` table for fast queries. Derived from `index.jsonl`, rebuildable.

```sql
CREATE TABLE IF NOT EXISTS screenshots (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  source TEXT NOT NULL,
  description TEXT,
  refs TEXT NOT NULL DEFAULT '[]'  -- JSON array
);
```

This is the same pattern as jobs (JSONL source of truth, DB for fast queries).

---

## Interface

```typescript
interface VisualActionService {
  // Store a screenshot — producers call this, no context needed
  store(image: Buffer, metadata: ScreenshotMetadata): Screenshot;

  // Add a ref (called when screenshot becomes visible in a context)
  addRef(screenshotId: string, ref: string): void;

  // Remove all refs matching a prefix (called on context deletion)
  removeRefs(refPrefix: string): void;

  // Get a screenshot by ID
  get(id: string): Screenshot | null;

  // List screenshots with refs matching a prefix
  listByRef(refPrefix: string): Screenshot[];

  // List unreferenced screenshots (for cleanup)
  listUnreferenced(): Screenshot[];

  // Get the serving URL for a screenshot
  url(screenshot: Screenshot): string;

  // Delete a screenshot file + remove from index
  delete(id: string): void;

  // Run cleanup — delete unreferenced screenshots older than maxAge
  cleanup(maxAgeMs?: number): number;

  // Callback for real-time events
  onScreenshot(callback: (screenshot: Screenshot) => void): void;
}

interface Screenshot {
  id: string;
  filename: string;
  path: string;
  timestamp: string;
  width: number;
  height: number;
  sizeBytes: number;
  source: "desktop" | "playwright" | "upload";
  description?: string;
  refs: string[];
}

interface ScreenshotMetadata {
  description?: string;
  width: number;
  height: number;
  source: "desktop" | "playwright" | "upload";
}
```

---

## Serving

Single route: `/api/assets/screenshots/:filename`

Replaces the two current routes (job + conversation). Simpler, no need to know context.

---

## What Changes From S1-S3

| Component | Before (S1-S3) | After (S3.5) |
|---|---|---|
| Storage | Per-context folders | Single `.my_agent/screenshots/` |
| Index | Per-context `index.jsonl` | Single `index.jsonl` |
| DB | None | `screenshots` table in agent.db |
| Context | Required at store time | Not needed — added later via refs |
| Tags | `keep`/`skip` with pixel diff | Removed — refs replace tags |
| Cleanup | Per-context, tag-based | Global, ref-based (7-day unreferenced expiry) |
| Asset route | Two routes (job + conversation) | Single route |
| Producers | Need `AssetContext` | Just provide metadata |
| Frontend store | Filter by contextType + contextId | Filter by ref prefix |

---

*Spec written: 2026-03-31*
*Sprint: M8-S3.5 (Centralized Screenshot Storage)*
