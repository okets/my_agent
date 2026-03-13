# Normalized Markdown Metadata & Timezone-Aware Scheduling

**Date:** 2026-03-13
**Status:** Draft
**Scope:** M6.9 follow-up — fixes calendar UI bug, eliminates morning prep special-casing, establishes project-wide metadata standard

---

## Problem

Morning prep was removed from `work-patterns.md` and given its own `isMorningPrepDue()` function for timezone awareness. This broke:

1. **Calendar UI** — clicking Morning Prep shows Daily Summary data (404 from `/api/work-loop/jobs/morning-prep` because no pattern exists)
2. **Job detail API** — returns 404 for morning prep
3. **Sidebar tabs** — stale data displayed on tab switch

Root cause: the `- key: value` markdown format couldn't express timezone, so morning prep was special-cased outside the normal job system.

Deeper issue: the `- key: value` format is brittle. Regex parsing, no schema, no validation. Any markdown file with structured metadata will hit the same problems.

## Goals

1. Make `isDue()` timezone-aware so ALL jobs go through the same scheduling path
2. Establish a normalized metadata standard (YAML frontmatter) for any markdown file that needs machine-readable structured data
3. Single source of truth: `work-patterns.md` owns cadence times, `config.yaml` owns user preferences (timezone, channel)
4. Validate metadata on change + server startup, surface errors via notifications, offer haiku-powered repair

## Non-Goals

- Retrofitting existing prose markdown files (standing-orders.md, contacts.md, user-info.md) — they work fine as-is
- Per-job timezone overrides — all jobs use the same resolved timezone
- Periodic scheduled validation sweeps — YAGNI

---

## §1 Normalized Markdown Metadata Standard

### 1.1 Pattern

Any markdown file that needs machine-readable structured data uses YAML frontmatter at the top. The body below the closing `---` fence is free-form markdown for humans and LLMs.

```markdown
---
jobs:
  morning-prep:
    cadence: "daily:08:00"
    model: haiku
  daily-summary:
    cadence: "daily:23:00"
    model: haiku
---

# Work Patterns

Morning prep runs at 08:00 in the user's local timezone.
Daily summary compresses the day's log at 23:00.
```

### 1.2 Schema Resolution

Path-based. The validator maps known file paths (relative to agent dir) to schema definitions in code. A schema registry file contains all mappings:

```typescript
// src/metadata/schemas/registry.ts
export const SCHEMAS: SchemaEntry[] = [
  {
    pathPattern: "notebook/config/work-patterns.md",
    schema: workPatternsSchema,
  },
  // Future files: add entries here, validator picks them up automatically
];
```

Adding a schema to the registry is all that's needed — no separate wiring or configuration.

### 1.3 Package Placement

The metadata utilities live in `packages/dashboard/src/metadata/` for now. Only the dashboard reads/writes `work-patterns.md` today. If `packages/core` needs frontmatter utilities later (e.g., hatching writes work-patterns.md at agent creation), move the utilities to `@my-agent/core` at that point. The API is generic — relocation is a move + re-export, not a rewrite.

### 1.4 Read/Write Utilities

Generic `readFrontmatter(filePath)` and `writeFrontmatter(filePath, data)` utilities using the `yaml` library (already a project dependency). No regex. These are the ONLY way to read or write structured metadata in markdown files.

- `readFrontmatter<T>(filePath): { data: T; body: string }` — parses YAML between `---` fences, returns typed data + remaining markdown body
- `writeFrontmatter(filePath, data, body?): void` — serializes data as YAML frontmatter, preserves or replaces body

### 1.5 Project Standard

This pattern is documented in `docs/design/normalized-markdown-metadata.md` and referenced from `CLAUDE.md`. All future markdown files requiring structured data MUST use this pattern. The design doc includes:

- The frontmatter format specification
- How to add a new schema to the registry
- Examples of correct and incorrect usage
- Reference to the validator

---

## §2 Timezone-Aware Scheduling

### 2.1 isDue() Rewrite

Add an optional `timezone` parameter to `isDue()` and `getNextScheduledTime()`:

```typescript
function isDue(
  cadence: string,
  lastRun: Date | null,
  now: Date = new Date(),
  timezone?: string,
): boolean
```

When `timezone` is provided, use `Intl.DateTimeFormat` to convert `now` to local time before comparing against the cadence. This replaces `Date.setHours()` which uses server local time.

Same change for `getNextScheduledTime()`.

### 2.2 Timezone Resolution

Once per poll cycle, the scheduler resolves timezone in priority order:

1. `properties.timezone?.value` — inferred from conversation (user is traveling)
2. `preferences.timezone` — from config.yaml (user's home timezone)
3. `"UTC"` — fallback

All jobs receive the same resolved timezone. No per-job special-casing.

The scheduler exposes `getResolvedTimezone(): string` so the UI can display the active timezone.

### 2.3 Timezone Validation

```typescript
function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
```

Invalid timezone → fallback to UTC + log warning.

### 2.4 Deletions

- `isMorningPrepDue()` — deleted, replaced by `isDue()` with timezone
- Special-case `if (pattern.name === "morning-prep")` branch in `checkDueJobs()` — deleted
- `tests/morning-prep-scheduling.test.ts` — deleted, replaced by timezone tests on `isDue()`

### 2.5 Morning Prep Returns to work-patterns.md

Morning prep becomes a normal job in the YAML frontmatter. No special treatment anywhere in the codebase.

---

## §3 Single Source of Truth

### 3.1 What Lives Where

| Data | Location | Reason |
|------|----------|--------|
| Job cadence times | `work-patterns.md` frontmatter | Markdown is source of truth |
| Job model | `work-patterns.md` frontmatter | Per-job configuration |
| User timezone preference | `config.yaml` preferences | User preference, not job config |
| Morning brief channel | `config.yaml` preferences | User preference |
| Inferred timezone | `properties/status.yaml` | Dynamic, from conversation extraction |

### 3.2 Settings UI Flow

**New endpoint:** `GET/PUT /api/settings/work-patterns` — dedicated to work pattern cadence management, separate from the existing `/api/settings/preferences` which continues to handle config.yaml preferences only.

- **GET `/api/settings/work-patterns`:** Reads job cadence/model from `work-patterns.md` frontmatter via `readFrontmatter()`. Returns `{ jobs: Record<string, { cadence: string; model: string }> }`.
- **PUT `/api/settings/work-patterns`:** Accepts partial job updates (e.g., `{ jobs: { "morning-prep": { cadence: "daily:09:00" } } }`). Writes to `work-patterns.md` via `writeFrontmatter()`. Calls `scheduler.reloadPatterns()` to pick up changes immediately.
- **Existing `/api/settings/preferences`:** Unchanged — continues to read/write timezone, channel, model defaults to config.yaml.

### 3.3 Hatching Flow

When a new agent is hatched and morning brief time is configured, the hatching logic writes to `work-patterns.md` using `writeFrontmatter()`. The `DEFAULT_WORK_PATTERNS` constant becomes a YAML frontmatter template.

No migration code. The current `work-patterns.md` file is manually updated.

---

## §4 Validation & Repair

### 4.1 Validator

A pure sync function:

```typescript
function validateFrontmatter(filePath: string): ValidationError[]
```

Checks:
1. YAML parses without error
2. Required fields present per schema (from registry)
3. Field values are valid (cadence format, model is a known alias, etc.)

### 4.2 When It Runs

- On every `reloadPatterns()` call (triggered by file change)
- 5 minutes after server start (delayed `setTimeout`, non-blocking)

### 4.3 Error Flow

1. Validator detects error → logs warning to console
2. Creates a `request_input` notification (using the existing `InputRequest` type): "work-patterns.md has invalid metadata: {error details}" with a **Fix** option
3. Morning brief includes pending validation errors in its context assembly

### 4.4 Haiku Repair (On Fix Button)

1. User taps **Fix** on the notification
2. Backend receives the respond action via existing `/api/notifications/:id/respond` endpoint
3. Backend triggers haiku with: the broken YAML, the schema definition, and the error description
4. Haiku produces corrected YAML
5. Backend validates the repair output before writing — if still invalid, creates a `notify` notification: "Auto-repair failed for {file}. Manual edit needed." No further auto-repair attempts for this error.
6. If valid, writes back via `writeFrontmatter()`
7. Calls `reloadPatterns()` to pick up the fix
8. Notification auto-clears

No LLM cost unless user explicitly taps Fix. Max one repair attempt per error to prevent loops.

---

## §5 Morning Brief Integration

### 5.1 Pending Notifications in Context

The `handleMorningPrep()` method queries the notification service for unresolved notifications and includes them as a section in the prompt context.

**Wiring:** `WorkLoopSchedulerConfig` gains an optional `notificationService` field. The scheduler is constructed with the service reference in `server.ts` where both are already available. If the service is not provided (e.g., in tests), the notifications section is simply omitted.

**Query:** `notificationService.getPending()` — returns all notifications with status `pending`. Formatted into the prompt as:

```
# Pending Notifications

- [validation] work-patterns.md has invalid metadata: missing cadence for "weekly-review"
- [request_input] Approve 3 staged facts from yesterday's conversations
```

This is generic — any pending notification appears in the morning brief, not just validation errors.

---

## §6 Frontend Fix

### 6.1 Stale Data Bug

`loadWorkLoopJobDetail()` in `app.js` doesn't clear stale data when a fetch returns 404. Fix: reset `workLoopJobDetail` to `null` on non-OK responses.

---

## §7 File Changes

| Area | Change |
|------|--------|
| **New: `packages/dashboard/src/metadata/frontmatter.ts`** | `readFrontmatter()`, `writeFrontmatter()` — generic YAML frontmatter read/write |
| **New: `packages/dashboard/src/metadata/schemas/registry.ts`** | Schema registry, path-to-schema mapping |
| **New: `packages/dashboard/src/metadata/schemas/work-patterns.ts`** | Schema definition for work-patterns.md |
| **New: `packages/dashboard/src/metadata/validator.ts`** | `validateFrontmatter()` — sync validation, notification creation, haiku repair trigger |
| **New: `packages/dashboard/src/routes/work-patterns-settings.ts`** | `GET/PUT /api/settings/work-patterns` — cadence management via frontmatter |
| **New: `docs/design/normalized-markdown-metadata.md`** | Project standard for future files |
| **Modify: `packages/dashboard/src/scheduler/work-patterns.ts`** | Replace `parseWorkPatterns()` regex parser with `readFrontmatter()`, add timezone param to `isDue()` and `getNextScheduledTime()`. `loadWorkPatterns()` now reads YAML frontmatter. `parseWorkPatterns()` is deleted. |
| **Modify: `packages/dashboard/src/scheduler/work-loop-scheduler.ts`** | Delete `isMorningPrepDue()`, remove special-case branching, resolve timezone once per poll, add `notificationService` to config, add pending notifications to morning prep context, expose `getResolvedTimezone()` |
| **Modify: `packages/dashboard/src/routes/work-loop.ts`** | Pass resolved timezone to `getNextScheduledTime()`, expose resolved timezone in `GET /api/work-loop/status` response |
| **Modify: `packages/dashboard/public/js/app.js`** | Clear stale data on 404 in `loadWorkLoopJobDetail()` |
| **Modify: `.my_agent/notebook/config/work-patterns.md`** | Convert to YAML frontmatter, add morning-prep back |
| **Modify: `packages/dashboard/tests/work-patterns.test.ts`** | Update to test frontmatter-based parsing instead of `parseWorkPatterns()` |
| **Modify: `packages/dashboard/tests/work-loop-scheduler.test.ts`** | Update `LIFECYCLE_PATTERNS` and helpers to use YAML frontmatter format |
| **Modify: `packages/dashboard/tests/work-loop-api.test.ts`** | Update work-patterns fixture to YAML frontmatter format |
| **Modify: `packages/dashboard/tests/e2e/memory-lifecycle.test.ts`** | Update work-patterns fixture to YAML frontmatter format |
| **Modify: `packages/dashboard/tests/e2e/timezone-location.test.ts`** | Update to call `isDue()` with timezone instead of `isMorningPrepDue()` |
| **Modify: `docs/ROADMAP.md`** | Reference normalized metadata standard |
| **Modify: `CLAUDE.md`** | Reference normalized metadata design doc |
| **Delete: `packages/dashboard/tests/morning-prep-scheduling.test.ts`** | Replaced by timezone tests on `isDue()` |

## §8 Test Strategy

- **Unit tests for `readFrontmatter()` / `writeFrontmatter()`** — roundtrip, malformed YAML, missing frontmatter, empty body
- **Unit tests for `validateFrontmatter()`** — valid file, missing fields, invalid cadence format, unknown schema path
- **Unit tests for `isDue()` with timezone** — port existing timezone E2E scenarios from `timezone-location.test.ts` to call `isDue()` directly
- **Unit tests for `getNextScheduledTime()` with timezone** — verify correct next time across timezone boundaries
- **Integration test for settings → work-patterns.md roundtrip** — PUT cadence change, verify file updated, verify scheduler picks it up
- **Existing E2E timezone tests** — update to call `isDue()` instead of `isMorningPrepDue()`
