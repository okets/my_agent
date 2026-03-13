# Normalized Metadata & Timezone-Aware Scheduling Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate morning prep special-casing by making `isDue()` timezone-aware, normalize markdown metadata via YAML frontmatter, and add metadata validation with haiku-powered repair.

**Architecture:** YAML frontmatter replaces regex-parsed `- key: value` metadata in markdown files. A generic `readFrontmatter()`/`writeFrontmatter()` utility pair handles all structured markdown I/O. `isDue()` gains an optional `timezone` parameter using `Intl.DateTimeFormat`. Validation runs on change + startup, surfaces errors via the existing notification system.

**Tech Stack:** TypeScript, `yaml` library (existing dep), `Intl.DateTimeFormat` (built-in), Vitest, Fastify

**Spec:** `docs/superpowers/specs/2026-03-13-normalized-metadata-timezone-scheduling.md`

---

## Chunk 1: Core Utilities & Timezone-Aware Scheduling

### Task 1: Generic Frontmatter Read/Write Utilities

**Files:**
- Create: `packages/dashboard/src/metadata/frontmatter.ts`
- Create: `packages/dashboard/tests/metadata/frontmatter.test.ts`

- [ ] **Step 1: Write failing tests for `readFrontmatter()`**

Create `packages/dashboard/tests/metadata/frontmatter.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFrontmatter, writeFrontmatter } from "../../src/metadata/frontmatter.js";

describe("readFrontmatter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "fm-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses YAML frontmatter and returns data + body", () => {
    const file = join(tmpDir, "test.md");
    writeFileSync(file, "---\nfoo: bar\ncount: 42\n---\n\n# Body\n\nSome text.");
    const result = readFrontmatter<{ foo: string; count: number }>(file);
    expect(result.data.foo).toBe("bar");
    expect(result.data.count).toBe(42);
    expect(result.body).toContain("# Body");
    expect(result.body).toContain("Some text.");
  });

  it("returns empty data and full body when no frontmatter", () => {
    const file = join(tmpDir, "test.md");
    writeFileSync(file, "# Just a heading\n\nNo frontmatter here.");
    const result = readFrontmatter(file);
    expect(result.data).toEqual({});
    expect(result.body).toContain("# Just a heading");
  });

  it("returns empty data when YAML is malformed", () => {
    const file = join(tmpDir, "test.md");
    writeFileSync(file, "---\n: broken yaml [[\n---\n\n# Body");
    const result = readFrontmatter(file);
    expect(result.data).toEqual({});
    expect(result.body).toContain("# Body");
  });

  it("handles empty file", () => {
    const file = join(tmpDir, "test.md");
    writeFileSync(file, "");
    const result = readFrontmatter(file);
    expect(result.data).toEqual({});
    expect(result.body).toBe("");
  });

  it("handles frontmatter with no body", () => {
    const file = join(tmpDir, "test.md");
    writeFileSync(file, "---\nkey: value\n---\n");
    const result = readFrontmatter<{ key: string }>(file);
    expect(result.data.key).toBe("value");
    expect(result.body.trim()).toBe("");
  });
});

describe("writeFrontmatter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "fm-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes YAML frontmatter + body", () => {
    const file = join(tmpDir, "test.md");
    writeFrontmatter(file, { foo: "bar", count: 42 }, "# My Doc\n\nBody text.");
    const raw = readFileSync(file, "utf-8");
    expect(raw).toMatch(/^---\n/);
    expect(raw).toContain("foo: bar");
    expect(raw).toContain("count: 42");
    expect(raw).toContain("# My Doc");
  });

  it("preserves existing body when body param omitted", () => {
    const file = join(tmpDir, "test.md");
    writeFileSync(file, "---\nold: data\n---\n\n# Existing Body\n\nKeep this.");
    writeFrontmatter(file, { new: "data" });
    const raw = readFileSync(file, "utf-8");
    expect(raw).toContain("new: data");
    expect(raw).not.toContain("old: data");
    expect(raw).toContain("# Existing Body");
    expect(raw).toContain("Keep this.");
  });

  it("roundtrips correctly", () => {
    const file = join(tmpDir, "test.md");
    const data = { jobs: { "morning-prep": { cadence: "daily:08:00", model: "haiku" } } };
    const body = "# Work Patterns\n\nNotes here.";
    writeFrontmatter(file, data, body);

    const result = readFrontmatter<typeof data>(file);
    expect(result.data.jobs["morning-prep"].cadence).toBe("daily:08:00");
    expect(result.body).toContain("# Work Patterns");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/dashboard && npx vitest run tests/metadata/frontmatter.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `readFrontmatter()` and `writeFrontmatter()`**

Create `packages/dashboard/src/metadata/frontmatter.ts`:

```typescript
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parse, stringify } from "yaml";

export interface FrontmatterResult<T = Record<string, unknown>> {
  data: T;
  body: string;
}

/**
 * Read YAML frontmatter from a markdown file.
 * Returns parsed data + remaining body. On parse error, returns empty data + full content as body.
 */
export function readFrontmatter<T = Record<string, unknown>>(
  filePath: string,
): FrontmatterResult<T> {
  if (!existsSync(filePath)) {
    return { data: {} as T, body: "" };
  }

  const raw = readFileSync(filePath, "utf-8");

  if (!raw.startsWith("---\n")) {
    return { data: {} as T, body: raw };
  }

  const endIndex = raw.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return { data: {} as T, body: raw };
  }

  const yamlBlock = raw.slice(4, endIndex);
  const body = raw.slice(endIndex + 5);

  try {
    const data = (parse(yamlBlock) as T) ?? ({} as T);
    return { data, body };
  } catch {
    return { data: {} as T, body: raw };
  }
}

/**
 * Write YAML frontmatter + body to a markdown file.
 * If body is omitted, preserves the existing body from the file.
 */
export function writeFrontmatter(
  filePath: string,
  data: Record<string, unknown>,
  body?: string,
): void {
  let resolvedBody = body;
  if (resolvedBody === undefined && existsSync(filePath)) {
    const existing = readFrontmatter(filePath);
    resolvedBody = existing.body;
  }
  resolvedBody = resolvedBody ?? "";

  const yamlStr = stringify(data, { lineWidth: 120 });
  const content = `---\n${yamlStr}---\n${resolvedBody}`;
  writeFileSync(filePath, content, "utf-8");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/metadata/frontmatter.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/metadata/frontmatter.ts packages/dashboard/tests/metadata/frontmatter.test.ts
git commit -m "feat: add generic YAML frontmatter read/write utilities"
```

---

### Task 2: Schema Registry & Work Patterns Schema

**Files:**
- Create: `packages/dashboard/src/metadata/schemas/registry.ts`
- Create: `packages/dashboard/src/metadata/schemas/work-patterns.ts`
- Create: `packages/dashboard/tests/metadata/schemas.test.ts`

- [ ] **Step 1: Write failing tests for schema validation**

Create `packages/dashboard/tests/metadata/schemas.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateWorkPatterns } from "../../src/metadata/schemas/work-patterns.js";

describe("validateWorkPatterns", () => {
  it("returns no errors for valid data", () => {
    const data = {
      jobs: {
        "morning-prep": { cadence: "daily:08:00", model: "haiku" },
        "daily-summary": { cadence: "daily:23:00", model: "haiku" },
      },
    };
    expect(validateWorkPatterns(data)).toHaveLength(0);
  });

  it("returns error when jobs is missing", () => {
    const errors = validateWorkPatterns({});
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("jobs");
  });

  it("returns error when cadence is missing", () => {
    const data = {
      jobs: { "morning-prep": { model: "haiku" } },
    };
    const errors = validateWorkPatterns(data);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].field).toContain("cadence");
  });

  it("returns error for invalid cadence format", () => {
    const data = {
      jobs: { "bad-job": { cadence: "daily", model: "haiku" } },
    };
    const errors = validateWorkPatterns(data);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("cadence");
  });

  it("returns error for invalid weekly day", () => {
    const data = {
      jobs: { "bad-job": { cadence: "weekly:funday:09:00", model: "haiku" } },
    };
    const errors = validateWorkPatterns(data);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("allows model to be optional (defaults to haiku)", () => {
    const data = {
      jobs: { "simple-job": { cadence: "daily:12:00" } },
    };
    expect(validateWorkPatterns(data)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/dashboard && npx vitest run tests/metadata/schemas.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement work-patterns schema**

Create `packages/dashboard/src/metadata/schemas/work-patterns.ts`:

```typescript
export interface WorkPatternsData {
  jobs: Record<string, { cadence: string; model?: string }>;
}

export interface ValidationError {
  field: string;
  message: string;
}

const VALID_DAYS = new Set([
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
]);

function isValidCadence(cadence: string): boolean {
  const parts = cadence.toLowerCase().split(":");
  if (parts[0] === "daily" && parts.length === 3) {
    const h = parseInt(parts[1], 10);
    const m = parseInt(parts[2], 10);
    return !isNaN(h) && !isNaN(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }
  if (parts[0] === "weekly" && parts.length === 4) {
    const h = parseInt(parts[2], 10);
    const m = parseInt(parts[3], 10);
    return VALID_DAYS.has(parts[1]) && !isNaN(h) && !isNaN(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }
  return false;
}

export function validateWorkPatterns(data: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!data.jobs || typeof data.jobs !== "object") {
    errors.push({ field: "jobs", message: "Missing required 'jobs' object" });
    return errors;
  }

  const jobs = data.jobs as Record<string, Record<string, unknown>>;
  for (const [name, job] of Object.entries(jobs)) {
    if (!job.cadence || typeof job.cadence !== "string") {
      errors.push({ field: `jobs.${name}.cadence`, message: `Missing required 'cadence' for job '${name}'` });
      continue;
    }
    if (!isValidCadence(job.cadence as string)) {
      errors.push({
        field: `jobs.${name}.cadence`,
        message: `Invalid cadence format '${job.cadence}' for job '${name}'. Expected 'daily:HH:MM' or 'weekly:DAYNAME:HH:MM'`,
      });
    }
  }

  return errors;
}
```

- [ ] **Step 4: Implement schema registry**

Create `packages/dashboard/src/metadata/schemas/registry.ts`:

```typescript
import { validateWorkPatterns, type ValidationError } from "./work-patterns.js";

export interface SchemaEntry {
  pathPattern: string;
  validate: (data: Record<string, unknown>) => ValidationError[];
}

export const SCHEMAS: SchemaEntry[] = [
  {
    pathPattern: "notebook/config/work-patterns.md",
    validate: validateWorkPatterns,
  },
];

export function findSchema(relativePath: string): SchemaEntry | null {
  return SCHEMAS.find((s) => s.pathPattern === relativePath) ?? null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/metadata/schemas.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/metadata/schemas/ packages/dashboard/tests/metadata/schemas.test.ts
git commit -m "feat: add schema registry and work-patterns validation schema"
```

---

### Task 3: Timezone-Aware `isDue()` and `getNextScheduledTime()`

**Files:**
- Modify: `packages/dashboard/src/scheduler/work-patterns.ts`
- Modify: `packages/dashboard/tests/work-patterns.test.ts`

- [ ] **Step 1: Add timezone tests to existing `isDue` test suite**

Append inside the `isDue` describe block in `packages/dashboard/tests/work-patterns.test.ts`, after the "invalid cadence" block:

```typescript
describe("timezone-aware scheduling", () => {
  it("daily job is due in Bangkok timezone when UTC time is early", () => {
    const now = new Date("2026-03-12T02:00:00Z");
    expect(isDue("daily:08:00", null, now, "Asia/Bangkok")).toBe(true);
  });

  it("daily job is NOT due in server local time when only due in Bangkok", () => {
    // 02:00 UTC without timezone param -> uses server local time (not UTC)
    // This test verifies that the no-timezone path doesn't accidentally match Bangkok
    const now = new Date("2026-03-12T02:00:00Z");
    expect(isDue("daily:08:00", null, now, "UTC")).toBe(false);
  });

  it("westward travel delays job (UTC to New York)", () => {
    const noonUtc = new Date("2026-03-12T12:00:00Z");
    expect(isDue("daily:08:00", null, noonUtc, "America/New_York")).toBe(true);
    const elevenUtc = new Date("2026-03-12T11:00:00Z");
    expect(isDue("daily:08:00", null, elevenUtc, "America/New_York")).toBe(false);
  });

  it("already ran today in timezone prevents duplicate", () => {
    const lastRun = new Date("2026-03-12T01:05:00Z");
    const now = new Date("2026-03-12T02:00:00Z");
    expect(isDue("daily:08:00", lastRun, now, "Asia/Bangkok")).toBe(false);
  });

  it("invalid timezone falls back to UTC (not server local time)", () => {
    // 07:00 UTC -> not yet 08:00 in UTC, so should be false
    const now = new Date("2026-03-12T07:00:00Z");
    expect(isDue("daily:08:00", null, now, "Invalid/Timezone")).toBe(false);
    // 09:00 UTC -> past 08:00 in UTC, so should be true
    const later = new Date("2026-03-12T09:00:00Z");
    expect(isDue("daily:08:00", null, later, "Invalid/Timezone")).toBe(true);
  });

  it("weekly job respects timezone for day-of-week check", () => {
    // Saturday 22:00 UTC = Sunday 05:00 Bangkok -> not yet due (09:00 target)
    const satNightUtc = new Date("2026-03-14T22:00:00Z");
    expect(isDue("weekly:sunday:09:00", null, satNightUtc, "Asia/Bangkok")).toBe(false);
    // Sunday 02:00 UTC = Sunday 09:00 Bangkok -> due
    const sunMorningUtc = new Date("2026-03-15T02:00:00Z");
    expect(isDue("weekly:sunday:09:00", null, sunMorningUtc, "Asia/Bangkok")).toBe(true);
  });
});
```

Also add timezone tests for `getNextScheduledTime` inside its describe block:

```typescript
it("returns timezone-adjusted next time for daily job", () => {
  const now = new Date("2026-03-12T01:00:00Z");
  const next = getNextScheduledTime("daily:08:00", now, "Asia/Bangkok");
  expect(next).not.toBeNull();
  expect(next!.getUTCDate()).toBe(13);
  expect(next!.getUTCHours()).toBe(1);
});

it("returns today's time if not yet reached in timezone", () => {
  const now = new Date("2026-03-12T00:00:00Z");
  const next = getNextScheduledTime("daily:08:00", now, "Asia/Bangkok");
  expect(next).not.toBeNull();
  expect(next!.getUTCDate()).toBe(12);
  expect(next!.getUTCHours()).toBe(1);
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `cd packages/dashboard && npx vitest run tests/work-patterns.test.ts`
Expected: New timezone tests FAIL. Existing tests still PASS.

- [ ] **Step 3: Rewrite `isDue()` with timezone support**

In `packages/dashboard/src/scheduler/work-patterns.ts`, add these helper functions before `isDue()`:

```typescript
/**
 * Validate a timezone string using Intl.DateTimeFormat.
 */
export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function getLocalTime(date: Date, timezone?: string): [number, number] {
  if (!timezone) return [date.getHours(), date.getMinutes()];
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = formatter.formatToParts(date);
  return [
    parseInt(parts.find((p) => p.type === "hour")!.value, 10),
    parseInt(parts.find((p) => p.type === "minute")!.value, 10),
  ];
}

function getLocalDayOfWeek(date: Date, timezone?: string): number {
  if (!timezone) return date.getDay();
  const dayStr = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, weekday: "short",
  }).format(date).toLowerCase();
  const map: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  return map[dayStr] ?? date.getDay();
}

function getLocalDateStr(date: Date, timezone?: string): string {
  if (!timezone) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date);
}
```

Then replace the `isDue` function body:

```typescript
export function isDue(
  cadence: string,
  lastRun: Date | null,
  now: Date = new Date(),
  timezone?: string,
): boolean {
  const tz = timezone
    ? (isValidTimezone(timezone) ? timezone : "UTC")
    : undefined;
  if (timezone && !isValidTimezone(timezone)) {
    console.warn(`[WorkPatterns] Invalid timezone '${timezone}', falling back to UTC`);
  }

  const parts = cadence.toLowerCase().split(":");

  if (parts[0] === "daily" && parts.length === 3) {
    const targetHour = parseInt(parts[1], 10);
    const targetMinute = parseInt(parts[2], 10);
    if (isNaN(targetHour) || isNaN(targetMinute)) return false;

    const [localHour, localMinute] = getLocalTime(now, tz);
    if (localHour < targetHour || (localHour === targetHour && localMinute < targetMinute)) return false;
    if (!lastRun) return true;

    const todayStr = getLocalDateStr(now, tz);
    const lastRunDayStr = getLocalDateStr(lastRun, tz);
    return lastRunDayStr < todayStr;
  }

  if (parts[0] === "weekly" && parts.length === 4) {
    const dayName = parts[1];
    const targetHour = parseInt(parts[2], 10);
    const targetMinute = parseInt(parts[3], 10);
    if (isNaN(targetHour) || isNaN(targetMinute)) return false;

    const dayMap: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    };
    const targetDay = dayMap[dayName];
    if (targetDay === undefined) return false;

    if (getLocalDayOfWeek(now, tz) !== targetDay) return false;

    const [localHour, localMinute] = getLocalTime(now, tz);
    if (localHour < targetHour || (localHour === targetHour && localMinute < targetMinute)) return false;
    if (!lastRun) return true;

    return getLocalDateStr(lastRun, tz) < getLocalDateStr(now, tz);
  }

  console.warn(`[WorkPatterns] Unknown cadence format: ${cadence}`);
  return false;
}
```

- [ ] **Step 4: Rewrite `getNextScheduledTime()` with timezone support**

Replace the function. The signature changes from `(cadence, now?)` to `(cadence, now?, timezone?)`:

```typescript
function localTimeToUtc(localIso: string, timezone: string): Date {
  const [datePart, timePart] = localIso.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi, s] = (timePart || "00:00:00").split(":").map(Number);

  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi, s || 0));
  const [guessH, guessM] = getLocalTime(guess, timezone);
  const offsetMinutes = (guessH * 60 + guessM) - (h * 60 + mi);
  return new Date(guess.getTime() - offsetMinutes * 60 * 1000);
}

export function getNextScheduledTime(
  cadence: string,
  now: Date = new Date(),
  timezone?: string,
): Date | null {
  const tz = timezone
    ? (isValidTimezone(timezone) ? timezone : "UTC")
    : undefined;
  const parts = cadence.toLowerCase().split(":");

  if (parts[0] === "daily" && parts.length === 3) {
    const targetHour = parseInt(parts[1], 10);
    const targetMinute = parseInt(parts[2], 10);
    if (isNaN(targetHour) || isNaN(targetMinute)) return null;

    if (!tz) {
      const next = new Date(now);
      next.setHours(targetHour, targetMinute, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return next;
    }

    const [localHour, localMinute] = getLocalTime(now, tz);
    let candidateDateStr = getLocalDateStr(now, tz);
    if (localHour > targetHour || (localHour === targetHour && localMinute >= targetMinute)) {
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      candidateDateStr = getLocalDateStr(tomorrow, tz);
    }
    const iso = `${candidateDateStr}T${String(targetHour).padStart(2, "0")}:${String(targetMinute).padStart(2, "0")}:00`;
    return localTimeToUtc(iso, tz);
  }

  if (parts[0] === "weekly" && parts.length === 4) {
    const dayName = parts[1];
    const targetHour = parseInt(parts[2], 10);
    const targetMinute = parseInt(parts[3], 10);
    if (isNaN(targetHour) || isNaN(targetMinute)) return null;

    const dayMap: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    };
    const targetDay = dayMap[dayName];
    if (targetDay === undefined) return null;

    if (!tz) {
      const next = new Date(now);
      next.setHours(targetHour, targetMinute, 0, 0);
      let daysUntil = targetDay - now.getDay();
      if (daysUntil < 0) daysUntil += 7;
      if (daysUntil === 0 && next <= now) daysUntil = 7;
      next.setDate(next.getDate() + daysUntil);
      return next;
    }

    const localDay = getLocalDayOfWeek(now, tz);
    const [localHour, localMinute] = getLocalTime(now, tz);
    let daysUntil = targetDay - localDay;
    if (daysUntil < 0) daysUntil += 7;
    if (daysUntil === 0 && (localHour > targetHour || (localHour === targetHour && localMinute >= targetMinute))) {
      daysUntil = 7;
    }
    const candidateDate = new Date(now.getTime() + daysUntil * 24 * 60 * 60 * 1000);
    const candidateDateStr = getLocalDateStr(candidateDate, tz);
    const iso = `${candidateDateStr}T${String(targetHour).padStart(2, "0")}:${String(targetMinute).padStart(2, "0")}:00`;
    return localTimeToUtc(iso, tz);
  }

  return null;
}
```

- [ ] **Step 5: Run all work-patterns tests**

Run: `cd packages/dashboard && npx vitest run tests/work-patterns.test.ts`
Expected: All PASS (existing + new timezone tests)

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/scheduler/work-patterns.ts packages/dashboard/tests/work-patterns.test.ts
git commit -m "feat: make isDue() and getNextScheduledTime() timezone-aware"
```

---

### Task 4: Rewrite `work-patterns.ts` Parser to Use Frontmatter

**Files:**
- Modify: `packages/dashboard/src/scheduler/work-patterns.ts`
- Modify: `packages/dashboard/tests/work-patterns.test.ts`

- [ ] **Step 1: Update `parseWorkPatterns` tests to use frontmatter format**

Replace the `parseWorkPatterns` describe block in `packages/dashboard/tests/work-patterns.test.ts`. Change import to use `parseWorkPatternsFrontmatter` instead of `parseWorkPatterns`:

```typescript
import {
  isDue,
  getNextScheduledTime,
  parseWorkPatternsFrontmatter,
} from "../src/scheduler/work-patterns.js";

describe("parseWorkPatternsFrontmatter", () => {
  it("parses frontmatter data with two jobs", () => {
    const data = {
      jobs: {
        "morning-prep": { cadence: "daily:08:00", model: "haiku" },
        "daily-summary": { cadence: "daily:23:00", model: "haiku" },
      },
    };
    const patterns = parseWorkPatternsFrontmatter(data);
    expect(patterns).toHaveLength(2);
    expect(patterns[0].name).toBe("morning-prep");
    expect(patterns[0].displayName).toBe("Morning Prep");
    expect(patterns[0].cadence).toBe("daily:08:00");
    expect(patterns[0].model).toBe("haiku");
    expect(patterns[1].name).toBe("daily-summary");
  });

  it("defaults model to haiku when not specified", () => {
    const data = { jobs: { "simple-job": { cadence: "daily:12:00" } } };
    const patterns = parseWorkPatternsFrontmatter(data);
    expect(patterns[0].model).toBe("haiku");
  });

  it("skips jobs without cadence", () => {
    const data = {
      jobs: {
        "no-cadence": { model: "haiku" },
        "has-cadence": { cadence: "daily:10:00" },
      },
    };
    const patterns = parseWorkPatternsFrontmatter(data);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].name).toBe("has-cadence");
  });

  it("returns empty array for empty jobs", () => {
    expect(parseWorkPatternsFrontmatter({ jobs: {} })).toHaveLength(0);
  });

  it("returns empty array for missing jobs key", () => {
    expect(parseWorkPatternsFrontmatter({})).toHaveLength(0);
  });

  it("converts kebab-case to display name", () => {
    const data = { jobs: { "my-special-job": { cadence: "daily:06:00" } } };
    const patterns = parseWorkPatternsFrontmatter(data);
    expect(patterns[0].displayName).toBe("My Special Job");
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

Run: `cd packages/dashboard && npx vitest run tests/work-patterns.test.ts`
Expected: FAIL (`parseWorkPatternsFrontmatter` not exported)

- [ ] **Step 3: Implement `parseWorkPatternsFrontmatter` and update `loadWorkPatterns`**

In `packages/dashboard/src/scheduler/work-patterns.ts`:

Add import at top:
```typescript
import { readFrontmatter, writeFrontmatter } from "../metadata/frontmatter.js";
```

Replace `DEFAULT_WORK_PATTERNS` string constant with:
```typescript
const DEFAULT_WORK_PATTERNS_DATA = {
  jobs: {
    "morning-prep": { cadence: "daily:08:00", model: "haiku" },
    "daily-summary": { cadence: "daily:23:00", model: "haiku" },
  },
};

const DEFAULT_WORK_PATTERNS_BODY = `
# Work Patterns

Morning prep runs at 08:00 in the user's local timezone.
Daily summary compresses the day's log at 23:00.
`;
```

Add new parser function:
```typescript
function toDisplayName(kebab: string): string {
  return kebab.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function parseWorkPatternsFrontmatter(
  data: Record<string, unknown>,
): WorkPattern[] {
  const jobs = data.jobs as Record<string, Record<string, unknown>> | undefined;
  if (!jobs || typeof jobs !== "object") return [];

  const patterns: WorkPattern[] = [];
  for (const [name, job] of Object.entries(jobs)) {
    if (!job.cadence || typeof job.cadence !== "string") continue;
    patterns.push({
      name,
      displayName: toDisplayName(name),
      cadence: job.cadence,
      model: (job.model as string) ?? "haiku",
    });
  }
  return patterns;
}
```

Replace `loadWorkPatterns`:
```typescript
export async function loadWorkPatterns(agentDir: string): Promise<WorkPattern[]> {
  const filePath = `${agentDir}/notebook/config/work-patterns.md`;

  if (!existsSync(filePath)) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    writeFrontmatter(filePath, DEFAULT_WORK_PATTERNS_DATA, DEFAULT_WORK_PATTERNS_BODY);
    console.log("[WorkPatterns] Created default work-patterns.md");
  }

  try {
    const { data } = readFrontmatter<{ jobs: Record<string, { cadence: string; model?: string }> }>(filePath);
    const patterns = parseWorkPatternsFrontmatter(data);
    console.log(`[WorkPatterns] Loaded ${patterns.length} job(s): ${patterns.map((p) => p.name).join(", ")}`);
    return patterns;
  } catch (err) {
    console.error("[WorkPatterns] Failed to read work-patterns.md:", err instanceof Error ? err.message : String(err));
    return [];
  }
}
```

Delete the old `parseWorkPatterns`, `toKebabCase`, and `DEFAULT_WORK_PATTERNS` string.

- [ ] **Step 4: Run tests**

Run: `cd packages/dashboard && npx vitest run tests/work-patterns.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/scheduler/work-patterns.ts packages/dashboard/tests/work-patterns.test.ts
git commit -m "feat: replace regex parser with YAML frontmatter for work-patterns.md"
```

---

### Task 5: Update Work-Patterns File and Dependent Tests

**Files:**
- Modify: `.my_agent/notebook/config/work-patterns.md`
- Modify: `packages/dashboard/tests/work-loop-scheduler.test.ts`
- Modify: `packages/dashboard/tests/work-loop-api.test.ts`
- Modify: `packages/dashboard/tests/e2e/memory-lifecycle.test.ts`

- [ ] **Step 1: Update the live work-patterns.md to YAML frontmatter**

Replace `.my_agent/notebook/config/work-patterns.md` with:

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

- [ ] **Step 2: Update test fixtures in `work-loop-scheduler.test.ts`**

Replace `LIFECYCLE_PATTERNS` constant:
```typescript
const LIFECYCLE_PATTERNS = `---
jobs:
  morning-prep:
    cadence: "weekly:saturday:03:33"
    model: haiku
  daily-summary:
    cadence: "weekly:saturday:03:34"
    model: haiku
---

# Work Patterns (Test)
`;
```

Update the "reloads patterns" test extra job pattern to frontmatter format. Update the "failed job" test pattern to frontmatter format.

- [ ] **Step 3: Update `WORK_PATTERNS_MD` in `work-loop-api.test.ts`**

```typescript
const WORK_PATTERNS_MD = `---
jobs:
  unknown-handler:
    cadence: "weekly:saturday:03:33"
    model: haiku
---

# Work Patterns (Test)
`;
```

- [ ] **Step 4: Update `memory-lifecycle.test.ts` work patterns fixture**

Replace the `writeFileSync` for work-patterns.md (around line 86-88) with frontmatter format.

- [ ] **Step 5: Run all affected tests**

Run: `cd packages/dashboard && npx vitest run tests/work-loop-scheduler.test.ts tests/work-loop-api.test.ts tests/work-patterns.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add .my_agent/notebook/config/work-patterns.md packages/dashboard/tests/
git commit -m "feat: update work-patterns.md and all test fixtures to YAML frontmatter"
```

---

## Chunk 2: Scheduler Refactor, Settings, Validation & Frontend

### Task 6: Remove Morning Prep Special-Casing from Scheduler

**Files:**
- Modify: `packages/dashboard/src/scheduler/work-loop-scheduler.ts`
- Delete: `packages/dashboard/tests/morning-prep-scheduling.test.ts`
- Modify: `packages/dashboard/tests/e2e/timezone-location.test.ts`

- [ ] **Step 1: Delete `isMorningPrepDue()` and special-case branching**

In `packages/dashboard/src/scheduler/work-loop-scheduler.ts`:

1. Delete the `isMorningPrepDue` function (lines 57-88) and its export.

2. Replace the `checkDueJobs` method with a unified path that resolves timezone once and passes it to `isDue()` for all jobs:

```typescript
private async checkDueJobs(): Promise<void> {
  if (!this.isRunning || this.isExecuting) return;
  const now = new Date();
  const timezone = await this.resolveTimezone();

  for (const pattern of this.patterns) {
    if (!this.isRunning) return;
    const lastRun = this.getLastRun(pattern.name);
    const due = isDue(pattern.cadence, lastRun, now, timezone);

    if (due) {
      try {
        await this.runJob(pattern);
      } catch (err) {
        console.error(`[WorkLoop] Failed to run ${pattern.name}:`, err instanceof Error ? err.message : String(err));
      }
    }
  }
}
```

3. Add `resolveTimezone()` private method and `getResolvedTimezone()` public method:

```typescript
private resolvedTimezone: string = "UTC";

private async resolveTimezone(): Promise<string> {
  try {
    const props = await readProperties(this.agentDir);
    if (props.timezone?.value) { this.resolvedTimezone = props.timezone.value; return this.resolvedTimezone; }
  } catch { /* fall through */ }
  try {
    const prefs = loadPreferences(this.agentDir);
    if (prefs.timezone && prefs.timezone !== "UTC") { this.resolvedTimezone = prefs.timezone; return this.resolvedTimezone; }
  } catch { /* fall through */ }
  this.resolvedTimezone = "UTC";
  return "UTC";
}

getResolvedTimezone(): string {
  return this.resolvedTimezone;
}
```

- [ ] **Step 2: Update timezone E2E tests to use `isDue()` instead of `isMorningPrepDue()`**

In `packages/dashboard/tests/e2e/timezone-location.test.ts`:

Replace import of `isMorningPrepDue` with `isDue`:
```typescript
import { isDue } from "../../src/scheduler/work-patterns.js";
```

Update each scheduling test (scenarios 1-3, 6-7) to call `isDue("daily:08:00", lastRun, now, timezone)` instead of `isMorningPrepDue(prefs, props, lastRun, now)`. The cadence comes from `prefs.morningBrief.time`, the timezone from `props.timezone?.value ?? prefs.timezone`.

Keep scenarios 4-5 (properties roundtrip, staleness) and scenario 8 (loadPreferences defaults) as-is.

- [ ] **Step 3: Delete `morning-prep-scheduling.test.ts`**

Remove `packages/dashboard/tests/morning-prep-scheduling.test.ts`.

- [ ] **Step 4: Run all tests**

Run: `cd packages/dashboard && npx vitest run tests/e2e/timezone-location.test.ts tests/work-loop-scheduler.test.ts tests/work-patterns.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/scheduler/work-loop-scheduler.ts packages/dashboard/tests/e2e/timezone-location.test.ts
git rm packages/dashboard/tests/morning-prep-scheduling.test.ts
git commit -m "feat: remove isMorningPrepDue, all jobs use timezone-aware isDue()"
```

---

### Task 7: Pass Timezone to Work Loop Routes

**Files:**
- Modify: `packages/dashboard/src/routes/work-loop.ts`

- [ ] **Step 1: Update `getNextScheduledTime` calls to pass timezone**

In `packages/dashboard/src/routes/work-loop.ts`:

1. Events endpoint (line 120): pass `scheduler.getResolvedTimezone()` to `getNextScheduledTime`.
2. Status endpoint (line 167): pass timezone, add `timezone` field to response.
3. Job detail endpoint (line 203): pass timezone.

- [ ] **Step 2: Run API tests**

Run: `cd packages/dashboard && npx vitest run tests/work-loop-api.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/routes/work-loop.ts
git commit -m "feat: pass resolved timezone to getNextScheduledTime in work-loop routes"
```

---

### Task 8: Work Patterns Settings Endpoint

**Files:**
- Create: `packages/dashboard/src/routes/work-patterns-settings.ts`
- Create: `packages/dashboard/tests/work-patterns-settings.test.ts`
- Modify: `packages/dashboard/src/server.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/dashboard/tests/work-patterns-settings.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { writeFrontmatter } from "../src/metadata/frontmatter.js";
import { WorkLoopScheduler } from "../src/scheduler/work-loop-scheduler.js";
import { registerWorkPatternsSettingsRoutes } from "../src/routes/work-patterns-settings.js";

declare module "fastify" {
  interface FastifyInstance {
    workLoopScheduler: WorkLoopScheduler | null;
    agentDir: string;
  }
}

let tmpDir: string;
let db: Database.Database;
let fastify: FastifyInstance;
let scheduler: WorkLoopScheduler;

describe("work-patterns settings API", () => {
  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wps-test-"));
    mkdirSync(join(tmpDir, "notebook", "config"), { recursive: true });
    mkdirSync(join(tmpDir, "conversations"), { recursive: true });

    writeFrontmatter(
      join(tmpDir, "notebook", "config", "work-patterns.md"),
      {
        jobs: {
          "morning-prep": { cadence: "daily:08:00", model: "haiku" },
          "daily-summary": { cadence: "daily:23:00", model: "haiku" },
        },
      },
      "# Work Patterns\n",
    );

    db = new Database(":memory:");
    db.exec(`CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, title TEXT, abbreviation TEXT, updated TEXT NOT NULL
    )`);

    scheduler = new WorkLoopScheduler({ db, agentDir: tmpDir, pollIntervalMs: 999_999 });
    await scheduler.start();

    fastify = Fastify();
    fastify.decorate("workLoopScheduler", scheduler);
    fastify.decorate("agentDir", tmpDir);
    await registerWorkPatternsSettingsRoutes(fastify);
  });

  afterEach(async () => {
    await scheduler.stop();
    await fastify.close();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET returns current job configurations", async () => {
    const res = await fastify.inject({ method: "GET", url: "/api/settings/work-patterns" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jobs["morning-prep"].cadence).toBe("daily:08:00");
    expect(body.jobs["daily-summary"].cadence).toBe("daily:23:00");
  });

  it("PUT updates cadence and persists to file", async () => {
    const res = await fastify.inject({
      method: "PUT",
      url: "/api/settings/work-patterns",
      payload: { jobs: { "morning-prep": { cadence: "daily:09:30" } } },
    });
    expect(res.statusCode).toBe(200);

    const raw = readFileSync(join(tmpDir, "notebook", "config", "work-patterns.md"), "utf-8");
    expect(raw).toContain("daily:09:30");

    const patterns = scheduler.getPatterns();
    const mp = patterns.find((p) => p.name === "morning-prep");
    expect(mp?.cadence).toBe("daily:09:30");
  });

  it("PUT merges partial updates (doesn't delete other jobs)", async () => {
    await fastify.inject({
      method: "PUT",
      url: "/api/settings/work-patterns",
      payload: { jobs: { "morning-prep": { cadence: "daily:07:00" } } },
    });

    const res = await fastify.inject({ method: "GET", url: "/api/settings/work-patterns" });
    const body = res.json();
    expect(body.jobs["morning-prep"].cadence).toBe("daily:07:00");
    expect(body.jobs["daily-summary"].cadence).toBe("daily:23:00");
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

Run: `cd packages/dashboard && npx vitest run tests/work-patterns-settings.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement the routes**

Create `packages/dashboard/src/routes/work-patterns-settings.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import { readFrontmatter, writeFrontmatter } from "../metadata/frontmatter.js";

interface WorkPatternsBody {
  jobs: Record<string, { cadence?: string; model?: string }>;
}

export async function registerWorkPatternsSettingsRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const getFilePath = () =>
    join(fastify.agentDir, "notebook", "config", "work-patterns.md");

  fastify.get("/api/settings/work-patterns", async () => {
    const { data } = readFrontmatter<{ jobs: Record<string, unknown> }>(getFilePath());
    return { jobs: data.jobs ?? {} };
  });

  fastify.put<{ Body: WorkPatternsBody }>(
    "/api/settings/work-patterns",
    async (request) => {
      const filePath = getFilePath();
      const { data, body } = readFrontmatter<{
        jobs: Record<string, { cadence: string; model?: string }>;
      }>(filePath);

      const existingJobs = data.jobs ?? {};
      const updates = request.body.jobs ?? {};

      for (const [name, fields] of Object.entries(updates)) {
        existingJobs[name] = { ...existingJobs[name], ...fields };
      }

      writeFrontmatter(filePath, { jobs: existingJobs }, body);

      const scheduler = fastify.workLoopScheduler;
      if (scheduler) await scheduler.reloadPatterns();

      return { jobs: existingJobs };
    },
  );
}
```

- [ ] **Step 4: Register route in server.ts**

In `packages/dashboard/src/server.ts`, add:

```typescript
import { registerWorkPatternsSettingsRoutes } from "./routes/work-patterns-settings.js";
```

Add registration call near the other `register*Routes` calls:

```typescript
await registerWorkPatternsSettingsRoutes(fastify);
```

- [ ] **Step 5: Run tests**

Run: `cd packages/dashboard && npx vitest run tests/work-patterns-settings.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/routes/work-patterns-settings.ts packages/dashboard/tests/work-patterns-settings.test.ts packages/dashboard/src/server.ts
git commit -m "feat: add GET/PUT /api/settings/work-patterns for cadence management"
```

---

### Task 9: Metadata Validator with Notification Integration

**Files:**
- Create: `packages/dashboard/src/metadata/validator.ts`
- Create: `packages/dashboard/tests/metadata/validator.test.ts`
- Modify: `packages/dashboard/src/scheduler/work-loop-scheduler.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/dashboard/tests/metadata/validator.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFrontmatter } from "../../src/metadata/frontmatter.js";
import { validateMetadataFile } from "../../src/metadata/validator.js";

describe("validateMetadataFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "val-test-"));
    mkdirSync(join(tmpDir, "notebook", "config"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns valid for correct work-patterns.md", () => {
    const filePath = join(tmpDir, "notebook", "config", "work-patterns.md");
    writeFrontmatter(filePath, {
      jobs: { "morning-prep": { cadence: "daily:08:00", model: "haiku" } },
    }, "# Work Patterns\n");

    const result = validateMetadataFile(filePath, tmpDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns errors for missing cadence", () => {
    const filePath = join(tmpDir, "notebook", "config", "work-patterns.md");
    writeFrontmatter(filePath, {
      jobs: { "bad-job": { model: "haiku" } },
    }, "# Work Patterns\n");

    const result = validateMetadataFile(filePath, tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns errors for invalid cadence format", () => {
    const filePath = join(tmpDir, "notebook", "config", "work-patterns.md");
    writeFrontmatter(filePath, {
      jobs: { "bad-job": { cadence: "daily", model: "haiku" } },
    }, "# Work Patterns\n");

    const result = validateMetadataFile(filePath, tmpDir);
    expect(result.valid).toBe(false);
  });

  it("returns valid=true for unknown file (no schema)", () => {
    const filePath = join(tmpDir, "notebook", "config", "unknown.md");
    writeFrontmatter(filePath, { arbitrary: "data" }, "# Unknown\n");

    const result = validateMetadataFile(filePath, tmpDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns errors for malformed YAML", () => {
    const filePath = join(tmpDir, "notebook", "config", "work-patterns.md");
    writeFileSync(filePath, "---\n: broken [[\n---\n# Body\n");

    const result = validateMetadataFile(filePath, tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("frontmatter");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/dashboard && npx vitest run tests/metadata/validator.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement validator**

Create `packages/dashboard/src/metadata/validator.ts`:

```typescript
import { relative } from "node:path";
import { readFrontmatter } from "./frontmatter.js";
import { findSchema } from "./schemas/registry.js";
import type { ValidationError } from "./schemas/work-patterns.js";

export interface MetadataValidationResult {
  valid: boolean;
  errors: ValidationError[];
  filePath: string;
}

/**
 * Validate a metadata file against its schema (resolved by path).
 * Returns valid=true if no schema exists for the path (unknown files pass).
 */
export function validateMetadataFile(
  filePath: string,
  agentDir: string,
): MetadataValidationResult {
  const relativePath = relative(agentDir, filePath).replace(/\\/g, "/");
  const schema = findSchema(relativePath);

  if (!schema) {
    return { valid: true, errors: [], filePath };
  }

  const { data } = readFrontmatter(filePath);

  if (Object.keys(data).length === 0) {
    return {
      valid: false,
      errors: [{ field: "frontmatter", message: "Missing or malformed YAML frontmatter" }],
      filePath,
    };
  }

  const errors = schema.validate(data);
  return { valid: errors.length === 0, errors, filePath };
}
```

- [ ] **Step 4: Wire validation into scheduler**

In `packages/dashboard/src/scheduler/work-loop-scheduler.ts`:

1. Add imports:
```typescript
import { validateMetadataFile } from "../metadata/validator.js";
import type { NotificationService } from "@my-agent/core";
```

2. Add `notificationService` to `WorkLoopSchedulerConfig`:
```typescript
export interface WorkLoopSchedulerConfig {
  db: Database.Database;
  agentDir: string;
  pollIntervalMs?: number;
  notificationService?: NotificationService | null;
}
```

3. Store in class constructor:
```typescript
private notificationService: NotificationService | null;

constructor(config: WorkLoopSchedulerConfig) {
  // ... existing ...
  this.notificationService = config.notificationService ?? null;
}
```

4. Add validation to `reloadPatterns()`:
```typescript
async reloadPatterns(): Promise<void> {
  this.patterns = await loadWorkPatterns(this.agentDir);

  const filePath = join(this.agentDir, "notebook", "config", "work-patterns.md");
  const result = validateMetadataFile(filePath, this.agentDir);
  if (!result.valid && this.notificationService) {
    const errorSummary = result.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
    this.notificationService.requestInput({
      question: `work-patterns.md has invalid metadata: ${errorSummary}`,
      options: ["Fix", "Dismiss"],
    });
  }
}
```

5. Add delayed startup validation in `start()` after the existing check:
```typescript
// Delayed validation (5 minutes after startup)
setTimeout(() => {
  const filePath = join(this.agentDir, "notebook", "config", "work-patterns.md");
  const result = validateMetadataFile(filePath, this.agentDir);
  if (!result.valid) {
    console.warn("[WorkLoop] Startup validation found errors:", result.errors);
    if (this.notificationService) {
      const errorSummary = result.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
      this.notificationService.requestInput({
        question: `work-patterns.md has invalid metadata: ${errorSummary}`,
        options: ["Fix", "Dismiss"],
      });
    }
  }
}, 5 * 60 * 1000);
```

- [ ] **Step 5: Run tests**

Run: `cd packages/dashboard && npx vitest run tests/metadata/validator.test.ts tests/work-loop-scheduler.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/metadata/validator.ts packages/dashboard/tests/metadata/validator.test.ts packages/dashboard/src/scheduler/work-loop-scheduler.ts
git commit -m "feat: add metadata validator with notification integration"
```

---

### Task 9b: Haiku Repair Handler

**Files:**
- Create: `packages/dashboard/src/metadata/repair.ts`
- Create: `packages/dashboard/tests/metadata/repair.test.ts`
- Modify: `packages/dashboard/src/scheduler/work-loop-scheduler.ts`

**Note:** This task implements spec section 4.4 — the haiku-powered repair triggered by the "Fix" button.

- [ ] **Step 1: Write failing tests**

Create `packages/dashboard/tests/metadata/repair.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildRepairPrompt } from "../../src/metadata/repair.js";

describe("buildRepairPrompt", () => {
  it("includes broken YAML, schema description, and errors", () => {
    const prompt = buildRepairPrompt(
      "---\njobs:\n  bad: {}\n---\n",
      [{ field: "jobs.bad.cadence", message: "Missing required 'cadence' for job 'bad'" }],
      "work-patterns",
    );
    expect(prompt).toContain("bad");
    expect(prompt).toContain("cadence");
    expect(prompt).toContain("work-patterns");
  });

  it("instructs haiku to output only the corrected YAML frontmatter", () => {
    const prompt = buildRepairPrompt("---\njobs: {}\n---\n", [], "work-patterns");
    expect(prompt).toContain("YAML frontmatter");
    expect(prompt).toContain("---");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/dashboard && npx vitest run tests/metadata/repair.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement repair module**

Create `packages/dashboard/src/metadata/repair.ts`:

```typescript
import { readFileSync } from "node:fs";
import type { ValidationError } from "./schemas/work-patterns.js";
import { readFrontmatter, writeFrontmatter } from "./frontmatter.js";
import { validateMetadataFile } from "./validator.js";
import { queryModel } from "../scheduler/query-model.js";

/**
 * Build the prompt for haiku to repair broken YAML frontmatter.
 */
export function buildRepairPrompt(
  rawContent: string,
  errors: ValidationError[],
  schemaName: string,
): string {
  const errorList = errors.map((e) => `- ${e.field}: ${e.message}`).join("\n");
  return `You are a YAML repair assistant. Fix the YAML frontmatter in this markdown file.

Schema: ${schemaName}
Errors found:
${errorList}

Current file content:
\`\`\`
${rawContent}
\`\`\`

Rules:
- Output ONLY the corrected YAML frontmatter block (between --- fences)
- Do not change the markdown body
- For work-patterns schema: each job needs a 'cadence' field (format: "daily:HH:MM" or "weekly:DAYNAME:HH:MM") and optional 'model' field
- Preserve all existing valid data
- If you cannot determine the correct value, use sensible defaults (cadence: "daily:08:00", model: "haiku")

Output the corrected frontmatter:`;
}

/**
 * Attempt to repair a metadata file using haiku.
 * Returns true if repair succeeded, false if it failed.
 * Max one attempt — if the repair output is still invalid, returns false.
 */
export async function repairMetadataFile(
  filePath: string,
  agentDir: string,
  errors: ValidationError[],
  schemaName: string,
): Promise<{ success: boolean; error?: string }> {
  const rawContent = readFileSync(filePath, "utf-8");
  const prompt = buildRepairPrompt(rawContent, errors, schemaName);

  try {
    const response = await queryModel(prompt, "haiku");

    // Extract YAML from response (between --- fences)
    const yamlMatch = response.match(/---\n([\s\S]*?)\n---/);
    if (!yamlMatch) {
      return { success: false, error: "Haiku response did not contain valid --- fenced YAML" };
    }

    // Build the repaired file content
    const { body } = readFrontmatter(filePath);
    const { parse } = await import("yaml");
    const repairedData = parse(yamlMatch[1]);

    if (!repairedData || typeof repairedData !== "object") {
      return { success: false, error: "Haiku produced unparseable YAML" };
    }

    // Validate the repair BEFORE writing
    writeFrontmatter(filePath, repairedData, body);
    const validation = validateMetadataFile(filePath, agentDir);

    if (!validation.valid) {
      // Repair failed — restore original content
      const { writeFileSync } = await import("node:fs");
      writeFileSync(filePath, rawContent, "utf-8");
      return {
        success: false,
        error: `Repair produced invalid YAML: ${validation.errors.map((e) => e.message).join("; ")}`,
      };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `Repair failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
```

- [ ] **Step 4: Wire repair into notification respond handler**

In `packages/dashboard/src/scheduler/work-loop-scheduler.ts`, add a method that handles the "Fix" response:

```typescript
import { repairMetadataFile } from "../metadata/repair.js";

// Add to WorkLoopScheduler class:

/**
 * Handle "Fix" response from a validation notification.
 * Triggers haiku repair and reloads patterns on success.
 */
async handleValidationFix(filePath: string, errors: ValidationError[]): Promise<{ success: boolean; error?: string }> {
  const result = await repairMetadataFile(filePath, this.agentDir, errors, "work-patterns");

  if (result.success) {
    await this.reloadPatterns();
    return { success: true };
  }

  // Repair failed — create a notify (no Fix button) to prevent loops
  if (this.notificationService) {
    this.notificationService.notify({
      message: `Auto-repair failed for ${filePath}: ${result.error}. Manual edit needed.`,
      importance: "warning",
    });
  }

  return result;
}
```

Import the `ValidationError` type at top:
```typescript
import type { ValidationError } from "../metadata/schemas/work-patterns.js";
```

- [ ] **Step 5: Run tests**

Run: `cd packages/dashboard && npx vitest run tests/metadata/repair.test.ts tests/work-loop-scheduler.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/metadata/repair.ts packages/dashboard/tests/metadata/repair.test.ts packages/dashboard/src/scheduler/work-loop-scheduler.ts
git commit -m "feat: add haiku-powered metadata repair with single-attempt guard"
```

---

### Task 10: Morning Brief Pending Notifications & Frontend Fix

**Files:**
- Modify: `packages/dashboard/src/scheduler/work-loop-scheduler.ts`
- Modify: `packages/dashboard/public/js/app.js`

- [ ] **Step 1: Add pending notifications to morning prep context**

In `handleMorningPrep()`, after the stale properties section, query `this.notificationService?.getPending()` and format as a "Pending Notifications" section in the prompt context.

- [ ] **Step 2: Fix frontend stale data bug**

In `packages/dashboard/public/js/app.js`, in `loadWorkLoopJobDetail()`, set `this.workLoopJobDetail = null` on non-OK response and in catch block.

- [ ] **Step 3: Run full test suite**

Run: `cd packages/dashboard && npx vitest run`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/scheduler/work-loop-scheduler.ts packages/dashboard/public/js/app.js
git commit -m "feat: add pending notifications to morning brief, fix stale job detail bug"
```

---

### Task 11: Documentation & Standards

**Files:**
- Create: `docs/design/normalized-markdown-metadata.md`
- Modify: `CLAUDE.md`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Write the normalized metadata design doc**

Create `docs/design/normalized-markdown-metadata.md` documenting the standard: format, how to add schemas, current schemas, anti-patterns.

- [ ] **Step 2: Add reference to CLAUDE.md**

Add row to the References table:
```markdown
| Normalized metadata | `docs/design/normalized-markdown-metadata.md` | YAML frontmatter standard for markdown files |
```

- [ ] **Step 3: Update ROADMAP.md with plan link**

Update S2.5 row to include plan link.

- [ ] **Step 4: Commit**

```bash
git add docs/design/normalized-markdown-metadata.md CLAUDE.md docs/ROADMAP.md
git commit -m "docs: add normalized markdown metadata standard, update references"
```

---

### Task 12: Restart Dashboard Service & Verify

- [ ] **Step 1: Run full test suite**

Run: `cd packages/dashboard && npx vitest run`
Expected: All PASS

- [ ] **Step 2: Restart dashboard service**

Run: `systemctl --user restart nina-dashboard.service`

- [ ] **Step 3: Verify calendar UI shows Morning Prep correctly**

- [ ] **Step 4: Verify `/api/work-loop/status` includes timezone**

- [ ] **Step 5: Verify `/api/settings/work-patterns` returns jobs**
