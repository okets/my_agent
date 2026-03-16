# M6.8-S3: Seed Skills — Decision Log

| # | Severity | Decision | Rationale | Risk |
|---|----------|----------|-----------|------|
| 1 | Minor | No Frontend Dev on team | Sprint is pure backend (prompt.ts + tests), no UI changes | None |
| 2 | Minor | Backend Dev handles Tasks 1-5 sequentially | T1→T3→T4→T5 is a dependency chain; T2 is small enough to include | None |
| 3 | Minor | Tech Lead prepares T7 (behavioral tests) in parallel | T7 is independent after T3; saves wall-clock time | None |
| 4 | Medium | Rebuild dist/ after prompt.ts changes | Dashboard imports from `dist/lib.js` (compiled), not source TypeScript. Without rebuild, live system doesn't pick up changes. | Missed initially — caught by Level 2 debug API verification |
| 5 | Minor | Use dynamic import for @anthropic-ai/sdk in behavioral tests | SDK not in core's dependencies; static import crashes test suite. Dynamic import with graceful skip. | Tests skip when SDK not installed — acceptable per plan |
