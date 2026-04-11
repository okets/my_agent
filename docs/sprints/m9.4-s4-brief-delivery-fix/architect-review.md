# Architect Review — M9.4-S4 Brief Delivery Pipeline Fix

**Reviewer:** CTO architect session
**Date:** 2026-04-11
**Commits:** `cacba19..1e5a13a` (4 commits)

---

## Verdict: PASS with corrections

All 9 plan tasks are implemented. The core fix is sound — `.slice(0, 500)` is gone from all 4 sites, worker artifacts are read from disk, both delivery paths use verbatim framing, the reporter is pure assembly. Four corrections required before closing.

---

## Corrections Required

### C1: Validator must strip frontmatter before checking body length

**File:** `packages/dashboard/src/automations/todo-validators.ts:105-121`
**Severity:** Must fix

The `deliverable_written` validator checks raw file length (`content.length < 50`). A file with long YAML frontmatter and a trivial body passes validation:

```yaml
---
change_type: configure
test_result: pass
summary: Updated the configuration settings for the deployment
status: complete
---
Done.
```

This is 120+ chars raw but only 5 chars of body. It defeats the purpose — the deliverable todo exists to ensure substantive content reaches the user.

**Fix:** Strip frontmatter before checking length. The `readFrontmatter()` import already exists in the file (used by `change_type_set` on line 128). Use it:

```typescript
deliverable_written: (runDir) => {
    const delPath = path.join(runDir, "deliverable.md");
    if (!fs.existsSync(delPath)) {
      return {
        pass: false,
        message: "deliverable.md not found — write your deliverable before marking this done",
      };
    }
    const { content } = readFrontmatter<Record<string, unknown>>(delPath);
    const body = content.trim();
    if (body.length < 50) {
      return {
        pass: false,
        message:
          "deliverable.md body is too short (< 50 chars after frontmatter). Include a substantive summary of your work — key findings, outcomes, and recommendations.",
      };
    }
    return { pass: true };
  },
```

**Test:** Add a case to `deliverable-validator.test.ts` that writes a file with long frontmatter + short body and asserts it fails.

### C2: Sync resolver needs a DB display limit

**File:** `packages/dashboard/src/automations/summary-resolver.ts:53-58`
**Severity:** Must fix

The sync `resolveJobSummary` returns content without any size limit. It's used in 3 DB summary sites (`automation-executor.ts:163, 486, 674`). If a `deliverable.md` is 15K chars, that goes verbatim into the `job.summary` SQLite column.

This column is consumed by:
- Dashboard job cards (rendered in UI)
- StatePublisher (broadcast to all WebSocket clients on every state tick)
- Debrief-reporter fallback (when no deliverable file exists)

Unbounded summaries bloat state broadcasts and break card layouts.

**Fix:** Add a `maxLength` parameter to the sync path with a sensible default for DB storage:

```typescript
export function resolveJobSummary(
  runDir: string | undefined | null,
  fallbackWork: string,
  maxLength = 2000,
): string {
  const { text } = resolve(runDir, fallbackWork);
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "\n\n[Full results in job workspace]";
}
```

The async path (notification delivery) keeps no limit — it has the Haiku condense fallback. The sync path truncates gracefully for display contexts only. 2000 chars is enough for meaningful dashboard summaries.

**Test:** Update the "returns full content for large deliverables" test case to verify the 2000-char default.

### C3: DECISIONS.md contradicts implementation on limit value

**File:** `docs/sprints/m9.4-s4-brief-delivery-fix/DECISIONS.md` (D3)
**Severity:** Must fix

D3 says "The plan specified 4000 chars" but the implementation uses `MAX_LENGTH = 10_000`. The decisions doc should reflect the actual shipped value and rationale.

**Fix:** Update D3 to:

```markdown
## D3: 10,000-char async threshold (up from plan's 4,000)

The async resolver uses a 10,000-char threshold before triggering Haiku condense. The plan specified 4,000 but this was raised during implementation because the Haiku condense step preserves all information (unlike hard truncation). A higher threshold means fewer Haiku calls for moderately-sized deliverables while still catching unbounded raw streams.

The sync resolver (DB path) uses a separate 2,000-char display limit since its consumers are UI job cards and state broadcasts.
```

### C4: Extract shared frontmatter-stripping utility

**File:** `packages/dashboard/src/automations/summary-resolver.ts:4` and `packages/dashboard/src/scheduler/jobs/handler-registry.ts:304,315`
**Severity:** Must fix

The same frontmatter regex `^---\n[\s\S]*?\n---\n?` appears in both files. The `readFrontmatter()` utility in `metadata/frontmatter.ts` already does this but returns a parsed object — what these sites need is just the stripped body text.

**Fix:** Add a `stripFrontmatter` export to `packages/dashboard/src/automations/summary-resolver.ts` (it's already doing this) and import it in `handler-registry.ts`:

In `summary-resolver.ts`, export the strip function:

```typescript
/** Strip YAML frontmatter from markdown content, returning body text only. */
export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_RE, "").trim();
}
```

In `handler-registry.ts`, replace the two inline regex calls (lines 304 and 315) with:

```typescript
import { stripFrontmatter } from "../automations/summary-resolver.js";

// line 304 area:
content = stripFrontmatter(await readFile(job.deliverablePath, "utf-8"));

// line 315 area:
content = stripFrontmatter(await readFile(reportPath, "utf-8"));
```

Also update `readAndStrip` in `summary-resolver.ts` to use the shared function internally.

---

## Confirmed (no action needed)

| Area | Status | Notes |
|------|--------|-------|
| `.slice(0, 500)` removal | PASS | All 4 sites replaced — zero remaining in production code |
| Notification path uses disk artifacts | PASS | `resolveJobSummaryAsync` wired into processor |
| DB path uses disk artifacts | PASS | `resolveJobSummary` wired into all 3 executor sites |
| `formatNotification()` verbatim framing | PASS | `job_completed` uses "Forward verbatim" instruction |
| Pending briefing framing | PASS | System prompt builder updated to match |
| Reporter is pure assembler | PASS | No Haiku call, collects deliverables, writes digest + full |
| Zero-worker case | PASS | Returns "No background work to report" |
| Deliverable todo in templates | PASS | Both `generic` and `research` updated with `deliverable_written` |
| Haiku DI pattern | PASS | Better than plan's direct import — testable |
| Bug doc updated | PASS | `status: fixed`, `fixed_in: M9.4-S4` |
| Debug logging | PASS | Appropriate for pipeline observability |

## Deviations accepted

- **D1 (frontmatter regex vs readFrontmatter):** Acceptable — C4 addresses the duplication concern.
- **D2 (10K vs 4K threshold):** Acceptable — Haiku condense preserves information, higher threshold reduces unnecessary calls. C3 updates the docs.
- **D5 (queryModel DI):** Improvement over plan — makes async resolver unit-testable without module mocking.
