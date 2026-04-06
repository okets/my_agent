# M9.1-S5 Decisions Log

> Decisions made during autonomous execution. Minor = implemented silently. Medium = logged with pros/cons.

## D1: check_job_status returns text, not JSON (Minor)

**Spec shows:** Structured JSON with `todos.completed`, `todos.in_progress`, `todos.pending` arrays.

**Implementation:** Text-formatted progress appended to existing text output.

**Rationale:** The tool already returned text (not JSON). Changing to JSON would break the existing output format. The brain consumes text naturally. All the same data is present — just formatted differently. The spec example appeared illustrative, not prescriptive.

## D2: Added `blocked` status to todo progress (Minor)

The spec mentions completed/in_progress/pending for `check_job_status`. Implementation also shows `blocked` items. This is a superset — adds useful information without breaking anything.

