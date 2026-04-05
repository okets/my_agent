# Decisions — M9.1-S2: Todo Templates + Validation

> Sprint decisions logged during autonomous execution (trip mode).

## D1: Fixed pre-existing target_path round-trip bug

**Context:** `frontmatterToManifest()` in automation-manager.ts didn't include `target_path` when parsing from disk. This means automations loaded from disk after restart lost their `target_path` field. Found while adding `todos`/`job_type` fields.

**Decision:** Added `target_path`, `todos`, and `job_type` to both `manifestToFrontmatter()` and `frontmatterToManifest()`.

## D2: detectJobType resolves target_path relative to agentDir

**Context:** The plan suggested resolving `target_path` relative to `path.resolve(agentDir, '..', tp)` but `target_path` values like `.my_agent/capabilities/stt-deepgram` are already relative to the agent dir root. Used `path.resolve(agentDir, tp)` instead (simpler, correct).

**Decision:** `detectJobType` checks `path.resolve(this.config.agentDir, tp)` for existing `CAPABILITY.md`.

