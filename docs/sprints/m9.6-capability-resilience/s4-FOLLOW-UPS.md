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

**Recommended action:** Add the call site in S4's `app.ts` edit, since we're already touching that area. If doing so would exceed the >150-line or >6-file guard, leave for S5.
