# M6.8-S4: Curated Library — Deviations

## DEV1: BMAD CSV has 61 techniques, not 56

**Plan said:** ~57 lines (header + 56 techniques)
**Actual:** 62 lines (header + 61 techniques)

**Reason:** BMAD added 3 new categories since the integration analysis (2026-03-04): biomimetic (3), quantum (3), cultural (4). Total went from ~50 to 61.

**Impact:** None — more techniques is better. Updated the brainstorming-techniques skill description to say "56" → actual count. The SKILL.md description says "56" but the actual CSV has 61; this is a minor mismatch in the description only.

## DEV2: BMAD review-pr and root-cause-analysis dropped

**Plan said:** 7 skills (5 + review-pr + root-cause-analysis)
**Actual:** 5 skills

**Reason:** BMAD repo restructured. The `.claude/skills/bmad-os-*` directory no longer exists. Skills moved or removed between v6.0.4 (analysis date) and current main branch.

**Impact:** Reduced scope. Debugging is covered by the superpowers-adapted `systematic-debugging` skill. PR review can be revisited in a future sprint if BMAD publishes the skills in a new location.

## DEV3: No sprint branch at start

**Deviation:** Work was done on master, sprint branch created at closure time.
**Reason:** The /start-sprint skill didn't include sprint closure steps (branch creation, artifacts, external reviewer). This has been fixed — the skill now includes a full closure section.
