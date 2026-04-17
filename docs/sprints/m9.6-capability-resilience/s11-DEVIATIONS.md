---
sprint: m9.6-s11
title: Template Smoke Fixtures — Deviations
---

# S11 Deviations

## DEV-1 — `runSmokeFixture` implemented in S11 (S13 scope)

**Status:** Accepted by architect (see s11-architect-review.md §2)

**What the plan says:** `plan-phase2-coverage.md §2.5` (S13) lists `runSmokeFixture` as an S13 deliverable.

**What was done:** `runSmokeFixture` was implemented and exported from `reverify.ts` in S11, with 4 unit tests.

**Why:** The dev sub-task plan included `runSmokeFixture` without checking its sprint assignment in the architect plan. This is a §0.2 violation — scope expansion requires a deviation proposal before work begins.

**Architect decision:** Accept the implementation (it is well-built and tested). S13 will mark `runSmokeFixture` as already-delivered and only wire it into the dispatcher.

**S13 impact:** S13 dispatcher must use signature `runSmokeFixture(cap.path, registry, failure.capabilityType)` — see D2 in DECISIONS.md. The architect will update `plan-phase2-coverage.md §2.5` accordingly.

**Process correction:** Per §0.2, any future work outside the architect plan's "Files" list requires a `proposals/s<N>-<slug>.md` filed before the work begins. Inline code comments do not substitute for deviation proposals.

---

## DEV-2 — `runSmokeFixture` signature differs from plan sketch

**Status:** Accepted — non-blocking

**What the plan says:** `plan-phase2-coverage.md §12.6` sketches `runSmokeFixture(failure, registry)`.

**What was shipped:** `runSmokeFixture(capDir: string, registry: CapabilityRegistry, capabilityType: string)`

**Rationale:** See DECISIONS.md D2. The simpler signature doesn't couple the function to `CapabilityFailure`. S14 adopts this signature when writing the dispatcher.

**Evidence:** Deviation note at `packages/core/src/capabilities/reverify.ts` line 227–229.
