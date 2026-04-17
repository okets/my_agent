---
sprint: m9.6-s11
title: Template Smoke Fixtures — Decisions
---

# S11 Decisions

## D1 — Smoke fixture is a liveness check, not a quality check

**Decision:** The `smoke.sh` reference implementations validate that the capability's core script runs and returns structurally valid output (JSON with required fields, file exists and is non-trivially sized). They do not validate semantic quality (transcription accuracy, voice naturalness, image prompt fidelity).

**Rationale:** Smoke fixtures are designed to be fast, cheap, and reproducible. A quality check would require a known-good reference output to compare against, which varies by provider and model version. Liveness is what the reverify dispatcher needs: "is the capability operational?" not "is it producing good output?".

The `audio-to-text` template explicitly notes that a sine wave won't produce meaningful transcription — smoke exits 0 regardless of transcript content. This is correct.

---

## D2 — `runSmokeFixture` signature: `(capDir, registry, capabilityType)` not `(failure, registry)`

**Decision:** Implemented `runSmokeFixture(capDir, registry, capabilityType)` rather than the plan sketch's `(failure, registry)`.

**Rationale:** `runSmokeFixture` has no need for the full `CapabilityFailure` shape. Only `capDir` (to locate smoke.sh) and `capabilityType` (for the fallback availability check) are required. Passing the full failure object would couple this utility to the CFR type unnecessarily.

**Impact on S14:** S14's dispatcher will call `runSmokeFixture(cap.path, registry, failure.capabilityType)`. This is simpler than the plan sketch. A deviation note is in `reverify.ts` at the function definition.

---

## D3 — MCP template stubs use `sleep 3` not `sleep 2`

**Decision:** The minimal smoke stubs for browser-control and desktop-control templates wait 3 seconds before probing server liveness, not 2.

**Rationale:** Cold-start `npx tsx` can take 3–6 seconds on a machine without a warm tsx cache. 2 seconds was judged too short for reliable green results in CI on cold machines.
