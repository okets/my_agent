# Normalized Markdown Metadata Standard

**Date:** 2026-03-13
**Status:** Active
**Spec:** `docs/superpowers/specs/2026-03-13-normalized-metadata-timezone-scheduling.md`

---

## Pattern

Any markdown file that needs machine-readable structured data uses **YAML frontmatter** at the top. The body below the closing `---` fence is free-form markdown for humans and LLMs.

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

## Read/Write Utilities

**Location:** `packages/dashboard/src/metadata/frontmatter.ts`

```typescript
import { readFrontmatter, writeFrontmatter } from "../metadata/frontmatter.js";

// Read
const { data, body } = readFrontmatter<MyType>(filePath);

// Write (preserves body if omitted)
writeFrontmatter(filePath, newData);
writeFrontmatter(filePath, newData, newBody);
```

These are the **only** way to read or write structured metadata in markdown files. No regex parsing.

## Adding a New Schema

1. Create a schema file in `packages/dashboard/src/metadata/schemas/`:

```typescript
// schemas/my-file.ts
export function validateMyFile(data: unknown): string[] {
  const errors: string[] = [];
  // Validate structure...
  return errors;
}
```

2. Register it in `packages/dashboard/src/metadata/schemas/registry.ts`:

```typescript
import { validateMyFile } from "./my-file.js";

export const SCHEMAS: SchemaEntry[] = [
  // ... existing entries
  {
    pathPattern: "notebook/config/my-file.md",
    validate: validateMyFile,
  },
];
```

That's it. The validator picks it up automatically.

## Validation

**Location:** `packages/dashboard/src/metadata/validator.ts`

- Runs on every `reloadPatterns()` call (file change)
- Runs 5 minutes after server start (`setTimeout`, non-blocking)
- Creates a notification with **Fix** button on error
- **Fix** triggers haiku repair — max 1 attempt per error
- If repair fails, notifies "Manual edit needed"

## Incorrect Usage

Do **not** use:
- `- key: value` under H2 headings (the old format)
- Regex parsing of markdown for structured data
- Direct `readFileSync` + manual YAML parsing (use `readFrontmatter`)

## Files Using This Pattern

| File | Schema | Purpose |
|------|--------|---------|
| `notebook/config/work-patterns.md` | `work-patterns` | Job cadence and model configuration |
