# M9-S7: Universal Paper Trail

> **Milestone:** M9 — Capability System
> **Design spec:** [paper-trail.md](../../design/paper-trail.md)
> **Status:** Planned
> **Date:** 2026-04-04

---

## Goal

Every job that creates or modifies an artifact leaves a traceable paper trail (DECISIONS.md at the artifact, linked back to full job artifacts). Session resumption enabled for recent modifications.

---

## Tasks

### Builder Deliverable Template

| # | Task | Files | Details |
|---|------|-------|---------|
| 1 | Add deliverable frontmatter requirement to builder prompt | `packages/core/src/agents/definitions.ts` | Builder deliverables must start with YAML frontmatter: `target_path`, `change_type` (create/configure/upgrade/fix/replace), `provider`, `test_result`, `test_duration_ms`, `files_changed`. Framework reads this to write DECISIONS.md |

### Post-Completion Hook

| # | Task | Files | Details |
|---|------|-------|---------|
| 2 | Parse deliverable frontmatter in executor | `packages/dashboard/src/automations/automation-executor.ts` | After job completes, read deliverable, parse YAML frontmatter via `readFrontmatter()`. If `target_path` exists, proceed to paper trail. If absent, skip (non-artifact job) |
| 3 | Append structured entry to DECISIONS.md | `packages/dashboard/src/automations/automation-executor.ts` | Create `{target_path}/DECISIONS.md` if it doesn't exist. Append entry with: date, change_type, provider, test result, job link (relative path to `.runs/`). ~30 lines |

### Session Resumption

| # | Task | Files | Details |
|---|------|-------|---------|
| 4 | Support `resume_from_job` in executor | `packages/dashboard/src/automations/automation-executor.ts` | If automation instructions contain `resume_from_job: <job-id>`, look up `sdk_session_id` from jobs database. Pass as `resume` option to `createBrainQuery()`. On failure (expired), fall back to fresh session. ~20 lines |

### Brainstorming Skill — Modify Flow

| # | Task | Files | Details |
|---|------|-------|---------|
| 5 | Add modify detection to brainstorming skill | `.my_agent/.claude/skills/capability-brainstorming/SKILL.md` | Step 1 becomes: check if capability already exists for this type. If yes → read DECISIONS.md → determine change type → write context entry → spawn builder with modify spec + `resume_from_job` |
| 6 | Add modify spec format to builder prompt | `packages/core/src/agents/definitions.ts` | Builder accepts modify specs: target path, change type, what to change, what to preserve. On modify: read DECISIONS.md for history before making changes |
| 7 | Update brainstorming skill references | `.my_agent/.claude/skills/capability-brainstorming/references/` | Add modify flow reference: change types (configure/upgrade/fix/replace), DECISIONS.md reading, resume_from_job convention |

### Migration — Existing Capabilities

| # | Task | Details |
|---|------|---------|
| 8 | Retroactively create DECISIONS.md for stt-deepgram | `.my_agent/capabilities/stt-deepgram/DECISIONS.md` | Write "Initial build" entry from existing job status report. Link to original job in `.runs/` |
| 9 | Retroactively create DECISIONS.md for tts-edge | `.my_agent/capabilities/tts-edge/DECISIONS.md` | Same as above |

---

## Verification

- [ ] Builder produces deliverable with YAML frontmatter (target_path, change_type, etc.)
- [ ] Executor reads frontmatter, appends to DECISIONS.md at target path
- [ ] Non-artifact jobs (no target_path) skip paper trail — no errors
- [ ] DECISIONS.md entry has correct date, change type, test result, job link
- [ ] Job link is valid relative path to `.runs/` artifacts
- [ ] `resume_from_job` looks up session ID, attempts resume
- [ ] Resume failure falls back to fresh session cleanly
- [ ] Brainstorming skill detects existing capability, reads DECISIONS.md
- [ ] Existing capabilities have retroactive DECISIONS.md
- [ ] TypeScript compiles, existing tests pass

---

## Traceability Matrix

| Design Spec Section | Requirement | Task(s) |
|---------------------|-------------|---------|
| Principles §1 | One file (DECISIONS.md) | 3, 8, 9 |
| Principles §2 | Three writers: brainstorming, builder, framework | 1 (builder), 3 (framework), 5 (brainstorming) |
| Principles §3 | Links not copies, artifacts stay in .runs/ | 3 |
| Principles §4 | Resume when possible, read when not | 4 |
| Principles §5 | Universal pattern | 2 (discriminator via target_path) |
| Builder Deliverable Frontmatter | target_path, change_type, provider, test fields | 1 |
| Post-Completion Hook | Parse frontmatter, write DECISIONS.md | 2, 3 |
| Session Resumption | resume_from_job, try resume, fall back | 4 |
| Modify Flow | Read DECISIONS.md, determine change type, spawn builder | 5, 6, 7 |
| Reviewer Finding 1 | Target path via deliverable frontmatter | 1, 2 |
| Reviewer Finding 2 | Structured metadata from frontmatter | 1, 2 |
| Reviewer Finding 4 | Hybrid: brainstorming + builder + framework | 1, 3, 5 |
| Reviewer Finding 10 | Brainstorming writes context before builder | 5 |

---

## Deliverables

- Builder prompt with deliverable frontmatter template
- Executor post-completion hook (parse frontmatter → write DECISIONS.md)
- Executor resume support (resume_from_job → session lookup → fallback)
- Brainstorming skill modify flow (detect existing, read history, write context)
- Retroactive DECISIONS.md for existing capabilities
