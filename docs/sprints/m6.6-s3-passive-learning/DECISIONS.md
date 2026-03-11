# M6.6-S3: Passive Learning -- Decisions Log

| # | Severity | Decision | Rationale | Risk |
|---|----------|----------|-----------|------|
| 1 | Low | Combined Tasks 5+6 into single commit | Both modify same files (work-loop-scheduler.ts, abbreviation.ts, index.ts) with no independent test boundary | None |
| 2 | Low | Used Promise.allSettled not Promise.all for parallel extraction | Extraction failure must not block abbreviation (non-fatal design) | None |
| 3 | Medium | Fix inactive trigger gap: add onConversationInactive callback in manager.ts | Coverage review found manager.create() demotes but doesn't enqueue extraction. Chat-handler covers web UI, but programmatic callers would miss it. | Low — additive change |
| 4 | Medium | Weekly review conflict resolution stays advisory-only (log, don't auto-apply) | Auto-modifying reference/ files based on Haiku output risks data corruption. Safer to log suggestions as run output. S4 test adjusted to check output text, not file modifications. | Conflicts require manual review until trust in Haiku output is established |
