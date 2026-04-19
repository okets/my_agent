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

## DEV-3 — Wall-time measurement (Task 12) — RESOLVED 2026-04-19

- **What:** Originally blocked (no CFR injection endpoint; manual trigger required).
- **Resolution:** Measurement executed via `POST /api/automations/:id/fire` HTTP API. Synthetic test capability with `smoke.sh exit 1` stood in for a real broken plug. Opus completed in **100 s (1.7 min)**. Gate decision: **Branch A — ship as-is**. Results: `s16-walltime-results.md`.
