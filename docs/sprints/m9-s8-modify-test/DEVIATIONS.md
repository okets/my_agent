# M9-S8 Deviations Log

## DEV1: Sprint became infrastructure debugging instead of E2E validation
**Type:** Scope change
**Original plan:** 17 tasks — verify modify flow, Hebrew voice E2E, paper trail chain.
**Actual:** 5 infrastructure fixes + 3 paper trail attempts + partial Hebrew test.
**Reason:** Paper trail didn't fire (3 root causes found and fixed: empty instructions from findById, prompt confusion from S7 additions, missing regex fallback). Each fix required a clean rebuild cycle.
**Impact:** Paper trail creation proven working. Modify flow and Hebrew E2E incomplete.

## DEV2: Builder prompt additions from S7 reverted
**Type:** Rollback
**Original plan:** Builder writes deliverable with YAML frontmatter containing target_path, change_type, etc.
**Actual:** Frontmatter section removed from builder prompt entirely. Executor uses regex extraction instead.
**Reason:** The 43 added lines included a second YAML frontmatter example that confused the builder into omitting `name` and `interface` from CAPABILITY.md. Scanner silently skipped the capabilities. Reverting restored S6-quality builds.

## DEV3: Hebrew modify done inline, not via tracked job
**Type:** Process failure
**Original plan:** Nina detects existing capability, reads DECISIONS.md, classifies change type, spawns builder with modify spec.
**Actual:** Nina edited config.yaml and transcribe.sh directly in conversation. No tracked job, no paper trail for the modification, no session resumption.
**Reason:** Nina defaulted to inline editing instead of the modify flow. The brainstorming skill's modify detection (Step 1) didn't fire. This is the same "inline fallback" issue from S6 iteration 2.

## DEV4: Multiple capability deletion and rebuild cycles
**Type:** Process
**Original plan:** One build, one modify.
**Actual:** 5 full rebuild cycles (delete capabilities, clear jobs, restart, ask Nina).
**Reason:** Each iteration exposed a different infrastructure issue. Following the S6 iteration rule: "fix the process, not the instance."
