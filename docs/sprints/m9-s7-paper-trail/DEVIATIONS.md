# M9-S7 Deviations Log

## DEV1: Language autodetect tasks bundled into sprint
**Type:** Scope addition
**Original plan:** 9 tasks — paper trail only.
**Actual:** 12 tasks — added 3 language autodetect tasks (template updates + framework threading).
**Reason:** CTO requested bundling since the sprint was small. Language autodetect is the first real test case for the modify flow.
**Impact:** Minimal — 3 extra tasks, ~10 lines of framework code + 2 template updates.

## DEV2: Brainstorming skill moved to framework
**Type:** Scope addition
**Original plan:** Brainstorming skill stays in `.my_agent/` (gitignored).
**Actual:** Moved to `packages/core/skills/capability-brainstorming/`, shipped with framework.
**Reason:** CTO flagged that users wouldn't receive the skill since `.my_agent/` is gitignored. The hatching copy mechanism already handles framework→agent skill distribution.
**Impact:** Skill now ships with the framework. Existing agents get it via hatching's `copyFrameworkSkills()`. Instance-specific voice-evaluation reference not included (already covered by templates).
