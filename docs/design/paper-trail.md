# Universal Paper Trail — Design Spec

> **Status:** Approved
> **Created:** 2026-04-04
> **Scope:** Every agent job that creates or modifies an artifact leaves a traceable, resumable paper trail
> **Milestone:** M9-S7 (implementation), M9-S8 (validation)

---

## Problem

When Nina creates a capability, the build artifacts (deliverable, status report) live in `.my_agent/automations/.runs/`, disconnected from the capability folder. When she later needs to modify the capability (e.g., "add Hebrew support"), she has no colocated history — no record of what was decided, what was tried, or why. The same gap applies to any artifact the agent builds: spaces, automations, future transports.

Additionally, the builder's SDK session may still be alive shortly after creation. Resuming that session gives the builder full context — richer than any summary. But sessions expire, so we need a durable fallback.

## Principles

1. **One file, not two.** `DECISIONS.md` at the artifact captures both *what* changed and *why*. No separate CHANGELOG.
2. **Three writers, clear boundaries.** Brainstorming writes strategic context, builder writes implementation notes, framework writes guaranteed structured metadata.
3. **Links, not copies.** Job artifacts stay in `.runs/`. DECISIONS.md entries link back. Three levels of detail: summary → deliverable → status report.
4. **Resume when possible, read when not.** Try session resumption for recent modifications. Fall back to DECISIONS.md as durable context.
5. **Universal pattern.** Any persistent artifact folder gets DECISIONS.md when the agent modifies it. Capabilities first, spaces and future artifacts follow the same convention.

---

## DECISIONS.md Format

Append-only, most recent first. Each entry has a structured header (written by framework) and optional narrative (written by brainstorming skill or builder).

```markdown
# Decisions

## 2026-04-04 — Add multilingual support
- **Change type:** configure
- **What:** Changed `language: en` to `language: multi` in config.yaml
- **Why:** User requested Hebrew support. Deepgram Nova-2 supports auto language detection
- **Test:** healthy (1.3s)
- **Job:** [modify-stt-deepgram/job-a1b2c3d4](../../automations/.runs/modify-stt-deepgram/job-a1b2c3d4/)

## 2026-04-04 — Initial build
- **Change type:** create
- **Provider:** Deepgram Nova-2 (cloud REST API)
- **Why:** User prefers cloud, has existing Deepgram account, lowest latency in evaluation
- **Alternatives considered:** faster-whisper (local, too slow on this VPS), Groq Whisper (fast but less accurate)
- **Template:** audio-to-text v1
- **Test:** healthy (1.4s)
- **Job:** [build-deepgram-stt/job-73438260](../../automations/.runs/build-deepgram-stt/job-73438260/)
```

---

## Who Writes What

### 1. Brainstorming Skill — Strategic Decisions (before builder spawns)

The brainstorming skill writes the initial DECISIONS.md entry when creating a new capability, or appends context when modifying. It has the richest user context: what the user asked for, what alternatives were discussed, why this approach was chosen.

**Creates the file** for new capabilities:
```markdown
# Decisions

## 2026-04-04 — Initial build
- **Change type:** create
- **Provider:** Deepgram Nova-2 (cloud REST API)
- **Why:** User prefers cloud, has existing Deepgram account
- **Alternatives considered:** faster-whisper (local, too slow on this VPS)
- **Template:** audio-to-text v1
```

**Appends context** for modifications:
```markdown
## 2026-04-04 — Add multilingual support
- **Change type:** configure
- **Why:** User requested Hebrew support
```

### 2. Builder Agent — Implementation Notes (during build)

The builder may append implementation details to the current entry: workarounds needed, dependencies installed, errors encountered and resolved. This is optional — simple builds may not need it.

### 3. Framework (Executor) — Structured Metadata (after job completes)

The automation executor appends guaranteed structured fields to the most recent entry after the job completes:

- **Test result:** healthy/degraded/untested + latency
- **Job link:** relative path to `.runs/` artifacts

This is deterministic — the executor reads the builder's deliverable frontmatter (see below) and writes the metadata. The paper trail is guaranteed even if the builder forgets to write notes.

---

## Builder Deliverable Frontmatter

For the framework to write structured metadata, the builder's deliverable must include parseable frontmatter:

```yaml
---
target_path: .my_agent/capabilities/stt-deepgram
change_type: create
provider: Deepgram Nova-2
test_result: healthy
test_duration_ms: 1400
files_changed:
  - CAPABILITY.md
  - scripts/transcribe.sh
  - config.yaml
---

The Deepgram STT capability is built and ready...
```

The executor reads `target_path` to know WHERE to write DECISIONS.md. It reads the other fields to construct the structured entry. No schema changes to `AutomationManifest` or `Job` needed — the deliverable frontmatter is the contract.

---

## Session Resumption

### Flow

```
User: "Add Hebrew support to voice recognition"
  → Brainstorming skill reads DECISIONS.md
  → Finds last job link: build-deepgram-stt/job-73438260
  → Passes resume_from_job in the modify automation spec
  → Executor looks up sdk_session_id from job-73438260 in database
  → Tries to resume that session
    → Success: builder has full original context + modify instruction
    → Failure (expired): fresh session, builder reads DECISIONS.md + status-report.md
```

### What Changes

| Component | Change |
|-----------|--------|
| Brainstorming skill | Pass `resume_from_job: <job-id>` in modify automation specs |
| Executor | On modify jobs with `resume_from_job`, look up session ID, try resume, fall back to fresh |
| Builder prompt | No change — resumed session has context; fresh session reads DECISIONS.md |
| DECISIONS.md | No change — job link provides the lookup path to session ID |

### When It Works

| Scenario | Resume? | Fallback |
|----------|---------|----------|
| Modify within minutes/hours | Likely yes — full context | — |
| Modify after days | Likely no — session expired | Fresh session reads DECISIONS.md + status-report |
| Different artifact than original | No — wrong session | Fresh session always |

Session resumption is an optimization, not a requirement. DECISIONS.md is the durable layer that always works.

---

## Modify Flow

When the brainstorming skill detects a modify request for an existing capability:

1. **Read DECISIONS.md** — understand history, original provider choice, past changes
2. **Determine change type:**
   - **Configure** — config.yaml values only (e.g., "add Hebrew")
   - **Upgrade** — config + possibly script (e.g., "use Nova-3 model")
   - **Fix** — script bug (e.g., "long audio cuts off")
   - **Replace** — everything changes (e.g., "switch to Whisper")
3. **Write context entry** to DECISIONS.md (why this change)
4. **Spawn builder** with modify spec, including:
   - Target path
   - Change type
   - What to change and what to preserve
   - `resume_from_job` (last job ID from DECISIONS.md)
5. **Builder modifies**, tests, framework appends structured metadata

---

## Target Path Discovery

The executor needs to know WHERE the artifact lives to write DECISIONS.md. This comes from the builder's deliverable frontmatter (`target_path` field), not from the automation schema.

**Why frontmatter, not schema:** Avoids schema changes to `AutomationManifest`, `Job`, and `create_automation` tool. The builder already writes a deliverable — adding frontmatter is a prompt change, not an infrastructure change.

**Discriminator for non-artifact jobs:** Most jobs don't target artifacts (research, daily summaries, debriefs). If the deliverable has no `target_path` in its frontmatter, the executor skips the paper trail step. No special field needed — absence of `target_path` is the discriminator.

---

## Job Artifact Location

Job artifacts stay in `.my_agent/automations/.runs/`. They are NOT moved to the capability folder.

DECISIONS.md entries use relative links to reach them:
```markdown
- **Job:** [build-deepgram-stt/job-73438260](../../automations/.runs/build-deepgram-stt/job-73438260/)
```

**Why not colocate:** Moving artifacts to `.builds/` inside the capability folder would break `AutomationJobService.createRunDir()`, the dashboard UI, `deliverablePath` in the database, and the debrief system. Links achieve the same traceability with zero infrastructure changes.

---

## Framework Code Changes

| File | Change | Scope |
|------|--------|-------|
| `packages/core/src/agents/definitions.ts` | Builder prompt: deliverable frontmatter template (target_path, change_type, provider, test_result, files_changed) | Prompt update |
| `packages/dashboard/src/automations/automation-executor.ts` | Post-completion hook: read deliverable frontmatter, if `target_path` exists → append structured entry to `{target_path}/DECISIONS.md` | ~30 lines |
| `packages/dashboard/src/automations/automation-executor.ts` | Resume support: if `resume_from_job` in spec → look up session ID → try resume → fall back to fresh | ~20 lines |
| `.my_agent/.claude/skills/capability-brainstorming/SKILL.md` | Modify flow: read DECISIONS.md, determine change type, write context entry, pass resume_from_job | Skill update |
| `packages/core/src/prompt.ts` | No change — DECISIONS.md is per-artifact, not injected into system prompt |

**Estimated scope:** 2-3 files of framework code (~50 lines), 2 prompt/skill updates. One sprint.

---

## Non-Goals

- **No `.builds/` subfolder.** Job artifacts stay in `.runs/`, linked from DECISIONS.md.
- **No schema changes.** No new fields on `AutomationManifest`, `Job`, or `create_automation`. Target path comes from deliverable frontmatter.
- **No CHANGELOG.md.** One file (DECISIONS.md) captures both what and why.
- **No rotation/archival.** Capabilities won't have 50+ entries. Defer if ever needed.
- **No automatic space migration.** Spaces already have DECISIONS.md. The pattern is compatible but spaces won't get framework-written entries until explicitly wired.

---

## Future Extensions

- **Spaces:** Wire the same post-completion hook for jobs that target space folders.
- **Transports (M10):** When transport SDK ships, transports can adopt DECISIONS.md.
- **Template versioning:** DECISIONS.md entries include template version. Registry can detect stale capabilities by comparing against current template.
- **Backup/restore (M13):** DECISIONS.md is inside `.my_agent/capabilities/`, automatically included in backup.
