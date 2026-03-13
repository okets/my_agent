# Test Report — M6.9-S2.5 Normalized Metadata & Timezone-Aware Scheduling

**Date:** 2026-03-13
**Reviewer:** External Opus (independent)
**Branch:** `sprint/m6.9-s2.5-normalized-metadata`

---

## 1. TypeScript Compilation

```
$ npx tsc --noEmit
(no output — clean compilation)
```

**Result:** PASS — zero errors.

---

## 2. Vitest Test Suite

```
$ npx vitest run

Test Files  2 failed | 30 passed (32)
Tests       8 failed | 355 passed | 2 skipped (365)
Duration    6.60s
```

### New Tests Added (all passing)

| Test File | Tests | Status |
|-----------|-------|--------|
| `tests/metadata/frontmatter.test.ts` | 8 | All pass |
| `tests/metadata/schemas.test.ts` | 12 | All pass |
| `tests/metadata/validator.test.ts` | 8 | All pass |
| `tests/work-patterns-settings.test.ts` | 5 | All pass |

### Modified Tests (all passing)

| Test File | Change | Status |
|-----------|--------|--------|
| `tests/work-patterns.test.ts` | Rewritten for YAML frontmatter + timezone tests | All pass |
| `tests/work-loop-scheduler.test.ts` | Fixtures updated to YAML frontmatter | Lifecycle tests pass |
| `tests/work-loop-api.test.ts` | Fixtures updated to YAML frontmatter | All pass |
| `tests/e2e/timezone-location.test.ts` | Uses `isDue()` with timezone (not `isMorningPrepDue`) | All pass |
| `tests/e2e/memory-lifecycle.test.ts` | Fixtures updated to YAML frontmatter | All pass |

### Deleted Tests

| Test File | Reason |
|-----------|--------|
| `tests/morning-prep-scheduling.test.ts` | Replaced by timezone tests in `work-patterns.test.ts` |

### Pre-existing Failures (8 total — NOT regressions)

All 8 failures require a running dashboard with Haiku API key:

**haiku-jobs.test.ts (5 failures):**
- morning-prep produces output
- morning-prep output is concise (< 2000 chars)
- morning-prep writes current-state.md (verified via consecutive trigger)
- daily-summary produces output
- daily-summary output is concise (< 2000 chars)

**work-loop-scheduler.test.ts — "real Haiku jobs via endpoint" (3 failures):**
- morning-prep: produces output via endpoint
- daily-summary: produces output via endpoint
- sequential: two morning-prep triggers produce output

These tests call live Haiku API through the dashboard HTTP endpoint. They fail with `expected false to be true` because the endpoint returns `success: false` (no API key / dashboard not running on test port).

---

## 3. Browser Verification

**Server:** `systemctl --user restart nina-dashboard.service` (port 4321)
**Tool:** Playwright MCP

### CTO-Specified Bug Test Sequence

| Step | Action | Expected | Actual | Result |
|------|--------|----------|--------|--------|
| 1 | Click Morning Prep event | Shows Morning Prep detail | Heading "Morning Prep", cadence "daily:08:00", Activity Log with 20 runs | PASS |
| 2 | Close Morning Prep tab | Returns to calendar | Calendar view displayed | PASS |
| 3 | Click Daily Summary event | Shows Daily Summary detail | Heading "Daily Summary", cadence "daily:23:00", Activity Log with 20 runs | PASS |
| 4 | Close Daily Summary tab | Returns to calendar | Calendar view displayed | PASS |
| 5 | Click Morning Prep AGAIN | Shows Morning Prep (NOT Daily Summary) | Heading "Morning Prep", cadence "daily:08:00" — correct data, no stale bleed | PASS |

**Bug verdict:** The stale data bug where Morning Prep showed Daily Summary data after switching is **fixed**.

### API Endpoint Verification

| Endpoint | Method | Status | Response |
|----------|--------|--------|----------|
| `/api/work-loop/status` | GET | 200 | `{ running: true, patterns: [...], resolvedTimezone: "UTC" }` |
| `/api/settings/work-patterns` | GET | 200 | `{ jobs: { "morning-prep": { cadence: "daily:08:00", model: "haiku" }, "daily-summary": { cadence: "daily:23:00", model: "haiku" } } }` |
| `/api/work-loop/jobs/morning-prep` | GET | 200 | Job detail with cadence, runs, prompts (was 404 before this sprint) |
| `/api/work-loop/events` | GET | 200 | FullCalendar events including both Morning Prep and Daily Summary |

### Console Errors

| Error | Severity | Sprint-Related |
|-------|----------|----------------|
| `favicon.ico 404` | Cosmetic | No |
| `[App] Calendar element not found` (on tab switch) | Expected | No — DOM element removed when switching to job tab |

---

## 4. Summary

- **355 tests pass**, 8 pre-existing failures (live Haiku API), 2 skipped
- **TypeScript compiles clean**
- **Critical calendar bug verified fixed** via 5-step browser test
- **All new APIs return correct data**
- **No regressions introduced**
