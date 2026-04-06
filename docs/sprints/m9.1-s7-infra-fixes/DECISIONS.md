# M9.1-S7 Decisions Log

## D1: Task 7.2 already fixed — verify only

**Decision:** `findById` already delegates to `read()` which reads from disk. No code change needed — just verification.

**Rationale:** The `read()` method was implemented with disk reads from the start (M7-S3). The bug was in `list()` which returns `instructions: ""` from the DB index. `findById` was later changed to use `read()` instead of a DB query, fixing the issue before S7 was planned.

**Impact:** Saves time, reduces diff. Document as pre-fixed in review artifacts.
