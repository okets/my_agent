# M7-S2 Tool Spaces -- Test Report

**Date:** 2026-03-23
**Reviewer:** External Opus (independent)

## Automated Tests

### Core Package

```
Test Files  21 passed | 1 skipped (22)
Tests       217 passed | 7 skipped (224)
TypeScript  compiles clean (0 errors)
```

**S2-specific test files:**
- `tests/spaces/types.test.ts` -- 6 tests: `isToolSpace()` predicate (all permutations of runtime/entry/io)
- `tests/spaces/space-sync-service.test.ts` -- 7 tests: SPACE.md parsing, tool field sync (io, maintenance, entry)

### Dashboard Package

```
Test Files  78 passed (78)
Tests       732 passed | 2 skipped (734)
TypeScript  compiles clean (0 errors)
```

**S2-specific test files:**
- `tests/spaces/decisions.test.ts` -- 6 tests: template creation, idempotent ensure, empty read, append, chronological order, ISO timestamps
- `tests/spaces/tool-invoker.test.ts` -- 12 tests: `buildToolCommand()` for uv/node/bash, missing runtime/entry errors, unsupported runtime; `classifyToolOutput()` for exit code, empty stdout, invalid JSON, valid JSON, file output, no io contract
- `tests/spaces/repair-context.test.ts` -- 6 tests: fix/alert/replace policies, missing DECISIONS.md, maintenance rules extraction, undefined maintenance default
- `tests/spaces/tool-lifecycle.test.ts` -- 1 integration test (9 steps): create space, sync to DB, build command, execute, classify output, simulate failure, build repair context, append decisions, list by tag
- `tests/mcp/space-tools-server.test.ts` -- 11 tests (4 new for S2): tag filtering for tool discovery, runtime filtering, io/maintenance fields returned
- `tests/tasks/working-nina-prompt.test.ts` -- 11 tests (3 new for S2): toolCreationGuide inclusion/exclusion, spaceContexts injection

## Browser Verification

### Setup

- Created `test-scraper` space with SPACE.md (runtime: bash, entry: src/scrape.sh, io contract, maintenance: fix) and DECISIONS.md
- Dashboard restarted for cache busting
- Verified via API: `GET /api/spaces/test-scraper` returns correct manifest

### Desktop (1280x800)

| Check | Result | Notes |
|-------|--------|-------|
| Dashboard loads | PASS | No new console errors |
| Spaces widget shows test-scraper | PASS | With "tool" and "scraper" tags |
| Space detail tab opens | PASS | File tree + property view |
| SPACE.md property view: I/O Contract | PASS | Input: url/string (blue badge), Output: results/stdout (green badge) |
| SPACE.md property view: Maintenance | PASS | fix/replace/alert pills, "fix" active (violet) |
| DECISIONS.md: Decision History header | PASS | Amber clock icon + "Decision History" text |
| DECISIONS.md: Rendered markdown | PASS | Headings, paragraphs, separator all rendered |

Screenshot: `desktop-space-detail.png`

### Mobile (375x812)

| Check | Result | Notes |
|-------|--------|-------|
| Dashboard loads | PASS | No console errors |
| Space detail panel renders | PASS | File tree and property view visible |
| I/O Contract section | PASS | Badges visible, sections stack |
| Maintenance pills | PASS | fix/replace/alert rendered |
| DECISIONS.md in tree | PASS | "history" badge visible |
| No horizontal overflow | PASS | Content stacks vertically |

Screenshot: `mobile-space-detail.png`

### API Verification

```bash
$ curl http://localhost:4321/api/spaces/test-scraper | jq '.manifest.io, .manifest.maintenance'
{
  "input": { "url": "string" },
  "output": { "results": "stdout" }
}
{
  "on_failure": "fix",
  "log": "DECISIONS.md"
}
```

## Cleanup

Test space `test-scraper` removed after verification.

## Summary

All 41 S2-specific tests pass. Browser verification confirms UI changes render correctly on both desktop and mobile. API returns tool-specific fields. No regressions detected in the full test suites (217 core + 732 dashboard tests).
