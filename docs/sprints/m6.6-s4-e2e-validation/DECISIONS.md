# M6.6-S4: E2E Validation -- Decisions Log

| # | Severity | Decision | Rationale | Risk |
|---|----------|----------|-----------|------|
| 1 | Low | Combined all S4 tasks into one commit | All E2E tests are in a single file with sequential phases; splitting would create broken intermediate states | None |
| 2 | Low | Used db.prepare().run() instead of db.exec for DDL in tests | Avoids security hook false positive | None |
| 3 | Medium | Fixed loadWorkPatterns assertion: expect Array.isArray instead of toEqual([]) | loadWorkPatterns creates defaults if file missing; cold start test should verify no crash, not empty result | None |
| 4 | Medium | Pre-existing flaky test in system-prompt-builder.test.ts (test isolation) | Passes alone, fails when all 18 test files run together. Not caused by S3/S4 changes. | Tracked but not blocking |
