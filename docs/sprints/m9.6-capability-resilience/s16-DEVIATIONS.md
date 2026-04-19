---
sprint: m9.6-s16
---

# S16 Deviations

## DEV-1 — Integration test depth: writePaperTrail not verified at unit scope (ARCHITECT S1)

- **What:** Plan-phase3 §2.1 asks fix-mode-integration.test.ts to assert "no nested create_automation" and "paper trail appended via writePaperTrail (target_path correctly set on manifest)." `writePaperTrail` is called by the automation framework, not the orchestrator — unreachable at unit-test scope without mocking the entire automation framework.
- **Proposal:** [proposals/s16-integration-test-scope.md](proposals/s16-integration-test-scope.md)
- **Resolution:** Self-answered (Option 2 / Option B) — substitute with orchestrator-level assertions (targetPath set, ≤3 spawns, prompt contains capDir). Behavior verification deferred to S20 exit-gate tests.

## DEV-2 — SKILL.md gate test is text-coverage, not behavior-coverage (ARCHITECT S2)

- **What:** `capability-brainstorming-gate.test.ts` asserts SKILL.md structure (text presence, R3 regression). It cannot assert that Opus actually follows Step 0 and skips authoring steps in fix mode — that requires a live Opus invocation.
- **Proposal:** [proposals/s16-skill-gate-test-scope.md](proposals/s16-skill-gate-test-scope.md)
- **Resolution:** Self-answered — text-coverage substitution approved; behavior verification deferred to S20's cfr-exit-gate-conversation test.

## DEV-3 — Wall-time measurement (Task 12) requires CTO presence — not executed autonomously

- **What:** Task 12 requires triggering real CFR recovery cycles against broken plugs with live Opus API calls. There is no CFR injection endpoint in the debug API; all trigger paths require either sending a real WhatsApp audio message (forbidden in tests) or manually breaking a plug and driving the dashboard.
- **Proposal:** None filed — this is an execution constraint, not a design deviation.
- **Resolution:** Pending CTO-assisted run. The measurement script (`scripts/measure-fix-mode-walltime.js`) and results template (`s16-walltime-results.md`) are ready. Preconditions confirmed: OAuth set, 4 plugs with smoke.sh available. CTO runs Task 12 after trip sprint.
