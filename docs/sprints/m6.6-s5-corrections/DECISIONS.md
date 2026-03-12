# M6.6-S5: Corrections — Decisions Log

| # | Severity | Decision | Rationale | Risk |
|---|----------|----------|-----------|------|
| 1 | Major | Fix Phase 3 E2E tests: add SystemPromptBuilder integration test asserting extracted facts appear in assembled prompt | Phase 3 tests currently re-read knowledge files instead of validating the last mile. False confidence signal if wiring breaks. | Low — additive test |
| 2 | ~~Minor~~ | ~~Fix Test 17~~ — **DROPPED**: M6.9-S1 replaces extraction pipeline. Equivalent test (extraction failure resilience) required in M6.9-S1. | Superseded by M6.9 | N/A |
| 3 | ~~Theoretical~~ | ~~Add singleton mutex~~ — **DROPPED**: M6.9-S1 replaces `persistFacts`. Equivalent test (concurrent write safety) required in M6.9-S1. | Superseded by M6.9 | N/A |
| 4 | Major | Fix failing SystemPromptBuilder test: update assertion to match current 6-layer prompt shape (temporal + metadata layers) | Deterministic failure — test expects `[Current State]` first but builder now prepends `[Temporal Context]` and `[Inbound Metadata]`. Blocks green suite. | None |
| 5 | Minor | Audit 6 skipped tests (4 work-loop-scheduler, 2 conversation-lifecycle): confirm intentional vs accidental, unskip or document | Skipped tests are blind spots. Need to know if they're intentional (API-dependent) or forgotten. | Low |
| 6 | Major | Refactor 14 haiku-jobs tests to call through my_agent endpoint instead of direct Haiku API | Tests currently require live API key → permanently skipped → zero coverage. Route through my_agent endpoint so they run in CI without external dependencies. | Medium — requires endpoint to exist or be created |
