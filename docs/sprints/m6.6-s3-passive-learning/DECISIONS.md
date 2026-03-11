# M6.6-S3: Passive Learning -- Decisions Log

| # | Severity | Decision | Rationale | Risk |
|---|----------|----------|-----------|------|
| 1 | Low | Combined Tasks 5+6 into single commit | Both modify same files (work-loop-scheduler.ts, abbreviation.ts, index.ts) with no independent test boundary | None |
| 2 | Low | Used Promise.allSettled not Promise.all for parallel extraction | Extraction failure must not block abbreviation (non-fatal design) | None |
