# M9.2-S7 Decisions

## D1: Merged richer instance content into framework skill (Medium)

**Context:** `.my_agent/.claude/skills/conversation-role.md` had evolved beyond what was in `.my_agent/brain/conversation-role.md` — it included `create_automation` examples, `check_job_status`, `resume_job`, `job_type`, `target_path` guidance.

**Decision:** Merged the additional operational content from the `.claude/skills/` copy into the framework `skills/conversation-role.md` before deleting the instance copy. These are framework concerns (how to use `create_automation`), not instance-specific.

**Why:** The plan said to take content from `brain/conversation-role.md`, but the `.claude/skills/` version was more complete and reflected how the system actually works. Losing that content would have been a regression.

## D2: Deferred instance file deletion until tests pass

**Context:** CTO instructed "backup for reference, delete once it's working."

**Decision:** Backed up all instance files to `docs/sprints/m9.2-s7-framework-instance-split/backups/` first. Deleted after all tests passed (core: 259 passed, dashboard: 1074 passed).
