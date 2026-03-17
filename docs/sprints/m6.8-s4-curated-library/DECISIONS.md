# M6.8-S4: Curated Library — Decisions

## D1: Introduce `origin: curated` tier

**Decision:** Add a third origin value — `curated` — between `system` and `user`.

**Context:** CTO asked: "what if I want these curated skills in every my_agent?" and "these are not to be disabled as user skills might." This revealed that `system` (core infrastructure like task-triage) and `user` (agent-created, toggleable) don't cover framework-shipped capabilities that every instance should get but aren't core infrastructure.

**Alternatives considered:**
- Use `origin: system` — rejected because curated skills are a feature layer (brainstorming, image-gen), not infrastructure
- Use `origin: user` — rejected because users must not disable framework capabilities

**Result:** Three-tier model: `system` (infrastructure, non-toggleable), `curated` (capabilities, non-toggleable), `user` (agent-created, toggleable). Dashboard S6 will treat both `system` and `curated` as view-only.

## D2: Skills live in repo, copy at hatch time

**Decision:** Curated skills source in `packages/core/skills/` (committed), copied to `.my_agent/.claude/skills/` during hatching.

**Context:** CTO wanted skills available to every my_agent instance, not just in gitignored space.

**Result:** `copyFrameworkSkills()` copies all skill directories at hatch time with no-overwrite semantics. Existing instances get skills via manual copy or re-hatch.

## D3: Drop BMAD review-pr and root-cause-analysis

**Decision:** Removed from scope.

**Context:** The BMAD integration analysis (2026-03-04) referenced `bmad-os-review-pr` and `bmad-os-root-cause-analysis` at `.claude/skills/bmad-os-*/`. The current BMAD repo (fetched 2026-03-17) has restructured — these skills no longer exist at those paths. No equivalent found.

**Result:** 5 skills instead of 7. Debugging coverage is handled by the superpowers-adapted `systematic-debugging` skill.

## D4: Brainstorming skill explicitly references technique libraries

**Decision:** Added a "Technique Libraries" section to the brainstorming skill that tells Nina to invoke `brainstorming-techniques` and `elicitation-techniques` during brainstorming sessions.

**Context:** CTO asked "how will Nina know when to work with BMAD or the brainstorming skill?" Without an explicit cross-reference, Nina would need to independently decide to invoke technique libraries — fragile.

**Result:** The brainstorming skill orchestrates the full flow; technique libraries are invoked as enrichment during the process.

## D5: Visual Companion deferred to M6.10

**Decision:** Stripped the Visual Companion (browser-based mockup/diagram tool) from the brainstorming skill.

**Context:** The superpowers version opens a local browser server for terminal-based visual brainstorming. Nina's dashboard chat is a different medium — showing rich content there requires dashboard-native rendering, not a separate browser server. This is a multimodal concern.

**Result:** Brainstorming is text-only for now. Visual companion is an M6.10 enrichment.
