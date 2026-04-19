# M9.6-S17 DECISIONS

## D1: Adapter fix over source fix for Item B

**Decision:** Add `"completed"` to `KNOWN_TERMINAL` in `awaitAutomation` (app.ts) and normalise to `"done"` in the return value.

**Rejected:** Changing `automation-executor.ts` to emit `"done"` instead of `"completed"`.

**Why:** `"completed"` is the canonical `Job.status` value throughout the codebase — the Job type union in `automation-job-service.ts`, `automation-server.ts`, `debrief-automation-adapter.ts`, and `app.ts` all use it. Changing the source would require updating the Job type and all downstream consumers. The adapter is the minimal, least-disruptive fix.

**Evidence:** E2E test files (`cfr-phase2-stt-replay.test.ts` et al.) already contained `job.status === "completed" ? "done" : job.status` — the mapping existed in tests but never made it into the production closure.

---

## D2: ESCALATE FU-1 — push synthetic FixAttempt before return

**Decision:** Push a synthetic `FixAttempt` entry (phase="execute", failureMode="escalate: ...") into `session.attempts` before returning `{recovered:false, escalate:true}`.

**Why:** Without this, sessions that hit the ESCALATE path had an empty `session.attempts`, so `CFR_RECOVERY.md` was written with no attempt record — no paper trail for the engineer debugging why the CFR surrendered.

---

## D3: FU-2 — unrecognised ESCALATE reason logs warn, not error

**Decision:** Use `console.warn` for unrecognised ESCALATE reason tokens, not `console.error`.

**Why:** An unrecognised token is not a crash-level error — the surrender path still completes correctly. `console.warn` signals "inspect this" without polluting the error channel.

---

## D4: Budget guard lowered to >= 4 (matches MAX_JOBS)

**Decision:** Update the inline budget guard in `runOneAttempt` from `>= 5` to `>= 4` to match `MAX_JOBS = 4`.

**Why:** With reflect removed, each attempt now uses exactly 1 job (execute only). The old `>= 5` guard was for the 2-jobs-per-attempt model. Aligning the guard to `MAX_JOBS` keeps the state machine and the orchestrator consistent.
