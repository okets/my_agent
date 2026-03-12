# Sprint M6.9-S1 Review: Data Model + Pipeline

> **Status:** Complete
> **Date:** 2026-03-12
> **Branch:** `sprint/m6.9-s1-data-model-pipeline` (16 commits)

## Goal

Replace the flat `[FACT]/[PERSON]/[PREFERENCE]` extraction pipeline with a classified knowledge lifecycle: permanent vs temporal routing, YAML properties, summary rollup chain, and `queryModel()` abstraction.

## Completed Tasks

| # | Task | Files | Status |
|---|------|-------|--------|
| 1 | Recursive `loadNotebookReference()` | `core/src/prompt.ts`, `core/tests/prompt-recursive.test.ts` | Done |
| 2 | `loadProperties()` YAML injection | `core/src/prompt.ts`, `core/src/lib.ts`, `core/tests/load-properties.test.ts` | Done |
| 3 | SyncService `excludePatterns` | `core/src/memory/sync-service.ts`, `core/tests/sync-service-exclusion.test.ts`, `dashboard/src/index.ts` | Done |
| 4 | `queryModel()` abstraction | `dashboard/src/scheduler/query-model.ts`, `dashboard/src/scheduler/haiku-query.ts`, `dashboard/tests/query-model.test.ts` | Done |
| 5 | Properties utilities | `dashboard/src/conversations/properties.ts`, `dashboard/tests/properties.test.ts` | Done |
| 6 | Classification parser + router | `dashboard/src/conversations/knowledge-extractor.ts`, `dashboard/tests/knowledge-extractor.test.ts` | Done |
| 7 | Staging area CRUD | `dashboard/src/conversations/knowledge-staging.ts`, `dashboard/tests/knowledge-staging.test.ts` | Done |
| 8 | Wire new extraction pipeline | `dashboard/src/conversations/abbreviation.ts` | Done |
| 9 | Daily summary revision | `dashboard/src/scheduler/jobs/daily-summary.ts`, `dashboard/src/scheduler/work-loop-scheduler.ts` | Done |
| 10 | Weekly summary job | `dashboard/src/scheduler/jobs/weekly-summary.ts`, `dashboard/tests/weekly-summary.test.ts` | Done |
| 11 | Monthly summary job | `dashboard/src/scheduler/jobs/monthly-summary.ts`, `dashboard/tests/monthly-summary.test.ts` | Done |
| 12 | Morning prep revision + scheduler handlers | `dashboard/src/scheduler/jobs/morning-prep.ts`, `dashboard/src/scheduler/work-loop-scheduler.ts` | Done |
| 13 | SystemPromptBuilder `loadProperties` | `dashboard/src/agent/system-prompt-builder.ts` | Done |
| 14 | Preferences directory split | Verified via Task 1 (no code needed) | Done |
| 15 | E2E memory lifecycle test update | `dashboard/tests/e2e/memory-lifecycle.test.ts` | Done |
| 16 | Migration script | `dashboard/scripts/migrate-knowledge.ts` | Done |
| 17 | Docs update | `docs/design.md` | Done |

## Architecture Decisions

- **7 classification categories:** `PERMANENT:user-info`, `PERMANENT:contact`, `PERMANENT:preference:personal/work/communication`, `TEMPORAL`, `PROPERTY:key:confidence`. Replaces the old 3-category `[FACT]/[PERSON]/[PREFERENCE]` format.
- **Staging area over direct persistence:** Permanent facts go to `knowledge/extracted/` staging files for morning brief review (M6.9-S2), instead of being immediately written to knowledge files. Prevents noise accumulation.
- **Summary rollup chain:** Daily -> weekly -> monthly summaries compress temporal context. Replaces indefinite fact accumulation with a natural forgetting curve.
- **YAML properties:** Dynamic metadata (location, timezone, availability) stored in `properties/status.yaml`. Updated in real-time from conversation extraction, injected into system prompt.
- **`queryModel()` with alias resolution:** Model aliases (`haiku`, `sonnet`, `opus`) resolve to latest model IDs internally. `queryHaiku()` becomes a deprecated wrapper.
- **`yaml` package added to dashboard:** Was only a transitive dependency via `@my-agent/core`. Added directly to dashboard's `package.json` for `properties.ts`.

## Verification

- `npx tsc --noEmit` -- clean on both `core` and `dashboard`
- Core tests: 89 passed (6 test files)
- Dashboard tests: 287 passed, 2 intentionally skipped (24 test files)
- Haiku integration tests (`haiku-jobs.test.ts`) pass -- morning-prep and daily-summary endpoints still work
- E2E memory lifecycle fully rewritten for new pipeline, all phases pass

## Success Criteria

From the design spec:
- [x] `loadNotebookReference()` recurses into subdirectories
- [x] `loadProperties()` injects YAML data into system prompt
- [x] SyncService excludes `knowledge/extracted/`
- [x] New classification prompt produces 7 categories
- [x] Permanent facts route to staging, temporal to daily log, properties to YAML
- [x] Staging area CRUD works (write, read, increment, delete)
- [x] Daily/weekly/monthly summary jobs produce output
- [x] Morning prep reads from summary stack
- [x] `queryModel()` supports haiku/sonnet/opus selection
- [x] SystemPromptBuilder includes properties in dynamic block
- [x] Existing knowledge files can be migrated
- [x] All existing tests still pass

## New Files Created

```
packages/core/
  tests/prompt-recursive.test.ts
  tests/load-properties.test.ts
  tests/sync-service-exclusion.test.ts

packages/dashboard/
  src/conversations/knowledge-extractor.ts
  src/conversations/knowledge-staging.ts
  src/conversations/properties.ts
  src/scheduler/query-model.ts
  src/scheduler/jobs/weekly-summary.ts
  src/scheduler/jobs/monthly-summary.ts
  scripts/migrate-knowledge.ts
  tests/knowledge-extractor.test.ts
  tests/knowledge-staging.test.ts
  tests/properties.test.ts
  tests/query-model.test.ts
  tests/weekly-summary.test.ts
  tests/monthly-summary.test.ts
```

## What's Next (M6.9-S2)

- Morning brief approval flow: Nina proposes staged facts, user confirms/rejects
- Staging fact expiry after N unapproved attempts
- Sonnet/opus upgrade for morning brief synthesis
