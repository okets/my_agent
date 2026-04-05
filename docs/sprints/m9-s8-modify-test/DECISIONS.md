# M9-S8 Decisions Log

## D1: Revert builder prompt additions from S7
**Severity:** Major (CTO decision)
**Decision:** Removed 43 lines added to builder prompt in S7 (deliverable frontmatter template + modify specs section). Builder reverts to S6-era prompt.
**Reason:** The two YAML frontmatter examples (CAPABILITY.md format + deliverable format) confused the builder. It started omitting `name` and `interface` from CAPABILITY.md, causing the scanner to silently skip capabilities. Reverting restored S6-quality builds.

## D2: Regex extraction as primary target_path source
**Severity:** Major
**Decision:** Executor extracts `target_path` from automation instructions via regex (`/.my_agent/capabilities/[a-z0-9_-]+/`) as the primary reliable source, with manifest field and frontmatter as secondary sources.
**Reason:** Three approaches failed: (1) builder deliverable frontmatter — builder ignores it, (2) manifest schema field — brainstorming skill doesn't pass it, (3) updated brainstorming skill instruction — still doesn't pass it. The instructions text always contains the capability path in the file layout section. Regex extraction is code-guaranteed.

## D3: findById reads from disk instead of DB
**Severity:** Major (bug fix)
**Decision:** `AutomationManager.findById()` changed from `list().find()` (DB, empty instructions) to `read()` (disk, full instructions).
**Reason:** The DB-backed `list()` returns `instructions: ""` because instructions aren't stored in SQLite. The executor and paper trail regex both depend on instructions being present. This was the root cause of the paper trail not firing for the first 3 attempts.

## D4: target_path added to AutomationManifest schema
**Severity:** Minor
**Decision:** Added optional `target_path?: string` to `AutomationManifest` and `CreateAutomationInput`. Wired through `create_automation` MCP tool and `automation-manager.create()`.
**Reason:** Provides a code-level path for artifact-producing jobs, even though the regex fallback currently handles it. The plumbing is in place for when brainstorming compliance improves.

## D5: Adversary agent debate on paper trail architecture
**Severity:** Major (architectural)
**Decision:** Two sources of truth for two domains: JSONL+SQLite for job lifecycle (operational), DECISIONS.md at artifact for history (institutional). Three writers with two guarantee tiers: executor (guaranteed), brainstorming skill (best-effort), builder (optional enrichment).
**Reason:** Formal debate between two Opus agents investigating the codebase. Both converged on this architecture. Documented in `docs/design/paper-trail-v2-guaranteed.md`.

## D6: Keep S7+S8 code despite incomplete E2E validation
**Severity:** Major (CTO decision)
**Decision:** Paper trail infrastructure code is kept. Modify flow E2E test is incomplete due to agentic flow gaps (notifications, inline fallback, restart resume).
**Reason:** The code changes are small (~30 lines executor + 1 line findById + schema field), don't break anything, and paper trail creation was proven working 3 times. The failures are pre-existing agentic flow issues, not regressions.
