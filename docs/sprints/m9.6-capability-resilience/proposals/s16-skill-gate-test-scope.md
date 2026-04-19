# Deviation Proposal — S16: SKILL.md gate test scope (ARCHITECT S2)

**Blocker:** Plan-phase3 §2.1 acceptance test wording — "authoring-mode prompt still runs
full Steps 1-6; fix-mode prompt runs fix-only path" — implies behavior verification.
At unit-test scope this requires invoking the real skill against an Opus session, which
is out of unit scope.

**What I found:** The achievable unit-level verification is:
(a) SKILL.md contains the Step 0 mode-check section + ESCALATE markers + neutral-identifier
    convention (text presence).
(b) Authoring-mode Steps 1-6 headings + key authoring phrases ("create_automation",
    "Spawn the Builder") survive the Step 0 insert (regression check, ARCHITECT R3).

Behavior-level verification ("did Step 0 actually gate Opus to skip Steps 1-6?") lands
in S20's exit-gate-conversation test which invokes fix-mode end-to-end against a real
broken plug.

**Recommendation:** Approve text-coverage substitution at unit level; behavior verification
deferred to S20.

**Blast radius:** If S20 slips, S16's gate test becomes a weaker safety net. Revisit at S20-time.

**Question for architect:** Approve substitution? S20 takes responsibility for behavior verification?

**Self-answered:** APPROVE — agreed by Phase 3 architect during plan review (R3+S2 frame).
