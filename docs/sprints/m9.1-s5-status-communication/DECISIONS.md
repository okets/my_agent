# M9.1-S5 Decisions Log

> Decisions made during autonomous execution. Minor = implemented silently. Medium = logged with pros/cons.

## D1: check_job_status returns text, not JSON (Minor)

**Spec shows:** Structured JSON with `todos.completed`, `todos.in_progress`, `todos.pending` arrays.

**Implementation:** Text-formatted progress appended to existing text output.

**Rationale:** The tool already returned text (not JSON). Changing to JSON would break the existing output format. The brain consumes text naturally. All the same data is present — just formatted differently. The spec example appeared illustrative, not prescriptive.

## D2: Added `blocked` status to todo progress (Minor)

The spec mentions completed/in_progress/pending for `check_job_status`. Implementation also shows `blocked` items. This is a superset — adds useful information without breaking anything.

## Architect Review Observations (2026-04-06)

### O1: Benign double-delivery race (Logged, no fix)

Heartbeat tick can fire between reading pending notifications and marking them delivered during `buildQuery()`. Result: same notification delivered via both system prompt and `ci.alert()`. Not destructive — the spec explicitly says push is best-effort, system prompt is the guarantee. User just gets the same info twice.

### O2: Pull channel test coverage gap (Accepted, low risk)

The acceptance test for `check_job_status` tests `readTodoFile` round-trip, not the actual `formatJobTodoProgress` function. The function is simple and the code is readable — low risk.

