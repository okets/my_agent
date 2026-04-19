# Deviation Proposal — S16: integration test depth (ARCHITECT S1)

**Blocker:** The spec (plan-phase3-refinements.md §2.1) asks fix-mode-integration.test.ts to assert
"no nested create_automation" and "paper trail appended via writePaperTrail (target_path correctly
set on manifest)." Both behaviors live outside the orchestrator — in the automation framework
(automation-executor.ts) called on job completion. At unit-test scope, the orchestrator only sees
`spawnAutomation` (a dep injection); writePaperTrail is not reachable without mocking the entire
automation framework.

**Original plan says:** plan-phase3-refinements.md §2.1: "verify: no nested create_automation call,
paper trail appended via writePaperTrail with target_path set."

**What I found:** The orchestrator's surface to verify these behaviors is limited to:
(a) `spec.targetPath` is set correctly (covered in Task 3 + Task 6), and
(b) total spawn count ≤ 3 (covered in Task 6 — no reflect spawn means old 6-spawn path is gone).

True integration verification requires either invoking the real automation-executor (out of unit scope)
or running fix-mode end-to-end against a real Opus session (S20 exit-gate territory).

**Options considered:**
1. Expand mocks to include automation-executor stub → couples the orchestrator test to framework
   internals. Maintenance cost > coverage benefit.
2. Defer behavior verification to S20's definitive smoke tests which exercise the full stack
   end-to-end. Unit tests stay scoped to orchestrator behavior. S20's cfr-exit-gate test verifies
   the paper trail exists on disk after a real capability failure + recovery cycle.

**Recommendation:** Option 2. The orchestrator-level assertions in Task 6 (targetPath set, ≤3 spawns,
prompt contains capDir) are the correct unit-test scope. End-to-end behavior goes in S20.

**Blast radius:** None — Task 6's existing assertions are valid orchestrator-level checks.

**Question for architect:** Approve substitution (Option 2)?
