# Decisions — M7-S8: Debrief Worker Architecture

## D1: No feature branch
**Decision:** Work directly on master.
**Reason:** CTO directive. Tasks 1-2 already committed to master. Sprint is corrections, not speculative features.

## D2: Delete all user automations during validation
**Decision:** Delete `daily-summary` and `test-watcher` user automations entirely. Recreate through natural conversation as validation.
**Reason:** CTO directive. Tests the full creation pipeline end-to-end.
