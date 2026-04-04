# M9-S7 Decisions Log

## D1: DECISIONS.md only, no CHANGELOG.md
**Severity:** Minor (follows design spec)
**Decision:** One file (DECISIONS.md) captures both what changed and why. No separate CHANGELOG.
**Reason:** Design spec principle §1 — "One file, not two." Reduces file clutter and avoids redundancy.

## D2: target_path resolution relative to agentDir parent
**Severity:** Minor
**Decision:** `path.resolve(this.config.agentDir, '..', data.target_path)` — target_path in deliverable frontmatter is relative to the repo root (e.g., `.my_agent/capabilities/stt-deepgram`).
**Reason:** The agentDir is `.my_agent/`, but target_path starts with `.my_agent/` for clarity in the builder's deliverable. Resolving from parent gives the correct absolute path.

## D3: Prepend entries after header, not append
**Severity:** Minor
**Decision:** New DECISIONS.md entries are inserted after the `# Decisions` header, before existing entries (most recent first).
**Reason:** Design spec format shows most recent first. Easier to find latest change at the top.

## D4: resume_from_job extracted via regex from instructions
**Severity:** Medium
**Decision:** The executor extracts `resume_from_job: <job-id>` from the automation instructions text via regex, rather than adding a field to AutomationManifest.
**Reason:** Design spec explicitly says "No schema changes." The brainstorming skill includes this in the automation instructions body.

## D5: WhatsApp TTS language threading deferred
**Severity:** Minor
**Decision:** Language autodetect threading only implemented for dashboard path. WhatsApp voice reply path (`onSendVoiceReply`) does not receive detected language.
**Reason:** WhatsApp plugin handles its own transcription — the framework STT doesn't run for WhatsApp voice notes. Adding language support there requires WhatsApp plugin changes, which is a separate concern.

## D7: Move brainstorming skill from .my_agent/ to packages/core/skills/
**Severity:** Medium (CTO decision)
**Decision:** Brainstorming skill moved to `packages/core/skills/capability-brainstorming/`. The hatching `copyFrameworkSkills()` function copies it to `.my_agent/.claude/skills/` on new agent setups. Voice-evaluation reference left out (instance-specific data duplicated by templates).
**Reason:** CTO pointed out the skill was in `.my_agent/` (gitignored), so other users wouldn't get it. Framework skills must ship with the repo. The hatching copy mechanism already exists for this exact purpose.

## D6: Language field is optional in template contracts
**Severity:** Minor
**Decision:** Both `language` in STT output and `[language]` arg in TTS invocation are optional, backwards compatible.
**Reason:** Existing scripts should continue to work without modification. Language support is additive.
