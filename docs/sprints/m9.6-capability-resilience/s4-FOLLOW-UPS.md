# S4 Follow-Ups — Recovery Orchestrator

Sprint: M9.6-S4
Branch: sprint/m9.6-s4-recovery-orchestrator

---

## FU1 — EventEmitter-based job completion API (out of scope)

**Observation:** `awaitAutomation` currently polls `getJob()` every 2s. A cleaner implementation would add a `once('job:done', handler)` EventEmitter to `AutomationJobService`, eliminating the poll interval.

**Why not now:** Modifies shared infrastructure outside S4's declared file set. D2 deviation covers the polling approach for this sprint.

**Suggested sprint:** M9.6-S7 or post-milestone cleanup.

---

## FU2 — getHealth() boot-time WARN call site (carried from S3)

**Observation:** S3 review finding F1 — `registry.getHealth()` exists and is tested but has no call site in `app.ts` after `capabilityWatcher.start()`. S3 filed this in `s3-FOLLOW-UPS.md`. Carrying forward since S4 touches `app.ts`.

**Recommended action:** Confirmed by reviewer — JC2 documents that this was already implemented in S3 inside `testAll()` chain. Follow-up closed.

---

## FU3 — Cross-session nested CFR budget not structurally enforced (reviewer F1)

**Observation:** Plan §6.1 specifies `totalJobsInThisTrigger: Map<triggerRootId, count>` to cap nested-CFR job spawns across sessions. `CapabilityFailure.parentFailureId` is declared in `cfr-types.ts:59` but no producer sets it and no consumer reads it. Budget is currently tracked per-session only. The per-type `inFlight` mutex makes the most obvious nesting vector unreachable, so M9.6 is safe.

**Why not now:** Wiring `parentFailureId` through all CFR emitters is out of S4's declared scope.

**Suggested sprint:** S5 or S6, before any nested emitter is added.

---

## FU4 — Surrender ack missing reason discriminator (reviewer F3)

**Observation:** Plan §6 acceptance test 2.c expects surrender ack to include `reason: "budget-exhausted"`. Current `AckKind = "attempt" | "status" | "surrender"` has no reason field. S6 replaces the ack stub entirely with real channel delivery.

**Recommended action:** When S6 implements real ack delivery, widen the interface: `AckKind` → `{ kind: "surrender"; reason: "budget-exhausted" | "max-attempts" }` or similar.

**Suggested sprint:** S6 (messaging implementation).
